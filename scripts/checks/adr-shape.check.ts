import * as fs from 'fs';
import * as path from 'path';
import { ADR_SHAPES, type AdrShapes } from '../lib/build/facts.ts';
import { root, type CheckResult } from './check-utils.ts';

// Issue #711 — V-ADR-08: advisory ADR heading-shape conformance. New domain file (not folded
// into adr-status.check.ts, which sits at its own 218-LOC glob budget ceiling with no headroom
// left) that classifies every tracked ADR against `ADR_SHAPES` (facts.ts). Advisory, `ok: true`
// always: the corpus predates both shapes — most existing ADRs match neither exactly (see
// `.blackhole/plans/issue-711.md` Execution Strategy item 6) — so a blocking version would fail
// `bun run verify` for the bulk of the pre-existing tree with no code change of their own.
//
// Advisory **by decision, not by omission** (issue #741): raising it to blocking needs either a
// frozen grandfather allowlist — the `V-CONTENTGATE-03` precedent (issue #722) has not landed,
// so building one here would stand up a second, parallel exemption mechanism (V-INT-04) — or a
// backfill of the ~23 non-conforming ADRs, which is a separate initiative. Revisit once #722
// lands; until then do not "fix" this into `ok: false`.

const decisionsDir = path.join(root, 'documentation', 'decisions');

export type AdrShapeName = keyof AdrShapes;

// Reuses design-track.check.ts's `content.includes(heading)` verbatim-substring idiom (V-INT-02)
// — no second markdown-heading-matching mechanism.
export const extractAdrHeadings = (content: string): string[] => (content.match(/^## .+$/gm) ?? []).map((h) => h.trimEnd());

// A shape matches when every one of its required headings is present verbatim — extra headings
// are allowed. designTrack is checked first: its 8 headings never overlap classic's 5, so a
// hybrid file satisfying both would be the rarer, more-specific case.
export const classifyAdrShape = (headings: string[]): AdrShapeName | null => {
  if (ADR_SHAPES.designTrack.every((h) => headings.includes(h))) return 'designTrack';
  if (ADR_SHAPES.classic.every((h) => headings.includes(h))) return 'classic';
  return null;
};

export type MalformedAdrShape = { filename: string; closest: AdrShapeName; missing: string[] };

// For a file matching neither shape, "closest" is whichever shape has fewer missing headings
// (ties favor classic — the older, narrower skeleton).
export const findMalformedAdrShapes = (files: { filename: string; headings: string[] }[]): MalformedAdrShape[] =>
  files
    .map((f) => {
      if (classifyAdrShape(f.headings)) return null;
      const missingClassic = ADR_SHAPES.classic.filter((h) => !f.headings.includes(h));
      const missingDesignTrack = ADR_SHAPES.designTrack.filter((h) => !f.headings.includes(h));
      const closest: AdrShapeName = missingClassic.length <= missingDesignTrack.length ? 'classic' : 'designTrack';
      return { filename: f.filename, closest, missing: closest === 'classic' ? missingClassic : missingDesignTrack };
    })
    .filter((x): x is MalformedAdrShape => x !== null);

const checkAdrShapeConformance = (): CheckResult => {
  const files = fs
    .readdirSync(decisionsDir)
    .filter((f) => /^ADR-\d+-.*\.md$/.test(f))
    .sort()
    .map((filename) => ({
      filename,
      headings: extractAdrHeadings(fs.readFileSync(path.join(decisionsDir, filename), 'utf-8')),
    }));
  const malformed = findMalformedAdrShapes(files);
  if (malformed.length) {
    const detail = malformed.map((m) => `${m.filename} (closest: ${m.closest}, missing: ${m.missing.join(', ')})`).join('; ');
    return { id: 'V-ADR-08', ok: true, detail: `non-conforming ADR heading shape (advisory): ${detail}` };
  }
  return { id: 'V-ADR-08', ok: true };
};

// ADR-007 T5/R2': domain entrypoint — see adr-status.check.ts's runChecks doc comment for the
// shared contract (pure, no side effects, glob-discovered by scripts/verify.ts).
export const runChecks = (): CheckResult[] => [checkAdrShapeConformance()];
