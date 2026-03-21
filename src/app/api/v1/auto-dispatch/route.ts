// GET/POST /api/v1/auto-dispatch — Toggle or query auto-dispatch mode

import { NextResponse } from 'next/server';
import { getScheduler } from '@/lib/symphony';

export const dynamic = 'force-dynamic';

export function GET() {
  const scheduler = getScheduler();
  if (!scheduler) {
    return NextResponse.json(
      { error: { code: 'unavailable', message: 'Orchestrator is not running' } },
      { status: 503 },
    );
  }

  return NextResponse.json({ auto_dispatch: scheduler.isAutoDispatch() });
}

export async function POST(request: Request) {
  const scheduler = getScheduler();
  if (!scheduler) {
    return NextResponse.json(
      { error: { code: 'unavailable', message: 'Orchestrator is not running' } },
      { status: 503 },
    );
  }

  try {
    const body = await request.json();
    const enabled = Boolean(body.enabled);
    scheduler.setAutoDispatch(enabled);
    return NextResponse.json({ auto_dispatch: enabled });
  } catch {
    return NextResponse.json(
      { error: { code: 'invalid_body', message: 'Body must include { "enabled": true/false }' } },
      { status: 400 },
    );
  }
}
