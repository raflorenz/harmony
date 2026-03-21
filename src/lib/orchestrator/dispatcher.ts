// ---------------------------------------------------------------------------
// Candidate Selection & Dispatch Logic (Spec Section 8.2)
// ---------------------------------------------------------------------------

import type { Issue, OrchestratorState, ServiceConfig } from '../tracker/types';
import { availableSlots, availableSlotsForState } from './state';

/**
 * Sort issues for dispatch priority (Section 8.2):
 *  1. priority ascending (1..4 preferred; null/unknown sorts last)
 *  2. createdAt oldest first
 *  3. identifier lexicographic tie-breaker
 */
export function sortForDispatch(issues: Issue[]): Issue[] {
  return [...issues].sort((a, b) => {
    // Priority: lower is better, null sorts last
    const pa = a.priority ?? Number.MAX_SAFE_INTEGER;
    const pb = b.priority ?? Number.MAX_SAFE_INTEGER;
    if (pa !== pb) return pa - pb;

    // CreatedAt: oldest first
    const ca = a.createdAt?.getTime() ?? Number.MAX_SAFE_INTEGER;
    const cb = b.createdAt?.getTime() ?? Number.MAX_SAFE_INTEGER;
    if (ca !== cb) return ca - cb;

    // Identifier: lexicographic
    return a.identifier.localeCompare(b.identifier);
  });
}

/**
 * Determine whether an issue is dispatch-eligible (Section 8.2).
 *
 * An issue is eligible only if ALL of these are true:
 *  - It has id, identifier, title, and state
 *  - State is in activeStates and NOT in terminalStates
 *  - Not already in running map
 *  - Not already in claimed set
 *  - Global concurrency slots available
 *  - Per-state concurrency slots available
 *  - Blocker rule: if state is "todo", no non-terminal blockers
 */
export function shouldDispatch(
  issue: Issue,
  state: OrchestratorState,
  config: ServiceConfig,
): boolean {
  // Required fields present
  if (!issue.id || !issue.identifier || !issue.title || !issue.state) {
    return false;
  }

  const normalizedState = issue.state.toLowerCase();
  const activeNormalized = config.tracker.activeStates.map((s) =>
    s.toLowerCase(),
  );
  const terminalNormalized = config.tracker.terminalStates.map((s) =>
    s.toLowerCase(),
  );

  // State must be active and NOT terminal
  if (!activeNormalized.includes(normalizedState)) return false;
  if (terminalNormalized.includes(normalizedState)) return false;

  // Not already running
  if (state.running.has(issue.id)) return false;

  // Not already claimed (running OR retry-queued)
  if (state.claimed.has(issue.id)) return false;

  // Global slots
  if (availableSlots(state) <= 0) return false;

  // Per-state slots
  if (
    availableSlotsForState(
      state,
      issue.state,
      config.agent.maxConcurrentAgentsByState,
    ) <= 0
  ) {
    return false;
  }

  // Blocker rule for "Todo" state: don't dispatch if any blocker is non-terminal
  if (normalizedState === 'todo' && issue.blockedBy.length > 0) {
    const hasNonTerminalBlocker = issue.blockedBy.some((b) => {
      if (!b.state) return true; // unknown state = assume non-terminal
      return !terminalNormalized.includes(b.state.toLowerCase());
    });
    if (hasNonTerminalBlocker) return false;
  }

  return true;
}
