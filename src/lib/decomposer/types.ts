// ---------------------------------------------------------------------------
// Feature Decomposer
// ---------------------------------------------------------------------------

export type Feasibility = 'fits' | 'fits_with_caveats' | 'unclear' | 'no';

export interface ProposedTicket {
  /** Local ID used for blocked_by edges within the proposal. */
  tempId: string;
  title: string;
  description: string;
  acceptanceCriteria: string[];
  estimatedFiles: number;
  estimatedDiffLines: number;
  blockedByTempIds: string[];
  rationale: string;
}

export interface DecompositionProposal {
  /** Stable proposal ID assigned by the server. */
  proposalId: string;
  featureDescription: string;
  featureSummary: string;
  feasibility: Feasibility;
  feasibilityNotes: string;
  tickets: ProposedTicket[];
  totalEstimatedScope: { files: number; lines: number };
  warnings: string[];
  createdAt: string;
  status: 'proposed' | 'approved' | 'rejected';
}

export interface DecomposerConfig {
  enabled: boolean;
  model: string;
  /** Soft cap — refuse to decompose past this without explicit override. */
  maxTickets: number;
}
