// ---------------------------------------------------------------------------
// Symphony Configuration Defaults (Spec Section 6.4)
// ---------------------------------------------------------------------------

export const DEFAULTS = {
  tracker: {
    endpoint: 'https://api.linear.app/graphql',
    activeStates: ['Todo', 'In Progress'],
    terminalStates: ['Closed', 'Cancelled', 'Canceled', 'Duplicate', 'Done'],
  },
  polling: { intervalMs: 30000 },
  workspace: { root: '' }, // resolved at runtime to os.tmpdir()/symphony_workspaces
  hooks: { timeoutMs: 60000 },
  agent: {
    maxConcurrentAgents: 10,
    maxTurns: 20,
    maxRetryBackoffMs: 300000,
  },
  codex: {
    command: 'codex app-server',
    approvalPolicy: 'auto-edit',
    threadSandbox: 'none',
    turnSandboxPolicy: 'none',
    turnTimeoutMs: 3600000,
    readTimeoutMs: 5000,
    stallTimeoutMs: 300000,
  },
  claude: {
    enabled: false,
    runtimeTimeoutMs: 1_200_000, // 20 minutes
    maxTurns: 20,
    model: '', // empty = use CLI default
  },
  sideAgent: {
    apiKey: '',
    defaultModel: 'claude-haiku-4-5-20251001',
    endpoint: '',
  },
  guardrails: {
    maxFilesChanged: 25,
    maxDiffLines: 1500,
    maxCostUsd: 5.0,
    blockedPaths: [] as string[],
    requireLabelForPaths: {} as Record<string, string>,
    onBreach: 'stop_and_escalate' as 'stop_and_escalate' | 'warn' | 'auto_split',
  },
  repoBrain: {
    enabled: false,
    model: '',
    learningsPath: '.harmony/learnings.md',
    learningsPrivatePath: '.harmony/learnings.private.md',
    maxInjectChars: 8000,
  decomposer: {
    enabled: false,
    model: '',
    maxTickets: 5,
  grader: {
    enabled: false,
    model: '',
    minPerScore: 3,
    minOverall: 14,
    rerunOnCommentUpdate: true,
  },
  verifier: {
    enabled: false,
    model: '',
    maxRevisions: 2,
    onNoTests: 'concern' as 'concern' | 'blocking',
  },
};
