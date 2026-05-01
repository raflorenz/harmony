// POST /api/v1/issues/:issueId/resume — Resume a canceled run from its partial state

import { NextResponse } from 'next/server';
import { getScheduler } from '@/lib/symphony';

export const dynamic = 'force-dynamic';

export async function POST(
  _request: Request,
  { params }: { params: Promise<{ issueId: string }> },
) {
  const { issueId } = await params;
  const scheduler = getScheduler();

  if (!scheduler) {
    return NextResponse.json(
      { error: { code: 'unavailable', message: 'Orchestrator is not running' } },
      { status: 503 },
    );
  }

  const resumed = await scheduler.manualResume(issueId);

  if (!resumed) {
    return NextResponse.json(
      { error: { code: 'cannot_resume', message: 'No canceled run found for this issue' } },
      { status: 404 },
    );
  }

  return NextResponse.json({ resumed: true, issue_id: issueId }, { status: 200 });
}
