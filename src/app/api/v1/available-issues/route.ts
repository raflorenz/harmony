// GET /api/v1/available-issues — List issues available for manual dispatch

import { NextResponse } from 'next/server';
import { getScheduler } from '@/lib/harmony';

export const dynamic = 'force-dynamic';

export async function GET() {
  const scheduler = getScheduler();
  if (!scheduler) {
    return NextResponse.json(
      { error: { code: 'unavailable', message: 'Orchestrator is not running' } },
      { status: 503 },
    );
  }

  const issues = await scheduler.getAvailableIssues();

  return NextResponse.json({
    issues: issues.map((i) => ({
      id: i.id,
      identifier: i.identifier,
      title: i.title,
      state: i.state,
      priority: i.priority,
      labels: i.labels,
      url: i.url,
      created_at: i.createdAt?.toISOString() ?? null,
    })),
  });
}
