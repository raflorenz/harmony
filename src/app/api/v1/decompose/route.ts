// ---------------------------------------------------------------------------
// POST /api/v1/decompose — Submit a feature description, get a proposal
// GET  /api/v1/decompose — List existing proposals
// ---------------------------------------------------------------------------

import { NextResponse } from 'next/server';
import { getScheduler } from '@/lib/symphony';
import { resolveConfig } from '@/lib/config/resolver';
import { loadWorkflow } from '@/lib/policy/workflow-loader';
import { runDecomposer, saveProposal, listProposals } from '@/lib/decomposer';
import * as path from 'path';

export const dynamic = 'force-dynamic';

export async function GET() {
  return NextResponse.json({ proposals: listProposals() });
}

export async function POST(request: Request) {
  const scheduler = getScheduler();
  if (!scheduler) {
    return NextResponse.json(
      { error: { code: 'unavailable', message: 'Orchestrator is not running' } },
      { status: 503 },
    );
  }

  let body: { feature?: string; context?: string };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json(
      { error: { code: 'invalid_body', message: 'Invalid JSON body' } },
      { status: 400 },
    );
  }

  if (!body.feature || typeof body.feature !== 'string' || !body.feature.trim()) {
    return NextResponse.json(
      {
        error: { code: 'missing_feature', message: 'Field "feature" is required' },
      },
      { status: 400 },
    );
  }

  // Reload config from WORKFLOW.md to pick up sideAgent + decomposer settings.
  const wfPath = path.resolve(
    process.env.SYMPHONY_WORKFLOW_PATH ?? './WORKFLOW.md',
  );
  const wf = await loadWorkflow(wfPath);
  const config = resolveConfig(wf.config);

  if (!config.decomposer.enabled) {
    return NextResponse.json(
      {
        error: {
          code: 'disabled',
          message: 'decomposer.enabled is false in WORKFLOW.md',
        },
      },
      { status: 400 },
    );
  }
  // No API key check — runSideAgent transparently falls back to the local
  // Claude CLI (subscription OAuth) when sideAgent.apiKey is empty.

  const proposal = await runDecomposer(
    body.feature.trim(),
    config,
    body.context,
  );
  if (!proposal) {
    return NextResponse.json(
      {
        error: {
          code: 'decomposer_failed',
          message: 'Decomposer side-agent did not return a valid proposal',
        },
      },
      { status: 502 },
    );
  }

  saveProposal(proposal);
  return NextResponse.json({ proposal }, { status: 201 });
}
