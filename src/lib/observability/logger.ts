// ---------------------------------------------------------------------------
// Harmony Observability - Structured Logger (Spec Section 13)
// ---------------------------------------------------------------------------

/** Log severity levels ordered by verbosity. */
type LogLevel = "debug" | "info" | "warn" | "error";

/** Numeric ordering so we can gate on minimum level. */
const LEVEL_RANK: Record<LogLevel, number> = {
  debug: 0,
  info: 1,
  warn: 2,
  error: 3,
};

/**
 * Keys that must never appear in log output.
 * Values associated with these keys are redacted before serialization.
 */
const REDACTED_KEYS = new Set([
  "apikey",
  "api_key",
  "apitoken",
  "api_token",
  "token",
  "secret",
  "password",
  "authorization",
  "credential",
  "credentials",
]);

/** Maximum serialized length for any single context value. */
const MAX_VALUE_LENGTH = 512;

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function redactSensitive(
  ctx: Record<string, unknown>,
): Record<string, unknown> {
  const clean: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(ctx)) {
    if (REDACTED_KEYS.has(key.toLowerCase().replace(/[-_]/g, ""))) {
      clean[key] = "[REDACTED]";
    } else {
      clean[key] = truncateValue(value);
    }
  }
  return clean;
}

function truncateValue(value: unknown): unknown {
  if (typeof value === "string" && value.length > MAX_VALUE_LENGTH) {
    return value.slice(0, MAX_VALUE_LENGTH) + "...(truncated)";
  }
  return value;
}

function safeSerialize(record: Record<string, unknown>): string {
  try {
    return JSON.stringify(record);
  } catch {
    // Fallback: drop context values that cannot be serialized
    const safe: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(record)) {
      try {
        JSON.stringify(v);
        safe[k] = v;
      } catch {
        safe[k] = "[unserializable]";
      }
    }
    return JSON.stringify(safe);
  }
}

// ---------------------------------------------------------------------------
// Logger
// ---------------------------------------------------------------------------

/**
 * Structured JSON logger.
 *
 * Writes one JSON object per line to stdout.  Context fields are merged into
 * every log record so that downstream consumers can filter on stable keys
 * such as `issue_id`, `issue_identifier`, and `session_id`.
 *
 * Logging sink failures (serialization errors, write errors) are silently
 * swallowed so that they never crash the orchestrator.
 */
export class Logger {
  private readonly baseContext: Record<string, unknown>;
  private readonly minLevel: LogLevel;

  constructor(
    baseContext: Record<string, unknown> = {},
    minLevel: LogLevel = "debug",
  ) {
    this.baseContext = baseContext;
    this.minLevel = minLevel;
  }

  // ---- Public API --------------------------------------------------------

  /** Log at INFO level. */
  info(message: string, context?: Record<string, unknown>): void {
    this.write("info", message, context);
  }

  /** Log at WARN level. */
  warn(message: string, context?: Record<string, unknown>): void {
    this.write("warn", message, context);
  }

  /** Log at ERROR level. */
  error(message: string, context?: Record<string, unknown>): void {
    this.write("error", message, context);
  }

  /** Log at DEBUG level. */
  debug(message: string, context?: Record<string, unknown>): void {
    this.write("debug", message, context);
  }

  // ---- Contextual Logger Factories ---------------------------------------

  /**
   * Return a child logger that automatically includes `issue_id` and
   * `issue_identifier` in every record.
   */
  forIssue(issueId: string, issueIdentifier: string): Logger {
    return new Logger(
      { ...this.baseContext, issue_id: issueId, issue_identifier: issueIdentifier },
      this.minLevel,
    );
  }

  /**
   * Return a child logger that automatically includes `session_id` in
   * every record.
   */
  forSession(sessionId: string): Logger {
    return new Logger(
      { ...this.baseContext, session_id: sessionId },
      this.minLevel,
    );
  }

  // ---- Internals ---------------------------------------------------------

  private write(
    level: LogLevel,
    message: string,
    context?: Record<string, unknown>,
  ): void {
    if (LEVEL_RANK[level] < LEVEL_RANK[this.minLevel]) {
      return;
    }

    try {
      const record: Record<string, unknown> = {
        timestamp: new Date().toISOString(),
        level,
        message,
        ...this.baseContext,
        ...(context ? redactSensitive(context) : undefined),
      };

      const line = safeSerialize(record);

      // Use process.stdout.write to avoid the trailing newline ambiguity of
      // console.log and to keep output atomic for piped consumers.
      process.stdout.write(line + "\n");
    } catch {
      // Spec: sink failures must not crash orchestration. Swallow silently.
    }
  }
}

// ---------------------------------------------------------------------------
// Singleton default logger
// ---------------------------------------------------------------------------

/** Default application-wide logger instance. */
export const logger = new Logger();
