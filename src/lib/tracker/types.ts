// ---------------------------------------------------------------------------
// Symphony Core Domain Model (Spec Section 4)
// ---------------------------------------------------------------------------

// ---- Helper / Utility Types -----------------------------------------------

/** Supported issue-tracker backends. */
export type TrackerKind = "linear" | "github";

/** Errors that can arise when loading or parsing a workflow file. */
export type WorkflowError =
  | "missing_workflow_file"
  | "workflow_parse_error"
  | "workflow_validation_error"
  | "workflow_template_error";

/** High-level categories of agent events streamed from a Codex session. */
export type AgentEventKind =
  | "session_init"
  | "turn_start"
  | "turn_end"
  | "message"
  | "error"
  | "rate_limit"
  | "usage"
  | "session_end";

// ---- 4.1.1 Issue ----------------------------------------------------------

/** A reference to another issue that blocks the current one. */
export interface BlockerRef {
  id: string | null;
  identifier: string | null;
  state: string | null;
}

/** Normalized issue record fetched from an external tracker. */
export interface Issue {
  /** Stable tracker-generated ID (e.g. Linear UUID). */
  id: string;
  /** Human-readable identifier such as "ABC-123". */
  identifier: string;
  title: string;
  description: string | null;
  /** Numeric priority; lower value = higher urgency. */
  priority: number | null;
  /** Current workflow state name (e.g. "In Progress"). */
  state: string;
  /** Suggested git branch name, if provided by the tracker. */
  branchName: string | null;
  /** URL to view the issue in the tracker UI. */
  url: string | null;
  /** Labels attached to the issue, normalized to lowercase. */
  labels: string[];
  /** Other issues that block this one. */
  blockedBy: BlockerRef[];
  createdAt: Date | null;
  updatedAt: Date | null;
}

// ---- 4.1.2 WorkflowDefinition ---------------------------------------------

/** A loaded workflow definition consisting of arbitrary config and a prompt template. */
export interface WorkflowDefinition {
  /** Freeform configuration object parsed from the workflow file header. */
  config: Record<string, unknown>;
  /** Handlebars/Mustache-style prompt template rendered per-issue. */
  promptTemplate: string;
}

// ---- 4.1.3 ServiceConfig ---------------------------------------------------

export interface TrackerConfig {
  kind: TrackerKind;
  endpoint: string;
  apiKey: string;
  projectSlug: string;
  /** States that mark an issue as eligible for agent work. */
  activeStates: string[];
  /** States that mark an issue as done (no further processing). */
  terminalStates: string[];
}

export interface PollingConfig {
  /** Interval between tracker polls in milliseconds. */
  intervalMs: number;
}

export interface WorkspaceConfig {
  /** Filesystem root under which per-issue workspaces are created. */
  root: string;
}

export interface HooksConfig {
  /** Script to run after a workspace is created. */
  afterCreate: string | null;
  /** Script to run before launching the agent. */
  beforeRun: string | null;
  /** Script to run after the agent finishes. */
  afterRun: string | null;
  /** Script to run before removing a workspace. */
  beforeRemove: string | null;
  /** Maximum time (ms) any single hook may run before being killed. */
  timeoutMs: number;
}

export interface AgentConfig {
  /** Global cap on simultaneously running agent processes. */
  maxConcurrentAgents: number;
  /** Maximum turns per agent session. */
  maxTurns: number;
  /** Upper bound (ms) for exponential retry back-off. */
  maxRetryBackoffMs: number;
  /** Per-state concurrency overrides (state name -> max agents). */
  maxConcurrentAgentsByState: Record<string, number>;
}

export interface CodexConfig {
  /** CLI command used to launch the Codex agent. */
  command: string;
  /** Auto-approval policy: "full-auto", "auto-edit", "suggest", etc. */
  approvalPolicy: string;
  /** Sandbox strategy for the entire thread. */
  threadSandbox: string;
  /** Sandbox strategy applied per-turn. */
  turnSandboxPolicy: string;
  /** Hard timeout (ms) for a single agent turn. */
  turnTimeoutMs: number;
  /** Timeout (ms) waiting for the first byte of output. */
  readTimeoutMs: number;
  /** Time (ms) of no output before declaring a session stalled. */
  stallTimeoutMs: number;
}

export interface ClaudeConfig {
  /** Whether to use Claude Code CLI instead of Codex. */
  enabled: boolean;
  /** Total runtime timeout in ms for each task (default: 1_200_000 = 20 min). */
  runtimeTimeoutMs: number;
  /** Max turns for the Claude CLI --max-turns flag. */
  maxTurns: number;
  /** Model to use (e.g. "claude-sonnet-4-20250514"), or empty for CLI default. */
  model: string;
}

export interface ServerConfig {
  port?: number;
}

/** Fully-typed service configuration (Section 6.4). */
export interface ServiceConfig {
  tracker: TrackerConfig;
  polling: PollingConfig;
  workspace: WorkspaceConfig;
  hooks: HooksConfig;
  agent: AgentConfig;
  codex: CodexConfig;
  claude: ClaudeConfig;
  server?: ServerConfig;
}

// ---- 4.1.4 Workspace -------------------------------------------------------

/** A per-issue workspace on disk. */
export interface Workspace {
  /** Absolute filesystem path to the workspace directory. */
  path: string;
  /** Unique key derived from the issue (used for directory naming). */
  workspaceKey: string;
  /** Whether the workspace was freshly created during this cycle. */
  createdNow: boolean;
}

// ---- 4.1.5 RunAttempt & RunStatus ------------------------------------------

/** Lifecycle status of a single agent run attempt. */
export enum RunStatus {
  PreparingWorkspace = "PreparingWorkspace",
  BuildingPrompt = "BuildingPrompt",
  LaunchingAgentProcess = "LaunchingAgentProcess",
  InitializingSession = "InitializingSession",
  StreamingTurn = "StreamingTurn",
  Finishing = "Finishing",
  Succeeded = "Succeeded",
  Failed = "Failed",
  TimedOut = "TimedOut",
  Stalled = "Stalled",
  CanceledByReconciliation = "CanceledByReconciliation",
}

/** Record of a single attempt to process an issue. */
export interface RunAttempt {
  issueId: string;
  issueIdentifier: string;
  /** Attempt number (1-based); null when not yet assigned. */
  attempt: number | null;
  /** Absolute path to the workspace used for this run. */
  workspacePath: string;
  startedAt: Date;
  status: RunStatus;
  /** Human-readable error message if the run failed. */
  error?: string;
}

// ---- 4.1.6 LiveSession -----------------------------------------------------

/** Tracks the lifecycle of a running Codex agent session. */
export interface LiveSession {
  /** Spawned child process handle. */
  process: import("child_process").ChildProcess;
  /** Unique session ID assigned by Codex. */
  sessionId: string | null;
  /** Current run status. */
  status: RunStatus;
  /** Monotonic timestamp (ms) of the last output received. */
  lastActivityMs: number;
  /** Accumulated stdout chunks. */
  stdoutChunks: string[];
  /** Accumulated stderr chunks. */
  stderrChunks: string[];
  /** Resolved when the session terminates. */
  completionPromise: Promise<void>;
  /** Number of turns executed so far. */
  turnCount: number;
  /** Per-session token usage counters. */
  usage: {
    inputTokens: number;
    outputTokens: number;
    totalTokens: number;
    secondsRunning: number;
  };
}

// ---- 4.1.7 RetryEntry ------------------------------------------------------

/** An issue queued for retry after a transient failure. */
export interface RetryEntry {
  issueId: string;
  identifier: string;
  /** 1-based attempt counter. */
  attempt: number;
  /** Epoch-ms timestamp when the retry becomes eligible. */
  dueAtMs: number;
  /** Handle to the scheduled retry timer, if one is set. */
  timerHandle: ReturnType<typeof setTimeout> | null;
  /** Error message from the failed attempt that triggered this retry. */
  error: string | null;
}

// ---- 4.1.8 OrchestratorState -----------------------------------------------

/** Aggregated token/time counters across all Codex sessions. */
export interface CodexTotals {
  inputTokens: number;
  outputTokens: number;
  totalTokens: number;
  secondsRunning: number;
}

/** Per-issue entry in the orchestrator's running map. */
export interface RunningEntry {
  issueId: string;
  issueIdentifier: string;
  attempt: number;
  workspacePath: string;
  startedAt: Date;
  status: RunStatus;
  /** The live Codex session, if one has been spawned. */
  session: LiveSession | null;
  /** The issue snapshot at the time this run started. */
  issue: Issue;
  /** Error message if the run has failed. */
  error?: string;
  /** Session ID (populated from codex updates even without a LiveSession). */
  sessionId?: string;
  /** Token counters tracked directly from codex update events. */
  inputTokens: number;
  outputTokens: number;
  totalTokens: number;
  /** Number of turns started in this run. */
  turnCount: number;
  /** Epoch-ms of most recent codex event (for stall detection). */
  lastActivityMs: number;
}

/** Top-level orchestrator state that drives the reconciliation loop. */
export interface OrchestratorState {
  /** Active polling interval in milliseconds. */
  pollIntervalMs: number;
  /** Maximum number of concurrent agent processes. */
  maxConcurrentAgents: number;
  /** Currently running agent entries, keyed by issue ID. */
  running: Map<string, RunningEntry>;
  /** Issue IDs that have been claimed for processing this cycle. */
  claimed: Set<string>;
  /** Issues waiting for retry, keyed by issue ID. */
  retryAttempts: Map<string, RetryEntry>;
  /** Issue IDs that have reached a terminal state. */
  completed: Set<string>;
  /** Aggregate token and time usage across all sessions. */
  codexTotals: CodexTotals;
  /** Raw rate-limit headers from the most recent Codex API response. */
  codexRateLimits: Record<string, unknown> | null;
}

// ---- 4.x CodexUpdateEvent -------------------------------------------------

/** Structured event emitted by a Codex agent session. */
export type CodexUpdateEvent =
  | { kind: "session_init"; sessionId: string }
  | { kind: "turn_start"; turnNumber: number }
  | { kind: "turn_end"; turnNumber: number }
  | {
      kind: "message";
      role: "assistant" | "system";
      content: string;
    }
  | { kind: "error"; message: string; fatal: boolean }
  | {
      kind: "rate_limit";
      retryAfterMs: number;
      headers: Record<string, string>;
    }
  | {
      kind: "usage";
      inputTokens: number;
      outputTokens: number;
      totalTokens: number;
      secondsRunning: number;
    }
  | { kind: "session_end"; exitCode: number | null };
