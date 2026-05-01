// ---------------------------------------------------------------------------
// Orchestrator State Helpers (Spec Section 4.1.8 / 7.1)
// ---------------------------------------------------------------------------

import type { OrchestratorState, RunningEntry } from '../tracker/types';

/**
 * Create a fresh orchestrator state object.
 */
export function createInitialState(
  pollIntervalMs: number,
  maxConcurrentAgents: number,
): OrchestratorState {
  return {
    pollIntervalMs,
    maxConcurrentAgents,
    running: new Map(),
    claimed: new Set(),
    retryAttempts: new Map(),
    canceled: new Map(),
    completed: new Set(),
    codexTotals: {
      inputTokens: 0,
      outputTokens: 0,
      totalTokens: 0,
      secondsRunning: 0,
    },
    codexRateLimits: null,
  };
}

/**
 * Number of global dispatch slots remaining.
 */
export function availableSlots(state: OrchestratorState): number {
  return Math.max(state.maxConcurrentAgents - state.running.size, 0);
}

/**
 * Number of slots remaining for a specific issue state, taking per-state
 * concurrency caps into account. Falls back to global limit if no per-state
 * limit is configured.
 */
export function availableSlotsForState(
  state: OrchestratorState,
  stateName: string,
  maxByState: Record<string, number>,
): number {
  const normalized = stateName.toLowerCase();
  const perStateLimit = maxByState[normalized];

  if (perStateLimit === undefined) {
    // No per-state cap — fall back to global availability
    return availableSlots(state);
  }

  // Count how many running entries are in this state
  let countInState = 0;
  for (const entry of state.running.values()) {
    if (entry.issue.state.toLowerCase() === normalized) {
      countInState++;
    }
  }

  return Math.max(
    Math.min(perStateLimit - countInState, availableSlots(state)),
    0,
  );
}

/**
 * Check whether an issue ID is currently claimed (running or retry-queued).
 */
export function isIssueClaimed(
  state: OrchestratorState,
  issueId: string,
): boolean {
  return state.claimed.has(issueId);
}

/**
 * Add the runtime seconds from a finished RunningEntry to cumulative totals.
 */
export function addRuntimeSeconds(
  state: OrchestratorState,
  entry: RunningEntry,
): OrchestratorState {
  const elapsed = (Date.now() - entry.startedAt.getTime()) / 1000;
  state.codexTotals.secondsRunning += elapsed;

  // Merge token counts (prefer direct fields, fallback to session)
  const inputTokens = entry.inputTokens ?? entry.session?.usage.inputTokens ?? 0;
  const outputTokens = entry.outputTokens ?? entry.session?.usage.outputTokens ?? 0;
  const totalTokens = entry.totalTokens ?? entry.session?.usage.totalTokens ?? 0;

  state.codexTotals.inputTokens += inputTokens;
  state.codexTotals.outputTokens += outputTokens;
  state.codexTotals.totalTokens += totalTokens;

  return state;
}
