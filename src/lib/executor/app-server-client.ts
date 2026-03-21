// ---------------------------------------------------------------------------
// Codex App-Server Client (Spec Section 10)
// ---------------------------------------------------------------------------

import { spawn, type ChildProcess } from 'child_process';
import { logger } from '../observability/logger';
import type { CodexUpdateEvent, CodexConfig } from '../tracker/types';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface AppServerSession {
  threadId: string;
  turnId: string;
  sessionId: string;
  process: ChildProcess;
}

interface JsonRpcRequest {
  id?: number;
  method: string;
  params?: Record<string, unknown>;
}

interface JsonRpcResponse {
  id?: number;
  result?: Record<string, unknown>;
  error?: { code: number; message: string };
  method?: string;
  params?: Record<string, unknown>;
}

// ---------------------------------------------------------------------------
// Line-delimited JSON reader
// ---------------------------------------------------------------------------

class LineReader {
  private buffer = '';
  private waiters: Array<{
    resolve: (line: string) => void;
    reject: (err: Error) => void;
  }> = [];
  private lines: string[] = [];
  private ended = false;
  private endError?: Error;

  feed(chunk: string): void {
    this.buffer += chunk;
    const parts = this.buffer.split('\n');
    this.buffer = parts.pop()!;
    for (const line of parts) {
      const trimmed = line.trim();
      if (!trimmed) continue;
      if (this.waiters.length > 0) {
        this.waiters.shift()!.resolve(trimmed);
      } else {
        this.lines.push(trimmed);
      }
    }
  }

  end(error?: Error): void {
    this.ended = true;
    this.endError = error;
    for (const waiter of this.waiters) {
      waiter.reject(error ?? new Error('Stream ended'));
    }
    this.waiters = [];
  }

  nextLine(timeoutMs: number): Promise<string> {
    if (this.lines.length > 0) {
      return Promise.resolve(this.lines.shift()!);
    }
    if (this.ended) {
      return Promise.reject(this.endError ?? new Error('Stream ended'));
    }
    return new Promise<string>((resolve, reject) => {
      const timer = setTimeout(() => {
        const idx = this.waiters.findIndex((w) => w.resolve === resolve);
        if (idx >= 0) this.waiters.splice(idx, 1);
        reject(new Error(`Read timeout after ${timeoutMs}ms`));
      }, timeoutMs);

      this.waiters.push({
        resolve: (line) => {
          clearTimeout(timer);
          resolve(line);
        },
        reject: (err) => {
          clearTimeout(timer);
          reject(err);
        },
      });
    });
  }
}

// ---------------------------------------------------------------------------
// Protocol helpers
// ---------------------------------------------------------------------------

let requestIdCounter = 0;

function makeRequest(method: string, params?: Record<string, unknown>): JsonRpcRequest {
  return { id: ++requestIdCounter, method, params: params ?? {} };
}

function makeNotification(method: string, params?: Record<string, unknown>): JsonRpcRequest {
  return { method, params: params ?? {} };
}

function sendMessage(process: ChildProcess, msg: JsonRpcRequest): void {
  const line = JSON.stringify(msg) + '\n';
  process.stdin?.write(line);
}

function parseJsonLine(line: string): JsonRpcResponse | null {
  try {
    return JSON.parse(line) as JsonRpcResponse;
  } catch {
    return null;
  }
}

// ---------------------------------------------------------------------------
// AppServerClient
// ---------------------------------------------------------------------------

export class AppServerClient {
  private config: CodexConfig;

  constructor(config: CodexConfig) {
    this.config = config;
  }

  /**
   * Launch the app-server process and complete the startup handshake.
   * Returns a session handle with threadId and process reference.
   * (Section 10.1 + 10.2)
   */
  async startSession(
    workspacePath: string,
    onUpdate: (event: CodexUpdateEvent) => void,
  ): Promise<AppServerSession> {
    // Launch subprocess via bash -lc (Section 10.1)
    const child = spawn('bash', ['-lc', this.config.command], {
      cwd: workspacePath,
      stdio: ['pipe', 'pipe', 'pipe'],
      env: { ...process.env },
    });

    const reader = new LineReader();

    child.stdout?.on('data', (chunk: Buffer) => {
      reader.feed(chunk.toString());
    });

    // Stderr: log diagnostics, don't parse as protocol (Section 10.3)
    child.stderr?.on('data', (chunk: Buffer) => {
      const text = chunk.toString().trim();
      if (text) {
        logger.debug('Agent stderr', { text: text.slice(0, 500) });
      }
    });

    child.on('error', (err) => {
      reader.end(err);
    });

    child.on('close', () => {
      reader.end();
    });

    const readTimeout = this.config.readTimeoutMs;

    try {
      // Step 1: Send initialize request
      const initReq = makeRequest('initialize', {
        clientInfo: { name: 'symphony', version: '1.0' },
        capabilities: {},
      });
      sendMessage(child, initReq);

      // Wait for initialize response
      const initResponseLine = await reader.nextLine(readTimeout);
      const initResponse = parseJsonLine(initResponseLine);
      if (initResponse?.error) {
        throw new Error(`Initialize error: ${initResponse.error.message}`);
      }

      // Step 2: Send initialized notification
      sendMessage(child, makeNotification('initialized'));

      // Step 3: Send thread/start
      const threadReq = makeRequest('thread/start', {
        approvalPolicy: this.config.approvalPolicy,
        sandbox: this.config.threadSandbox,
        cwd: workspacePath,
      });
      sendMessage(child, threadReq);

      // Wait for thread/start response
      const threadResponseLine = await reader.nextLine(readTimeout);
      const threadResponse = parseJsonLine(threadResponseLine);
      if (threadResponse?.error) {
        throw new Error(`thread/start error: ${threadResponse.error.message}`);
      }

      // Extract thread_id from response
      const threadId =
        (threadResponse?.result?.thread as Record<string, unknown>)?.id as string ??
        (threadResponse?.result as Record<string, unknown>)?.threadId as string ??
        `thread-${Date.now()}`;

      onUpdate({ kind: 'session_init', sessionId: threadId });

      return {
        threadId,
        turnId: '',
        sessionId: threadId,
        process: child,
      };
    } catch (err) {
      // Kill the process on startup failure
      child.kill('SIGTERM');
      setTimeout(() => child.kill('SIGKILL'), 5_000);

      onUpdate({
        kind: 'error',
        message: `Startup failed: ${err instanceof Error ? err.message : String(err)}`,
        fatal: true,
      });

      throw err;
    }
  }

  /**
   * Run a turn on an existing session.
   * (Section 10.2 step 4, Section 10.3)
   */
  async runTurn(
    session: AppServerSession,
    prompt: string,
    issueIdentifier: string,
    issueTitle: string,
    onUpdate: (event: CodexUpdateEvent) => void,
    turnNumber: number,
  ): Promise<{ success: boolean; error?: string }> {
    const reader = new LineReader();
    const child = session.process;

    child.stdout?.on('data', (chunk: Buffer) => {
      reader.feed(chunk.toString());
    });

    // Send turn/start
    const turnReq = makeRequest('turn/start', {
      threadId: session.threadId,
      input: [{ type: 'text', text: prompt }],
      cwd: child.spawnargs?.[2] ?? process.cwd(), // workspace path
      title: `${issueIdentifier}: ${issueTitle}`,
      approvalPolicy: this.config.approvalPolicy,
      sandboxPolicy: { type: this.config.turnSandboxPolicy },
    });
    sendMessage(child, turnReq);

    onUpdate({ kind: 'turn_start', turnNumber });

    // Read turn response to get turnId
    try {
      const turnResponseLine = await reader.nextLine(this.config.readTimeoutMs);
      const turnResponse = parseJsonLine(turnResponseLine);
      if (turnResponse?.result) {
        const turnId =
          (turnResponse.result.turn as Record<string, unknown>)?.id as string ??
          (turnResponse.result as Record<string, unknown>)?.turnId as string ??
          `turn-${turnNumber}`;
        session.turnId = turnId;
        session.sessionId = `${session.threadId}-${turnId}`;
      }
    } catch {
      // Non-fatal: we can continue without the turnId
    }

    // Stream turn events until completion (Section 10.3)
    const turnTimeout = this.config.turnTimeoutMs;
    const deadline = Date.now() + turnTimeout;

    while (Date.now() < deadline) {
      const remaining = Math.max(deadline - Date.now(), 1000);

      let line: string;
      try {
        line = await reader.nextLine(Math.min(remaining, 30_000));
      } catch {
        // Check if process is still alive
        if (child.exitCode !== null) {
          onUpdate({ kind: 'session_end', exitCode: child.exitCode });
          return {
            success: false,
            error: `Agent process exited with code ${child.exitCode}`,
          };
        }
        continue; // Timeout on read, but process still alive
      }

      const msg = parseJsonLine(line);
      if (!msg) continue;

      // Handle completion conditions
      if (msg.method === 'turn/completed') {
        onUpdate({ kind: 'turn_end', turnNumber });
        return { success: true };
      }

      if (msg.method === 'turn/failed' || msg.method === 'turn/cancelled') {
        const errMsg =
          (msg.params?.error as string) ??
          (msg.params?.reason as string) ??
          msg.method;
        onUpdate({
          kind: 'error',
          message: errMsg,
          fatal: false,
        });
        return { success: false, error: errMsg };
      }

      // Handle approval requests: auto-approve (high-trust mode)
      if (
        msg.method === 'item/approval/request' ||
        msg.method === 'approval/request'
      ) {
        const approvalId = msg.id ?? msg.params?.id;
        if (approvalId !== undefined) {
          sendMessage(child, {
            id: approvalId as number,
            method: 'approval/response',
            params: { approved: true },
          });
          onUpdate({
            kind: 'message',
            role: 'system',
            content: 'Auto-approved agent action',
          });
        }
        continue;
      }

      // Handle user-input-required: hard failure (Section 10.5)
      if (
        msg.method === 'item/tool/requestUserInput' ||
        msg.method === 'turn/userInputRequired'
      ) {
        onUpdate({
          kind: 'error',
          message: 'Agent requested user input (not supported in Symphony)',
          fatal: true,
        });
        return {
          success: false,
          error: 'turn_input_required',
        };
      }

      // Handle unsupported tool calls
      if (msg.method === 'item/tool/call') {
        const toolCallId = msg.id;
        if (toolCallId !== undefined) {
          sendMessage(child, {
            id: toolCallId as number,
            method: 'tool/response',
            params: { success: false, error: 'unsupported_tool_call' },
          });
        }
        continue;
      }

      // Extract usage/token data
      if (
        msg.method === 'thread/tokenUsage/updated' ||
        msg.params?.total_token_usage
      ) {
        const usage =
          (msg.params?.total_token_usage as Record<string, number>) ??
          (msg.params as Record<string, number>);

        onUpdate({
          kind: 'usage',
          inputTokens: usage?.input_tokens ?? usage?.inputTokens ?? 0,
          outputTokens: usage?.output_tokens ?? usage?.outputTokens ?? 0,
          totalTokens: usage?.total_tokens ?? usage?.totalTokens ?? 0,
          secondsRunning: 0,
        });
        continue;
      }

      // Extract rate-limit data
      if (msg.method === 'rate_limit' || msg.params?.rate_limit) {
        const rl =
          (msg.params?.rate_limit as Record<string, string>) ??
          (msg.params?.headers as Record<string, string>) ??
          {};
        onUpdate({
          kind: 'rate_limit',
          retryAfterMs: parseInt(String(rl.retry_after_ms ?? '0'), 10),
          headers: rl,
        });
        continue;
      }

      // Generic notifications
      if (msg.method?.startsWith('notification') || msg.params?.message) {
        onUpdate({
          kind: 'message',
          role: 'assistant',
          content: String(msg.params?.message ?? msg.params?.text ?? ''),
        });
      }
    }

    // Turn timed out
    onUpdate({
      kind: 'error',
      message: `Turn timed out after ${turnTimeout}ms`,
      fatal: false,
    });
    return { success: false, error: 'turn_timeout' };
  }

  /**
   * Stop a session by killing the app-server process.
   */
  stopSession(session: AppServerSession): void {
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
  }
}
