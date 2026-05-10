// ---------------------------------------------------------------------------
// POST /api/v1/decompose/[proposalId]/approve
// Creates manual issues from each ticket in the proposal.
// blocked_by edges are preserved as a label so the orchestrator can respect
// them when dispatching.
// ---------------------------------------------------------------------------

import { NextResponse } from 'next/server';
import { getScheduler } from '@/lib/symphony';
import { getProposal, updateProposal } from '@/lib/decomposer';

export const dynamic = 'force-dynamic';

export async function POST(
  _req: Request,
  { params }: { params: Promise<{ proposalId: string }> },
) {
  const { proposalId } = await params;
  const scheduler = getScheduler();
  if (!scheduler) {
    return NextResponse.json(
      { error: { code: 'unavailable', message: 'Orchestrator is not running' } },
      { status: 503 },
    );
  }

  const proposal = getProposal(proposalId);
  if (!proposal) {
    return NextResponse.json(
      { error: { code: 'not_found', message: 'Proposal not found' } },
      { status: 404 },
    );
  }
  if (proposal.status !== 'proposed') {
    return NextResponse.json(
      {
        error: {
          code: 'already_resolved',
          message: `Proposal is already ${proposal.status}`,
        },
      },
      { status: 400 },
    );
  }

  // Map tempId -> created issue identifier so we can stamp blocked_by labels.
  const idMap = new Map<string, string>();
  const created: Array<{ tempId: string; id: string; identifier: string }> = [];

  for (const ticket of proposal.tickets) {
    const labels = ['harmony:proposed'];
    if (ticket.blockedByTempIds.length > 0) {
      // Encode blocker temp IDs as labels — orchestrator can resolve them
      // once dependent tickets have IDs assigned.
      for (const blocker of ticket.blockedByTempIds) {
        labels.push(`harmony:blocked-by:${blocker}`);
      }
    }

    const issue = scheduler.addManualIssue({
      title: ticket.title,
      description: [
        ticket.description,
        '',
        '## Acceptance criteria',
        ...ticket.acceptanceCriteria.map((c) => `- ${c}`),
        '',
        `_Decomposed from proposal ${proposal.proposalId}; rationale: ${ticket.rationale}_`,
      ].join('\n'),
      labels,
      state: 'Todo',
    });

    if (issue) {
      idMap.set(ticket.tempId, issue.identifier);
      created.push({ tempId: ticket.tempId, id: issue.id, identifier: issue.identifier });
    }
  }

  updateProposal(proposalId, { status: 'approved' });
  return NextResponse.json({ approved: true, created });
}
