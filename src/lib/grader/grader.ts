// ---------------------------------------------------------------------------
// Issue Grader — runs a side-agent to score ticket clarity, scope, and
// acceptance criteria before the ticket is dispatched to an execution agent.
// ---------------------------------------------------------------------------

import { runSideAgent, recordSideAgentCost } from '../side-agent';
import { logger } from '../observability/logger';
import type { Issue, ServiceConfig } from '../tracker/types';
import type { GraderConfig, GraderReport, GraderScores } from './types';

const SYSTEM_PROMPT = `You are a strict code-task triage agent. You score whether an issue is ready
for an autonomous coding agent to pick up.

Score each rubric dimension 0-5 (integers only):
- clarity: is the goal stated unambiguously?
- scope: is it the right size for one PR (not too big, not trivial)?
- acceptanceCriteria: can we tell when it's done?
- technicalContext: are relevant code areas, files, or constraints referenced?

Return ONLY a JSON object matching this exact shape, with no surrounding prose:
{
  "scores": {
    "clarity": <int 0-5>,
    "scope": <int 0-5>,
    "acceptanceCriteria": <int 0-5>,
    "technicalContext": <int 0-5>
  },
  "blockingQuestions": [<string>, ...],   // empty if no questions
  "suggestedRevisions": [<string>, ...]   // empty if not applicable
}

Be strict but fair. Be specific in blockingQuestions — they will be posted
back to the human as a comment on the ticket.`;

interface GraderRawResponse {
  scores: GraderScores;
  blockingQuestions: string[];
  suggestedRevisions: string[];
}

/**
 * Validate and clamp a scores object. Coerces missing/non-numeric values
 * to 0 so a single bad field can't break gating.
 */
function clampScores(s: Partial<GraderScores> | undefined): GraderScores {
  const clamp = (n: unknown): number => {
    const v = typeof n === 'number' ? n : 0;
    return Math.max(0, Math.min(5, Math.round(v)));
  };
  return {
    clarity: clamp(s?.clarity),
    scope: clamp(s?.scope),
    acceptanceCriteria: clamp(s?.acceptanceCriteria),
    technicalContext: clamp(s?.technicalContext),
  };
}

/**
 * Run the grader against an issue. Returns a complete report (including
 * pass/fail decision) or null on side-agent failure.
 */
export async function runGrader(
  issue: Issue,
  config: ServiceConfig,
): Promise<GraderReport | null> {
  if (!config.grader.enabled) {
    return {
      ticketId: issue.id,
      scores: { clarity: 5, scope: 5, acceptanceCriteria: 5, technicalContext: 5 },
      overallPass: true,
      blockingQuestions: [],
      suggestedRevisions: [],
    };
  }

  const userMsg = [
    `# ${issue.identifier}: ${issue.title}`,
    '',
    issue.description ?? '(no description)',
    '',
    `Labels: ${issue.labels.join(', ') || '(none)'}`,
  ].join('\n');

  const resp = await runSideAgent<GraderRawResponse>(
    {
      apiKey: config.sideAgent.apiKey,
      defaultModel: config.sideAgent.defaultModel,
      endpoint: config.sideAgent.endpoint,
    },
    {
      stage: 'grader',
      ticketId: issue.id,
      system: SYSTEM_PROMPT,
      user: userMsg,
      model: config.grader.model || config.sideAgent.defaultModel,
      maxTokens: 1024,
    },
  );

  if (!resp.ok) {
    logger.warn('Grader side-agent call failed', {
      issue_id: issue.id,
      error: resp.error,
    });
    return null;
  }
  recordSideAgentCost(issue.id, 'grader', resp.usage);

  const scores = clampScores(resp.data?.scores);
  const overall =
    scores.clarity + scores.scope + scores.acceptanceCriteria + scores.technicalContext;
  const minPerScore = config.grader.minPerScore;
  const minOverall = config.grader.minOverall;
  const passes =
    scores.clarity >= minPerScore &&
    scores.scope >= minPerScore &&
    scores.acceptanceCriteria >= minPerScore &&
    scores.technicalContext >= minPerScore &&
    overall >= minOverall;

  return {
    ticketId: issue.id,
    scores,
    overallPass: passes,
    blockingQuestions: Array.isArray(resp.data?.blockingQuestions)
      ? resp.data.blockingQuestions.filter((q): q is string => typeof q === 'string')
      : [],
    suggestedRevisions: Array.isArray(resp.data?.suggestedRevisions)
      ? resp.data.suggestedRevisions.filter((q): q is string => typeof q === 'string')
      : [],
  };
}

/** Render a grader report as a human-readable comment body for the tracker. */
export function renderGraderComment(report: GraderReport): string {
  const lines = [
    '## Harmony Grader — needs clarification',
    '',
    `**Scores:** clarity ${report.scores.clarity}/5, scope ${report.scores.scope}/5, acceptance ${report.scores.acceptanceCriteria}/5, technical context ${report.scores.technicalContext}/5`,
    '',
  ];
  if (report.blockingQuestions.length > 0) {
    lines.push('### Blocking questions');
    for (const q of report.blockingQuestions) lines.push(`- ${q}`);
    lines.push('');
  }
  if (report.suggestedRevisions.length > 0) {
    lines.push('### Suggested revisions');
    for (const r of report.suggestedRevisions) lines.push(`- ${r}`);
    lines.push('');
  }
  lines.push('_Comment to update the issue, then this grader will re-run._');
  return lines.join('\n');
}
