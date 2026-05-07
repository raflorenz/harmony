// ---------------------------------------------------------------------------
// Guardrails — declarative limits enforced by the orchestrator
// ---------------------------------------------------------------------------

export type OnBreachPolicy = 'stop_and_escalate' | 'warn' | 'auto_split';

export interface Guardrails {
  maxFilesChanged: number;
  maxDiffLines: number;
  maxCostUsd: number;
  blockedPaths: string[];
  /** Map of glob -> required label name. */
  requireLabelForPaths: Record<string, string>;
  onBreach: OnBreachPolicy;
}

export type GuardrailBreachType = 'files' | 'diff' | 'cost' | 'path' | 'label';

export interface GuardrailBreach {
  type: GuardrailBreachType;
  detail: string;
  observedValue: number | string;
  limit: number | string;
}
