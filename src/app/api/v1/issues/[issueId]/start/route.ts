// POST /api/v1/issues/:issueId/start — Manually start a session

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

  const dispatched = await scheduler.manualStart(issueId);

  if (!dispatched) {
    return NextResponse.json(
      { error: { code: 'cannot_start', message: 'Issue not found, not eligible, or already running' } },
      { status: 409 },
    );
  }

  return NextResponse.json({ started: true, issue_id: issueId }, { status: 200 });
}
