// ---------------------------------------------------------------------------
// Feature Decomposer — side-agent that turns a feature description into a DAG
// of proposed tickets awaiting human approval.
// ---------------------------------------------------------------------------

import { runSideAgent, recordSideAgentCost } from '../side-agent';
import { logger } from '../observability/logger';
import type { ServiceConfig } from '../tracker/types';
import type {
  DecompositionProposal,
  Feasibility,
  ProposedTicket,
} from './types';

const SYSTEM_PROMPT = `You are a senior engineer triaging feature requests for an autonomous coding
team. Your job is to decompose a feature description into a small DAG of
PR-sized tickets.

First, do two validation passes:
1. Feasibility — does this fit the existing architecture? Output one of:
   "fits", "fits_with_caveats", "unclear", "no". Explain in feasibilityNotes.
2. Scope — if you'd estimate the feature exceeds 5 tickets, return only a
   warning asking the user to split it themselves before decomposing.

Granularity rules (important):
- Prefer FEWER, LARGER tickets. Coarse > fine.
- Each ticket must be a coherent PR, not a single file edit.
- Don't decompose past 5 tickets unless the user explicitly says so.
- Splitting later is easier than merging — err coarse.

Return ONLY a JSON object matching this exact shape:
{
  "featureSummary": "<one-sentence summary>",
  "feasibility": "fits" | "fits_with_caveats" | "unclear" | "no",
  "feasibilityNotes": "<reasoning>",
  "tickets": [
    {
      "tempId": "T1",
      "title": "...",
      "description": "...",
      "acceptanceCriteria": ["...", "..."],
      "estimatedFiles": <int>,
      "estimatedDiffLines": <int>,
      "blockedByTempIds": ["T0", ...],
      "rationale": "<why this is its own ticket>"
    },
    ...
  ],
  "warnings": ["..."]
}

If feasibility is "no" or scope is too large, return tickets: [] and put
the reason in warnings.`;

interface DecomposerRawResponse {
  featureSummary?: string;
  feasibility?: string;
  feasibilityNotes?: string;
  tickets?: Array<Partial<ProposedTicket>>;
  warnings?: string[];
}

const VALID_FEASIBILITIES: Feasibility[] = ['fits', 'fits_with_caveats', 'unclear', 'no'];

function normalizeFeasibility(raw: string | undefined): Feasibility {
  const f = raw as Feasibility;
  return VALID_FEASIBILITIES.includes(f) ? f : 'unclear';
}

function normalizeTicket(t: Partial<ProposedTicket>, idx: number): ProposedTicket {
  const tempId = typeof t.tempId === 'string' && t.tempId ? t.tempId : `T${idx + 1}`;
  return {
    tempId,
    title: typeof t.title === 'string' ? t.title : '(untitled)',
    description: typeof t.description === 'string' ? t.description : '',
    acceptanceCriteria: Array.isArray(t.acceptanceCriteria)
      ? t.acceptanceCriteria.filter((s): s is string => typeof s === 'string')
      : [],
    estimatedFiles: typeof t.estimatedFiles === 'number' ? t.estimatedFiles : 0,
    estimatedDiffLines: typeof t.estimatedDiffLines === 'number' ? t.estimatedDiffLines : 0,
    blockedByTempIds: Array.isArray(t.blockedByTempIds)
      ? t.blockedByTempIds.filter((s): s is string => typeof s === 'string')
      : [],
    rationale: typeof t.rationale === 'string' ? t.rationale : '',
  };
}

/**
 * Run the decomposer side-agent on a feature description. Returns a
 * proposal with `status: 'proposed'` or null on side-agent failure.
 */
export async function runDecomposer(
  featureDescription: string,
  config: ServiceConfig,
  context?: string,
): Promise<DecompositionProposal | null> {
  const userMsg = [
    '# Feature description',
    featureDescription,
    context ? `\n# Repo context\n${context}` : '',
  ].join('\n');

  const resp = await runSideAgent<DecomposerRawResponse>(
    {
      apiKey: config.sideAgent.apiKey,
      defaultModel: config.sideAgent.defaultModel,
      endpoint: config.sideAgent.endpoint,
    },
    {
      stage: 'decomposer',
      system: SYSTEM_PROMPT,
      user: userMsg,
      model: config.decomposer.model || config.sideAgent.defaultModel,
      maxTokens: 4096,
    },
  );

  if (!resp.ok) {
    logger.warn('Decomposer side-agent call failed', { error: resp.error });
    return null;
  }
  recordSideAgentCost(undefined, 'decomposer', resp.usage);

  const tickets = Array.isArray(resp.data.tickets)
    ? resp.data.tickets.map((t, i) => normalizeTicket(t, i))
    : [];

  // Enforce the soft cap (returns warning rather than chopping the list).
  const warnings: string[] = Array.isArray(resp.data.warnings)
    ? resp.data.warnings.filter((s): s is string => typeof s === 'string')
    : [];
  if (tickets.length > config.decomposer.maxTickets) {
    warnings.unshift(
      `Decomposer returned ${tickets.length} tickets (soft cap ${config.decomposer.maxTickets}). Consider splitting at the feature level first.`,
    );
  }

  const totalFiles = tickets.reduce((s, t) => s + t.estimatedFiles, 0);
  const totalLines = tickets.reduce((s, t) => s + t.estimatedDiffLines, 0);

  return {
    proposalId: `prop-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    featureDescription,
    featureSummary: resp.data.featureSummary ?? featureDescription.slice(0, 80),
    feasibility: normalizeFeasibility(resp.data.feasibility),
    feasibilityNotes: resp.data.feasibilityNotes ?? '',
    tickets,
    totalEstimatedScope: { files: totalFiles, lines: totalLines },
    warnings,
    createdAt: new Date().toISOString(),
    status: 'proposed',
  };
}
