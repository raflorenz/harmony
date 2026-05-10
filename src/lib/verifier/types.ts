// ---------------------------------------------------------------------------
// Verifier — post-execution gate
// ---------------------------------------------------------------------------

export type VerifierDecision = 'approve' | 'request_revision' | 'escalate';
export type VerifierSeverity = 'blocking' | 'concern' | 'nit';
export type VerifierCategory =
  | 'spec_mismatch'
  | 'bug'
  | 'scope_creep'
  | 'test_gap'
  | 'guardrail';

export interface VerifierFinding {
  severity: VerifierSeverity;
  category: VerifierCategory;
  detail: string;
  filePath?: string;
  lineRange?: [number, number];
}

export interface VerifierReport {
  ticketId: string;
  decision: VerifierDecision;
  findings: VerifierFinding[];
  passedChecks: string[];
  confidence: number;
}

export interface VerifierConfig {
  enabled: boolean;
  model: string;
  maxRevisions: number;
  /** What to do when no test changes accompany code changes. */
  onNoTests: 'concern' | 'blocking';
}
