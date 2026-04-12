// ---------------------------------------------------------------------------
// GET  /api/v1/manual-issues — List manually-added issues
// POST /api/v1/manual-issues — Add a new manual issue
// ---------------------------------------------------------------------------

import { NextResponse } from 'next/server';
import { getScheduler } from '@/lib/harmony';

export const dynamic = 'force-dynamic';

export function GET() {
  const scheduler = getScheduler();
  if (!scheduler) {
    return NextResponse.json(
      { error: { code: 'unavailable', message: 'Orchestrator is not running' } },
      { status: 503 },
    );
  }

  // Fetch available issues and filter to only manual ones (id starts with "manual-")
  // This is a best-effort approach since we can't directly access the composite tracker
  return scheduler.getAvailableIssues().then((issues) => {
    const manualIssues = issues.filter((i) => i.id.startsWith('manual-'));
    return NextResponse.json({
      issues: manualIssues.map((i) => ({
        id: i.id,
        identifier: i.identifier,
        title: i.title,
        description: i.description,
        state: i.state,
        priority: i.priority,
        labels: i.labels,
        created_at: i.createdAt?.toISOString() ?? null,
      })),
    });
  });
}

export async function POST(request: Request) {
  const scheduler = getScheduler();
  if (!scheduler) {
    return NextResponse.json(
      { error: { code: 'unavailable', message: 'Orchestrator is not running' } },
      { status: 503 },
    );
  }

  let body: {
    title?: string;
    description?: string;
    priority?: number;
    state?: string;
    labels?: string[];
  };

  try {
    body = await request.json();
  } catch {
    return NextResponse.json(
      { error: { code: 'invalid_body', message: 'Invalid JSON body' } },
      { status: 400 },
    );
  }

  if (!body.title || typeof body.title !== 'string' || !body.title.trim()) {
    return NextResponse.json(
      { error: { code: 'missing_title', message: 'Field "title" is required' } },
      { status: 400 },
    );
  }

  const issue = scheduler.addManualIssue({
    title: body.title.trim(),
    description: body.description,
    priority: body.priority,
    state: body.state,
    labels: body.labels,
  });

  if (!issue) {
    return NextResponse.json(
      { error: { code: 'not_supported', message: 'Tracker does not support manual issues' } },
      { status: 400 },
    );
  }

  return NextResponse.json(
    {
      created: true,
      issue: {
        id: issue.id,
        identifier: issue.identifier,
        title: issue.title,
        description: issue.description,
        state: issue.state,
        priority: issue.priority,
        labels: issue.labels,
        created_at: issue.createdAt?.toISOString() ?? null,
      },
    },
    { status: 201 },
  );
}
