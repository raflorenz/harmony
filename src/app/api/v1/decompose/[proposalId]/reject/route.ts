// ---------------------------------------------------------------------------
// POST /api/v1/decompose/[proposalId]/reject
// Marks a proposal as rejected (kept around for revision/resubmission).
// ---------------------------------------------------------------------------

import { NextResponse } from 'next/server';
import { getProposal, updateProposal } from '@/lib/decomposer';

export const dynamic = 'force-dynamic';

export async function POST(
  _req: Request,
  { params }: { params: Promise<{ proposalId: string }> },
) {
  const { proposalId } = await params;
  const proposal = getProposal(proposalId);
  if (!proposal) {
    return NextResponse.json(
      { error: { code: 'not_found', message: 'Proposal not found' } },
      { status: 404 },
    );
  }

  updateProposal(proposalId, { status: 'rejected' });
  return NextResponse.json({ rejected: true });
}
