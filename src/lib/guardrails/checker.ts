// ---------------------------------------------------------------------------
// Guardrail Enforcement Checks
// ---------------------------------------------------------------------------
//
// These are pure functions invoked by the orchestrator between agent turns
// (max files / max diff lines / max cost) and at PR-open time (label rules).
// blocked_paths is enforced at the filesystem level via a pre-commit hook
// installed in the workspace — see precommit.ts.
// ---------------------------------------------------------------------------

import { execInWorkspace } from '../executor/hooks';
import type { Guardrails, GuardrailBreach } from './types';

/**
 * Convert a glob pattern to a RegExp for matching file paths.
 * Supports `*`, `**`, and literal `?`. Used for blocked_paths and
 * require_label_for_paths in label/PR-time enforcement.
 */
export function globToRegex(glob: string): RegExp {
  let re = '';
  for (let i = 0; i < glob.length; i++) {
    const ch = glob[i];
    if (ch === '*') {
      if (glob[i + 1] === '*') {
        re += '.*';
        i++;
        if (glob[i + 1] === '/') i++;
      } else {
        re += '[^/]*';
      }
    } else if (ch === '?') {
      re += '[^/]';
    } else if ('.+^$(){}[]|\\'.includes(ch)) {
      re += '\\' + ch;
    } else {
      re += ch;
    }
  }
  return new RegExp('^' + re + '$');
}

/**
 * Mark untracked files as intent-to-add so they appear in `git diff` as
 * new files. The agent is instructed not to commit, so its work shows up
 * as a mix of working-tree edits and untracked files. The orchestrator's
 * own `git add -A` at commit time still picks everything up.
 */
async function markUntrackedIntentToAdd(workspacePath: string): Promise<void> {
  try {
    await execInWorkspace('git add -N .', workspacePath, 10_000);
  } catch {
    // best-effort
  }
}

/** Get list of changed files vs. main as `path\n` lines. Returns empty on git failure. */
async function getChangedFiles(workspacePath: string): Promise<string[]> {
  try {
    await markUntrackedIntentToAdd(workspacePath);
    const r = await execInWorkspace(
      'git diff --name-only origin/main',
      workspacePath,
      10_000,
    );
    if (r.exitCode !== 0) {
      // Fallback: working-tree changes only
      const w = await execInWorkspace('git diff --name-only HEAD', workspacePath, 10_000);
      return w.stdout.trim().split('\n').filter(Boolean);
    }
    return r.stdout.trim().split('\n').filter(Boolean);
  } catch {
    return [];
  }
}

/** Get total added+removed line count. Best-effort. */
async function getDiffLineCount(workspacePath: string): Promise<number> {
  try {
    await markUntrackedIntentToAdd(workspacePath);
    const r = await execInWorkspace(
      'git diff --shortstat origin/main',
      workspacePath,
      10_000,
    );
    const out = r.exitCode === 0 ? r.stdout : (await execInWorkspace('git diff --shortstat HEAD', workspacePath, 10_000)).stdout;
    const m = out.match(/(\d+)\s+insertion[^,]*,?\s*(\d+)?\s*deletion?/);
    if (!m) return 0;
    return parseInt(m[1] ?? '0', 10) + parseInt(m[2] ?? '0', 10);
  } catch {
    return 0;
  }
}

export interface DiffStats {
  filesChanged: number;
  diffLines: number;
  changedFiles: string[];
}

export async function readWorkspaceDiffStats(workspacePath: string): Promise<DiffStats> {
  const files = await getChangedFiles(workspacePath);
  const lines = await getDiffLineCount(workspacePath);
  return { filesChanged: files.length, diffLines: lines, changedFiles: files };
}

/**
 * Check size guardrails (files, diff lines) against current workspace state.
 * Cost is checked separately because the orchestrator already tracks it.
 */
export function checkSizeGuardrails(
  guardrails: Guardrails,
  stats: DiffStats,
): GuardrailBreach | null {
  if (stats.filesChanged > guardrails.maxFilesChanged) {
    return {
      type: 'files',
      detail: `${stats.filesChanged} files changed (limit ${guardrails.maxFilesChanged})`,
      observedValue: stats.filesChanged,
      limit: guardrails.maxFilesChanged,
    };
  }
  if (stats.diffLines > guardrails.maxDiffLines) {
    return {
      type: 'diff',
      detail: `${stats.diffLines} diff lines (limit ${guardrails.maxDiffLines})`,
      observedValue: stats.diffLines,
      limit: guardrails.maxDiffLines,
    };
  }
  return null;
}

export function checkCostGuardrail(
  guardrails: Guardrails,
  costUsd: number,
): GuardrailBreach | null {
  if (costUsd > guardrails.maxCostUsd) {
    return {
      type: 'cost',
      detail: `cost $${costUsd.toFixed(2)} exceeds budget $${guardrails.maxCostUsd.toFixed(2)}`,
      observedValue: Number(costUsd.toFixed(4)),
      limit: guardrails.maxCostUsd,
    };
  }
  return null;
}

/**
 * Check whether any changed file matches a blocked path glob. Used as a
 * defensive double-check at PR-open time; the primary enforcement is the
 * pre-commit hook installed in the workspace.
 */
export function checkBlockedPaths(
  guardrails: Guardrails,
  changedFiles: string[],
): GuardrailBreach | null {
  for (const glob of guardrails.blockedPaths) {
    const re = globToRegex(glob);
    const offender = changedFiles.find((f) => re.test(f));
    if (offender) {
      return {
        type: 'path',
        detail: `'${offender}' matches blocked path '${glob}'`,
        observedValue: offender,
        limit: glob,
      };
    }
  }
  return null;
}

/**
 * Check the require_label_for_paths rules. Returns a breach if any rule's
 * glob matches at least one changed file but the required label is missing.
 */
export function checkRequiredLabels(
  guardrails: Guardrails,
  changedFiles: string[],
  ticketLabels: string[],
): GuardrailBreach | null {
  const lower = ticketLabels.map((l) => l.toLowerCase());
  for (const [glob, label] of Object.entries(guardrails.requireLabelForPaths)) {
    const re = globToRegex(glob);
    const matched = changedFiles.some((f) => re.test(f));
    if (matched && !lower.includes(label.toLowerCase())) {
      return {
        type: 'label',
        detail: `changes match '${glob}' but ticket lacks required label '${label}'`,
        observedValue: glob,
        limit: label,
      };
    }
  }
  return null;
}
