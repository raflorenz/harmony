// ---------------------------------------------------------------------------
// Issue Grader — pre-execution gate
// ---------------------------------------------------------------------------

export interface GraderScores {
  clarity: number;            // 0-5, is the goal stated unambiguously
  scope: number;              // 0-5, is it the right size for one PR
  acceptanceCriteria: number; // 0-5, can we tell when it's done
  technicalContext: number;   // 0-5, are relevant code areas referenced
}

export interface GraderReport {
  ticketId: string;
  scores: GraderScores;
  overallPass: boolean;
  blockingQuestions: string[];
  suggestedRevisions: string[];
}

export interface GraderConfig {
  enabled: boolean;
  model: string;
  minPerScore: number;        // default 3
  minOverall: number;         // default 14
  rerunOnCommentUpdate: boolean;
}
