// ---------------------------------------------------------------------------
// Inject the learnings.md content into an agent prompt.
// ---------------------------------------------------------------------------

import { readLearnings } from './learnings';

/**
 * Build a preamble block to prepend to the agent's prompt. Returns empty
 * string when learnings are absent or repo brain is disabled.
 */
export async function buildLearningsPreamble(
  workspacePath: string,
  enabled: boolean,
  maxChars: number,
  publicPath = '.harmony/learnings.md',
  privatePath = '.harmony/learnings.private.md',
): Promise<string> {
  if (!enabled) return '';

  const pub = await readLearnings(workspacePath, publicPath);
  const priv = await readLearnings(workspacePath, privatePath);

  if (!pub.exists && !priv.exists) return '';

  const merged = [pub.contents, priv.contents].filter(Boolean).join('\n\n');
  const truncated =
    merged.length <= maxChars
      ? merged
      : merged.slice(0, maxChars) + `\n\n[... truncated ${merged.length - maxChars} chars]`;

  return [
    '## Repo brain — accumulated learnings',
    '',
    'Below are notes the team has built up across past tasks. Apply them when',
    'they are relevant; surface conflicts before deviating.',
    '',
    truncated,
    '',
    '---',
    '',
  ].join('\n');
}
