---
# Tracker: use "github" or "linear"
# GitHub: set GITHUB_TOKEN env var and use "owner/repo" as project_slug
# Linear: set LINEAR_API_KEY env var and use your project slug
tracker:
  kind: github
  api_key: $GITHUB_TOKEN
  project_slug: raflorenz/harmony
  active_states:
    - Todo
    - In Progress
  terminal_states:
    - Done
    - Closed
    - Cancelled
    - Canceled
    - Duplicate

polling:
  interval_ms: 30000

workspace:
  root: ~/harmony_workspaces

hooks:
  # Git clone is handled by ClaudeAgentRunner — no git init needed here
  after_create: |
    echo "Workspace created"
  before_run: |
    echo "Starting agent run"
  after_run: |
    echo "Agent run finished"
  timeout_ms: 60000

agent:
  max_concurrent_agents: 3
  max_turns: 250
  max_retry_backoff_ms: 300000

# Claude Code CLI as the agent runner
# Requires: `claude` CLI installed, ANTHROPIC_API_KEY env var set
claude:
  enabled: true
  runtime_timeout_ms: 3600000
  max_turns: 250
  model: "" # empty = use CLI default

# Codex config kept for fallback (claude.enabled: false to use Codex instead)
codex:
  command: codex app-server
  approval_policy: auto-edit
  turn_timeout_ms: 3600000
  stall_timeout_ms: 300000

# Side-agent runtime (used by grader, verifier, decomposer, repo-brain).
# Set ANTHROPIC_API_KEY env var or hard-code apiKey here.
sideAgent:
  apiKey: $ANTHROPIC_API_KEY
  defaultModel: claude-haiku-4-5-20251001

# Guardrails — declarative limits enforced by the orchestrator.
# blockedPaths: enforced via a pre-commit hook installed in the workspace.
# maxFilesChanged / maxDiffLines / maxCostUsd: checked before opening a PR.
# requireLabelForPaths: ticket must have label X when changes touch glob.
# onBreach: stop_and_escalate (default), warn, or auto_split.
guardrails:
  maxFilesChanged: 25
  maxDiffLines: 1500
  maxCostUsd: 5.00
  blockedPaths:
    - "infra/**"
    - "*.lock"
    - ".github/workflows/**"
  requireLabelForPaths:
    "src/db/migrations/**": "needs-migration-review"
  onBreach: stop_and_escalate

# Issue grader — pre-execution gate. Filters underspecified tickets before
# they reach the execution agent. Failed tickets get a comment with blocking
# questions and transition to harmony:needs-clarification.
grader:
  enabled: false
  model: claude-haiku-4-5-20251001
  thresholds:
    minPerScore: 3
    minOverall: 14
  rerunOnCommentUpdate: true

# Verifier — post-execution gate. A fresh-context critic reviews the diff
# against the spec before the orchestrator opens a PR. On request_revision
# the run aborts and the ticket transitions to harmony:needs-revision.
verifier:
  enabled: false
  model: claude-sonnet-4-6
  maxRevisions: 2
  onNoTests: concern   # | "blocking"

server:
  port: 3000
---

# Harmony Workflow

You are a coding agent working on issue **{{ issue.identifier }}**: **{{ issue.title }}**.

You are working inside a cloned Git repository on a dedicated branch. Your goal is to implement the changes described in this issue.

## Issue Details

- **State:** {{ issue.state }}
- **Priority:** {{ issue.priority }}
- **Description:** {{ issue.description }}
  {% if issue.url %}- **URL:** {{ issue.url }}{% endif %}

{% if issue.labels.size > 0 %}

## Labels

{% for label in issue.labels %}- {{ label }}
{% endfor %}
{% endif %}

{% if issue.blocked_by.size > 0 %}

## Blockers

{% for blocker in issue.blocked_by %}- {{ blocker.identifier }} ({{ blocker.state }})
{% endfor %}
{% endif %}

## Instructions

{% if attempt == null %}
This is your first attempt at this issue. Follow these steps:

1. Read the codebase to understand the architecture and relevant code
2. Plan your implementation approach
3. Implement the solution with focused, minimal changes
4. Write or update tests for your changes
5. Ensure all existing tests still pass
6. Commit all your changes with a descriptive commit message
7. Push the branch to origin
8. Create a pull request on GitHub targeting the `main` branch

{% else %}
This is retry attempt {{ attempt }}. Review your previous work on this branch and continue from where you left off. Fix any issues encountered in the previous attempt. When done, commit, push, and create a PR if one doesn't already exist.
{% endif %}

### Guidelines

- Make focused, minimal changes — do not refactor unrelated code
- If tests exist, make sure they pass before finishing
- Do NOT commit, push, or create a PR — the orchestrator handles that automatically after you finish
