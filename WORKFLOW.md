---
# Tracker: use "github" or "linear"
# GitHub: set GITHUB_TOKEN env var and use "owner/repo" as project_slug
# Linear: set LINEAR_API_KEY env var and use your project slug
tracker:
  kind: github
  api_key: $GITHUB_TOKEN
  project_slug: owner/repo
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
  root: ~/symphony_workspaces

hooks:
  after_create: |
    git init
    echo "Workspace initialized"
  before_run: |
    echo "Starting agent run"
  after_run: |
    echo "Agent run finished"
  timeout_ms: 60000

agent:
  max_concurrent_agents: 5
  max_turns: 20
  max_retry_backoff_ms: 300000
  max_concurrent_agents_by_state:
    todo: 2
    in progress: 5

codex:
  command: codex app-server
  approval_policy: auto-edit
  turn_timeout_ms: 3600000
  stall_timeout_ms: 300000

server:
  port: 3000
---

# Symphony Workflow

You are a coding agent working on issue **{{ issue.identifier }}**: **{{ issue.title }}**.

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
This is your first attempt at this issue. Read the codebase, understand the problem, implement the solution, write tests, and create a pull request.
{% else %}
This is retry attempt {{ attempt }}. Review your previous work and continue from where you left off. Fix any issues encountered in the previous attempt.
{% endif %}

### Guidelines
1. Read the existing code and understand the architecture
2. Make focused, minimal changes
3. Write or update tests for your changes
4. Ensure all existing tests pass
5. Create a descriptive commit message
6. If the change is ready, transition the issue to "In Progress" and create a PR
