// POST /api/v1/issues/:issueId/delete — Delete a session (stop + clean workspace)

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

  // Parse identifier from request body
  let identifier = '';
  try {
    const body = await _request.json();
    identifier = body.identifier ?? '';
  } catch {
    // identifier not provided
  }

  if (!identifier) {
    return NextResponse.json(
      { error: { code: 'missing_identifier', message: 'Request body must include "identifier"' } },
      { status: 400 },
    );
  }

  const deleted = await scheduler.deleteSession(issueId, identifier);

  return NextResponse.json({ deleted, issue_id: issueId }, { status: 200 });
}
