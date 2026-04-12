// ---------------------------------------------------------------------------
// Harmony Configuration Defaults (Spec Section 6.4)
// ---------------------------------------------------------------------------

export const DEFAULTS = {
  tracker: {
    endpoint: 'https://api.linear.app/graphql',
    activeStates: ['Todo', 'In Progress'],
    terminalStates: ['Closed', 'Cancelled', 'Canceled', 'Duplicate', 'Done'],
  },
  polling: { intervalMs: 30000 },
  workspace: { root: '' }, // resolved at runtime to os.tmpdir()/harmony_workspaces
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
};
