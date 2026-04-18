// ---------------------------------------------------------------------------
// Harmony Service Bootstrap
// ---------------------------------------------------------------------------
//
// This module creates and manages the singleton Harmony orchestrator.
// It's initialized via Next.js instrumentation.ts and accessed by API routes.
//
// MOCK MODE: When LINEAR_API_KEY is not set (or HARMONY_MOCK=true), the
// service starts with mock tracker + mock agent runner so the full dashboard
// and orchestration loop can be demonstrated without external dependencies.
// ---------------------------------------------------------------------------

import { loadWorkflow, watchWorkflow } from './policy/workflow-loader';
import { resolveConfig, validateDispatchConfig, type ValidationResult } from './config/resolver';
import { LinearClient } from './tracker/linear';
import { GitHubClient } from './tracker/github';
import { MockTrackerClient } from './tracker/mock';
import { CompositeTracker } from './tracker/composite';
import { Scheduler } from './orchestrator/scheduler';
import type { AgentRunner } from './orchestrator/scheduler';
import { WorkspaceManagerImpl } from './executor/workspace';
import { AgentRunnerImpl } from './executor/agent-runner';
import { ClaudeAgentRunner } from './executor/claude-agent-runner';
import { MockAgentRunner } from './executor/mock-agent-runner';
import { logger } from './observability/logger';
import type { ServiceConfig } from './tracker/types';
import type { TrackerClient } from './tracker/client';
import type { FSWatcher } from 'chokidar';
import * as path from 'path';

// ---------------------------------------------------------------------------
// Singleton (uses globalThis so the reference survives across Next.js
// module-scope boundaries between instrumentation.ts and API routes)
// ---------------------------------------------------------------------------

const GLOBAL_KEY = '__harmony_scheduler__' as const;
const GLOBAL_MOCK_KEY = '__harmony_mock__' as const;
const GLOBAL_WATCHER_KEY = '__harmony_watcher__' as const;

function getGlobal<T>(key: string): T | null {
  return (globalThis as Record<string, unknown>)[key] as T | null ?? null;
}
function setGlobal<T>(key: string, value: T): void {
  (globalThis as Record<string, unknown>)[key] = value;
}

/**
 * Get the running Scheduler instance (for API routes to read state).
 * Returns null if the service hasn't started yet.
 */
export function getScheduler(): Scheduler | null {
  return getGlobal<Scheduler>(GLOBAL_KEY);
}

/** Whether the service is running in mock mode. */
export function isMockMode(): boolean {
  return getGlobal<boolean>(GLOBAL_MOCK_KEY) ?? false;
}

/**
 * Start the Harmony service.
 *
 * Loads WORKFLOW.md, resolves config, creates all layers, starts the
 * scheduler, and begins watching for workflow file changes.
 *
 * If LINEAR_API_KEY is missing or HARMONY_MOCK=true, starts in mock mode
 * with simulated issues and agent runs.
 */
export async function startHarmony(
  workflowPath?: string,
): Promise<void> {
  const resolvedPath = path.resolve(
    workflowPath ?? process.env.HARMONY_WORKFLOW_PATH ?? './WORKFLOW.md',
  );

  logger.info('Harmony starting', { workflow_path: resolvedPath });

  // 1. Load workflow
  const workflow = await loadWorkflow(resolvedPath);
  const config = resolveConfig(workflow.config);
  const promptTemplate = workflow.promptTemplate;

  // 2. Determine mock mode
  const forceMock = process.env.HARMONY_MOCK === 'true';
  const missingApiKey = !config.tracker.apiKey;
  const _mockMode = forceMock || missingApiKey;
  setGlobal(GLOBAL_MOCK_KEY, _mockMode);

  if (_mockMode) {
    logger.info('Starting in MOCK MODE (no external dependencies required)', {
      reason: forceMock ? 'HARMONY_MOCK=true' : 'LINEAR_API_KEY not set',
    });
  }

  // 3. Validate config (skip tracker validation in mock mode)
  if (!_mockMode) {
    const validation = validateDispatchConfig(config);
    if (!validation.ok) {
      logger.error('Config validation failed at startup', {
        errors: validation.errors,
      });
      throw new Error(
        `Harmony startup failed: ${validation.errors.join('; ')}`,
      );
    }
  }

  // 4. Create tracker client
  const tracker = createTracker(config, _mockMode);

  // 5. Create workspace manager
  const workspaceManager = new WorkspaceManagerImpl(
    config.workspace.root,
    // Disable hooks in mock mode to avoid needing bash/git
    _mockMode
      ? { afterCreate: null, beforeRun: null, afterRun: null, beforeRemove: null, timeoutMs: config.hooks.timeoutMs }
      : config.hooks,
  );

  // 6. Create agent runner
  const agentRunner: AgentRunner = _mockMode
    ? new MockAgentRunner()
    : config.claude.enabled
      ? new ClaudeAgentRunner(tracker)
      : new AgentRunnerImpl(tracker);

  // 7. Apply mock-friendly config overrides
  const effectiveConfig: ServiceConfig = _mockMode
    ? {
        ...config,
        tracker: {
          ...config.tracker,
          apiKey: 'mock-api-key',
          projectSlug: config.tracker.projectSlug || 'mock-project',
        },
        polling: { intervalMs: 15_000 }, // Poll faster in mock mode
        agent: {
          ...config.agent,
          maxConcurrentAgents: 3, // Limit so retries are visible
        },
      }
    : config;

  // 8. Create and start scheduler
  const scheduler = new Scheduler({
    config: effectiveConfig,
    promptTemplate,
    tracker,
    workspaceManager,
    agentRunner,
  });
  setGlobal(GLOBAL_KEY, scheduler);

  await scheduler.start();

  // 9. Watch for workflow changes (Section 6.2)
  const watcher = watchWorkflow(resolvedPath, (newDef) => {
    try {
      const newConfig = resolveConfig(newDef.config);
      const currentScheduler = getScheduler();
      const mockMode = isMockMode();

      if (!mockMode) {
        const newValidation = validateDispatchConfig(newConfig);
        if (!newValidation.ok) {
          logger.error('Invalid workflow reload, keeping last good config', {
            errors: newValidation.errors,
          });
          return;
        }
      }

      currentScheduler?.reloadConfig(
        mockMode
          ? {
              ...newConfig,
              tracker: {
                ...newConfig.tracker,
                apiKey: 'mock-api-key',
                projectSlug: newConfig.tracker.projectSlug || 'mock-project',
              },
            }
          : newConfig,
        newDef.promptTemplate,
      );
      logger.info('Workflow reloaded successfully');
    } catch (err) {
      logger.error('Workflow reload error, keeping last good config', {
        error: err instanceof Error ? err.message : String(err),
      });
    }
  });

  setGlobal(GLOBAL_WATCHER_KEY, watcher);

  logger.info('Harmony started successfully', {
    mock_mode: _mockMode,
    agent_runner: _mockMode ? 'mock' : config.claude.enabled ? 'claude' : 'codex',
    tracker_kind: _mockMode ? 'mock' : config.tracker.kind,
    project_slug: effectiveConfig.tracker.projectSlug,
    workspace_root: effectiveConfig.workspace.root,
    poll_interval_ms: effectiveConfig.polling.intervalMs,
    max_concurrent: effectiveConfig.agent.maxConcurrentAgents,
  });
}

/**
 * Stop the Harmony service gracefully.
 */
export async function stopHarmony(): Promise<void> {
  const watcher = getGlobal<FSWatcher>(GLOBAL_WATCHER_KEY);
  if (watcher) {
    await watcher.close();
    setGlobal(GLOBAL_WATCHER_KEY, null);
  }
  const scheduler = getScheduler();
  if (scheduler) {
    await scheduler.stop();
    setGlobal(GLOBAL_KEY, null);
  }
  logger.info('Harmony stopped');
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function createTracker(config: ServiceConfig, mockMode: boolean): TrackerClient {
  let baseTracker: TrackerClient;

  if (mockMode) {
    baseTracker = new MockTrackerClient();
  } else {
    switch (config.tracker.kind) {
      case 'linear':
        baseTracker = new LinearClient(config.tracker);
        break;
      case 'github':
        baseTracker = new GitHubClient(config.tracker);
        break;
      default:
        throw new Error(`Unsupported tracker kind: ${config.tracker.kind}`);
    }
  }

  // Wrap in CompositeTracker to support manually-added issues
  return new CompositeTracker(baseTracker);
}
