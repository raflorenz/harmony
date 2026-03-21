import type { TrackerClient } from './client';
import type { Issue } from './types';

/**
 * CompositeTracker wraps a base tracker and overlays manually-added issues.
 * Manual issues are stored in-memory and appear alongside tracker issues.
 */
export class CompositeTracker implements TrackerClient {
  private baseTracker: TrackerClient;
  private manualIssues: Map<string, Issue> = new Map();

  constructor(baseTracker: TrackerClient) {
    this.baseTracker = baseTracker;
  }

  /** Add a manually-created issue. */
  addManualIssue(issue: Issue): void {
    this.manualIssues.set(issue.id, issue);
  }

  /** Remove a manually-created issue by ID. */
  removeManualIssue(issueId: string): boolean {
    return this.manualIssues.delete(issueId);
  }

  /** Get all manual issues. */
  getManualIssues(): Issue[] {
    return Array.from(this.manualIssues.values());
  }

  /** Update a manual issue's state. */
  updateManualIssueState(issueId: string, state: string): boolean {
    const issue = this.manualIssues.get(issueId);
    if (!issue) return false;
    issue.state = state;
    issue.updatedAt = new Date();
    return true;
  }

  async fetchCandidateIssues(): Promise<Issue[]> {
    const trackerIssues = await this.baseTracker.fetchCandidateIssues();
    // Merge manual issues that are in active-like states
    const activeManual = Array.from(this.manualIssues.values()).filter(
      i => i.state.toLowerCase() === 'todo' || i.state.toLowerCase() === 'in progress'
    );
    return [...trackerIssues, ...activeManual];
  }

  async fetchIssueStatesByIds(issueIds: string[]): Promise<Issue[]> {
    // Split: manual IDs we handle ourselves, rest goes to base tracker
    const manualResults: Issue[] = [];
    const trackerIds: string[] = [];

    for (const id of issueIds) {
      const manual = this.manualIssues.get(id);
      if (manual) {
        manualResults.push(manual);
      } else {
        trackerIds.push(id);
      }
    }

    const trackerResults = trackerIds.length > 0
      ? await this.baseTracker.fetchIssueStatesByIds(trackerIds)
      : [];

    return [...trackerResults, ...manualResults];
  }

  async fetchIssuesByStates(stateNames: string[]): Promise<Issue[]> {
    const trackerIssues = await this.baseTracker.fetchIssuesByStates(stateNames);
    const normalizedStates = new Set(stateNames.map(s => s.toLowerCase()));
    const matchingManual = Array.from(this.manualIssues.values()).filter(
      i => normalizedStates.has(i.state.toLowerCase())
    );
    return [...trackerIssues, ...matchingManual];
  }
}
