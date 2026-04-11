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
    content?: Array<{ type: string; text?: string; name?: string }>;
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

    // 5. Run after_run hook (non-fatal)
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
        `git clone --depth=50 "${cloneUrl}" .`,
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
    const branchCheck = await execInWorkspace(
      `git rev-parse --verify "${branchName}" 2>/dev/null`,
      workspacePath,
      10_000,
    );

    if (branchCheck.exitCode === 0) {
      // Branch exists, check it out
      await execInWorkspace(
        `git checkout "${branchName}"`,
        workspacePath,
        10_000,
      );
    } else {
      // Create new branch from default branch
      const createResult = await execInWorkspace(
        `git checkout -b "${branchName}"`,
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
        '--max-turns', String(maxTurns),
        '--dangerously-skip-permissions',
      ];

      if (model) {
        args.push('--model', model);
      }

      // Resolve and spawn the claude CLI binary
      const claudeBin = resolveClaudeBinary();
      logger.debug('Spawning Claude CLI', { binary: claudeBin, args });

      const child = spawn(claudeBin, args, {
        cwd: workspacePath,
        stdio: ['pipe', 'pipe', 'pipe'],
        env: { ...process.env },
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
            error: `Claude process exited with code ${code}`,
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
                content: `Using tool: ${block.name}`,
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
