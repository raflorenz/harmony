// ---------------------------------------------------------------------------
// Symphony Observability - Metrics & Snapshots (Spec Section 13.5)
// ---------------------------------------------------------------------------

import type {
  OrchestratorState,
  RunningEntry,
  RetryEntry,
  RunStatus,
} from "../tracker/types";

// ---------------------------------------------------------------------------
// Snapshot row types
// ---------------------------------------------------------------------------

/** A row in the snapshot's `running` list. */
export interface RunningSessionRow {
  issueId: string;
  issueIdentifier: string;
  attempt: number;
  status: RunStatus;
  startedAt: string;
  secondsRunning: number;
  inputTokens: number;
  outputTokens: number;
  totalTokens: number;
  lastMessage: string | null;
}

/** A row in the snapshot's `retrying` list. */
export interface RetryRow {
  issueId: string;
  issueIdentifier: string;
  attempt: number;
  dueAt: string;
  error: string | null;
}

// ---------------------------------------------------------------------------
// RuntimeSnapshot
// ---------------------------------------------------------------------------

/**
 * A point-in-time view of the orchestrator suitable for the status API
 * and dashboard consumption.
 */
export interface RuntimeSnapshot {
  /** ISO-8601 timestamp of when this snapshot was generated. */
  generatedAt: string;
  /** Aggregate counts for quick consumption. */
  counts: { running: number; retrying: number };
  /** Details of every currently-running session. */
  running: RunningSessionRow[];
  /** Details of every issue awaiting retry. */
  retrying: RetryRow[];
  /** Aggregate Codex token & runtime totals. */
  codexTotals: {
    inputTokens: number;
    outputTokens: number;
    totalTokens: number;
    secondsRunning: number;
  };
  /** Latest rate-limit payload from Codex, if available. */
  rateLimits: Record<string, unknown> | null;
}

// ---------------------------------------------------------------------------
// IssueDetail
// ---------------------------------------------------------------------------

/** Detailed view of a single issue's current processing state. */
export interface IssueDetail {
  issueId: string;
  issueIdentifier: string;
  status: "running" | "retrying" | "completed" | "unknown";
  attempt: number | null;
  startedAt: string | null;
  secondsRunning: number | null;
  usage: {
    inputTokens: number;
    outputTokens: number;
    totalTokens: number;
  } | null;
  error: string | null;
  retryDueAt: string | null;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Compute elapsed seconds since `startedAt`, using `Date.now()` for the
 * live wall-clock component of an active session.
 */
function elapsedSeconds(startedAt: Date): number {
  return Math.max(0, (Date.now() - startedAt.getTime()) / 1000);
}

/**
 * Build a {@link RunningSessionRow} from a {@link RunningEntry}.
 *
 * For running sessions that have a live session object, the runtime is
 * computed as the session's own `usage.secondsRunning` (which the Codex
 * agent reports) if available, otherwise falls back to wall-clock elapsed
 * since `startedAt`.
 */
function toRunningRow(entry: RunningEntry): RunningSessionRow {
  const seconds = elapsedSeconds(entry.startedAt);

  return {
    issueId: entry.issueId,
    issueIdentifier: entry.issueIdentifier,
    attempt: entry.attempt,
    status: entry.status,
    startedAt: entry.startedAt.toISOString(),
    secondsRunning: Math.round(seconds * 100) / 100,
    inputTokens: entry.inputTokens ?? entry.session?.usage.inputTokens ?? 0,
    outputTokens: entry.outputTokens ?? entry.session?.usage.outputTokens ?? 0,
    totalTokens: entry.totalTokens ?? entry.session?.usage.totalTokens ?? 0,
    lastMessage: entry.lastMessage ?? null,
  };
}

/**
 * Build a {@link RetryRow} from a {@link RetryEntry}.
 */
function toRetryRow(entry: RetryEntry): RetryRow {
  return {
    issueId: entry.issueId,
    issueIdentifier: entry.identifier,
    attempt: entry.attempt,
    dueAt: new Date(entry.dueAtMs).toISOString(),
    error: entry.error,
  };
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Produce a point-in-time {@link RuntimeSnapshot} from the current
 * orchestrator state.
 *
 * The snapshot includes:
 * - Running list with per-session token counts and runtime.
 * - Retry list with due times.
 * - Aggregate `codexTotals` that combine the orchestrator's cumulative
 *   counters with live elapsed time from active sessions.
 * - Latest rate-limit data.
 */
export function createSnapshot(state: OrchestratorState): RuntimeSnapshot {
  const runningEntries = Array.from(state.running.values());
  const retryEntries = Array.from(state.retryAttempts.values());

  const runningRows: RunningSessionRow[] = runningEntries.map(toRunningRow);
  const retryRows: RetryRow[] = retryEntries.map(toRetryRow);

  // Compute cumulative secondsRunning: the stored total from completed
  // sessions plus live elapsed from each active session.
  let liveSecondsRunning = 0;
  for (const entry of runningEntries) {
    liveSecondsRunning += elapsedSeconds(entry.startedAt);
  }

  return {
    generatedAt: new Date().toISOString(),
    counts: {
      running: runningRows.length,
      retrying: retryRows.length,
    },
    running: runningRows,
    retrying: retryRows,
    codexTotals: {
      inputTokens: state.codexTotals.inputTokens,
      outputTokens: state.codexTotals.outputTokens,
      totalTokens: state.codexTotals.totalTokens,
      secondsRunning:
        Math.round(
          (state.codexTotals.secondsRunning + liveSecondsRunning) * 100,
        ) / 100,
    },
    rateLimits: state.codexRateLimits ?? null,
  };
}

/**
 * Return detailed status for a single issue identified by its
 * human-readable `identifier` (e.g. "ABC-123").
 *
 * Searches the running map first, then the retry queue, then the
 * completed set.  Returns `null` if the identifier is unknown.
 */
export function createIssueDetail(
  state: OrchestratorState,
  identifier: string,
): IssueDetail | null {
  const runningEntries = Array.from(state.running.values());
  const retryEntries = Array.from(state.retryAttempts.values());

  // Search running entries
  for (const entry of runningEntries) {
    if (entry.issueIdentifier === identifier) {
      const session = entry.session;
      const seconds =
        session && session.usage.secondsRunning > 0
          ? session.usage.secondsRunning
          : elapsedSeconds(entry.startedAt);

      return {
        issueId: entry.issueId,
        issueIdentifier: entry.issueIdentifier,
        status: "running",
        attempt: entry.attempt,
        startedAt: entry.startedAt.toISOString(),
        secondsRunning: Math.round(seconds * 100) / 100,
        usage: session
          ? {
              inputTokens: session.usage.inputTokens,
              outputTokens: session.usage.outputTokens,
              totalTokens: session.usage.totalTokens,
            }
          : null,
        error: entry.error ?? null,
        retryDueAt: null,
      };
    }
  }

  // Search retry entries
  for (const entry of retryEntries) {
    if (entry.identifier === identifier) {
      return {
        issueId: entry.issueId,
        issueIdentifier: entry.identifier,
        status: "retrying",
        attempt: entry.attempt,
        startedAt: null,
        secondsRunning: null,
        usage: null,
        error: entry.error,
        retryDueAt: new Date(entry.dueAtMs).toISOString(),
      };
    }
  }

  // Search completed set (we only have the ID, not the identifier, so we
  // need to check if any completed ID matches by scanning running entries
  // that may have been cleared).  The completed set stores issue IDs, so
  // we cannot resolve the identifier directly.  Return a minimal record.
  for (const entry of runningEntries) {
    if (
      entry.issueIdentifier === identifier &&
      state.completed.has(entry.issueId)
    ) {
      return {
        issueId: entry.issueId,
        issueIdentifier: identifier,
        status: "completed",
        attempt: entry.attempt,
        startedAt: entry.startedAt.toISOString(),
        secondsRunning: null,
        usage: null,
        error: entry.error ?? null,
        retryDueAt: null,
      };
    }
  }

  return null;
}
