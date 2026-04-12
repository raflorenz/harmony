// ---------------------------------------------------------------------------
// GET /api/v1/:identifier — Issue detail (Spec Section 13.7.2)
// ---------------------------------------------------------------------------

import { NextResponse } from 'next/server';
import { getScheduler } from '@/lib/harmony';
import { createIssueDetail } from '@/lib/observability/metrics';

export const dynamic = 'force-dynamic';

export function GET(
  _request: Request,
  { params }: { params: Promise<{ identifier: string }> },
) {
  return params.then((resolvedParams) => {
    const { identifier } = resolvedParams;
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

    const state = scheduler.getState();
    const detail = createIssueDetail(state, identifier);

    if (!detail) {
      return NextResponse.json(
        {
          error: {
            code: 'issue_not_found',
            message: `Issue "${identifier}" is not tracked in the current runtime state`,
          },
        },
        { status: 404 },
      );
    }

    return NextResponse.json({
      issue_identifier: detail.issueIdentifier,
      issue_id: detail.issueId,
      status: detail.status,
      attempt: detail.attempt,
      started_at: detail.startedAt,
      seconds_running: detail.secondsRunning,
      usage: detail.usage
        ? {
            input_tokens: detail.usage.inputTokens,
            output_tokens: detail.usage.outputTokens,
            total_tokens: detail.usage.totalTokens,
          }
        : null,
      error: detail.error,
      retry_due_at: detail.retryDueAt,
    });
  });
}
