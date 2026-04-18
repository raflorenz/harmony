// ---------------------------------------------------------------------------
// POST /api/v1/refresh — Trigger immediate poll cycle (Spec Section 13.7.2)
// ---------------------------------------------------------------------------

import { NextResponse } from 'next/server';
import { getScheduler } from '@/lib/harmony';

export const dynamic = 'force-dynamic';

export function POST() {
  const scheduler = getScheduler();

  if (!scheduler) {
    return NextResponse.json(
      {
        error: {
          code: 'unavailable',
          message: 'Harmony orchestrator is not running',
        },
      },
      { status: 503 },
    );
  }

  scheduler.triggerRefresh();

  return NextResponse.json(
    {
      queued: true,
      coalesced: false,
      requested_at: new Date().toISOString(),
      operations: ['poll', 'reconcile'],
    },
    { status: 202 },
  );
}

// Return 405 for non-POST methods
export function GET() {
  return NextResponse.json(
    { error: { code: 'method_not_allowed', message: 'Use POST' } },
    { status: 405 },
  );
}
