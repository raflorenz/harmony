// ---------------------------------------------------------------------------
// Mock Agent Runner — Simulates Codex agent sessions with realistic behavior
// ---------------------------------------------------------------------------

import type { AgentRunner } from '../orchestrator/scheduler';
import type { Issue, ServiceConfig, CodexUpdateEvent } from '../tracker/types';
import { logger } from '../observability/logger';
import { runHook } from './hooks';

/** Simulated work phases an agent goes through. */
const WORK_PHASES = [
  { label: 'Reading codebase structure', durationMs: 8000, inputTokens: 800, outputTokens: 200 },
  { label: 'Analyzing issue requirements', durationMs: 7000, inputTokens: 1200, outputTokens: 400 },
  { label: 'Planning implementation', durationMs: 6000, inputTokens: 600, outputTokens: 800 },
  { label: 'Writing code changes', durationMs: 12000, inputTokens: 1500, outputTokens: 2000 },
  { label: 'Running tests', durationMs: 10000, inputTokens: 400, outputTokens: 300 },
  { label: 'Reviewing changes', durationMs: 6000, inputTokens: 500, outputTokens: 600 },
  { label: 'Creating commit', durationMs: 5000, inputTokens: 200, outputTokens: 400 },
];

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/** Introduce realistic jitter to timings. */
function jitter(base: number, variance = 0.3): number {
  return Math.round(base * (1 - variance + Math.random() * variance * 2));
}

export class MockAgentRunner implements AgentRunner {
  private activeRuns = new Map<string, { cancelled: boolean }>();

  async runAttempt(params: {
    issue: Issue;
    attempt: number | null;
    workspacePath: string;
    config: ServiceConfig;
    promptTemplate: string;
    onUpdate: (event: CodexUpdateEvent) => void;
  }): Promise<{ success: boolean; error?: string }> {
    const { issue, attempt, workspacePath, config, onUpdate } = params;
    const log = logger.forIssue(issue.id, issue.identifier);

    const runState = { cancelled: false };
    this.activeRuns.set(issue.id, runState);

    // Run before_run hook
    try {
      await runHook('before_run', config.hooks.beforeRun, workspacePath, config.hooks.timeoutMs, true);
    } catch (err) {
      await runHook('after_run', config.hooks.afterRun, workspacePath, config.hooks.timeoutMs, false);
      this.activeRuns.delete(issue.id);
      return { success: false, error: `before_run hook failed: ${err instanceof Error ? err.message : String(err)}` };
    }

    // Simulate session startup
    const sessionId = `mock-thread-${Date.now()}`;
    onUpdate({ kind: 'session_init', sessionId });

    log.info('Mock agent session started', { session_id: sessionId, attempt });

    // Simulate a small chance of failure (15%)
    const willFail = Math.random() < 0.15;
    const failAtPhase = willFail ? Math.floor(Math.random() * WORK_PHASES.length) : -1;

    let totalInput = 0;
    let totalOutput = 0;
    let totalTokens = 0;
    let turnNumber = 1;

    onUpdate({ kind: 'turn_start', turnNumber });

    try {
      for (let i = 0; i < WORK_PHASES.length; i++) {
        if (runState.cancelled) {
          log.info('Mock agent run cancelled');
          return { success: false, error: 'Run cancelled by reconciliation' };
        }

        const phase = WORK_PHASES[i];

        // Simulate failure at random phase
        if (i === failAtPhase) {
          const errors = [
            'Rate limit exceeded, retrying after backoff',
            'Unexpected error in code generation',
            'Test suite failed: 3 tests failing',
          ];
          const errorMsg = errors[Math.floor(Math.random() * errors.length)];

          onUpdate({ kind: 'error', message: errorMsg, fatal: true });
          log.warn('Mock agent encountered error', { error: errorMsg, phase: phase.label });

          this.activeRuns.delete(issue.id);
          await runHook('after_run', config.hooks.afterRun, workspacePath, config.hooks.timeoutMs, false);
          return { success: false, error: errorMsg };
        }

        // Send progress notification
        onUpdate({
          kind: 'message',
          role: 'assistant',
          content: phase.label,
        });

        // Accumulate tokens
        const phaseInput = jitter(phase.inputTokens);
        const phaseOutput = jitter(phase.outputTokens);
        totalInput += phaseInput;
        totalOutput += phaseOutput;
        totalTokens = totalInput + totalOutput;

        // Send usage update
        onUpdate({
          kind: 'usage',
          inputTokens: totalInput,
          outputTokens: totalOutput,
          totalTokens,
          secondsRunning: 0,
        });

        // Simulate rate limit event occasionally
        if (i === 3 && Math.random() < 0.3) {
          onUpdate({
            kind: 'rate_limit',
            retryAfterMs: 2000,
            headers: {
              'x-ratelimit-remaining': String(Math.floor(Math.random() * 50)),
              'x-ratelimit-limit': '100',
              'x-ratelimit-reset': new Date(Date.now() + 60_000).toISOString(),
            },
          });
        }

        // Wait for the phase duration
        await delay(jitter(phase.durationMs));

        // Simulate multi-turn: start a new turn mid-way through
        if (i === 3 && WORK_PHASES.length > 4) {
          onUpdate({ kind: 'turn_end', turnNumber });
          turnNumber++;
          onUpdate({ kind: 'turn_start', turnNumber });
        }
      }

      // Turn completed
      onUpdate({ kind: 'turn_end', turnNumber });

      // Final usage report
      onUpdate({
        kind: 'usage',
        inputTokens: totalInput,
        outputTokens: totalOutput,
        totalTokens,
        secondsRunning: 0,
      });

      log.info('Mock agent run completed successfully', {
        session_id: sessionId,
        turns: turnNumber,
        total_tokens: totalTokens,
      });
    } finally {
      this.activeRuns.delete(issue.id);
      await runHook('after_run', config.hooks.afterRun, workspacePath, config.hooks.timeoutMs, false);
    }

    return { success: true };
  }

  async terminateRun(issueId: string): Promise<void> {
    const state = this.activeRuns.get(issueId);
    if (state) {
      state.cancelled = true;
      this.activeRuns.delete(issueId);
    }
  }
}
