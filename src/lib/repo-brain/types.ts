// ---------------------------------------------------------------------------
// Repo Brain — auto-maintained learnings file injected into every agent run
// ---------------------------------------------------------------------------

export interface RepoBrainConfig {
  enabled: boolean;
  model: string;
  /** Path inside the repo where learnings are stored. */
  learningsPath: string;     // default: '.harmony/learnings.md'
  /** Path for private (gitignored) learnings. */
  learningsPrivatePath: string; // default: '.harmony/learnings.private.md'
  /** Cap on the size of injected learnings, in chars. */
  maxInjectChars: number;    // default: 8000
}

export interface LearningsAddition {
  /** Section heading the addition belongs to (e.g. "Path-specific", "Past mistakes"). */
  section: string;
  /** Bullet text. Single line, no markdown beyond inline. */
  body: string;
  /** Optional sub-section heading (e.g. a path glob). */
  subsection?: string;
}
