// ---------------------------------------------------------------------------
// Read / write the `.harmony/learnings.md` file in a repo workspace.
// ---------------------------------------------------------------------------
//
// Format:
//
//   # Harmony Learnings (auto-maintained)
//
//   ## Conventions
//   - bullet
//
//   ## Path-specific
//   ### glob
//   - bullet
//
//   ## Past mistakes
//   - bullet
//
// Human edits to bullets/sections are preserved; the updater never overwrites
// existing content — it only appends bullets to known sections.
// ---------------------------------------------------------------------------

import * as fs from 'fs/promises';
import * as path from 'path';
import type { LearningsAddition } from './types';

const HEADER = '# Harmony Learnings (auto-maintained)';
const DEFAULT_SECTIONS = ['Conventions', 'Path-specific', 'Past mistakes'];

export interface LoadedLearnings {
  exists: boolean;
  contents: string;
}

export async function readLearnings(
  workspacePath: string,
  relativePath = '.harmony/learnings.md',
): Promise<LoadedLearnings> {
  const full = path.join(workspacePath, relativePath);
  try {
    const contents = await fs.readFile(full, 'utf-8');
    return { exists: true, contents };
  } catch {
    return { exists: false, contents: '' };
  }
}

export async function ensureLearningsExist(
  workspacePath: string,
  relativePath = '.harmony/learnings.md',
): Promise<void> {
  const full = path.join(workspacePath, relativePath);
  try {
    await fs.stat(full);
    return;
  } catch {
    // not present — create skeleton
  }
  await fs.mkdir(path.dirname(full), { recursive: true });
  const skeleton = [
    HEADER,
    '',
    '_This file is maintained by Harmony. Human edits are preserved._',
    '',
    ...DEFAULT_SECTIONS.flatMap((s) => [`## ${s}`, '']),
  ].join('\n');
  await fs.writeFile(full, skeleton, 'utf-8');
}

/**
 * Append additions to the learnings file. Pure file mutation — preserves all
 * existing bullets and headings. Adds new sections at the end if needed.
 */
export async function appendAdditions(
  workspacePath: string,
  additions: LearningsAddition[],
  relativePath = '.harmony/learnings.md',
): Promise<void> {
  if (additions.length === 0) return;
  await ensureLearningsExist(workspacePath, relativePath);

  const full = path.join(workspacePath, relativePath);
  const original = await fs.readFile(full, 'utf-8');
  let updated = original;

  // Group by section + subsection
  const grouped = new Map<string, Map<string | null, string[]>>();
  for (const a of additions) {
    if (!grouped.has(a.section)) grouped.set(a.section, new Map());
    const sec = grouped.get(a.section)!;
    const key = a.subsection ?? null;
    if (!sec.has(key)) sec.set(key, []);
    sec.get(key)!.push(a.body);
  }

  for (const [section, subsections] of grouped) {
    for (const [subsection, bullets] of subsections) {
      updated = appendBulletsTo(updated, section, subsection, bullets);
    }
  }

  if (updated !== original) {
    await fs.writeFile(full, updated, 'utf-8');
  }
}

function appendBulletsTo(
  content: string,
  section: string,
  subsection: string | null,
  bullets: string[],
): string {
  const sectionHeading = `## ${section}`;
  const subHeading = subsection ? `### ${subsection}` : null;

  const sectionIdx = content.indexOf(sectionHeading);
  if (sectionIdx < 0) {
    // Append section to the end
    const block = [
      '',
      sectionHeading,
      '',
      ...(subHeading ? [subHeading, ''] : []),
      ...bullets.map((b) => `- ${b}`),
      '',
    ].join('\n');
    return content.trimEnd() + block;
  }

  // Find end of the section (next H2 or EOF)
  const after = content.slice(sectionIdx + sectionHeading.length);
  const nextH2 = after.search(/\n## [^#]/);
  const sectionEnd =
    nextH2 < 0 ? content.length : sectionIdx + sectionHeading.length + nextH2;

  // Find or create subsection within this section's slice
  if (!subHeading) {
    const insertion = bullets.map((b) => `- ${b}`).join('\n') + '\n';
    return content.slice(0, sectionEnd).trimEnd() + '\n' + insertion + content.slice(sectionEnd);
  }

  const sectionSlice = content.slice(sectionIdx, sectionEnd);
  const subIdx = sectionSlice.indexOf(subHeading);
  if (subIdx < 0) {
    // Append subsection at the end of the section
    const block = ['', subHeading, '', ...bullets.map((b) => `- ${b}`), ''].join('\n');
    return content.slice(0, sectionEnd).trimEnd() + block + content.slice(sectionEnd);
  }

  // Append bullets at the end of the subsection
  const subAbsoluteIdx = sectionIdx + subIdx;
  const afterSub = content.slice(subAbsoluteIdx + subHeading.length);
  const nextHeading = afterSub.search(/\n##? [^#]/);
  const subEnd =
    nextHeading < 0
      ? content.length
      : subAbsoluteIdx + subHeading.length + nextHeading;
  const insertion = bullets.map((b) => `- ${b}`).join('\n') + '\n';
  return content.slice(0, subEnd).trimEnd() + '\n' + insertion + content.slice(subEnd);
}
