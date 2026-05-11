// ---------------------------------------------------------------------------
// GET /api/v1/health — Health check endpoint
// ---------------------------------------------------------------------------

import { NextResponse } from 'next/server';

export const dynamic = 'force-dynamic';

export function GET() {
  return NextResponse.json({ ok: true, version: '0.1.0' });
}
