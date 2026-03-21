// ---------------------------------------------------------------------------
// Symphony Scheduler – The Core Orchestration Loop (Spec Sections 7–8, 16)
// ---------------------------------------------------------------------------

import type {
  Issue,
  OrchestratorState,
  ServiceConfig,
  RunningEntry,
  RunStatus,
  CodexUpdateEvent,
} from '../tracker/types';
import type { TrackerClient } from '../tracker/client';
import { logger } from '../observability/logger';
import { createInitialState, availableSlots, addRuntimeSeconds } from './state';
import { sortForDispatch, shouldDispatch } from './dispatcher';
import { reconcileRunningIssues, type ReconciliationCallbacks } from './reconciler';
import { scheduleRetry, cancelRetry, releaseClaim } from './retry';
import { validateDispatchConfig } from '../config/resolver';

// Forward-declared types for the executor layer (avoids circular imports)
export interface WorkspaceManager {
  createForIssue(identifier: string): Promise<{ path: string; workspaceKey: string; createdNow: boolean }>;
  removeWorkspace(identifier: string): Promise<void>;
}

export interface AgentRunner {
  runAttempt(params: {
    issue: Issue;
    attempt: number | null;
    workspacePath: string;
    config: ServiceConfig;
    promptTemplate: string;
    onUpdate: (event: CodexUpdateEvent) => void;
  }): Promise<{ success: boolean; error?: string }>;

  terminateRun(issueId: string): Promise<void>;
}

// ---------------------------------------------------------------------------
// Scheduler
// ---------------------------------------------------------------------------

export class Scheduler {
  private state: OrchestratorState;
  private tickTimer: ReturnType<typeof setTimeout> | null = null;
  private config: ServiceConfig;
  private promptTemplate: string;
  private tracker: TrackerClient;
  private workspace: WorkspaceManager;
  private agentRunner: AgentRunner;
  private running = false;
  private refreshQueued = false;
  private autoDispatch = false;

  // Map issueId → abort controller so we can cancel running workers
  private workerAborts = new Map<string, AbortController>();

  constructor(params: {
    config: ServiceConfig;
    promptTemplate: string;
    tracker: TrackerClient;
    workspaceManager: WorkspaceManager;
    agentRunner: AgentRunner;
  }) {
    this.config = params.config;
    this.promptTemplate = params.promptTemplate;
    this.tracker = params.tracker;
    this.workspace = params.workspaceManager;
    this.agentRunner = params.agentRunner;

    this.state = createInitialState(
      params.config.polling.intervalMs,
      params.config.agent.maxConcurrentAgents,
    );
  }

  // ---- Public API ----------------------------------------------------------

  /** Start the service (Section 16.1). */
  async start(): Promise<void> {
    logger.info('Symphony scheduler starting');

    // Validate config before starting
    const validation = validateDispatchConfig(this.config);
    if (!validation.ok) {
      for (const err of validation.errors) {
        logger.error('Startup validation failed', { error: err });
      }
      throw new Error(`Startup validation failed: ${validation.errors.join('; ')}`);
    }

    // Startup terminal workspace cleanup (Section 8.6)
    await this.startupTerminalCleanup();

    this.running = true;

    // Schedule immediate first tick
    this.scheduleTick(0);

    logger.info('Symphony scheduler started', {
      poll_interval_ms: this.state.pollIntervalMs,
      max_concurrent_agents: this.state.maxConcurrentAgents,
    });
  }

  /** Stop the scheduler gracefully. */
  async stop(): Promise<void> {
    this.running = false;

    if (this.tickTimer) {
      clearTimeout(this.tickTimer);
      this.tickTimer = null;
    }

    // Cancel all retry timers
    for (const [issueId] of this.state.retryAttempts) {
      cancelRetry(this.state, issueId);
    }

    // Terminate all running workers
    for (const [issueId] of this.state.running) {
      await this.terminateWorker(issueId, false);
    }

    logger.info('Symphony scheduler stopped');
  }

  /** Get the current state for snapshots / API. */
  getState(): OrchestratorState {
    return this.state;
  }

  /** Dynamic config reload (Section 6.2). */
  reloadConfig(config: ServiceConfig, promptTemplate: string): void {
    this.config = config;
    this.promptTemplate = promptTemplate;
    this.state.pollIntervalMs = config.polling.intervalMs;
    this.state.maxConcurrentAgents = config.agent.maxConcurrentAgents;
    logger.info('Config reloaded', {
      poll_interval_ms: config.polling.intervalMs,
      max_concurrent_agents: config.agent.maxConcurrentAgents,
    });
  }

  /** Trigger an immediate poll+reconcile cycle (for /api/v1/refresh). */
  triggerRefresh(): void {
    if (this.refreshQueued) return;
    this.refreshQueued = true;

    // Cancel current scheduled tick and run immediately
    if (this.tickTimer) {
      clearTimeout(this.tickTimer);
      this.tickTimer = null;
    }
    this.scheduleTick(0);
  }

  /** Toggle auto-dispatch on/off. */
  setAutoDispatch(enabled: boolean): void {
    this.autoDispatch = enabled;
    logger.info('Auto-dispatch toggled', { auto_dispatch: enabled });
  }

  /** Whether auto-dispatch is enabled. */
  isAutoDispatch(): boolean {
    return this.autoDispatch;
  }

  /** Get the list of available (dispatchable) issues from the tracker. */
  async getAvailableIssues(): Promise<Issue[]> {
    try {
      const candidates = await this.tracker.fetchCandidateIssues();
      const sorted = sortForDispatch(candidates);
      return sorted.filter(issue => shouldDispatch(issue, this.state, this.config));
    } catch {
      return [];
    }
  }

  /** Manually start a session for a specific issue by ID. Returns true if dispatched. */
  async manualStart(issueId: string): Promise<boolean> {
    // If already running or claimed, reject
    if (this.state.running.has(issueId) || this.state.claimed.has(issueId)) {
      return false;
    }

    // Fetch candidates and find the requested issue
    let candidates: Issue[];
    try {
      candidates = await this.tracker.fetchCandidateIssues();
    } catch {
      return false;
    }

    const issue = candidates.find(c => c.id === issueId);
    if (!issue) return false;

    // Dispatch the issue
    this.dispatchIssue(issue, null);
    return true;
  }

  /** Manually stop a running session for a specific issue by ID. */
  async manualStop(issueId: string): Promise<boolean> {
    const entry = this.state.running.get(issueId);
    if (!entry) return false;

    const log = logger.forIssue(issueId, entry.issueIdentifier);
    log.info('Manual stop requested');

    // Terminate the worker
    await this.terminateWorker(issueId, false);

    // Remove from running and claimed, cancel any retry
    this.state.running.delete(issueId);
    this.workerAborts.delete(issueId);
    addRuntimeSeconds(this.state, entry);
    cancelRetry(this.state, issueId);
    releaseClaim(this.state, issueId);

    return true;
  }

  /** Delete a completed/stopped session (remove from completed set and clean workspace). */
  async deleteSession(issueId: string, identifier: string): Promise<boolean> {
    // If still running, stop it first
    if (this.state.running.has(issueId)) {
      await this.manualStop(issueId);
    }

    // Cancel any pending retry
    cancelRetry(this.state, issueId);
    releaseClaim(this.state, issueId);

    // Remove from completed set
    this.state.completed.delete(issueId);

    // Clean workspace
    try {
      await this.workspace.removeWorkspace(identifier);
    } catch {
      // Best effort
    }

    logger.info('Session deleted', { issue_id: issueId, issue_identifier: identifier });
    return true;
  }

  // ---- Tick Loop (Section 16.2) -------------------------------------------

  private scheduleTick(delayMs: number): void {
    if (!this.running) return;
    this.tickTimer = setTimeout(() => this.tick(), delayMs);
  }

  private async tick(): Promise<void> {
    if (!this.running) return;
    this.refreshQueued = false;

    try {
      // 1. Reconcile running issues FIRST (always, even if validation fails)
      this.state = await reconcileRunningIssues(
        this.state,
        this.tracker,
        this.config,
        this.getReconciliationCallbacks(),
      );

      // 2. Validate config for dispatch
      const validation = validateDispatchConfig(this.config);
      if (!validation.ok) {
        logger.error('Dispatch validation failed, skipping dispatch', {
          errors: validation.errors.join('; '),
        });
        this.scheduleTick(this.state.pollIntervalMs);
        return;
      }

      // 3. Fetch candidate issues (only when auto-dispatch is enabled)
      if (this.autoDispatch) {
        let candidates: Issue[];
        try {
          candidates = await this.tracker.fetchCandidateIssues();
        } catch (err) {
          logger.error('Candidate fetch failed, skipping dispatch', {
            error: err instanceof Error ? err.message : String(err),
          });
          this.scheduleTick(this.state.pollIntervalMs);
          return;
        }

        // 4. Sort and dispatch
        const sorted = sortForDispatch(candidates);
        for (const issue of sorted) {
          if (availableSlots(this.state) <= 0) break;
          if (shouldDispatch(issue, this.state, this.config)) {
            this.dispatchIssue(issue, null);
          }
        }
      }
    } catch (err) {
      logger.error('Tick error', {
        error: err instanceof Error ? err.message : String(err),
      });
    }

    // 5. Schedule next tick
    this.scheduleTick(this.state.pollIntervalMs);
  }

  // ---- Dispatch (Section 16.4) --------------------------------------------

  private dispatchIssue(issue: Issue, attempt: number | null): void {
    const log = logger.forIssue(issue.id, issue.identifier);
    log.info('Dispatching issue', { attempt, state: issue.state });

    // Mark as claimed and create running entry
    this.state.claimed.add(issue.id);

    const runningEntry: RunningEntry = {
      issueId: issue.id,
      issueIdentifier: issue.identifier,
      attempt: attempt ?? 0,
      workspacePath: '',
      startedAt: new Date(),
      status: 'PreparingWorkspace' as RunStatus,
      session: null,
      issue,
      inputTokens: 0,
      outputTokens: 0,
      totalTokens: 0,
      turnCount: 0,
      lastActivityMs: Date.now(),
    };
    this.state.running.set(issue.id, runningEntry);

    // Remove from retry queue if present
    cancelRetry(this.state, issue.id);

    // Spawn worker as async task
    const abort = new AbortController();
    this.workerAborts.set(issue.id, abort);

    this.runWorker(issue, attempt, abort.signal)
      .then(() => {
        this.onWorkerExit(issue.id, 'normal');
      })
      .catch((err) => {
        this.onWorkerExit(
          issue.id,
          'abnormal',
          err instanceof Error ? err.message : String(err),
        );
      });
  }

  // ---- Worker (Section 16.5) ----------------------------------------------

  private async runWorker(
    issue: Issue,
    attempt: number | null,
    signal: AbortSignal,
  ): Promise<void> {
    const log = logger.forIssue(issue.id, issue.identifier);

    // 1. Create/reuse workspace
    let workspace;
    try {
      workspace = await this.workspace.createForIssue(issue.identifier);
    } catch (err) {
      throw new Error(`Workspace error: ${err instanceof Error ? err.message : String(err)}`);
    }

    // Update running entry with workspace path
    const entry = this.state.running.get(issue.id);
    if (entry) {
      entry.workspacePath = workspace.path;
      entry.status = 'LaunchingAgentProcess' as RunStatus;
    }

    if (signal.aborted) throw new Error('Worker cancelled');

    // 2. Run the agent attempt
    const result = await this.agentRunner.runAttempt({
      issue,
      attempt,
      workspacePath: workspace.path,
      config: this.config,
      promptTemplate: this.promptTemplate,
      onUpdate: (event) => this.onCodexUpdate(issue.id, event),
    });

    if (!result.success) {
      throw new Error(result.error ?? 'Agent run failed');
    }

    log.info('Worker completed successfully', { attempt });
  }

  // ---- Worker Exit (Section 16.6) -----------------------------------------

  private onWorkerExit(
    issueId: string,
    reason: 'normal' | 'abnormal',
    error?: string,
  ): void {
    const entry = this.state.running.get(issueId);
    if (!entry) return;

    const log = logger.forIssue(issueId, entry.issueIdentifier);

    // Remove from running map and add runtime to totals
    this.state.running.delete(issueId);
    this.workerAborts.delete(issueId);
    addRuntimeSeconds(this.state, entry);

    if (reason === 'normal') {
      // Bookkeeping
      this.state.completed.add(issueId);

      if (!this.autoDispatch) {
        // Manual mode: just mark completed and release claim, no continuation retry
        log.info('Worker exited normally (manual mode), releasing claim');
        releaseClaim(this.state, issueId);
      } else {
        // Schedule continuation retry (attempt 1, 1s delay) — Section 8.4
        log.info('Worker exited normally, scheduling continuation check');
        this.state = scheduleRetry(
          this.state,
          issueId,
          1,
          { identifier: entry.issueIdentifier, isContinuation: true },
          this.config.agent.maxRetryBackoffMs,
          (id) => this.onRetryTimer(id),
        );
      }
    } else {
      // Abnormal exit: exponential backoff retry
      const nextAttempt = (entry.attempt ?? 0) + 1;
      log.warn('Worker exited abnormally, scheduling retry', {
        error,
        next_attempt: nextAttempt,
      });
      this.state = scheduleRetry(
        this.state,
        issueId,
        nextAttempt,
        {
          identifier: entry.issueIdentifier,
          error: error ?? 'unknown error',
        },
        this.config.agent.maxRetryBackoffMs,
        (id) => this.onRetryTimer(id),
      );
    }
  }

  // ---- Retry Timer (Section 16.6) -----------------------------------------

  private async onRetryTimer(issueId: string): Promise<void> {
    const retryEntry = this.state.retryAttempts.get(issueId);
    if (!retryEntry) return;

    // Remove the retry entry (timer has fired)
    this.state.retryAttempts.delete(issueId);

    const log = logger.forIssue(issueId, retryEntry.identifier);

    // Fetch active candidates
    let candidates: Issue[];
    try {
      candidates = await this.tracker.fetchCandidateIssues();
    } catch {
      // Re-schedule retry on fetch failure
      log.warn('Retry poll failed, re-scheduling');
      this.state = scheduleRetry(
        this.state,
        issueId,
        retryEntry.attempt + 1,
        {
          identifier: retryEntry.identifier,
          error: 'retry poll failed',
        },
        this.config.agent.maxRetryBackoffMs,
        (id) => this.onRetryTimer(id),
      );
      return;
    }

    // Find the issue among candidates
    const issue = candidates.find((c) => c.id === issueId);
    if (!issue) {
      // Issue no longer a candidate — release claim
      log.info('Issue no longer a candidate, releasing claim');
      releaseClaim(this.state, issueId);
      return;
    }

    // Check if slots are available
    if (availableSlots(this.state) <= 0) {
      log.info('No available slots, re-scheduling retry');
      this.state = scheduleRetry(
        this.state,
        issueId,
        retryEntry.attempt + 1,
        {
          identifier: issue.identifier,
          error: 'no available orchestrator slots',
        },
        this.config.agent.maxRetryBackoffMs,
        (id) => this.onRetryTimer(id),
      );
      return;
    }

    // Dispatch
    this.dispatchIssue(issue, retryEntry.attempt);
  }

  // ---- Codex Update Handler -----------------------------------------------

  private onCodexUpdate(issueId: string, event: CodexUpdateEvent): void {
    const entry = this.state.running.get(issueId);
    if (!entry) return;

    // Update last activity timestamp (for stall detection)
    entry.lastActivityMs = Date.now();
    if (entry.session) {
      entry.session.lastActivityMs = Date.now();
    }

    switch (event.kind) {
      case 'session_init':
        entry.sessionId = event.sessionId;
        if (entry.session) {
          entry.session.sessionId = event.sessionId;
        }
        entry.status = 'StreamingTurn' as RunStatus;
        break;

      case 'usage':
        entry.inputTokens = event.inputTokens;
        entry.outputTokens = event.outputTokens;
        entry.totalTokens = event.totalTokens;
        if (entry.session) {
          entry.session.usage.inputTokens = event.inputTokens;
          entry.session.usage.outputTokens = event.outputTokens;
          entry.session.usage.totalTokens = event.totalTokens;
        }
        break;

      case 'rate_limit':
        this.state.codexRateLimits = event.headers;
        break;

      case 'turn_start':
        entry.turnCount = event.turnNumber;
        if (entry.session) {
          entry.session.turnCount = event.turnNumber;
        }
        break;

      case 'error':
        if (event.fatal) {
          entry.error = event.message;
        }
        break;
    }
  }

  // ---- Terminal Cleanup (Section 8.6) -------------------------------------

  private async startupTerminalCleanup(): Promise<void> {
    try {
      const terminalIssues = await this.tracker.fetchIssuesByStates(
        this.config.tracker.terminalStates,
      );
      for (const issue of terminalIssues) {
        try {
          await this.workspace.removeWorkspace(issue.identifier);
          logger.debug('Cleaned up terminal workspace', {
            issue_identifier: issue.identifier,
          });
        } catch {
          // Ignore cleanup errors for individual workspaces
        }
      }
      logger.info('Startup terminal cleanup complete', {
        cleaned: terminalIssues.length,
      });
    } catch (err) {
      logger.warn('Startup terminal cleanup failed, continuing', {
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }

  // ---- Worker Termination -------------------------------------------------

  private async terminateWorker(
    issueId: string,
    cleanWorkspace: boolean,
  ): Promise<void> {
    // Abort the worker if running
    const abort = this.workerAborts.get(issueId);
    if (abort) {
      abort.abort();
      this.workerAborts.delete(issueId);
    }

    // Try to terminate via agent runner
    try {
      await this.agentRunner.terminateRun(issueId);
    } catch {
      // Best effort
    }

    // Clean workspace if requested
    if (cleanWorkspace) {
      const entry = this.state.running.get(issueId);
      if (entry) {
        try {
          await this.workspace.removeWorkspace(entry.issueIdentifier);
        } catch {
          // Best effort
        }
      }
    }
  }

  // ---- Reconciliation Callbacks -------------------------------------------

  private getReconciliationCallbacks(): ReconciliationCallbacks {
    return {
      terminateWorker: (issueId, cleanWorkspace) =>
        this.terminateWorker(issueId, cleanWorkspace),
      scheduleRetry: (issueId, attempt, meta) => {
        this.state = scheduleRetry(
          this.state,
          issueId,
          attempt,
          meta,
          this.config.agent.maxRetryBackoffMs,
          (id) => this.onRetryTimer(id),
        );
      },
    };
  }
}
