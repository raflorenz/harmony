// ---------------------------------------------------------------------------
// Harmony Kanban States — represented as labels on the underlying tracker
// ---------------------------------------------------------------------------
//
// Per the reliability plan's open-question answer (1), we use labels for
// portability across GitHub/Linear/Mock. Each state is a label of the form
// `harmony:<state>`. Project-board column mapping is left to the project.
// ---------------------------------------------------------------------------

import type { Issue } from './types';

export const HARMONY_LABEL_PREFIX = 'harmony:';

export const HarmonyStates = {
  Proposed: 'proposed',
  NeedsClarification: 'needs-clarification',
  Ready: 'ready',
  AwaitingVerification: 'awaiting-verification',
  NeedsRevision: 'needs-revision',
  InReview: 'in-review',
} as const;

export type HarmonyState = typeof HarmonyStates[keyof typeof HarmonyStates];

export function harmonyLabel(state: HarmonyState): string {
  return HARMONY_LABEL_PREFIX + state;
}

/** Find the current Harmony state label on an issue, if any. */
export function getHarmonyState(issue: Issue): HarmonyState | null {
  const lower = issue.labels.map((l) => l.toLowerCase());
  for (const state of Object.values(HarmonyStates)) {
    if (lower.includes(harmonyLabel(state))) return state;
  }
  return null;
}

/** True when the issue is in the given Harmony state. */
export function isInHarmonyState(issue: Issue, state: HarmonyState): boolean {
  return getHarmonyState(issue) === state;
}

/**
 * The set of all Harmony state labels. Used when writing a new state to
 * remove the previous Harmony label first.
 */
export const ALL_HARMONY_LABELS: readonly string[] = Object.values(HarmonyStates).map(harmonyLabel);
