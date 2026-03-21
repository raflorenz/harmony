import { Issue } from './types';

export interface TrackerClient {
  fetchCandidateIssues(): Promise<Issue[]>;
  fetchIssueStatesByIds(issueIds: string[]): Promise<Issue[]>;
  fetchIssuesByStates(stateNames: string[]): Promise<Issue[]>;
}
