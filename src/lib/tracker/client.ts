import { Issue } from './types';

export interface TrackerClient {
  fetchCandidateIssues(): Promise<Issue[]>;
  fetchIssueStatesByIds(issueIds: string[]): Promise<Issue[]>;
  fetchIssuesByStates(stateNames: string[]): Promise<Issue[]>;

  /**
   * Post a comment on an issue. Optional — implementations that don't
   * support commenting should leave undefined.
   */
  commentOnIssue?(issueId: string, body: string): Promise<void>;

  /**
   * Add a label to an issue. Optional.
   */
  addLabel?(issueId: string, label: string): Promise<void>;

  /**
   * Remove a label from an issue. Optional. No-op when absent.
   */
  removeLabel?(issueId: string, label: string): Promise<void>;

  /**
   * Replace a set of labels with a single label (used by Harmony state
   * transitions: remove all old harmony:* labels, add the new one).
   * Optional.
   */
  setHarmonyState?(issueId: string, newLabel: string, oldLabels: readonly string[]): Promise<void>;
}
