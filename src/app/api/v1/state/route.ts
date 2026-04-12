// ---------------------------------------------------------------------------
// GET /api/v1/state — Runtime state snapshot (Spec Section 13.7.2)
// ---------------------------------------------------------------------------

import { NextResponse } from 'next/server';
import { getScheduler, isMockMode } from '@/lib/harmony';
import { createSnapshot } from '@/lib/observability/metrics';

export const dynamic = 'force-dynamic';

export function GET() {
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
  const snapshot = createSnapshot(state);

  return NextResponse.json({
    mock_mode: isMockMode(),
    auto_dispatch: scheduler.isAutoDispatch(),
    generated_at: snapshot.generatedAt,
    counts: snapshot.counts,
    running: snapshot.running.map((r) => ({
      issue_id: r.issueId,
      issue_identifier: r.issueIdentifier,
      attempt: r.attempt,
      status: r.status,
      started_at: r.startedAt,
      seconds_running: r.secondsRunning,
      tokens: {
        input_tokens: r.inputTokens,
        output_tokens: r.outputTokens,
        total_tokens: r.totalTokens,
      },
    })),
    retrying: snapshot.retrying.map((r) => ({
      issue_id: r.issueId,
      issue_identifier: r.issueIdentifier,
      attempt: r.attempt,
      due_at: r.dueAt,
      error: r.error,
    })),
    codex_totals: {
      input_tokens: snapshot.codexTotals.inputTokens,
      output_tokens: snapshot.codexTotals.outputTokens,
      total_tokens: snapshot.codexTotals.totalTokens,
      seconds_running: snapshot.codexTotals.secondsRunning,
    },
    rate_limits: snapshot.rateLimits,
  });
}
