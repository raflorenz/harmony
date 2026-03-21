// ---------------------------------------------------------------------------
// Retry Queue & Backoff (Spec Section 8.4)
// ---------------------------------------------------------------------------

import type { OrchestratorState, RetryEntry } from '../tracker/types';

/**
 * Calculate backoff delay in milliseconds.
 *
 * - Continuation retries (after clean worker exit): fixed 1000ms
 * - Failure retries: min(10000 * 2^(attempt-1), maxBackoffMs)
 */
export function calculateBackoff(
  attempt: number,
  maxBackoffMs: number,
  isContinuation: boolean,
): number {
  if (isContinuation) return 1000;
  const raw = 10_000 * Math.pow(2, Math.max(attempt - 1, 0));
  return Math.min(raw, maxBackoffMs);
}

/**
 * Schedule a retry for an issue.
 * Cancels any existing retry timer for the same issue first.
 */
export function scheduleRetry(
  state: OrchestratorState,
  issueId: string,
  attempt: number,
  meta: {
    identifier: string;
    error?: string;
    isContinuation?: boolean;
  },
  maxBackoffMs: number,
  onFire: (issueId: string) => void,
): OrchestratorState {
  // Cancel any existing retry timer for this issue
  state = cancelRetry(state, issueId);

  const delay = calculateBackoff(
    attempt,
    maxBackoffMs,
    meta.isContinuation ?? false,
  );
  const dueAtMs = Date.now() + delay;

  const timerHandle = setTimeout(() => {
    onFire(issueId);
  }, delay);

  const entry: RetryEntry = {
    issueId,
    identifier: meta.identifier,
    attempt,
    dueAtMs,
    timerHandle,
    error: meta.error ?? null,
  };

  state.retryAttempts.set(issueId, entry);
  // Ensure the issue stays claimed while retrying
  state.claimed.add(issueId);

  return state;
}

/**
 * Cancel an existing retry timer for an issue and remove the entry.
 */
export function cancelRetry(
  state: OrchestratorState,
  issueId: string,
): OrchestratorState {
  const existing = state.retryAttempts.get(issueId);
  if (existing?.timerHandle) {
    clearTimeout(existing.timerHandle);
  }
  state.retryAttempts.delete(issueId);
  return state;
}

/**
 * Release all claims for an issue (remove from claimed set, cancel retry).
 */
export function releaseClaim(
  state: OrchestratorState,
  issueId: string,
): OrchestratorState {
  state = cancelRetry(state, issueId);
  state.claimed.delete(issueId);
  return state;
}
