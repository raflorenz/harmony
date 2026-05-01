// ---------------------------------------------------------------------------
// GET /api/v1/state — Runtime state snapshot (Spec Section 13.7.2)
// ---------------------------------------------------------------------------

import { NextResponse } from 'next/server';
import { getScheduler, isMockMode } from '@/lib/symphony';
import { createSnapshot } from '@/lib/observability/metrics';

export const dynamic = 'force-dynamic';

export function GET() {
  const scheduler = getScheduler();

  if (!scheduler) {
    return NextResponse.json(
      {
        error: {
          code: 'unavailable',
          message: 'Symphony orchestrator is not running',
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
      last_message: r.lastMessage,
      recent_messages: r.recentMessages,
    })),
    retrying: snapshot.retrying.map((r) => ({
      issue_id: r.issueId,
      issue_identifier: r.issueIdentifier,
      attempt: r.attempt,
      due_at: r.dueAt,
      error: r.error,
    })),
    canceled: snapshot.canceled.map((c) => ({
      issue_id: c.issueId,
      issue_identifier: c.issueIdentifier,
      attempt: c.attempt,
      canceled_at: c.canceledAt,
      tokens: {
        input_tokens: c.inputTokens,
        output_tokens: c.outputTokens,
        total_tokens: c.totalTokens,
      },
      turn_count: c.turnCount,
      last_message: c.lastMessage,
      recent_messages: c.recentMessages,
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
