import { TrackerClient } from './client';
import { Issue, BlockerRef, TrackerConfig } from './types';

// ---------------------------------------------------------------------------
// Error helpers
// ---------------------------------------------------------------------------

export type TrackerErrorCode =
  | 'unsupported_tracker_kind'
  | 'missing_tracker_api_key'
  | 'tracker_network_error'
  | 'tracker_auth_error'
  | 'tracker_graphql_error'
  | 'tracker_rate_limited'
  | 'tracker_timeout';

export class TrackerError extends Error {
  constructor(
    public readonly code: TrackerErrorCode,
    message: string,
    public readonly cause?: unknown,
  ) {
    super(message);
    this.name = 'TrackerError';
  }
}

// ---------------------------------------------------------------------------
// GraphQL fragments & queries
// ---------------------------------------------------------------------------

const ISSUE_FIELDS_FRAGMENT = `
  fragment IssueFields on Issue {
    id
    identifier
    title
    description
    priority
    state { name }
    branchName
    url
    labels { nodes { name } }
    relations {
      nodes {
        type
        relatedIssue {
          id
          identifier
          state { name }
        }
      }
    }
    createdAt
    updatedAt
  }
`;

/**
 * Candidate issues query: fetches issues belonging to a project (by slugId)
 * whose state name is in the provided list. Paginated via cursor.
 */
const CANDIDATE_ISSUES_QUERY = `
  ${ISSUE_FIELDS_FRAGMENT}
  query CandidateIssues($projectSlug: String!, $states: [String!]!, $first: Int!, $after: String) {
    issues(
      filter: {
        project: { slugId: { eq: $projectSlug } }
        state: { name: { in: $states } }
      }
      first: $first
      after: $after
    ) {
      nodes { ...IssueFields }
      pageInfo {
        hasNextPage
        endCursor
      }
    }
  }
`;

/**
 * Fetch issues by their GraphQL IDs (for reconciliation / state refresh).
 */
const ISSUES_BY_IDS_QUERY = `
  ${ISSUE_FIELDS_FRAGMENT}
  query IssuesByIds($ids: [ID!]!) {
    nodes(ids: $ids) {
      ... on Issue { ...IssueFields }
    }
  }
`;

/**
 * Fetch issues whose state name is in the given list (for terminal cleanup).
 * Scoped to the same project via slugId.
 */
const ISSUES_BY_STATES_QUERY = `
  ${ISSUE_FIELDS_FRAGMENT}
  query IssuesByStates($projectSlug: String!, $states: [String!]!, $first: Int!, $after: String) {
    issues(
      filter: {
        project: { slugId: { eq: $projectSlug } }
        state: { name: { in: $states } }
      }
      first: $first
      after: $after
    ) {
      nodes { ...IssueFields }
      pageInfo {
        hasNextPage
        endCursor
      }
    }
  }
`;

// ---------------------------------------------------------------------------
// Raw GraphQL response shapes
// ---------------------------------------------------------------------------

interface RawRelationNode {
  type: string;
  relatedIssue: {
    id: string;
    identifier: string;
    state: { name: string };
  };
}

interface RawIssueNode {
  id: string;
  identifier: string;
  title: string;
  description: string | null;
  priority: unknown;
  state: { name: string };
  branchName: string | null;
  url: string | null;
  labels: { nodes: { name: string }[] };
  relations: { nodes: RawRelationNode[] };
  createdAt: string | null;
  updatedAt: string | null;
}

interface PageInfo {
  hasNextPage: boolean;
  endCursor: string | null;
}

interface GraphQLResponse<T> {
  data?: T;
  errors?: { message: string; extensions?: Record<string, unknown> }[];
}

// ---------------------------------------------------------------------------
// Normalization (Section 11.3)
// ---------------------------------------------------------------------------

function normalizeIssue(raw: RawIssueNode): Issue {
  // labels -> lowercase strings
  const labels = raw.labels.nodes.map((l) => l.name.toLowerCase());

  // blocked_by -> derived from inverse relations where type is 'blocks'
  const blockedBy: BlockerRef[] = raw.relations.nodes
    .filter((r) => r.type === 'blocks')
    .map((r) => ({
      id: r.relatedIssue.id ?? null,
      identifier: r.relatedIssue.identifier ?? null,
      state: r.relatedIssue.state?.name ?? null,
    }));

  // priority -> integer only (non-integers become null)
  let priority: number | null = null;
  if (raw.priority != null) {
    const num = Number(raw.priority);
    if (Number.isInteger(num)) {
      priority = num;
    }
  }

  // created_at / updated_at -> parse ISO-8601
  const createdAt = raw.createdAt ? parseISODate(raw.createdAt) : null;
  const updatedAt = raw.updatedAt ? parseISODate(raw.updatedAt) : null;

  return {
    id: raw.id,
    identifier: raw.identifier,
    title: raw.title,
    description: raw.description,
    priority,
    state: raw.state.name,
    branchName: raw.branchName,
    url: raw.url,
    labels,
    blockedBy,
    createdAt,
    updatedAt,
  };
}

function parseISODate(value: string): Date | null {
  const d = new Date(value);
  return Number.isNaN(d.getTime()) ? null : d;
}

// ---------------------------------------------------------------------------
// LinearClient
// ---------------------------------------------------------------------------

const DEFAULT_ENDPOINT = 'https://api.linear.app/graphql';
const PAGE_SIZE = 50;
const NETWORK_TIMEOUT_MS = 30_000;

export class LinearClient implements TrackerClient {
  private readonly endpoint: string;
  private readonly apiKey: string;
  private readonly projectSlug: string;
  private readonly activeStates: string[];

  constructor(config: TrackerConfig) {
    if (!config.apiKey) {
      throw new TrackerError(
        'missing_tracker_api_key',
        'Linear API key is required but was not provided in tracker config.',
      );
    }
    this.endpoint = config.endpoint || DEFAULT_ENDPOINT;
    this.apiKey = config.apiKey;
    this.projectSlug = config.projectSlug;
    this.activeStates = config.activeStates;
  }

  // ---- Public API ----------------------------------------------------------

  /**
   * Fetch candidate issues: issues in the configured project whose state is
   * one of the configured active states. Automatically paginates.
   */
  async fetchCandidateIssues(): Promise<Issue[]> {
    const allIssues: Issue[] = [];
    let after: string | null = null;
    let hasNextPage = true;

    while (hasNextPage) {
      const variables: Record<string, unknown> = {
        projectSlug: this.projectSlug,
        states: this.activeStates,
        first: PAGE_SIZE,
        ...(after != null ? { after } : {}),
      };

      const body = await this.executeGraphQL<{
        issues: { nodes: RawIssueNode[]; pageInfo: PageInfo };
      }>(CANDIDATE_ISSUES_QUERY, variables);

      const { nodes, pageInfo } = body.issues;
      for (const node of nodes) {
        allIssues.push(normalizeIssue(node));
      }

      hasNextPage = pageInfo.hasNextPage;
      after = pageInfo.endCursor;
    }

    return allIssues;
  }

  /**
   * Fetch minimal issue data by GraphQL IDs for reconciliation.
   * Uses `nodes(ids:)` query with `[ID!]` typing.
   */
  async fetchIssueStatesByIds(issueIds: string[]): Promise<Issue[]> {
    if (issueIds.length === 0) {
      return [];
    }

    const body = await this.executeGraphQL<{
      nodes: (RawIssueNode | null)[];
    }>(ISSUES_BY_IDS_QUERY, { ids: issueIds });

    // The `nodes` query can return null entries for deleted/inaccessible issues.
    return body.nodes.filter(isNonNull).map(normalizeIssue);
  }

  /**
   * Fetch issues in the given state names (used for terminal cleanup).
   * Returns empty array immediately when called with an empty state list.
   */
  async fetchIssuesByStates(stateNames: string[]): Promise<Issue[]> {
    if (stateNames.length === 0) {
      return [];
    }

    const allIssues: Issue[] = [];
    let after: string | null = null;
    let hasNextPage = true;

    while (hasNextPage) {
      const variables: Record<string, unknown> = {
        projectSlug: this.projectSlug,
        states: stateNames,
        first: PAGE_SIZE,
        ...(after != null ? { after } : {}),
      };

      const body = await this.executeGraphQL<{
        issues: { nodes: RawIssueNode[]; pageInfo: PageInfo };
      }>(ISSUES_BY_STATES_QUERY, variables);

      const { nodes, pageInfo } = body.issues;
      for (const node of nodes) {
        allIssues.push(normalizeIssue(node));
      }

      hasNextPage = pageInfo.hasNextPage;
      after = pageInfo.endCursor;
    }

    return allIssues;
  }

  // ---- Internal helpers ----------------------------------------------------

  /**
   * Execute a GraphQL request against the Linear API with timeout and
   * structured error handling.
   */
  private async executeGraphQL<T>(
    query: string,
    variables: Record<string, unknown>,
  ): Promise<T> {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), NETWORK_TIMEOUT_MS);

    let response: Response;
    try {
      response = await fetch(this.endpoint, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${this.apiKey}`,
        },
        body: JSON.stringify({ query, variables }),
        signal: controller.signal,
      });
    } catch (err: unknown) {
      clearTimeout(timeout);
      if (isAbortError(err)) {
        throw new TrackerError(
          'tracker_timeout',
          `Linear API request timed out after ${NETWORK_TIMEOUT_MS}ms.`,
          err,
        );
      }
      throw new TrackerError(
        'tracker_network_error',
        `Network error communicating with Linear API: ${errorMessage(err)}`,
        err,
      );
    } finally {
      clearTimeout(timeout);
    }

    // Auth errors
    if (response.status === 401 || response.status === 403) {
      throw new TrackerError(
        'tracker_auth_error',
        `Linear API authentication failed (HTTP ${response.status}).`,
      );
    }

    // Rate limiting
    if (response.status === 429) {
      throw new TrackerError(
        'tracker_rate_limited',
        'Linear API rate limit exceeded.',
      );
    }

    // Other HTTP errors
    if (!response.ok) {
      const text = await response.text().catch(() => '');
      throw new TrackerError(
        'tracker_network_error',
        `Linear API returned HTTP ${response.status}: ${text}`,
      );
    }

    const json = (await response.json()) as GraphQLResponse<T>;

    if (json.errors && json.errors.length > 0) {
      const messages = json.errors.map((e) => e.message).join('; ');
      throw new TrackerError(
        'tracker_graphql_error',
        `Linear GraphQL errors: ${messages}`,
      );
    }

    if (!json.data) {
      throw new TrackerError(
        'tracker_graphql_error',
        'Linear GraphQL response contained no data.',
      );
    }

    return json.data;
  }
}

// ---------------------------------------------------------------------------
// Utility functions
// ---------------------------------------------------------------------------

function isNonNull<T>(value: T | null | undefined): value is T {
  return value != null;
}

function isAbortError(err: unknown): boolean {
  return err instanceof DOMException && err.name === 'AbortError';
}

function errorMessage(err: unknown): string {
  if (err instanceof Error) return err.message;
  return String(err);
}
