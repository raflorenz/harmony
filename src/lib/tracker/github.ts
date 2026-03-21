import { TrackerClient } from './client';
import { Issue } from './types';
import { TrackerError } from './linear';

// ---------------------------------------------------------------------------
// GitHub REST API response shapes
// ---------------------------------------------------------------------------

interface GitHubLabel {
  name: string;
}

interface GitHubUser {
  login: string;
}

interface GitHubIssue {
  number: number;
  title: string;
  body: string | null;
  state: 'open' | 'closed';
  html_url: string;
  labels: GitHubLabel[];
  assignee: GitHubUser | null;
  pull_request?: unknown;
  created_at: string;
  updated_at: string;
}

// ---------------------------------------------------------------------------
// Priority label mapping
// ---------------------------------------------------------------------------

const PRIORITY_LABEL_MAP: Record<string, number> = {
  'priority: urgent': 1,
  'priority: high': 2,
  'priority: medium': 3,
  'priority: low': 4,
};

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const DEFAULT_ENDPOINT = 'https://api.github.com';
const PAGE_SIZE = 100;
const NETWORK_TIMEOUT_MS = 30_000;

// ---------------------------------------------------------------------------
// GitHubClient
// ---------------------------------------------------------------------------

export class GitHubClient implements TrackerClient {
  private readonly endpoint: string;
  private readonly apiKey: string;
  private readonly owner: string;
  private readonly repo: string;
  private readonly repoPrefix: string;
  private readonly activeStates: string[];
  private readonly terminalStates: string[];

  constructor(config: {
    endpoint: string;
    apiKey: string;
    projectSlug: string;
    activeStates: string[];
    terminalStates: string[];
  }) {
    if (!config.apiKey) {
      throw new TrackerError(
        'missing_tracker_api_key',
        'GitHub API token is required but was not provided in tracker config.',
      );
    }

    const parts = config.projectSlug.split('/');
    if (parts.length !== 2 || !parts[0] || !parts[1]) {
      throw new TrackerError(
        'tracker_network_error',
        `Invalid projectSlug "${config.projectSlug}". Expected "owner/repo" format (e.g. "openai/symphony").`,
      );
    }

    this.endpoint = config.endpoint || DEFAULT_ENDPOINT;
    this.apiKey = config.apiKey;
    this.owner = parts[0];
    this.repo = parts[1];
    this.repoPrefix = this.repo.toUpperCase();
    this.activeStates = config.activeStates;
    this.terminalStates = config.terminalStates;
  }

  // ---- Public API ----------------------------------------------------------

  /**
   * Fetch candidate issues: open issues whose mapped state is one of the
   * configured active states. Automatically paginates through all results.
   */
  async fetchCandidateIssues(): Promise<Issue[]> {
    const issues = await this.fetchAllIssues('open');
    return issues.filter((issue) => this.activeStates.includes(issue.state));
  }

  /**
   * Fetch issues by their issue numbers (passed as string IDs).
   * Each issue is fetched individually via GET /repos/:owner/:repo/issues/:number.
   */
  async fetchIssueStatesByIds(issueIds: string[]): Promise<Issue[]> {
    if (issueIds.length === 0) {
      return [];
    }

    const results: Issue[] = [];

    for (const id of issueIds) {
      const issueNumber = parseInt(id, 10);
      if (Number.isNaN(issueNumber)) {
        continue;
      }

      const url = `${this.endpoint}/repos/${this.owner}/${this.repo}/issues/${issueNumber}`;
      const raw = await this.request<GitHubIssue>(url);

      // Skip pull requests (GitHub's issues API returns PRs too)
      if (raw.pull_request != null) {
        continue;
      }

      results.push(this.normalizeIssue(raw));
    }

    return results;
  }

  /**
   * Fetch issues whose mapped state name is in the given list.
   * Determines which GitHub API states (open/closed) to query based on
   * whether the requested state names overlap with active or terminal states.
   */
  async fetchIssuesByStates(stateNames: string[]): Promise<Issue[]> {
    if (stateNames.length === 0) {
      return [];
    }

    const stateSet = new Set(stateNames);
    const needOpen = this.activeStates.some((s) => stateSet.has(s));
    const needClosed = this.terminalStates.some((s) => stateSet.has(s));

    const results: Issue[] = [];

    if (needOpen) {
      const openIssues = await this.fetchAllIssues('open');
      for (const issue of openIssues) {
        if (stateSet.has(issue.state)) {
          results.push(issue);
        }
      }
    }

    if (needClosed) {
      const closedIssues = await this.fetchAllIssues('closed');
      for (const issue of closedIssues) {
        if (stateSet.has(issue.state)) {
          results.push(issue);
        }
      }
    }

    return results;
  }

  // ---- Internal helpers ----------------------------------------------------

  /**
   * Fetch all issues with the given GitHub state, paginating via the Link header.
   * Filters out pull requests (which GitHub returns in the issues endpoint).
   */
  private async fetchAllIssues(
    state: 'open' | 'closed',
  ): Promise<Issue[]> {
    const allIssues: Issue[] = [];
    let url: string | null =
      `${this.endpoint}/repos/${this.owner}/${this.repo}/issues` +
      `?state=${state}&per_page=${PAGE_SIZE}&page=1`;

    while (url) {
      const result: { data: GitHubIssue[]; nextUrl: string | null } = await this.requestWithPagination<GitHubIssue[]>(url);
      const { data, nextUrl } = result;

      for (const raw of data) {
        // Skip pull requests
        if (raw.pull_request != null) {
          continue;
        }
        allIssues.push(this.normalizeIssue(raw));
      }

      url = nextUrl;
    }

    return allIssues;
  }

  /**
   * Normalize a raw GitHub issue into the Symphony Issue model.
   */
  private normalizeIssue(raw: GitHubIssue): Issue {
    // Map labels to lowercase
    const labels = raw.labels.map((l) => l.name.toLowerCase());

    // Derive priority from labels
    let priority: number | null = null;
    for (const label of labels) {
      if (label in PRIORITY_LABEL_MAP) {
        priority = PRIORITY_LABEL_MAP[label];
        break;
      }
    }

    // Map state
    let state: string;
    if (raw.state === 'closed') {
      state = 'Done';
    } else if (raw.assignee != null) {
      state = 'In Progress';
    } else {
      state = 'Todo';
    }

    return {
      id: String(raw.number),
      identifier: `${this.repoPrefix}-${raw.number}`,
      title: raw.title,
      description: raw.body,
      priority,
      state,
      branchName: null,
      url: raw.html_url,
      labels,
      blockedBy: [],
      createdAt: parseISODate(raw.created_at),
      updatedAt: parseISODate(raw.updated_at),
    };
  }

  /**
   * Perform a GET request to the GitHub API with timeout and error handling.
   */
  private async request<T>(url: string): Promise<T> {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), NETWORK_TIMEOUT_MS);

    let response: Response;
    try {
      response = await fetch(url, {
        method: 'GET',
        headers: {
          Accept: 'application/vnd.github+json',
          Authorization: `Bearer ${this.apiKey}`,
          'X-GitHub-Api-Version': '2022-11-28',
        },
        signal: controller.signal,
      });
    } catch (err: unknown) {
      clearTimeout(timeout);
      if (isAbortError(err)) {
        throw new TrackerError(
          'tracker_timeout',
          `GitHub API request timed out after ${NETWORK_TIMEOUT_MS}ms: ${url}`,
          err,
        );
      }
      throw new TrackerError(
        'tracker_network_error',
        `Network error communicating with GitHub API: ${errorMessage(err)}`,
        err,
      );
    } finally {
      clearTimeout(timeout);
    }

    this.handleErrorResponse(response, url);

    return (await response.json()) as T;
  }

  /**
   * Perform a GET request and parse the Link header for pagination.
   * Returns the response data and the URL for the next page (or null).
   */
  private async requestWithPagination<T>(
    url: string,
  ): Promise<{ data: T; nextUrl: string | null }> {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), NETWORK_TIMEOUT_MS);

    let response: Response;
    try {
      response = await fetch(url, {
        method: 'GET',
        headers: {
          Accept: 'application/vnd.github+json',
          Authorization: `Bearer ${this.apiKey}`,
          'X-GitHub-Api-Version': '2022-11-28',
        },
        signal: controller.signal,
      });
    } catch (err: unknown) {
      clearTimeout(timeout);
      if (isAbortError(err)) {
        throw new TrackerError(
          'tracker_timeout',
          `GitHub API request timed out after ${NETWORK_TIMEOUT_MS}ms: ${url}`,
          err,
        );
      }
      throw new TrackerError(
        'tracker_network_error',
        `Network error communicating with GitHub API: ${errorMessage(err)}`,
        err,
      );
    } finally {
      clearTimeout(timeout);
    }

    this.handleErrorResponse(response, url);

    const data = (await response.json()) as T;
    const nextUrl = parseLinkHeaderNext(response.headers.get('link'));

    return { data, nextUrl };
  }

  /**
   * Check the HTTP response for common error conditions and throw
   * descriptive TrackerError instances.
   */
  private handleErrorResponse(response: Response, url: string): void {
    if (response.status === 401 || response.status === 403) {
      throw new TrackerError(
        'tracker_auth_error',
        `GitHub API authentication failed (HTTP ${response.status}). ` +
          `Verify your token has access to ${this.owner}/${this.repo}.`,
      );
    }

    if (response.status === 404) {
      throw new TrackerError(
        'tracker_network_error',
        `GitHub API resource not found (HTTP 404): ${url}. ` +
          `Verify the repository "${this.owner}/${this.repo}" exists and your token has access.`,
      );
    }

    if (response.status === 429) {
      throw new TrackerError(
        'tracker_rate_limited',
        'GitHub API rate limit exceeded. Retry after the rate limit resets.',
      );
    }

    if (!response.ok) {
      throw new TrackerError(
        'tracker_network_error',
        `GitHub API returned HTTP ${response.status} for ${url}.`,
      );
    }
  }
}

// ---------------------------------------------------------------------------
// Utility functions
// ---------------------------------------------------------------------------

/**
 * Parse the `Link` header returned by GitHub's paginated endpoints.
 * Extracts the URL marked with `rel="next"`, or returns null if there
 * is no next page.
 */
function parseLinkHeaderNext(linkHeader: string | null): string | null {
  if (!linkHeader) {
    return null;
  }

  // Link header format: <url>; rel="next", <url>; rel="last"
  const parts = linkHeader.split(',');
  for (const part of parts) {
    const match = part.match(/<([^>]+)>;\s*rel="next"/);
    if (match) {
      return match[1];
    }
  }

  return null;
}

function parseISODate(value: string): Date | null {
  const d = new Date(value);
  return Number.isNaN(d.getTime()) ? null : d;
}

function isAbortError(err: unknown): boolean {
  return err instanceof DOMException && err.name === 'AbortError';
}

function errorMessage(err: unknown): string {
  if (err instanceof Error) return err.message;
  return String(err);
}
