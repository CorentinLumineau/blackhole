import { read, type CheckResult } from './check-utils.ts';
import { COMMITTED_TARGET_TREES, type CommittedTargetTree } from '../lib/build/paths.ts';

// V-TREE-01 (WARN, advisory — always ok: true, same shape as V-DOCHEALTH-01..03): diffs
// paths.ts's COMMITTED_TARGET_TREES against documentation/architecture.md § Committed target
// trees and README.md § Installation Paths, naming any tree missing from either doc. This is
// the check that would have caught the R-03 bug (stale architecture.md table, unmentioned
// plugins/blackhole-claude/ row) before it shipped.

/** Slices `content` to the lines between the first `## ` heading containing `headingSubstring`
 * and the next `## ` heading (or EOF). Matches a heading even with a leading emoji, since the
 * substring check does not anchor to the start of the heading text. */
export const extractMarkdownSection = (content: string, headingSubstring: string): string => {
  const lines = content.split('\n');
  const startIdx = lines.findIndex((l) => /^##\s/.test(l) && l.includes(headingSubstring));
  if (startIdx === -1) return '';

  let endIdx = lines.length;
  for (let i = startIdx + 1; i < lines.length; i++) {
    if (/^##\s/.test(lines[i])) {
      endIdx = i;
      break;
    }
  }
  return lines.slice(startIdx + 1, endIdx).join('\n');
};

/** Per entry in `trees` (skipping any whose `id` is in `exclude`): when `requireAll`, every path
 * (trailing `/` stripped) must appear as a substring of `sectionText`; otherwise at least one
 * must. Returns the ids of entries that fail their condition. */
export const findMissingTrees = (
  sectionText: string,
  trees: CommittedTargetTree[],
  { requireAll, exclude = [] }: { requireAll: boolean; exclude?: string[] }
): string[] => {
  const excluded = new Set(exclude);
  const missing: string[] = [];

  for (const entry of trees) {
    if (excluded.has(entry.id)) continue;
    const present = entry.paths.map((p) => (p.endsWith('/') ? p.slice(0, -1) : p)).map((p) => sectionText.includes(p));
    const ok = requireAll ? present.every(Boolean) : present.some(Boolean);
    if (!ok) missing.push(entry.id);
  }

  return missing;
};

export const checkTreeRegistry = (): CheckResult => {
  const archSection = extractMarkdownSection(read('documentation/architecture.md'), 'Committed target trees');
  const readmeSection = extractMarkdownSection(read('README.md'), 'Installation Paths');

  const missingArch = findMissingTrees(archSection, COMMITTED_TARGET_TREES, { requireAll: true });
  const missingReadme = findMissingTrees(readmeSection, COMMITTED_TARGET_TREES, {
    requireAll: false,
    exclude: ['claude-native'],
  });

  if (!missingArch.length && !missingReadme.length) return { id: 'V-TREE-01', ok: true };

  const parts: string[] = [];
  if (missingArch.length) parts.push(`architecture.md missing: ${missingArch.join(', ')}`);
  if (missingReadme.length) parts.push(`README.md missing: ${missingReadme.join(', ')}`);

  return { id: 'V-TREE-01', ok: true, detail: parts.join('; ') };
};

export const runChecks = (): CheckResult[] => [checkTreeRegistry()];
