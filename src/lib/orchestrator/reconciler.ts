// ---------------------------------------------------------------------------
// Active Run Reconciliation (Spec Section 8.5)
// ---------------------------------------------------------------------------

import type {
  OrchestratorState,
  ServiceConfig,
  RunningEntry,
} from '../tracker/types';
import type { TrackerClient } from '../tracker/client';
import { logger } from '../observability/logger';

export interface ReconciliationCallbacks {
  /** Terminate a running worker and optionally clean its workspace. */
  terminateWorker: (
    issueId: string,
    cleanWorkspace: boolean,
  ) => Promise<void>;
  /** Schedule a retry for a stalled/failed issue. */
  scheduleRetry: (
    issueId: string,
    attempt: number,
    meta: { identifier: string; error: string },
  ) => void;
}

/**
 * Reconcile all active runs (Part A: stall detection, Part B: tracker refresh).
 *
 * This runs before dispatch on every tick.
 */
export async function reconcileRunningIssues(
  state: OrchestratorState,
  tracker: TrackerClient,
  config: ServiceConfig,
  callbacks: ReconciliationCallbacks,
): Promise<OrchestratorState> {
  // ---- Part A: Stall detection ----
  state = reconcileStalls(state, config, callbacks);

  // ---- Part B: Tracker state refresh ----
  const runningIds = Array.from(state.running.keys());
  if (runningIds.length === 0) {
    return state;
  }

  let refreshedIssues;
  try {
    refreshedIssues = await tracker.fetchIssueStatesByIds(runningIds);
  } catch (err) {
    logger.debug('Reconciliation state refresh failed, keeping workers running', {
      error: err instanceof Error ? err.message : String(err),
    });
    return state;
  }

  const terminalNormalized = new Set(
    config.tracker.terminalStates.map((s) => s.toLowerCase()),
  );
  const activeNormalized = new Set(
    config.tracker.activeStates.map((s) => s.toLowerCase()),
  );

  // Build a map of refreshed issues by ID for quick lookup
  const refreshedMap = new Map(refreshedIssues.map((i) => [i.id, i]));

  for (const [issueId, runningEntry] of Array.from(state.running.entries())) {
    const refreshed = refreshedMap.get(issueId);
    if (!refreshed) {
      // Issue disappeared from tracker — keep running (might be pagination issue)
      continue;
    }

    const normalizedState = refreshed.state.toLowerCase();

    if (terminalNormalized.has(normalizedState)) {
      // Terminal state → terminate and clean workspace
      logger.info('Issue reached terminal state, stopping worker', {
        issue_id: issueId,
        issue_identifier: runningEntry.issueIdentifier,
        state: refreshed.state,
      });
      await callbacks.terminateWorker(issueId, true);
      state.running.delete(issueId);
      state.claimed.delete(issueId);
    } else if (activeNormalized.has(normalizedState)) {
      // Still active → update in-memory issue snapshot
      runningEntry.issue = refreshed;
    } else {
      // Neither active nor terminal → terminate without cleanup
      logger.info('Issue no longer in active state, stopping worker', {
        issue_id: issueId,
        issue_identifier: runningEntry.issueIdentifier,
        state: refreshed.state,
      });
      await callbacks.terminateWorker(issueId, false);
      state.running.delete(issueId);
      state.claimed.delete(issueId);
    }
  }

  return state;
}

/**
 * Part A: Detect stalled runs and kill them.
 *
 * A run is stalled when no Codex event has been received for longer than
 * `codex.stallTimeoutMs`. If stallTimeoutMs <= 0, stall detection is disabled.
 */
function reconcileStalls(
  state: OrchestratorState,
  config: ServiceConfig,
  callbacks: ReconciliationCallbacks,
): OrchestratorState {
  const stallTimeoutMs = config.codex.stallTimeoutMs;
  if (stallTimeoutMs <= 0) return state;

  const now = Date.now();

  for (const [issueId, entry] of Array.from(state.running.entries())) {
    const lastActivity = entry.lastActivityMs ?? entry.session?.lastActivityMs ?? entry.startedAt.getTime();
    const elapsedMs = now - lastActivity;

    if (elapsedMs > stallTimeoutMs) {
      logger.warn('Stalled session detected, terminating', {
        issue_id: issueId,
        issue_identifier: entry.issueIdentifier,
        elapsed_ms: elapsedMs,
        stall_timeout_ms: stallTimeoutMs,
      });

      // Schedule retry for stalled issue
      callbacks.scheduleRetry(issueId, (entry.attempt ?? 0) + 1, {
        identifier: entry.issueIdentifier,
        error: `session stalled after ${Math.round(elapsedMs / 1000)}s`,
      });

      // The actual termination happens via the callback; remove from running
      callbacks.terminateWorker(issueId, false).catch(() => {});
      state.running.delete(issueId);
    }
  }

  return state;
}
