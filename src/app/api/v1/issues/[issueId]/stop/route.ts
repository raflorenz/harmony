// POST /api/v1/issues/:issueId/stop — Manually stop a running session

import { NextResponse } from 'next/server';
import { getScheduler } from '@/lib/harmony';

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

  const stopped = await scheduler.manualStop(issueId);

  if (!stopped) {
    return NextResponse.json(
      { error: { code: 'not_running', message: 'No active session found for this issue' } },
      { status: 404 },
    );
  }

  return NextResponse.json({ stopped: true, issue_id: issueId }, { status: 200 });
}
