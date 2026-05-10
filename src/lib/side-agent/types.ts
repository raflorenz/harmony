// ---------------------------------------------------------------------------
// Side-Agent Abstraction
// ---------------------------------------------------------------------------
//
// "Side-agents" are short, single-shot LLM invocations distinct from the
// long-running coding agent. The decomposer, grader, verifier, and
// repo-brain updater are all side-agents. They share a runtime config:
// cheaper model, lower turn cap, JSON structured output, no tool access.
// ---------------------------------------------------------------------------

/** Per-call cost & token usage record. */
export interface SideAgentUsage {
  inputTokens: number;
  outputTokens: number;
  costUsd: number;
}

/** Successful structured-output result from a side-agent call. */
export interface SideAgentResult<T> {
  ok: true;
  data: T;
  usage: SideAgentUsage;
  /** The raw JSON string the model returned, kept for debugging. */
  raw: string;
}

/** Failure (transport, parse, or schema mismatch). */
export interface SideAgentError {
  ok: false;
  error: string;
  raw?: string;
  usage?: SideAgentUsage;
}

export type SideAgentResponse<T> = SideAgentResult<T> | SideAgentError;

/** Inputs to a single side-agent call. */
export interface SideAgentRequest {
  /** Tag used for cost accounting and logs (e.g. "grader", "verifier"). */
  stage: string;
  /** Optional ticket ID for per-ticket cost rollup. */
  ticketId?: string;
  /** System prompt; describes the role and the JSON schema expected back. */
  system: string;
  /** User message containing the actual content to evaluate. */
  user: string;
  /** Anthropic model ID. Defaults from config when unset. */
  model?: string;
  /** Hard cap on output tokens. Defaults to 4096. */
  maxTokens?: number;
  /** Temperature 0-1. Defaults to 0.2 for predictable structured output. */
  temperature?: number;
}

/** Side-agent runtime config (loaded from the orchestrator's ServiceConfig). */
export interface SideAgentConfig {
  /** API key for the Anthropic API. */
  apiKey: string;
  /** Default model used when a request doesn't specify one. */
  defaultModel: string;
  /** Endpoint base URL (override for proxies). */
  endpoint: string;
}
