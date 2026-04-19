// ---------------------------------------------------------------------------
// Claude Code CLI Agent Runner
// ---------------------------------------------------------------------------
//
// Implements the AgentRunner interface using the Claude Code CLI (`claude`)
// as a subprocess. Each task clones its GitHub repo into the workspace,
// creates a dedicated branch, and runs Claude to implement the issue spec.
// ---------------------------------------------------------------------------

import { spawn, execSync, type ChildProcess } from 'child_process';
import * as fs from 'fs/promises';
import * as path from 'path';
import * as os from 'os';
import { logger } from '../observability/logger';
import { runHook } from './hooks';
import { execInWorkspace } from './hooks';
import { buildTurnPrompt, DEFAULT_PROMPT } from './prompt';
import type { AgentRunner } from '../orchestrator/scheduler';
import type { Issue, ServiceConfig, CodexUpdateEvent } from '../tracker/types';
import type { TrackerClient } from '../tracker/client';

// ---------------------------------------------------------------------------
// Claude CLI stream-json event shapes
// ---------------------------------------------------------------------------

interface ClaudeStreamEvent {
  type: string;
  subtype?: string;
  session_id?: string;
  message?: {
    role?: string;
    content?: Array<{
      type: string;
      text?: string;
      name?: string;
      input?: Record<string, unknown>;
    }>;
    usage?: { input_tokens?: number; output_tokens?: number };
  };
  content_block?: { type: string; text?: string; name?: string };
  result?: string;
  cost_usd?: number;
  duration_ms?: number;
  duration_api_ms?: number;
  input_tokens?: number;
  output_tokens?: number;
  total_tokens?: number;
  is_error?: boolean;
  tool_name?: string;
  // Catch-all for other fields
  [key: string]: unknown;
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const GIT_TIMEOUT_MS = 120_000; // 2 minutes for git operations
const BRANCH_PREFIX = 'harmony';

/** Cached resolved path to the claude binary. */
let _claudeBinaryPath: string | null = null;

/**
 * Resolve the claude binary path. Searches common install locations on Windows
 * and falls back to expecting `claude` in PATH on other platforms.
 */
function resolveClaudeBinary(): string {
  if (_claudeBinaryPath) return _claudeBinaryPath;

  // Try `which claude` / `where claude` first
  try {
    const cmd = process.platform === 'win32' ? 'where claude' : 'which claude';
    const result = execSync(cmd, { encoding: 'utf-8', timeout: 5_000 }).trim();
    if (result) {
      _claudeBinaryPath = result.split('\n')[0].trim();
      logger.info('Resolved claude binary via PATH', { path: _claudeBinaryPath });
      return _claudeBinaryPath;
    }
  } catch {
    // Not in PATH — try known install locations
  }

  // Common install locations (Windows native binary)
  const candidates: string[] = [];
  const home = os.homedir();

  if (process.platform === 'win32') {
    candidates.push(
      path.join(home, '.local', 'bin', 'claude.exe'),
      path.join(process.env.LOCALAPPDATA ?? '', 'Programs', 'claude-code', 'claude.exe'),
    );
  } else {
    candidates.push(
      path.join(home, '.local', 'bin', 'claude'),
      '/usr/local/bin/claude',
    );
  }

  for (const candidate of candidates) {
    try {
      const stat = require('fs').statSync(candidate);
      if (stat.isFile()) {
        _claudeBinaryPath = candidate;
        logger.info('Resolved claude binary at known location', { path: candidate });
        return candidate;
      }
    } catch {
      // Not found, try next
    }
  }

  // Fallback: assume it's in PATH and let spawn fail with a clear error
  logger.warn('Could not resolve claude binary path, falling back to "claude"');
  _claudeBinaryPath = 'claude';
  return 'claude';
}

// ---------------------------------------------------------------------------
// ClaudeAgentRunner
// ---------------------------------------------------------------------------

export class ClaudeAgentRunner implements AgentRunner {
  private activeProcesses = new Map<string, ChildProcess>();
  private tracker: TrackerClient;

  constructor(tracker: TrackerClient) {
    this.tracker = tracker;
  }

  async runAttempt(params: {
    issue: Issue;
    attempt: number | null;
    workspacePath: string;
    config: ServiceConfig;
    promptTemplate: string;
    onUpdate: (event: CodexUpdateEvent) => void;
  }): Promise<{ success: boolean; error?: string }> {
    const { issue, attempt, workspacePath, config, promptTemplate, onUpdate } =
      params;
    const log = logger.forIssue(issue.id, issue.identifier);
    const claudeConfig = config.claude;

    // 1. Run before_run hook (fatal — failure aborts attempt)
    try {
      await runHook(
        'before_run',
        config.hooks.beforeRun,
        workspacePath,
        config.hooks.timeoutMs,
        true,
      );
    } catch (err) {
      await this.runAfterRunHook(config, workspacePath);
      return {
        success: false,
        error: `before_run hook failed: ${err instanceof Error ? err.message : String(err)}`,
      };
    }

    // 2. Prepare git workspace: clone repo + create branch
    try {
      await this.prepareGitWorkspace(
        workspacePath,
        issue.identifier,
        config,
        onUpdate,
      );
    } catch (err) {
      await this.runAfterRunHook(config, workspacePath);
      return {
        success: false,
        error: `Git workspace setup failed: ${err instanceof Error ? err.message : String(err)}`,
      };
    }

    // 3. Build the prompt
    const template = promptTemplate || DEFAULT_PROMPT;
    let prompt: string;
    try {
      prompt = await buildTurnPrompt(
        template,
        issue,
        attempt,
        1, // turn 1 — Claude CLI handles its own multi-turn internally
        claudeConfig.maxTurns,
      );
    } catch (err) {
      await this.runAfterRunHook(config, workspacePath);
      return {
        success: false,
        error: `Prompt error: ${err instanceof Error ? err.message : String(err)}`,
      };
    }

    // 4. Spawn Claude CLI and stream events
    const sessionId = `claude-${Date.now()}-${issue.identifier}`;
    onUpdate({ kind: 'session_init', sessionId });
    log.info('Claude agent session starting', {
      session_id: sessionId,
      workspace: workspacePath,
    });

    let result: { success: boolean; error?: string };
    try {
      result = await this.runClaude(
        workspacePath,
        prompt,
        claudeConfig.runtimeTimeoutMs,
        claudeConfig.maxTurns,
        claudeConfig.model,
        issue.id,
        onUpdate,
      );
    } catch (err) {
      result = {
        success: false,
        error: err instanceof Error ? err.message : String(err),
      };
    }

    // 5. If Claude succeeded, commit + push + create PR (post-processing)
    if (result.success) {
      try {
        await this.commitPushAndCreatePR(
          workspacePath,
          issue,
          config,
          onUpdate,
        );
      } catch (err) {
        log.warn('Post-processing (commit/push/PR) failed', {
          session_id: sessionId,
          error: err instanceof Error ? err.message : String(err),
        });
        // Don't fail the whole run — code changes are still there
      }

      // 5b. Close the GitHub issue
      try {
        await this.closeGitHubIssue(issue, config, onUpdate);
      } catch (err) {
        log.warn('Failed to close GitHub issue', {
          session_id: sessionId,
          error: err instanceof Error ? err.message : String(err),
        });
      }
    }

    // 6. Run after_run hook (non-fatal)
    await this.runAfterRunHook(config, workspacePath);
    this.activeProcesses.delete(issue.id);

    if (result.success) {
      log.info('Claude agent run completed successfully', {
        session_id: sessionId,
      });
    } else {
      log.warn('Claude agent run failed', {
        session_id: sessionId,
        error: result.error,
      });
    }

    return result;
  }

  async terminateRun(issueId: string): Promise<void> {
    const proc = this.activeProcesses.get(issueId);
    if (proc) {
      try {
        proc.kill('SIGTERM');
        setTimeout(() => {
          try {
            proc.kill('SIGKILL');
          } catch {
            // Already dead
          }
        }, 5_000);
      } catch {
        // Already dead
      }
      this.activeProcesses.delete(issueId);
    }
  }

  // ---------------------------------------------------------------------------
  // Git workspace preparation
  // ---------------------------------------------------------------------------

  private async prepareGitWorkspace(
    workspacePath: string,
    issueIdentifier: string,
    config: ServiceConfig,
    onUpdate: (event: CodexUpdateEvent) => void,
  ): Promise<void> {
    const { kind, apiKey, projectSlug } = config.tracker;

    // Derive clone URL
    let cloneUrl: string;
    if (kind === 'github') {
      const [owner, repo] = projectSlug.split('/');
      if (!owner || !repo) {
        throw new Error(
          `Invalid project_slug "${projectSlug}". Expected "owner/repo" format.`,
        );
      }
      // Use token-authenticated HTTPS URL for cloning
      if (apiKey) {
        cloneUrl = `https://x-access-token:${apiKey}@github.com/${owner}/${repo}.git`;
      } else {
        cloneUrl = `https://github.com/${owner}/${repo}.git`;
      }
    } else {
      throw new Error(
        `Claude agent runner only supports GitHub repos (got tracker kind: "${kind}")`,
      );
    }

    const branchName = `${BRANCH_PREFIX}/${issueIdentifier.replace(/[^A-Za-z0-9._-]/g, '-').toLowerCase()}`;

    // Check if already cloned (workspace reuse on retry)
    const gitDirExists = await fileExists(path.join(workspacePath, '.git'));

    if (!gitDirExists) {
      onUpdate({
        kind: 'message',
        role: 'system',
        content: `Cloning repository ${projectSlug}...`,
      });

      const cloneResult = await execInWorkspace(
        `git clone --depth=50 ${cloneUrl} .`,
        workspacePath,
        GIT_TIMEOUT_MS,
      );

      if (cloneResult.exitCode !== 0) {
        throw new Error(
          `git clone failed (exit ${cloneResult.exitCode}): ${cloneResult.stderr.slice(0, 500)}`,
        );
      }
    } else {
      // Workspace reuse: fetch latest
      onUpdate({
        kind: 'message',
        role: 'system',
        content: 'Fetching latest changes...',
      });

      const fetchResult = await execInWorkspace(
        'git fetch origin',
        workspacePath,
        GIT_TIMEOUT_MS,
      );

      if (fetchResult.exitCode !== 0) {
        logger.warn('git fetch failed, continuing with existing state', {
          stderr: fetchResult.stderr.slice(0, 500),
        });
      }
    }

    // Create or checkout the branch
    const nullDev = process.platform === 'win32' ? 'NUL' : '/dev/null';
    const branchCheck = await execInWorkspace(
      `git rev-parse --verify ${branchName} 2>${nullDev}`,
      workspacePath,
      10_000,
    );

    if (branchCheck.exitCode === 0) {
      // Branch exists, check it out
      await execInWorkspace(
        `git checkout ${branchName}`,
        workspacePath,
        10_000,
      );
    } else {
      // Create new branch from default branch
      const createResult = await execInWorkspace(
        `git checkout -b ${branchName}`,
        workspacePath,
        10_000,
      );

      if (createResult.exitCode !== 0) {
        throw new Error(
          `git checkout -b failed (exit ${createResult.exitCode}): ${createResult.stderr.slice(0, 500)}`,
        );
      }
    }

    onUpdate({
      kind: 'message',
      role: 'system',
      content: `Working on branch ${branchName}`,
    });
  }

  // ---------------------------------------------------------------------------
  // Claude CLI execution
  // ---------------------------------------------------------------------------

  private runClaude(
    workspacePath: string,
    prompt: string,
    runtimeTimeoutMs: number,
    maxTurns: number,
    model: string,
    issueId: string,
    onUpdate: (event: CodexUpdateEvent) => void,
  ): Promise<{ success: boolean; error?: string }> {
    return new Promise((resolve) => {
      // Build CLI args
      const args = [
        '-p',
        '--output-format', 'stream-json',
        '--verbose',
        '--max-turns', String(maxTurns),
        '--dangerously-skip-permissions',
      ];

      if (model) {
        args.push('--model', model);
      }

      // Resolve and spawn the claude CLI binary
      const claudeBin = resolveClaudeBinary();
      logger.debug('Spawning Claude CLI', { binary: claudeBin, args });

      // Strip CLAUDECODE env var so the child process doesn't think it's a
      // nested session (Claude Code refuses to launch inside another session).
      const childEnv = { ...process.env };
      delete childEnv.CLAUDECODE;
      delete childEnv.CLAUDE_CODE_ENTRYPOINT;

      // Ensure GH_TOKEN is set for `gh` CLI (used for PR creation).
      // gh prefers GH_TOKEN over GITHUB_TOKEN.
      if (!childEnv.GH_TOKEN && childEnv.GITHUB_TOKEN) {
        childEnv.GH_TOKEN = childEnv.GITHUB_TOKEN;
      }

      // Ensure GitHub CLI is in PATH (common install location on Windows)
      if (process.platform === 'win32') {
        const ghDir = 'C:\\Program Files\\GitHub CLI';
        if (childEnv.PATH && !childEnv.PATH.includes(ghDir)) {
          childEnv.PATH = `${childEnv.PATH};${ghDir}`;
        }
      }

      const child = spawn(claudeBin, args, {
        cwd: workspacePath,
        stdio: ['pipe', 'pipe', 'pipe'],
        env: childEnv,
      });

      this.activeProcesses.set(issueId, child);

      // Write prompt to stdin and close it
      child.stdin?.write(prompt);
      child.stdin?.end();

      let turnNumber = 1;
      let totalInputTokens = 0;
      let totalOutputTokens = 0;
      let buffer = '';
      let resolved = false;
      let claudeErrorMessage: string | null = null;

      const finish = (result: { success: boolean; error?: string }) => {
        if (resolved) return;
        resolved = true;
        clearTimeout(runtimeTimer);
        this.activeProcesses.delete(issueId);
        resolve(result);
      };

      // Runtime timeout
      const runtimeTimer = setTimeout(() => {
        logger.warn('Claude runtime timeout reached', {
          timeout_ms: runtimeTimeoutMs,
          issue_id: issueId,
        });

        onUpdate({
          kind: 'error',
          message: `Runtime timeout: task exceeded ${Math.round(runtimeTimeoutMs / 60_000)} minute limit`,
          fatal: true,
        });

        child.kill('SIGTERM');
        setTimeout(() => {
          try {
            child.kill('SIGKILL');
          } catch {
            // Already dead
          }
        }, 5_000);

        finish({
          success: false,
          error: `Runtime timeout: task exceeded ${Math.round(runtimeTimeoutMs / 60_000)} minute limit`,
        });
      }, runtimeTimeoutMs);

      onUpdate({ kind: 'turn_start', turnNumber });

      // Parse stdout line-by-line
      child.stdout?.on('data', (chunk: Buffer) => {
        buffer += chunk.toString();
        const lines = buffer.split('\n');
        buffer = lines.pop()!;

        for (const line of lines) {
          const trimmed = line.trim();
          if (!trimmed) continue;

          let event: ClaudeStreamEvent;
          try {
            event = JSON.parse(trimmed);
          } catch {
            continue; // Skip non-JSON output
          }

          // Capture fatal error result for surfacing on non-zero exit
          if (event.type === 'result' && event.is_error && event.result) {
            claudeErrorMessage = String(event.result);
          }

          // Update last activity (parent scheduler uses this for stall detection)
          onUpdate({
            kind: 'message',
            role: 'assistant',
            content: '', // empty message just to trigger activity timestamp
          });

          this.handleStreamEvent(
            event,
            onUpdate,
            { turnNumber, totalInputTokens, totalOutputTokens },
            (updates) => {
              if (updates.turnNumber !== undefined) turnNumber = updates.turnNumber;
              if (updates.totalInputTokens !== undefined) totalInputTokens = updates.totalInputTokens;
              if (updates.totalOutputTokens !== undefined) totalOutputTokens = updates.totalOutputTokens;
            },
          );
        }
      });

      // Stderr: log but don't fail
      child.stderr?.on('data', (chunk: Buffer) => {
        const text = chunk.toString().trim();
        if (text) {
          logger.debug('Claude stderr', { text: text.slice(0, 500) });
        }
      });

      child.on('error', (err) => {
        onUpdate({
          kind: 'error',
          message: `Claude process error: ${err.message}`,
          fatal: true,
        });
        finish({ success: false, error: `Process spawn error: ${err.message}` });
      });

      child.on('close', (code) => {
        onUpdate({ kind: 'turn_end', turnNumber });
        onUpdate({
          kind: 'usage',
          inputTokens: totalInputTokens,
          outputTokens: totalOutputTokens,
          totalTokens: totalInputTokens + totalOutputTokens,
          secondsRunning: 0,
        });
        onUpdate({ kind: 'session_end', exitCode: code });

        if (code === 0) {
          finish({ success: true });
        } else {
          finish({
            success: false,
            error: claudeErrorMessage
              ? `${claudeErrorMessage} (exit ${code})`
              : `Claude process exited with code ${code}`,
          });
        }
      });
    });
  }

  // ---------------------------------------------------------------------------
  // Stream event mapping
  // ---------------------------------------------------------------------------

  private handleStreamEvent(
    event: ClaudeStreamEvent,
    onUpdate: (event: CodexUpdateEvent) => void,
    counters: {
      turnNumber: number;
      totalInputTokens: number;
      totalOutputTokens: number;
    },
    updateCounters: (updates: {
      turnNumber?: number;
      totalInputTokens?: number;
      totalOutputTokens?: number;
    }) => void,
  ): void {
    switch (event.type) {
      case 'system': {
        // System init or status messages
        if (event.subtype === 'init' && event.session_id) {
          onUpdate({ kind: 'session_init', sessionId: event.session_id });
        }
        break;
      }

      case 'assistant': {
        // Assistant text or tool use
        if (event.message?.content) {
          for (const block of event.message.content) {
            if (block.type === 'text' && block.text) {
              onUpdate({
                kind: 'message',
                role: 'assistant',
                content: block.text.slice(0, 500),
              });
            } else if (block.type === 'tool_use' && block.name) {
              onUpdate({
                kind: 'message',
                role: 'assistant',
                content: formatToolUse(block.name, block.input),
              });
            }
          }
        }

        // Token usage from message
        if (event.message?.usage) {
          const usage = event.message.usage;
          if (usage.input_tokens) {
            updateCounters({
              totalInputTokens: counters.totalInputTokens + usage.input_tokens,
            });
          }
          if (usage.output_tokens) {
            updateCounters({
              totalOutputTokens: counters.totalOutputTokens + usage.output_tokens,
            });
          }
          onUpdate({
            kind: 'usage',
            inputTokens: counters.totalInputTokens + (usage.input_tokens ?? 0),
            outputTokens: counters.totalOutputTokens + (usage.output_tokens ?? 0),
            totalTokens:
              counters.totalInputTokens +
              (usage.input_tokens ?? 0) +
              counters.totalOutputTokens +
              (usage.output_tokens ?? 0),
            secondsRunning: 0,
          });
        }
        break;
      }

      case 'content_block_start':
      case 'content_block_delta': {
        // Incremental content streaming
        if (event.content_block?.type === 'tool_use' && event.content_block.name) {
          onUpdate({
            kind: 'message',
            role: 'assistant',
            content: `Using tool: ${event.content_block.name}`,
          });
          // Each tool use is roughly a "turn" for tracking
          const newTurn = counters.turnNumber + 1;
          updateCounters({ turnNumber: newTurn });
          onUpdate({ kind: 'turn_end', turnNumber: counters.turnNumber });
          onUpdate({ kind: 'turn_start', turnNumber: newTurn });
        }
        break;
      }

      case 'result': {
        // Final result event with aggregated usage
        if (event.input_tokens !== undefined || event.output_tokens !== undefined) {
          const inputTokens = event.input_tokens ?? counters.totalInputTokens;
          const outputTokens = event.output_tokens ?? counters.totalOutputTokens;
          updateCounters({
            totalInputTokens: inputTokens,
            totalOutputTokens: outputTokens,
          });
          onUpdate({
            kind: 'usage',
            inputTokens,
            outputTokens,
            totalTokens: (event.total_tokens ?? inputTokens + outputTokens),
            secondsRunning: (event.duration_ms ?? 0) / 1000,
          });
        }

        if (event.is_error) {
          onUpdate({
            kind: 'error',
            message: String(event.result ?? 'Claude returned an error'),
            fatal: true,
          });
        }
        break;
      }

      default:
        // Unknown event type — ignore
        break;
    }
  }

  // ---------------------------------------------------------------------------
  // Helpers
  // ---------------------------------------------------------------------------

  private async runAfterRunHook(
    config: ServiceConfig,
    workspacePath: string,
  ): Promise<void> {
    await runHook(
      'after_run',
      config.hooks.afterRun,
      workspacePath,
      config.hooks.timeoutMs,
      false, // Non-fatal
    );
  }

  // ---------------------------------------------------------------------------
  // Post-processing: close GitHub issue
  // ---------------------------------------------------------------------------

  private async closeGitHubIssue(
    issue: Issue,
    config: ServiceConfig,
    onUpdate: (event: CodexUpdateEvent) => void,
  ): Promise<void> {
    const log = logger.forIssue(issue.id, issue.identifier);
    const { apiKey, projectSlug } = config.tracker;
    const [owner, repo] = projectSlug.split('/');

    onUpdate({
      kind: 'message',
      role: 'system',
      content: 'Closing GitHub issue...',
    });

    const response = await fetch(
      `https://api.github.com/repos/${owner}/${repo}/issues/${issue.id}`,
      {
        method: 'PATCH',
        headers: {
          Authorization: `token ${apiKey}`,
          'Content-Type': 'application/json',
          Accept: 'application/vnd.github.v3+json',
        },
        body: JSON.stringify({ state: 'closed' }),
      },
    );

    if (response.ok) {
      log.info('GitHub issue closed', { issue_id: issue.id });
      onUpdate({
        kind: 'message',
        role: 'system',
        content: `Issue ${issue.identifier} closed in GitHub`,
      });
    } else {
      const errBody = await response.text();
      throw new Error(
        `GitHub API returned ${response.status}: ${errBody.slice(0, 300)}`,
      );
    }
  }

  // ---------------------------------------------------------------------------
  // Post-processing: commit, push, and create PR
  // ---------------------------------------------------------------------------

  private async commitPushAndCreatePR(
    workspacePath: string,
    issue: Issue,
    config: ServiceConfig,
    onUpdate: (event: CodexUpdateEvent) => void,
  ): Promise<void> {
    const log = logger.forIssue(issue.id, issue.identifier);
    const { apiKey, projectSlug } = config.tracker;

    // 1. Check for uncommitted changes
    const statusResult = await execInWorkspace(
      'git status --porcelain',
      workspacePath,
      10_000,
    );

    const hasChanges = statusResult.stdout.trim().length > 0;
    if (!hasChanges) {
      log.info('No uncommitted changes to commit');
      return;
    }

    onUpdate({
      kind: 'message',
      role: 'system',
      content: 'Committing changes...',
    });

    // 2. Stage all changes
    const addResult = await execInWorkspace(
      'git add -A',
      workspacePath,
      10_000,
    );
    if (addResult.exitCode !== 0) {
      throw new Error(`git add failed: ${addResult.stderr}`);
    }

    // 3. Commit — write message to a temp file to avoid shell quoting issues on Windows
    const commitMsgPath = path.join(workspacePath, '.git', 'HARMONY_COMMIT_MSG');
    const commitMsg = `${issue.identifier}: ${issue.title}\n\nImplemented changes for issue ${issue.identifier}. Ref: ${issue.url || ''}`;
    await fs.writeFile(commitMsgPath, commitMsg, 'utf-8');
    const commitResult = await execInWorkspace(
      'git commit -F .git/HARMONY_COMMIT_MSG',
      workspacePath,
      30_000,
    );
    try { await fs.unlink(commitMsgPath); } catch { /* best effort cleanup */ }
    if (commitResult.exitCode !== 0) {
      throw new Error(`git commit failed: ${commitResult.stderr}`);
    }
    log.info('Changes committed', {
      stdout: commitResult.stdout.slice(0, 200),
    });

    // 4. Push the branch
    onUpdate({
      kind: 'message',
      role: 'system',
      content: 'Pushing branch to origin...',
    });

    const pushResult = await execInWorkspace(
      'git push -u origin HEAD',
      workspacePath,
      60_000,
    );
    if (pushResult.exitCode !== 0) {
      throw new Error(`git push failed: ${pushResult.stderr}`);
    }
    log.info('Branch pushed to origin');

    // 5. Create PR via GitHub API (more reliable than requiring gh CLI)
    onUpdate({
      kind: 'message',
      role: 'system',
      content: 'Creating pull request...',
    });

    const branchResult = await execInWorkspace(
      'git branch --show-current',
      workspacePath,
      5_000,
    );
    const branchName = branchResult.stdout.trim();

    try {
      const [owner, repo] = projectSlug.split('/');
      const prResponse = await fetch(
        `https://api.github.com/repos/${owner}/${repo}/pulls`,
        {
          method: 'POST',
          headers: {
            Authorization: `token ${apiKey}`,
            'Content-Type': 'application/json',
            Accept: 'application/vnd.github.v3+json',
          },
          body: JSON.stringify({
            title: `${issue.identifier}: ${issue.title}`,
            body: [
              `## Summary`,
              ``,
              `Automated implementation for [${issue.identifier}](${issue.url || ''}).`,
              ``,
              `**Issue:** ${issue.title}`,
              issue.description ? `\n**Description:** ${issue.description}` : '',
              ``,
              `---`,
              `*Created automatically by Harmony Agent Orchestrator*`,
            ].join('\n'),
            head: branchName,
            base: 'main',
          }),
        },
      );

      if (prResponse.ok) {
        const prData = (await prResponse.json()) as { html_url: string; number: number };
        log.info('Pull request created', {
          pr_url: prData.html_url,
          pr_number: prData.number,
        });
        onUpdate({
          kind: 'message',
          role: 'system',
          content: `Pull request created: ${prData.html_url}`,
        });
      } else {
        const errBody = await prResponse.text();
        // 422 often means PR already exists
        if (prResponse.status === 422 && errBody.includes('already exists')) {
          log.info('Pull request already exists for this branch');
          onUpdate({
            kind: 'message',
            role: 'system',
            content: 'Pull request already exists for this branch',
          });
        } else {
          throw new Error(
            `GitHub API returned ${prResponse.status}: ${errBody.slice(0, 300)}`,
          );
        }
      }
    } catch (err) {
      // If GitHub API fails, try gh CLI as fallback
      log.warn('GitHub API PR creation failed, trying gh CLI fallback', {
        error: err instanceof Error ? err.message : String(err),
      });

      const prBodyFile = path.join(workspacePath, '.git', 'HARMONY_PR_BODY');
      await fs.writeFile(prBodyFile, `Automated implementation for ${issue.identifier}: ${issue.title}`, 'utf-8');
      const ghResult = await execInWorkspace(
        `gh pr create --title ${issue.identifier} --body-file .git/HARMONY_PR_BODY --base main`,
        workspacePath,
        30_000,
      );
      try { await fs.unlink(prBodyFile); } catch { /* best effort */ }

      if (ghResult.exitCode === 0) {
        log.info('Pull request created via gh CLI', {
          stdout: ghResult.stdout.slice(0, 200),
        });
        onUpdate({
          kind: 'message',
          role: 'system',
          content: `Pull request created: ${ghResult.stdout.trim()}`,
        });
      } else {
        throw new Error(`gh pr create failed: ${ghResult.stderr}`);
      }
    }
  }
}

// ---------------------------------------------------------------------------
// Utility
// ---------------------------------------------------------------------------

async function fileExists(filePath: string): Promise<boolean> {
  try {
    await fs.stat(filePath);
    return true;
  } catch {
    return false;
  }
}

/** Render a compact one-line summary of a tool_use for live-output display. */
function formatToolUse(
  name: string,
  input: Record<string, unknown> | undefined,
): string {
  if (!input || typeof input !== 'object') return `Using tool: ${name}`;
  const summary = toolInputSummary(name, input);
  return summary ? `Using ${name}: ${summary}` : `Using tool: ${name}`;
}

function toolInputSummary(
  name: string,
  input: Record<string, unknown>,
): string {
  const truncate = (s: string, n = 140) =>
    s.length > n ? s.slice(0, n - 1) + '…' : s;

  switch (name) {
    case 'Bash':
    case 'BashOutput': {
      const cmd = typeof input.command === 'string' ? input.command : '';
      return truncate(cmd.replace(/\s+/g, ' ').trim());
    }
    case 'Read':
    case 'Write':
    case 'NotebookEdit':
      return truncate(String(input.file_path ?? input.notebook_path ?? ''));
    case 'Edit': {
      const file = String(input.file_path ?? '');
      const old = typeof input.old_string === 'string' ? input.old_string : '';
      const snippet = old.split('\n')[0].trim();
      return truncate(snippet ? `${file} — ${snippet}` : file);
    }
    case 'Glob':
      return truncate(String(input.pattern ?? ''));
    case 'Grep':
      return truncate(String(input.pattern ?? ''));
    case 'WebFetch':
    case 'WebSearch':
      return truncate(String(input.url ?? input.query ?? ''));
    case 'TodoWrite': {
      const todos = Array.isArray(input.todos) ? input.todos : [];
      const active = todos.find(
        (t: unknown): t is { content: string; status: string } =>
          typeof t === 'object' &&
          t !== null &&
          'status' in t &&
          (t as { status: string }).status === 'in_progress',
      );
      if (active?.content) return truncate(active.content);
      const first = todos[0];
      if (
        first &&
        typeof first === 'object' &&
        'content' in first &&
        typeof (first as { content: unknown }).content === 'string'
      ) {
        return truncate((first as { content: string }).content);
      }
      return `${todos.length} item${todos.length === 1 ? '' : 's'}`;
    }
    case 'Task':
      return truncate(String(input.description ?? input.prompt ?? ''));
    default: {
      // Generic: pick the first string-valued field
      for (const [key, value] of Object.entries(input)) {
        if (typeof value === 'string' && value) {
          return truncate(`${key}=${value}`);
        }
      }
      return '';
    }
  }
}
