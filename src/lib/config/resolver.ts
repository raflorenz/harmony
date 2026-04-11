// ---------------------------------------------------------------------------
// Symphony Config Resolver & Validator (Spec Section 6.3 / 6.4)
// ---------------------------------------------------------------------------

import * as os from 'os';
import * as path from 'path';
import { DEFAULTS } from './defaults';
import type { ServiceConfig } from '../tracker/types';

/**
 * Result of config validation: ok=true when valid, or ok=false with a list of
 * human-readable error strings.
 */
export interface ValidationResult {
  ok: boolean;
  errors: string[];
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Returns true when `value` looks like a filesystem path rather than a URI or
 * shell command.  URIs contain "://" and shell commands contain spaces — both
 * should be left as-is during path expansion.
 */
function isPathLike(value: string): boolean {
  if (value.includes('://')) return false; // URI
  if (value.includes(' ')) return false;   // shell command
  return (
    value.startsWith('~') ||
    value.startsWith('/') ||
    value.startsWith('./') ||
    value.startsWith('../') ||
    /^[a-zA-Z]:[/\\]/.test(value)
  );
}

/**
 * Expand `$VAR_NAME` references inside a string to the corresponding
 * environment variable.  Unknown variables are replaced with an empty string.
 */
function expandEnvVars(value: string): string {
  return value.replace(/\$([A-Za-z_][A-Za-z0-9_]*)/g, (_match, name) => {
    return process.env[name] ?? '';
  });
}

/**
 * Expand `~` at the start of a path to the current user's home directory.
 */
function expandTilde(value: string): string {
  if (value === '~') return os.homedir();
  if (value.startsWith('~/') || value.startsWith('~\\')) {
    return path.join(os.homedir(), value.slice(2));
  }
  return value;
}

/**
 * Full string-value expansion: env-vars first, then tilde for path-like
 * values.
 */
function expandString(value: string): string {
  let result = expandEnvVars(value);
  if (isPathLike(result)) {
    result = expandTilde(result);
  }
  return result;
}

/**
 * Coerce a string to an integer when the target field is expected to hold a
 * numeric value.  Returns `NaN` for non-numeric strings (callers should fall
 * back to the default in that case).
 */
function coerceInt(value: unknown): number | undefined {
  if (typeof value === 'number') return Number.isFinite(value) ? value : undefined;
  if (typeof value === 'string') {
    const n = parseInt(value, 10);
    return Number.isFinite(n) ? n : undefined;
  }
  return undefined;
}

// ---------------------------------------------------------------------------
// Helpers for deep-merging a raw config section over a defaults object
// ---------------------------------------------------------------------------

/**
 * Convert a camelCase key to its snake_case equivalent.
 * e.g. "projectSlug" → "project_slug", "maxTurns" → "max_turns"
 */
function toSnakeCase(key: string): string {
  return key.replace(/[A-Z]/g, (ch) => `_${ch.toLowerCase()}`);
}

/**
 * Look up a value from a raw config object, trying camelCase first then snake_case.
 */
function rawGet(raw: Record<string, unknown> | undefined, key: string): unknown {
  if (!raw) return undefined;
  if (key in raw) return raw[key];
  const snake = toSnakeCase(key);
  if (snake !== key && snake in raw) return raw[snake];
  return undefined;
}

function getStr(
  raw: Record<string, unknown> | undefined,
  key: string,
  fallback: string,
): string {
  const v = rawGet(raw, key);
  if (typeof v === 'string') return expandString(v);
  return fallback;
}

function getStrArray(
  raw: Record<string, unknown> | undefined,
  key: string,
  fallback: string[],
): string[] {
  const v = rawGet(raw, key);
  if (Array.isArray(v)) return v.map((s) => (typeof s === 'string' ? expandString(s) : String(s)));
  return fallback;
}

function getInt(
  raw: Record<string, unknown> | undefined,
  key: string,
  fallback: number,
): number {
  const v = rawGet(raw, key);
  const n = coerceInt(v);
  return n !== undefined ? n : fallback;
}

// ---------------------------------------------------------------------------
// resolveConfig
// ---------------------------------------------------------------------------

/**
 * Merge a raw (potentially partial) user configuration object with built-in
 * defaults and expand environment variables, tilde paths, and integer
 * coercions.
 *
 * Unknown top-level keys are silently ignored (forward-compat).
 */
export function resolveConfig(rawConfig: Record<string, any>): ServiceConfig {
  const rawTracker = rawConfig.tracker as Record<string, unknown> | undefined;
  const rawPolling = rawConfig.polling as Record<string, unknown> | undefined;
  const rawWorkspace = rawConfig.workspace as Record<string, unknown> | undefined;
  const rawHooks = rawConfig.hooks as Record<string, unknown> | undefined;
  const rawAgent = rawConfig.agent as Record<string, unknown> | undefined;
  const rawCodex = rawConfig.codex as Record<string, unknown> | undefined;
  const rawClaude = rawConfig.claude as Record<string, unknown> | undefined;

  // -- tracker ---------------------------------------------------------------
  // Resolve apiKey: explicit value > $VAR in config > LINEAR_API_KEY env var
  let trackerApiKey = '';
  if (typeof rawTracker?.apiKey === 'string' || typeof rawTracker?.api_key === 'string') {
    trackerApiKey = expandString(
      (typeof rawTracker?.apiKey === 'string' ? rawTracker.apiKey : rawTracker!.api_key) as string,
    );
  }
  const trackerKind = getStr(rawTracker, 'kind', '') as any;
  if (trackerKind === 'linear' && !trackerApiKey) {
    trackerApiKey = process.env.LINEAR_API_KEY ?? '';
  }
  if (trackerKind === 'github' && !trackerApiKey) {
    trackerApiKey = process.env.GITHUB_TOKEN ?? process.env.GH_TOKEN ?? '';
  }

  // -- workspace root --------------------------------------------------------
  const defaultWorkspaceRoot = path.join(os.tmpdir(), 'symphony_workspaces');
  let workspaceRoot = getStr(rawWorkspace, 'root', '');
  if (!workspaceRoot) {
    workspaceRoot = defaultWorkspaceRoot;
  }

  // -- agent per-state concurrency -------------------------------------------
  const rawPerState = (rawGet(rawAgent, 'maxConcurrentAgentsByState') ?? undefined) as Record<string, unknown> | undefined;
  const perStateConcurrency: Record<string, number> = {};
  if (rawPerState && typeof rawPerState === 'object') {
    for (const [key, val] of Object.entries(rawPerState)) {
      const n = coerceInt(val);
      if (n !== undefined && n > 0) {
        perStateConcurrency[key.toLowerCase()] = n;
      }
      // non-positive and non-numeric values are silently ignored
    }
  }

  // -- hooks -----------------------------------------------------------------
  const hookVal = (key: string) => {
    const v = rawGet(rawHooks, key);
    return v != null ? expandString(String(v)) : null;
  };
  const resolvedHooks = {
    afterCreate: hookVal('afterCreate'),
    beforeRun: hookVal('beforeRun'),
    afterRun: hookVal('afterRun'),
    beforeRemove: hookVal('beforeRemove'),
    timeoutMs: getInt(rawHooks, 'timeoutMs', DEFAULTS.hooks.timeoutMs),
  };

  // -- claude ----------------------------------------------------------------
  const claudeEnabled = rawClaude?.enabled === true || rawClaude?.enabled === 'true';

  return {
    tracker: {
      kind: trackerKind || ('linear' as any),
      endpoint: getStr(
        rawTracker,
        'endpoint',
        trackerKind === 'github' ? 'https://api.github.com' : DEFAULTS.tracker.endpoint,
      ),
      apiKey: trackerApiKey,
      projectSlug: getStr(rawTracker, 'projectSlug', ''),
      activeStates: getStrArray(rawTracker, 'activeStates', DEFAULTS.tracker.activeStates),
      terminalStates: getStrArray(rawTracker, 'terminalStates', DEFAULTS.tracker.terminalStates),
    },
    polling: {
      intervalMs: getInt(rawPolling, 'intervalMs', DEFAULTS.polling.intervalMs),
    },
    workspace: {
      root: workspaceRoot,
    },
    hooks: resolvedHooks,
    agent: {
      maxConcurrentAgents: getInt(rawAgent, 'maxConcurrentAgents', DEFAULTS.agent.maxConcurrentAgents),
      maxTurns: getInt(rawAgent, 'maxTurns', DEFAULTS.agent.maxTurns),
      maxRetryBackoffMs: getInt(rawAgent, 'maxRetryBackoffMs', DEFAULTS.agent.maxRetryBackoffMs),
      maxConcurrentAgentsByState: perStateConcurrency,
    },
    codex: {
      command: getStr(rawCodex, 'command', DEFAULTS.codex.command),
      approvalPolicy: getStr(rawCodex, 'approvalPolicy', DEFAULTS.codex.approvalPolicy),
      threadSandbox: getStr(rawCodex, 'threadSandbox', DEFAULTS.codex.threadSandbox),
      turnSandboxPolicy: getStr(rawCodex, 'turnSandboxPolicy', DEFAULTS.codex.turnSandboxPolicy),
      turnTimeoutMs: getInt(rawCodex, 'turnTimeoutMs', DEFAULTS.codex.turnTimeoutMs),
      readTimeoutMs: getInt(rawCodex, 'readTimeoutMs', DEFAULTS.codex.readTimeoutMs),
      stallTimeoutMs: getInt(rawCodex, 'stallTimeoutMs', DEFAULTS.codex.stallTimeoutMs),
    },
    claude: {
      enabled: claudeEnabled,
      runtimeTimeoutMs: getInt(rawClaude, 'runtimeTimeoutMs', DEFAULTS.claude.runtimeTimeoutMs),
      maxTurns: getInt(rawClaude, 'maxTurns', DEFAULTS.claude.maxTurns),
      model: getStr(rawClaude, 'model', DEFAULTS.claude.model),
    },
  };
}

// ---------------------------------------------------------------------------
// validateDispatchConfig (Section 6.3)
// ---------------------------------------------------------------------------

const SUPPORTED_TRACKER_KINDS: string[] = ['linear', 'github'];

/**
 * Validate a resolved ServiceConfig for minimum dispatch readiness.
 *
 * Returns `{ ok: true, errors: [] }` when the config is valid, or
 * `{ ok: false, errors: [...] }` listing every problem found.
 */
export function validateDispatchConfig(config: ServiceConfig): ValidationResult {
  const errors: string[] = [];

  // tracker.kind present and supported
  if (!config.tracker.kind) {
    errors.push('tracker.kind is required');
  } else if (!SUPPORTED_TRACKER_KINDS.includes(config.tracker.kind)) {
    errors.push(
      `tracker.kind '${config.tracker.kind}' is not supported (expected one of: ${SUPPORTED_TRACKER_KINDS.join(', ')})`,
    );
  }

  // tracker.apiKey present after $ resolution
  if (!config.tracker.apiKey) {
    errors.push('tracker.apiKey is required (set LINEAR_API_KEY or provide tracker.apiKey / tracker.api_key)');
  }

  // tracker.projectSlug present when kind=linear or kind=github
  if (config.tracker.kind === 'linear' && !config.tracker.projectSlug) {
    errors.push('tracker.projectSlug is required when tracker.kind is "linear"');
  }
  if (config.tracker.kind === 'github' && !config.tracker.projectSlug) {
    errors.push('tracker.projectSlug is required when tracker.kind is "github" (use "owner/repo" format)');
  }

  // codex.command present and non-empty (only required when claude is not enabled)
  if (!config.claude.enabled && (!config.codex.command || !config.codex.command.trim())) {
    errors.push('codex.command is required and must be non-empty (unless claude.enabled is true)');
  }

  return { ok: errors.length === 0, errors };
}
