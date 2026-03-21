// ---------------------------------------------------------------------------
// Prompt Construction (Spec Section 12)
// ---------------------------------------------------------------------------

import { Liquid } from 'liquidjs';
import type { Issue } from '../tracker/types';

const engine = new Liquid({
  strictVariables: true,
  strictFilters: true,
});

/**
 * Render a prompt template with issue context.
 *
 * Uses Liquid-compatible template rendering with strict variable/filter checking
 * as required by Spec Section 5.4.
 *
 * @param template      The prompt template (Markdown body from WORKFLOW.md)
 * @param issue         Normalized issue object
 * @param attempt       Retry/continuation attempt number (null for first run)
 * @param turnNumber    Current turn number (1-based)
 * @param maxTurns      Max turns configured
 * @returns Rendered prompt string
 */
export async function renderPrompt(
  template: string,
  issue: Issue,
  attempt: number | null,
  turnNumber: number = 1,
  maxTurns: number = 20,
): Promise<string> {
  // Convert issue to a plain object with string keys for template compat
  const issueObj: Record<string, unknown> = {
    id: issue.id,
    identifier: issue.identifier,
    title: issue.title,
    description: issue.description,
    priority: issue.priority,
    state: issue.state,
    branch_name: issue.branchName,
    url: issue.url,
    labels: issue.labels,
    blocked_by: issue.blockedBy.map((b) => ({
      id: b.id,
      identifier: b.identifier,
      state: b.state,
    })),
    created_at: issue.createdAt?.toISOString() ?? null,
    updated_at: issue.updatedAt?.toISOString() ?? null,
  };

  const context = {
    issue: issueObj,
    attempt,
    turn_number: turnNumber,
    max_turns: maxTurns,
  };

  try {
    return await engine.parseAndRender(template, context);
  } catch (err) {
    throw new Error(
      `Template render error: ${err instanceof Error ? err.message : String(err)}`,
    );
  }
}

/**
 * Build the prompt for a given turn.
 *
 * - First turn: full rendered task prompt
 * - Continuation turns: brief continuation guidance
 *   (spec says continuation turns send only continuation guidance,
 *    not the original task prompt already in thread history)
 */
export async function buildTurnPrompt(
  template: string,
  issue: Issue,
  attempt: number | null,
  turnNumber: number,
  maxTurns: number,
): Promise<string> {
  if (turnNumber === 1) {
    return renderPrompt(template, issue, attempt, turnNumber, maxTurns);
  }

  // Continuation turn: brief guidance
  return [
    `Continue working on ${issue.identifier}: ${issue.title}.`,
    `This is turn ${turnNumber} of ${maxTurns}.`,
    `The issue is currently in state "${issue.state}".`,
    attempt !== null ? `This is retry attempt ${attempt}.` : '',
    'Review your previous work and continue from where you left off.',
  ]
    .filter(Boolean)
    .join('\n');
}

/**
 * Default fallback prompt when the workflow body is empty.
 */
export const DEFAULT_PROMPT = 'You are working on an issue from Linear.';
