// ---------------------------------------------------------------------------
// Agent Runner (Spec Section 10.7 / 16.5)
// ---------------------------------------------------------------------------

import { logger } from '../observability/logger';
import { runHook } from './hooks';
import { buildTurnPrompt, DEFAULT_PROMPT } from './prompt';
import { AppServerClient, type AppServerSession } from './app-server-client';
import type { AgentRunner as IAgentRunner } from '../orchestrator/scheduler';
import type { Issue, ServiceConfig, CodexUpdateEvent } from '../tracker/types';
import type { TrackerClient } from '../tracker/client';

export class AgentRunnerImpl implements IAgentRunner {
  private activeSessions = new Map<string, AppServerSession>();
  private tracker: TrackerClient;

  constructor(tracker: TrackerClient) {
    this.tracker = tracker;
  }

  /**
   * Run an agent attempt for an issue.
   *
   * Follows the worker lifecycle in Section 16.5:
   * 1. Run before_run hook
   * 2. Start app-server session
   * 3. Loop turns until issue is no longer active or max turns reached
   * 4. Stop session, run after_run hook
   */
  async runAttempt(params: {
    issue: Issue;
    attempt: number | null;
    workspacePath: string;
    config: ServiceConfig;
    promptTemplate: string;
    onUpdate: (event: CodexUpdateEvent) => void;
    previousMessages?: string[];
  }): Promise<{ success: boolean; error?: string }> {
    const { issue, attempt, workspacePath, config, promptTemplate, onUpdate } =
      params;
    const log = logger.forIssue(issue.id, issue.identifier);
    const appClient = new AppServerClient(config.codex);

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

    // 2. Start app-server session
    let session: AppServerSession;
    try {
      session = await appClient.startSession(workspacePath, onUpdate);
      this.activeSessions.set(issue.id, session);
    } catch (err) {
      await this.runAfterRunHook(config, workspacePath);
      return {
        success: false,
        error: `Session startup failed: ${err instanceof Error ? err.message : String(err)}`,
      };
    }

    log.info('Agent session started', {
      session_id: session.sessionId,
      workspace: workspacePath,
    });

    // 3. Turn loop (Section 16.5)
    const maxTurns = config.agent.maxTurns;
    let turnNumber = 1;
    let currentIssue = issue;
    let lastError: string | undefined;

    try {
      while (turnNumber <= maxTurns) {
        // Build prompt for this turn
        const template = promptTemplate || DEFAULT_PROMPT;
        let prompt: string;
        try {
          prompt = await buildTurnPrompt(
            template,
            currentIssue,
            attempt,
            turnNumber,
            maxTurns,
          );
        } catch (err) {
          lastError = `Prompt error: ${err instanceof Error ? err.message : String(err)}`;
          break;
        }

        // Run turn
        const turnResult = await appClient.runTurn(
          session,
          prompt,
          currentIssue.identifier,
          currentIssue.title,
          onUpdate,
          turnNumber,
        );

        if (!turnResult.success) {
          lastError = turnResult.error;
          break;
        }

        log.info('Turn completed', {
          turn: turnNumber,
          max_turns: maxTurns,
          session_id: session.sessionId,
        });

        // Re-check tracker state after turn (Section 16.5)
        try {
          const refreshed = await this.tracker.fetchIssueStatesByIds([
            currentIssue.id,
          ]);
          if (refreshed.length > 0) {
            currentIssue = refreshed[0];
          }
        } catch (err) {
          lastError = `Issue state refresh error: ${err instanceof Error ? err.message : String(err)}`;
          break;
        }

        // Check if still active
        const activeNormalized = config.tracker.activeStates.map((s) =>
          s.toLowerCase(),
        );
        if (!activeNormalized.includes(currentIssue.state.toLowerCase())) {
          log.info('Issue no longer active after turn, stopping', {
            state: currentIssue.state,
          });
          break;
        }

        // Check max turns
        if (turnNumber >= maxTurns) {
          log.info('Max turns reached, stopping', { max_turns: maxTurns });
          break;
        }

        turnNumber++;
      }
    } finally {
      // 4. Stop session and run after_run hook
      appClient.stopSession(session);
      this.activeSessions.delete(issue.id);
      await this.runAfterRunHook(config, workspacePath);
    }

    if (lastError) {
      return { success: false, error: lastError };
    }

    return { success: true };
  }

  /**
   * Terminate a running session for an issue.
   */
  async terminateRun(issueId: string): Promise<void> {
    const session = this.activeSessions.get(issueId);
    if (session) {
      try {
        session.process.kill('SIGTERM');
        setTimeout(() => {
          try {
            session.process.kill('SIGKILL');
          } catch {
            // Already dead
          }
        }, 5_000);
      } catch {
        // Already dead
      }
      this.activeSessions.delete(issueId);
    }
  }

  /** Best-effort after_run hook. */
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
