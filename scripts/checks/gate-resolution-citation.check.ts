import { read, type CheckResult } from './check-utils.ts';
import { walkMdFiles } from '../lib/check-common.ts';

// Issue #723 — config-template.md's gate-resolution clause ("absent block, absent field, or
// explicit `false`") was copy-pasted verbatim at 9 call sites across 6 files instead of being
// cited by reference, and one copy (reviewer.md § Staged Artifact Carry Audit) already silently
// drifted (dropped its
// `, issue #477` suffix). This scans src/ for the duplicated clause pattern outside its one
// canonical home (config-template.md) so a tenth copy fails by name instead of drifting again.

const RESOLUTION_CLAUSE_PATTERN = /absent\s+(?:`[^`]+`\s+)?block,\s*absent\s+(?:`[^`]+`\s+)?field,\s*or\s+explicit/gi;

const EXEMPT_FILE = 'src/references/config-template.md';

export const findDuplicatedResolutionClauses = (
  files: Record<string, string>,
): { file: string; line: number }[] => {
  const hits: { file: string; line: number }[] = [];
  for (const [file, content] of Object.entries(files)) {
    if (file === EXEMPT_FILE) continue;
    const pattern = new RegExp(RESOLUTION_CLAUSE_PATTERN.source, RESOLUTION_CLAUSE_PATTERN.flags);
    let match: RegExpExecArray | null;
    while ((match = pattern.exec(content)) !== null) {
      const line = content.slice(0, match.index).split('\n').length;
      hits.push({ file, line });
    }
  }
  return hits;
};

export const checkGateResolutionCitation = (
  files: Record<string, string> = Object.fromEntries(walkMdFiles('src').map((f) => [f, read(f)])),
): CheckResult => {
  const hits = findDuplicatedResolutionClauses(files);
  if (hits.length === 0) return { id: 'V-GATE-02', ok: true };
  return { id: 'V-GATE-02', ok: false, detail: hits.map((h) => `${h.file}:${h.line}`).join('; ') };
};

// ADR-007 T5/R2': domain entrypoint — see agents.check.ts's runChecks doc comment for the shared
// contract (pure, no side effects, glob-discovered by scripts/verify.ts).
export const runChecks = (): CheckResult[] => [checkGateResolutionCitation()];
