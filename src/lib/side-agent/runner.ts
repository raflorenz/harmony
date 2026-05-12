// ---------------------------------------------------------------------------
// Side-Agent Runner — direct Anthropic API client
// ---------------------------------------------------------------------------
//
// Used by grader, verifier, decomposer, and repo-brain. Single-shot, no tool
// use, JSON output. Failures are returned (not thrown) so callers can decide
// whether to retry, escalate, or fall back.
// ---------------------------------------------------------------------------

import { spawn, execSync } from 'child_process';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { logger } from '../observability/logger';
import type {
  SideAgentConfig,
  SideAgentRequest,
  SideAgentResponse,
  SideAgentUsage,
} from './types';

const DEFAULT_ENDPOINT = 'https://api.anthropic.com/v1/messages';
const DEFAULT_MAX_TOKENS = 4096;
const DEFAULT_TEMPERATURE = 0.2;

// Approximate per-1M-token pricing for cost accounting. Updated occasionally;
// the goal is "good enough for budgeting", not invoice-grade.
const MODEL_PRICING_USD_PER_M: Record<string, { input: number; output: number }> = {
  'claude-haiku-4-5-20251001': { input: 1.0, output: 5.0 },
  'claude-haiku-4-5': { input: 1.0, output: 5.0 },
  'claude-sonnet-4-6': { input: 3.0, output: 15.0 },
  'claude-opus-4-7': { input: 15.0, output: 75.0 },
};

function estimateCostUsd(model: string, inputTokens: number, outputTokens: number): number {
  const price = MODEL_PRICING_USD_PER_M[model];
  if (!price) return 0;
  return (inputTokens * price.input + outputTokens * price.output) / 1_000_000;
}

interface AnthropicMessageResponse {
  content?: Array<{ type: string; text?: string }>;
  usage?: { input_tokens?: number; output_tokens?: number };
  error?: { type: string; message: string };
}

/**
 * Strip ```json ... ``` fences and parse JSON. Returns null on parse failure.
 */
function tryParseJson<T>(text: string): T | null {
  let cleaned = text.trim();
  if (cleaned.startsWith('```')) {
    cleaned = cleaned.replace(/^```(?:json)?\s*/, '').replace(/```\s*$/, '');
  }
  try {
    return JSON.parse(cleaned) as T;
  } catch {
    // Sometimes the model wraps JSON in prose. Try to find a top-level object.
    const objMatch = cleaned.match(/\{[\s\S]*\}/);
    if (objMatch) {
      try {
        return JSON.parse(objMatch[0]) as T;
      } catch {
        return null;
      }
    }
    return null;
  }
}

/**
 * Run a single side-agent call against the Anthropic Messages API.
 *
 * Returns a tagged-union response. Always shape-check the result with `ok`
 * before using `data` — schema validation is the caller's responsibility.
 */
export async function runSideAgent<T>(
  config: SideAgentConfig,
  request: SideAgentRequest,
): Promise<SideAgentResponse<T>> {
  const model = request.model ?? config.defaultModel;
  const endpoint = config.endpoint || DEFAULT_ENDPOINT;
  const logCtx = { stage: request.stage, ticket: request.ticketId ?? null };

  if (!config.apiKey) {
    // Fall back to the locally-installed Claude CLI (uses subscription OAuth).
    return runViaClaudeCli<T>(request, model, logCtx);
  }

  const body = {
    model,
    max_tokens: request.maxTokens ?? DEFAULT_MAX_TOKENS,
    temperature: request.temperature ?? DEFAULT_TEMPERATURE,
    system: request.system,
    messages: [{ role: 'user', content: request.user }],
  };

  let resp: Response;
  try {
    resp = await fetch(endpoint, {
      method: 'POST',
      headers: {
        'x-api-key': config.apiKey,
        'anthropic-version': '2023-06-01',
        'content-type': 'application/json',
      },
      body: JSON.stringify(body),
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    logger.warn('side-agent network error', { ...logCtx, error: msg });
    return { ok: false, error: `network error: ${msg}` };
  }

  let json: AnthropicMessageResponse;
  try {
    json = (await resp.json()) as AnthropicMessageResponse;
  } catch {
    return { ok: false, error: `non-JSON response (status ${resp.status})` };
  }

  if (!resp.ok || json.error) {
    const msg = json.error?.message ?? `HTTP ${resp.status}`;
    logger.warn('side-agent API error', { ...logCtx, status: resp.status, error: msg });
    return { ok: false, error: msg };
  }

  const inputTokens = json.usage?.input_tokens ?? 0;
  const outputTokens = json.usage?.output_tokens ?? 0;
  const usage: SideAgentUsage = {
    inputTokens,
    outputTokens,
    costUsd: estimateCostUsd(model, inputTokens, outputTokens),
  };

  const text = (json.content ?? [])
    .filter((b) => b.type === 'text' && typeof b.text === 'string')
    .map((b) => b.text!)
    .join('\n')
    .trim();

  const parsed = tryParseJson<T>(text);
  if (parsed === null) {
    return { ok: false, error: 'failed to parse JSON from model output', raw: text, usage };
  }

  logger.debug('side-agent success', {
    ...logCtx,
    input_tokens: inputTokens,
    output_tokens: outputTokens,
    cost_usd: usage.costUsd,
  });

  return { ok: true, data: parsed, usage, raw: text };
}

// ---------------------------------------------------------------------------
// Claude CLI fallback — used when no ANTHROPIC_API_KEY is configured. Runs
// the locally-installed `claude` CLI as a one-shot subprocess so side-agent
// calls bill against the user's Claude subscription via OAuth instead of an
// API key.
// ---------------------------------------------------------------------------

let _claudeBinaryPath: string | null = null;

function resolveClaudeBinary(): string {
  if (_claudeBinaryPath) return _claudeBinaryPath;
  try {
    const cmd = process.platform === 'win32' ? 'where claude' : 'which claude';
    const result = execSync(cmd, { encoding: 'utf-8', timeout: 5_000 }).trim();
    if (result) {
      _claudeBinaryPath = result.split('\n')[0].trim();
      return _claudeBinaryPath;
    }
  } catch {
    // not in PATH — fall through to known install locations
  }
  const home = os.homedir();
  const candidates: string[] =
    process.platform === 'win32'
      ? [
          path.join(home, '.local', 'bin', 'claude.exe'),
          path.join(process.env.LOCALAPPDATA ?? '', 'Programs', 'claude-code', 'claude.exe'),
        ]
      : [path.join(home, '.local', 'bin', 'claude'), '/usr/local/bin/claude'];
  for (const c of candidates) {
    try {
      if (fs.statSync(c).isFile()) {
        _claudeBinaryPath = c;
        return c;
      }
    } catch {
      // try next
    }
  }
  _claudeBinaryPath = 'claude';
  return 'claude';
}

interface ClaudeCliResult {
  type?: string;
  subtype?: string;
  is_error?: boolean;
  result?: string;
  cost_usd?: number;
  total_cost_usd?: number;
  duration_ms?: number;
  input_tokens?: number;
  output_tokens?: number;
  total_tokens?: number;
  usage?: { input_tokens?: number; output_tokens?: number };
  message?: { content?: Array<{ type: string; text?: string }>; usage?: { input_tokens?: number; output_tokens?: number } };
}

function runViaClaudeCli<T>(
  request: SideAgentRequest,
  model: string,
  logCtx: Record<string, unknown>,
): Promise<SideAgentResponse<T>> {
  return new Promise((resolve) => {
    const binary = resolveClaudeBinary();
    const args: string[] = [
      '-p',
      '--output-format', 'json',
      '--system-prompt', request.system,
      '--max-turns', '1',
      '--dangerously-skip-permissions',
    ];
    if (model) {
      args.push('--model', model);
    }

    const childEnv = { ...process.env };
    // Avoid nested-session refusal
    delete childEnv.CLAUDECODE;
    delete childEnv.CLAUDE_CODE_ENTRYPOINT;

    let child;
    try {
      child = spawn(binary, args, {
        stdio: ['pipe', 'pipe', 'pipe'],
        env: childEnv,
      });
    } catch (err) {
      resolve({
        ok: false,
        error: `side-agent CLI spawn failed: ${err instanceof Error ? err.message : String(err)}`,
      });
      return;
    }

    child.stdin?.write(request.user);
    child.stdin?.end();

    let stdout = '';
    let stderr = '';
    child.stdout?.on('data', (chunk: Buffer) => {
      stdout += chunk.toString();
    });
    child.stderr?.on('data', (chunk: Buffer) => {
      stderr += chunk.toString();
    });

    child.on('error', (err) => {
      resolve({
        ok: false,
        error: `side-agent CLI error: ${err.message}`,
      });
    });

    child.on('close', (code) => {
      if (code !== 0) {
        logger.warn('side-agent CLI exited non-zero', {
          ...logCtx,
          code,
          stderr_tail: stderr.slice(-400),
        });
        resolve({
          ok: false,
          error: `Claude CLI exited ${code}: ${stderr.slice(-300) || '(no stderr)'}`,
        });
        return;
      }

      let parsed: ClaudeCliResult;
      try {
        parsed = JSON.parse(stdout) as ClaudeCliResult;
      } catch {
        resolve({
          ok: false,
          error: `Claude CLI returned non-JSON: ${stdout.slice(0, 300)}`,
        });
        return;
      }

      if (parsed.is_error) {
        resolve({
          ok: false,
          error: `Claude CLI returned error result: ${parsed.result ?? parsed.subtype ?? 'unknown'}`,
        });
        return;
      }

      const text =
        typeof parsed.result === 'string'
          ? parsed.result
          : (parsed.message?.content ?? [])
              .filter((b) => b.type === 'text' && typeof b.text === 'string')
              .map((b) => b.text!)
              .join('\n')
              .trim();

      const inputTokens =
        parsed.input_tokens ?? parsed.usage?.input_tokens ?? parsed.message?.usage?.input_tokens ?? 0;
      const outputTokens =
        parsed.output_tokens ?? parsed.usage?.output_tokens ?? parsed.message?.usage?.output_tokens ?? 0;
      const costUsd = parsed.total_cost_usd ?? parsed.cost_usd ?? 0;
      const usage: SideAgentUsage = { inputTokens, outputTokens, costUsd };

      const data = tryParseJson<T>(text);
      if (data === null) {
        resolve({
          ok: false,
          error: 'failed to parse JSON from Claude CLI output',
          raw: text,
          usage,
        });
        return;
      }

      logger.debug('side-agent CLI success', {
        ...logCtx,
        input_tokens: inputTokens,
        output_tokens: outputTokens,
        cost_usd: costUsd,
      });

      resolve({ ok: true, data, usage, raw: text });
    });
  });
}
