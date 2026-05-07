// ---------------------------------------------------------------------------
// Repo Brain updater — proposes additions to learnings.md after PR-merge or
// after verifier rejection.
// ---------------------------------------------------------------------------
//
// The plan calls for the updater to open a tiny review PR with the proposed
// additions; it never writes directly. For v1, this module provides:
//
//   - proposeFromMergedPr(): runs a side-agent on (issue, PR description, diff,
//     reviews) and returns LearningsAddition[]
//   - proposeFromVerifierFinding(): turns a verifier finding into a single
//     LearningsAddition (rolled-up periodically rather than written per-run)
//
// Caller decides whether to apply additions inline (when running in a
// workspace it controls) or open a review PR.
// ---------------------------------------------------------------------------

import { runSideAgent, recordSideAgentCost } from '../side-agent';
import { logger } from '../observability/logger';
import type { ServiceConfig } from '../tracker/types';
import type { LearningsAddition } from './types';

const SYSTEM_PROMPT = `You are the Harmony repo-brain updater. Given the closing context of a
merged PR (issue, diff, review feedback), propose 0 or more bullets to add
to .harmony/learnings.md.

Rules:
- Only propose additions that capture a NON-OBVIOUS lesson likely to recur.
- Don't restate convention from style guides — only what would catch a
  future agent off-guard.
- Each bullet is ONE SHORT line. No code blocks, no multi-paragraph stories.
- Sections allowed: "Conventions", "Path-specific", "Past mistakes".
- For "Path-specific", set "subsection" to a path glob like "src/db/migrations/**".
- Do NOT propose anything if there's no clear lesson — empty array is fine.

Return ONLY a JSON object: { "additions": [{ "section": "...", "subsection": "...?", "body": "..." }, ...] }`;

interface UpdaterRawResponse {
  additions?: Array<Partial<LearningsAddition>>;
}

const ALLOWED_SECTIONS = new Set(['Conventions', 'Path-specific', 'Past mistakes']);

function normalizeAddition(
  raw: Partial<LearningsAddition>,
): LearningsAddition | null {
  if (!raw || typeof raw !== 'object') return null;
  const section = typeof raw.section === 'string' ? raw.section : '';
  if (!ALLOWED_SECTIONS.has(section)) return null;
  const body = typeof raw.body === 'string' ? raw.body.trim() : '';
  if (!body) return null;
  return {
    section,
    body,
    subsection: typeof raw.subsection === 'string' && raw.subsection ? raw.subsection : undefined,
  };
}

export interface MergedPrContext {
  ticketId: string;
  issueTitle: string;
  issueDescription: string | null;
  prTitle: string;
  prBody: string;
  diffSummary: string; // condensed diff (we don't send full bytes)
  reviewComments: string[];
}

export async function proposeFromMergedPr(
  ctx: MergedPrContext,
  config: ServiceConfig,
): Promise<LearningsAddition[]> {
  const userMsg = [
    `# Issue: ${ctx.issueTitle}`,
    ctx.issueDescription ?? '',
    '',
    `## PR: ${ctx.prTitle}`,
    ctx.prBody,
    '',
    '## Diff summary',
    ctx.diffSummary,
    '',
    ctx.reviewComments.length > 0
      ? '## Review comments\n' + ctx.reviewComments.map((c) => `- ${c}`).join('\n')
      : '',
  ].join('\n');

  const resp = await runSideAgent<UpdaterRawResponse>(
    {
      apiKey: config.sideAgent.apiKey,
      defaultModel: config.sideAgent.defaultModel,
      endpoint: config.sideAgent.endpoint,
    },
    {
      stage: 'repo_brain',
      ticketId: ctx.ticketId,
      system: SYSTEM_PROMPT,
      user: userMsg,
      model: config.repoBrain.model || config.sideAgent.defaultModel,
      maxTokens: 1024,
    },
  );

  if (!resp.ok) {
    logger.warn('Repo-brain side-agent call failed', { error: resp.error });
    return [];
  }
  recordSideAgentCost(ctx.ticketId, 'repo_brain', resp.usage);

  if (!Array.isArray(resp.data.additions)) return [];
  return resp.data.additions
    .map(normalizeAddition)
    .filter((a): a is LearningsAddition => a !== null);
}

/**
 * Synthesize an addition from a verifier finding category. Used to roll up
 * recurring categories into "Past mistakes" notes periodically.
 */
export function proposeFromVerifierCategory(
  category: string,
  detail: string,
  isoDate: string,
): LearningsAddition {
  return {
    section: 'Past mistakes',
    body: `${isoDate.slice(0, 10)}: verifier flagged ${category} — ${detail.slice(0, 200)}`,
  };
}
