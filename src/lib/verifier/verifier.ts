// ---------------------------------------------------------------------------
// Verifier — runs a fresh-context side-agent to critique the diff against the
// spec before the orchestrator opens a PR.
// ---------------------------------------------------------------------------

import { runSideAgent, recordSideAgentCost } from '../side-agent';
import { execInWorkspace } from '../executor/hooks';
import { logger } from '../observability/logger';
import type { Issue, ServiceConfig } from '../tracker/types';
import type {
  VerifierConfig,
  VerifierDecision,
  VerifierFinding,
  VerifierReport,
} from './types';
import type { GraderReport } from '../grader';

const SYSTEM_PROMPT = `You are a strict code-review agent. You see ONLY the spec and the diff —
not the executing agent's reasoning. Your job is to decide whether the diff
faithfully implements the spec.

Return ONLY a JSON object matching this exact shape, no surrounding prose:
{
  "decision": "approve" | "request_revision" | "escalate",
  "findings": [
    {
      "severity": "blocking" | "concern" | "nit",
      "category": "spec_mismatch" | "bug" | "scope_creep" | "test_gap" | "guardrail",
      "detail": "<concise description>",
      "filePath": "<optional path>",
      "lineRange": [<start>, <end>]    // optional
    },
    ...
  ],
  "passedChecks": ["tests", "lint", ...],
  "confidence": <number 0..1>
}

Rules:
- "approve" only when there are no blocking findings.
- "escalate" when you genuinely cannot tell if the change is correct.
- "request_revision" when there are blocking findings the agent can fix.
- Concerns and nits are advisory; they don't block approval.`;

interface VerifierRawResponse {
  decision: string;
  findings?: Partial<VerifierFinding>[];
  passedChecks?: string[];
  confidence?: number;
}

const MAX_DIFF_BYTES = 80_000;

async function readDiff(workspacePath: string): Promise<string> {
  try {
    // The agent is instructed not to commit; its work shows up as a mix of
    // working-tree edits and untracked files. `git add -N .` marks untracked
    // paths as intent-to-add so they appear in `git diff` as new files,
    // without staging actual content. The orchestrator's own `git add -A`
    // at commit time still picks everything up.
    await execInWorkspace('git add -N .', workspacePath, 30_000);

    // Diff working tree vs origin/main — captures committed, staged, and
    // unstaged changes, including the new files just marked intent-to-add.
    const r = await execInWorkspace(
      'git diff origin/main',
      workspacePath,
      30_000,
    );
    if (r.exitCode === 0 && r.stdout.trim()) return truncate(r.stdout);
    const w = await execInWorkspace('git diff HEAD', workspacePath, 30_000);
    return truncate(w.stdout);
  } catch {
    return '(unable to read diff)';
  }
}

function truncate(s: string): string {
  if (s.length <= MAX_DIFF_BYTES) return s;
  return (
    s.slice(0, MAX_DIFF_BYTES) +
    `\n\n[... truncated ${s.length - MAX_DIFF_BYTES} bytes — diff exceeded verifier budget]`
  );
}

function normalizeDecision(raw: string | undefined): VerifierDecision {
  if (raw === 'approve' || raw === 'request_revision' || raw === 'escalate') return raw;
  return 'escalate';
}

function normalizeFindings(raw: Partial<VerifierFinding>[] | undefined): VerifierFinding[] {
  if (!Array.isArray(raw)) return [];
  return raw
    .filter((f): f is Partial<VerifierFinding> => f !== null && typeof f === 'object')
    .map((f) => ({
      severity:
        f.severity === 'blocking' || f.severity === 'concern' || f.severity === 'nit'
          ? f.severity
          : 'nit',
      category:
        f.category === 'spec_mismatch' ||
        f.category === 'bug' ||
        f.category === 'scope_creep' ||
        f.category === 'test_gap' ||
        f.category === 'guardrail'
          ? f.category
          : 'spec_mismatch',
      detail: typeof f.detail === 'string' ? f.detail : '',
      filePath: typeof f.filePath === 'string' ? f.filePath : undefined,
      lineRange: Array.isArray(f.lineRange) && f.lineRange.length === 2
        ? [Number(f.lineRange[0]), Number(f.lineRange[1])]
        : undefined,
    }));
}

/**
 * Run the verifier against an issue's workspace. Returns the report or null
 * on side-agent failure (caller should treat null as 'escalate').
 */
export async function runVerifier(
  issue: Issue,
  workspacePath: string,
  config: ServiceConfig,
  graderReport: GraderReport | null,
): Promise<VerifierReport | null> {
  if (!config.verifier.enabled) {
    return {
      ticketId: issue.id,
      decision: 'approve',
      findings: [],
      passedChecks: ['verifier-disabled'],
      confidence: 0.5,
    };
  }

  const diff = await readDiff(workspacePath);

  const userMsg = [
    `# Issue ${issue.identifier}: ${issue.title}`,
    '',
    issue.description ?? '',
    graderReport
      ? `\nAcceptance criteria (from grader): clarity=${graderReport.scores.clarity}/5, scope=${graderReport.scores.scope}/5, acceptance=${graderReport.scores.acceptanceCriteria}/5\n`
      : '',
    '## Diff (vs main)',
    '```diff',
    diff,
    '```',
  ].join('\n');

  const resp = await runSideAgent<VerifierRawResponse>(
    {
      apiKey: config.sideAgent.apiKey,
      defaultModel: config.sideAgent.defaultModel,
      endpoint: config.sideAgent.endpoint,
    },
    {
      stage: 'verifier',
      ticketId: issue.id,
      system: SYSTEM_PROMPT,
      user: userMsg,
      model: config.verifier.model || config.sideAgent.defaultModel,
      maxTokens: 2048,
    },
  );

  if (!resp.ok) {
    logger.warn('Verifier side-agent call failed', {
      issue_id: issue.id,
      error: resp.error,
    });
    return null;
  }
  recordSideAgentCost(issue.id, 'verifier', resp.usage);

  const findings = normalizeFindings(resp.data.findings);

  // Apply onNoTests rule: if there are code changes but no test file changes,
  // synthesize a finding with the configured severity.
  // We approximate "no tests changed" by checking the diff for test path hints.
  const looksLikeTestsTouched = /test|spec/i.test(diff);
  if (!looksLikeTestsTouched && diff.length > 200) {
    findings.push({
      severity: config.verifier.onNoTests,
      category: 'test_gap',
      detail: 'No test files appear to be added or modified in this diff.',
    });
  }

  let decision = normalizeDecision(resp.data.decision);
  if (findings.some((f) => f.severity === 'blocking') && decision === 'approve') {
    decision = 'request_revision';
  }

  return {
    ticketId: issue.id,
    decision,
    findings,
    passedChecks: Array.isArray(resp.data.passedChecks)
      ? resp.data.passedChecks.filter((s): s is string => typeof s === 'string')
      : [],
    confidence:
      typeof resp.data.confidence === 'number'
        ? Math.max(0, Math.min(1, resp.data.confidence))
        : 0.5,
  };
}

/** Render a verifier report as a Markdown summary for the PR body. */
export function renderVerifierSummary(report: VerifierReport): string {
  const decisionEmoji =
    report.decision === 'approve' ? '✅' : report.decision === 'request_revision' ? '🔁' : '⚠️';
  const lines = [
    `## Verifier — ${decisionEmoji} ${report.decision}`,
    `**Confidence:** ${(report.confidence * 100).toFixed(0)}%`,
    '',
  ];
  if (report.passedChecks.length > 0) {
    lines.push(`**Passed checks:** ${report.passedChecks.join(', ')}`);
    lines.push('');
  }
  if (report.findings.length > 0) {
    lines.push('### Findings');
    for (const f of report.findings) {
      const loc = f.filePath
        ? ` (${f.filePath}${f.lineRange ? `:${f.lineRange[0]}-${f.lineRange[1]}` : ''})`
        : '';
      lines.push(`- **[${f.severity}/${f.category}]** ${f.detail}${loc}`);
    }
  }
  return lines.join('\n');
}
