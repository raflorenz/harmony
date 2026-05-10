// ---------------------------------------------------------------------------
// POST /api/v1/repo-brain/propose
// Trigger the repo-brain updater on a merged PR. Returns proposed additions;
// caller can review and apply them (or open a small follow-up PR).
// ---------------------------------------------------------------------------

import { NextResponse } from 'next/server';
import { resolveConfig } from '@/lib/config/resolver';
import { loadWorkflow } from '@/lib/policy/workflow-loader';
import { proposeFromMergedPr, type MergedPrContext } from '@/lib/repo-brain';
import * as path from 'path';

export const dynamic = 'force-dynamic';

export async function POST(request: Request) {
  let body: Partial<MergedPrContext>;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json(
      { error: { code: 'invalid_body', message: 'Invalid JSON body' } },
      { status: 400 },
    );
  }

  if (!body.ticketId || !body.issueTitle || !body.prTitle || !body.diffSummary) {
    return NextResponse.json(
      {
        error: {
          code: 'missing_fields',
          message:
            'Required fields: ticketId, issueTitle, prTitle, diffSummary (issueDescription, prBody, reviewComments are optional)',
        },
      },
      { status: 400 },
    );
  }

  const wfPath = path.resolve(process.env.SYMPHONY_WORKFLOW_PATH ?? './WORKFLOW.md');
  const wf = await loadWorkflow(wfPath);
  const config = resolveConfig(wf.config);

  if (!config.repoBrain.enabled) {
    return NextResponse.json(
      { error: { code: 'disabled', message: 'repoBrain.enabled is false' } },
      { status: 400 },
    );
  }
  if (!config.sideAgent.apiKey) {
    return NextResponse.json(
      {
        error: { code: 'missing_api_key', message: 'ANTHROPIC_API_KEY is not configured' },
      },
      { status: 400 },
    );
  }

  const additions = await proposeFromMergedPr(
    {
      ticketId: body.ticketId,
      issueTitle: body.issueTitle,
      issueDescription: body.issueDescription ?? null,
      prTitle: body.prTitle,
      prBody: body.prBody ?? '',
      diffSummary: body.diffSummary,
      reviewComments: Array.isArray(body.reviewComments) ? body.reviewComments : [],
    },
    config,
  );

  return NextResponse.json({ additions });
}
