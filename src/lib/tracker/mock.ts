// ---------------------------------------------------------------------------
// Mock Tracker Client — Simulates a Linear-like issue tracker
// ---------------------------------------------------------------------------

import type { TrackerClient } from './client';
import type { Issue } from './types';

const MOCK_ISSUES: Issue[] = [
  {
    id: 'issue-001',
    identifier: 'SYM-101',
    title: 'Add user authentication flow',
    description:
      'Implement OAuth2 login with Google and GitHub providers. Include session management and token refresh.',
    priority: 1,
    state: 'In Progress',
    branchName: 'feat/auth-flow',
    url: 'https://linear.app/symphony/issue/SYM-101',
    labels: ['feature', 'auth', 'high-priority'],
    blockedBy: [],
    createdAt: new Date(Date.now() - 3 * 86_400_000),
    updatedAt: new Date(Date.now() - 1_800_000),
  },
  {
    id: 'issue-002',
    identifier: 'SYM-102',
    title: 'Fix pagination bug in dashboard',
    description:
      'The dashboard table pagination resets to page 1 when switching tabs. State should persist across tab changes.',
    priority: 2,
    state: 'Todo',
    branchName: 'fix/pagination-reset',
    url: 'https://linear.app/symphony/issue/SYM-102',
    labels: ['bug', 'dashboard'],
    blockedBy: [],
    createdAt: new Date(Date.now() - 5 * 86_400_000),
    updatedAt: new Date(Date.now() - 7_200_000),
  },
  {
    id: 'issue-003',
    identifier: 'SYM-103',
    title: 'Implement webhook event processing',
    description:
      'Set up a webhook endpoint to receive and process events from external services. Queue events for async processing.',
    priority: 2,
    state: 'In Progress',
    branchName: 'feat/webhooks',
    url: 'https://linear.app/symphony/issue/SYM-103',
    labels: ['feature', 'backend', 'webhooks'],
    blockedBy: [],
    createdAt: new Date(Date.now() - 7 * 86_400_000),
    updatedAt: new Date(Date.now() - 3_600_000),
  },
  {
    id: 'issue-004',
    identifier: 'SYM-104',
    title: 'Migrate database schema to v2',
    description:
      'Update the database schema for the new data model. Write migration scripts and rollback procedures.',
    priority: 1,
    state: 'Todo',
    branchName: null,
    url: 'https://linear.app/symphony/issue/SYM-104',
    labels: ['backend', 'database', 'migration'],
    blockedBy: [
      { id: 'issue-001', identifier: 'SYM-101', state: 'In Progress' },
    ],
    createdAt: new Date(Date.now() - 2 * 86_400_000),
    updatedAt: new Date(Date.now() - 900_000),
  },
  {
    id: 'issue-005',
    identifier: 'SYM-105',
    title: 'Add rate limiting middleware',
    description:
      'Implement token-bucket rate limiting for the API. Support per-user and per-endpoint limits.',
    priority: 3,
    state: 'Todo',
    branchName: null,
    url: 'https://linear.app/symphony/issue/SYM-105',
    labels: ['feature', 'security', 'api'],
    blockedBy: [],
    createdAt: new Date(Date.now() - 10 * 86_400_000),
    updatedAt: new Date(Date.now() - 14_400_000),
  },
  {
    id: 'issue-006',
    identifier: 'SYM-106',
    title: 'Write integration tests for payment flow',
    description:
      'Cover the full Stripe payment lifecycle: checkout, confirmation, refund, and webhook handling.',
    priority: 2,
    state: 'In Progress',
    branchName: 'test/payment-integration',
    url: 'https://linear.app/symphony/issue/SYM-106',
    labels: ['testing', 'payments'],
    blockedBy: [],
    createdAt: new Date(Date.now() - 4 * 86_400_000),
    updatedAt: new Date(Date.now() - 600_000),
  },
];

const TERMINAL_ISSUES: Issue[] = [
  {
    id: 'issue-090',
    identifier: 'SYM-90',
    title: 'Setup CI/CD pipeline',
    description: 'Done.',
    priority: 2,
    state: 'Done',
    branchName: null,
    url: null,
    labels: ['devops'],
    blockedBy: [],
    createdAt: new Date(Date.now() - 30 * 86_400_000),
    updatedAt: new Date(Date.now() - 15 * 86_400_000),
  },
];

export class MockTrackerClient implements TrackerClient {
  private issues: Issue[];
  private stateOverrides = new Map<string, string>();

  constructor() {
    this.issues = [...MOCK_ISSUES];

    // Simulate issue SYM-103 transitioning to "Done" after 90 seconds
    setTimeout(() => {
      this.stateOverrides.set('issue-003', 'Done');
    }, 90_000);
  }

  async fetchCandidateIssues(): Promise<Issue[]> {
    // Simulate network latency
    await delay(200 + Math.random() * 300);

    const activeStates = new Set(['todo', 'in progress']);

    return this.issues
      .map((issue) => this.applyOverrides(issue))
      .filter((issue) => activeStates.has(issue.state.toLowerCase()));
  }

  async fetchIssueStatesByIds(issueIds: string[]): Promise<Issue[]> {
    await delay(100 + Math.random() * 200);

    return issueIds
      .map((id) => {
        const issue = this.issues.find((i) => i.id === id);
        if (!issue) return null;
        return this.applyOverrides(issue);
      })
      .filter((i): i is Issue => i !== null);
  }

  async fetchIssuesByStates(stateNames: string[]): Promise<Issue[]> {
    if (stateNames.length === 0) return [];
    await delay(100 + Math.random() * 200);

    const normalizedStates = new Set(stateNames.map((s) => s.toLowerCase()));
    return [...TERMINAL_ISSUES, ...this.issues]
      .map((issue) => this.applyOverrides(issue))
      .filter((issue) => normalizedStates.has(issue.state.toLowerCase()));
  }

  private applyOverrides(issue: Issue): Issue {
    const stateOverride = this.stateOverrides.get(issue.id);
    if (stateOverride) {
      return { ...issue, state: stateOverride, updatedAt: new Date() };
    }
    return issue;
  }
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
