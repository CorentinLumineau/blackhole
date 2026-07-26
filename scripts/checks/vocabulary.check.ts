import * as fs from 'fs';
import * as path from 'path';
import { QUEUE_STATUSES, QUEUE_NOTES, HUNT_KINDS, PLATFORM_TARGETS } from '../build.ts';
import { walkFilesAbs } from '../lib/fs.ts';

// Issue #320 — V-VOCAB-01: generalized, registry-driven extension of ADR-007 R1′'s two-sided
// facts-conformance mechanism to closed *value vocabularies* (enum-shaped strings agent prose
// restates verbatim at many sites), not just the structural facts V-GROUND-01 already covers.
// Never generated from the scan (ADR-007 Rejected Alternatives): each VocabSpec pairs a
// hand-authored `declared` array (build.ts § facts) with an independent `scan()` derivation —
// the two are authored and reasoned about separately, and only the comparison step is shared.
//
// NOTE: an ADR-status vocabulary was deliberately dropped from this registry during review
// (fix round 1, PR #339) — issue #324 (PR #338) already owns that concern with a purpose-built
// `adr-status.check.ts` (three checks cross-validating frontmatter, INDEX row, and the in-body
// `## Status` section against `accepted | superseded | deprecated`, the *designed* convention).
// This plan's `ADR_STATUSES` was only ever a permissive superset descriptive of the pre-#324
// corpus (`proposed`/`accepted`/`superseded`/`current`); keeping both would have been a
// V-INT-03 "third variant of a solved concern" — a value like `deprecated`, which #324
// legitimizes, would pass `adr-status.check.ts` and fail this check. Removed.
//
// KNOWN BLIND SPOTS (documented per review, not fixed — precision-over-recall v1; see each
// extractor's own comment for the specific narrowing rationale):
//   - queue status: invisible unless the literal token `phase` co-occurs on the same line,
//     regardless of markup — misses table cells, bullets without `phase`, and bare backtick
//     prose (`` `status: blocked` `` with no `phase` nearby)
//   - queue notes: only catches drift *within* the `awaiting-*` family — a genuinely new
//     gate-value class with a different prefix is invisible
//   - kaizen kinds: only the `"kinds": [...]` JSON-array form; the prose "e.g. `x`, `y`" form
//     is deliberately excluded (see extractHuntKinds)
//   - platform targets: only an array literal containing the quoted `'cursor'` anchor; a
//     partial array without that anchor, or a target restated via `if`/`switch` comparison
//     chains, is invisible
// Each gap is a documented engineering decision, not a silent trap — a future vocabulary or
// extractor revision should widen these deliberately, with the same false-positive calibration
// discipline used to narrow them in the first place (see PR #339 for the calibration evidence).

export type CheckResult = { id: string; ok: boolean; detail?: string };

const root = path.resolve(import.meta.dirname, '..', '..');
const srcDir = path.join(root, 'src');
const scriptsDir = path.join(root, 'scripts');

// Same two-sided reporting shape as findRosterScanMismatch/findRowCountMismatch
// (scripts/checks/ground-truth.check.ts) — never a boolean, always names the offending values so
// CI prints the precise fix. Only the "extra" direction (scanned-but-undeclared) is meaningful
// here: a vocabulary's declared set may legitimately include values that happen not to be
// scanned in the current repo snapshot (e.g. a value only used in a non-scanned prose form).
export const findVocabMismatch = (
  scanned: string[],
  declared: readonly string[],
  caseInsensitive = false,
): string | null => {
  const norm = (v: string) => (caseInsensitive ? v.toLowerCase() : v);
  const declaredSet = new Set(declared.map(norm));
  const extra = [...new Set(scanned.map(norm))].filter((v) => !declaredSet.has(v)).sort();
  if (extra.length === 0) return null;
  return `undeclared value(s) [${extra.join(', ')}]`;
};

// --- queue.json `status` (V-VOCAB-01) ---
// Scoped to lines mentioning both `phase` and `status:` — the queue.json schema always co-declares
// these two scheduling fields together (`phase: handle, status: blocked`), which disambiguates it
// from the differently-shaped worker-JSON `status` vocabulary (`ready`/`blocked`/`error`/
// `complete`) that shares the same field name but appears without a nearby `phase` mention.
export const extractQueueStatuses = (content: string): string[] => {
  const out: string[] = [];
  for (const line of content.split('\n')) {
    if (!/\bphase\b/i.test(line) || !/\bstatus\s*:/i.test(line)) continue;
    const re = /status\s*:\s*[`"]*([a-z][a-z-]*)/gi;
    let m: RegExpExecArray | null;
    while ((m = re.exec(line))) out.push(m[1].toLowerCase());
  }
  return out;
};

// --- queue.json `notes`' closed awaiting-* gate-value subset (V-VOCAB-01) ---
// Targets only `notes: <awaiting-kebab-token>` — `notes` also carries open, parameterized text
// (`overlap with #N`, `merge-order cycle with #N`) that a closed-set membership check would
// false-positive on; the `awaiting-[a-z-]+` anchor naturally excludes anything containing `#`,
// digits, or spaces (exactly ADR-012 Finding 3b's class of value, and nothing else).
export const extractQueueNotes = (content: string): string[] => {
  const out: string[] = [];
  const re = /notes\s*:\s*[`"]*\s*(awaiting-[a-z-]+)/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(content))) out.push(m[1]);
  return out;
};

// --- `kaizen.kinds` (V-VOCAB-01) ---
// Targets the JSON-array restatement (`"kinds": [...]`, config-template.md's default) only —
// prose "e.g." asides (`kaizen.kinds` (e.g. `quickwins`, `bug`)) sit alongside unrelated
// backtick-quoted words later in the same long sentence with no reliable stopping point, and a
// generic scan there produced false positives (`exhausted`, `true`, `waves`) in practice.
export const extractHuntKinds = (content: string): string[] => {
  const out: string[] = [];
  const arrRe = /"kinds"\s*:\s*\[([^\]]*)\]/g;
  let m: RegExpExecArray | null;
  while ((m = arrRe.exec(content))) {
    const tokRe = /"([a-z][a-z-]*)"/g;
    let t: RegExpExecArray | null;
    while ((t = tokRe.exec(m[1]))) out.push(t[1]);
  }
  return out;
};

// --- platform build targets (V-VOCAB-01) ---
// Any array literal containing the quoted anchor `'cursor'` is treated as a restatement of the
// full target-name list (today, that's PLATFORM_TARGETS' own declaration in build.ts, post the
// `type Target` DRY collapse — this scan guards against a *future* stray re-hardcoded copy).
export const extractPlatformTargets = (content: string): string[] => {
  const out: string[] = [];
  const arrRe = /\[([^\]]*)\]/g;
  let m: RegExpExecArray | null;
  while ((m = arrRe.exec(content))) {
    const toks: string[] = [];
    const tokRe = /['"]([a-z][a-z-]*)['"]/g;
    let t: RegExpExecArray | null;
    while ((t = tokRe.exec(m[1]))) toks.push(t[1]);
    if (toks.includes('cursor')) out.push(...toks);
  }
  return out;
};

const readAll = (absPath: string) => fs.readFileSync(absPath, 'utf-8');

const scanSrcMd = (extractor: (content: string) => string[]): string[] =>
  walkFilesAbs(srcDir)
    .filter((f) => f.endsWith('.md'))
    .flatMap((f) => extractor(readAll(f)));

// Excludes `*.test.ts`: unit-test fixtures (including this domain's own
// verify.vocabulary.test.ts) legitimately contain synthetic array literals anchored by 'cursor'
// for extractPlatformTargets' own test coverage — those are not real declarations to check.
const scanScriptsTs = (extractor: (content: string) => string[]): string[] =>
  walkFilesAbs(scriptsDir)
    .filter((f) => f.endsWith('.ts') && !f.endsWith('.test.ts'))
    .flatMap((f) => extractor(readAll(f)));

export type VocabSpec = {
  name: string;
  declared: readonly string[];
  scan: () => string[];
  caseInsensitive?: boolean;
};

// Registry-driven (Codebase Conventions design decision 1, issue #320): adding a 6th vocabulary
// is a 1-entry addition here, never a new inline sub-check block — the same OCP property
// ADR-007's Design Principles claim for § facts generally. (4 entries — ADR status was removed
// in fix round 1; see the NOTE above.)
export const VOCAB_REGISTRY: VocabSpec[] = [
  { name: 'queue status', declared: QUEUE_STATUSES, scan: () => scanSrcMd(extractQueueStatuses) },
  { name: 'queue notes', declared: QUEUE_NOTES, scan: () => scanSrcMd(extractQueueNotes) },
  { name: 'kaizen kinds', declared: HUNT_KINDS, scan: () => scanSrcMd(extractHuntKinds) },
  { name: 'platform targets', declared: PLATFORM_TARGETS, scan: () => scanScriptsTs(extractPlatformTargets) },
];

const checkVocabulary = (): CheckResult => {
  const errors: string[] = [];
  for (const spec of VOCAB_REGISTRY) {
    const mismatch = findVocabMismatch(spec.scan(), spec.declared, spec.caseInsensitive);
    if (mismatch) errors.push(`${spec.name}: ${mismatch}`);
  }
  if (errors.length) return { id: 'V-VOCAB-01', ok: false, detail: errors.join('; ') };
  return { id: 'V-VOCAB-01', ok: true };
};

// ADR-007 T5/R2': domain entrypoint — see agents.check.ts's runChecks doc comment for the shared
// contract (pure, no side effects, glob-discovered by scripts/verify.ts).
export const runChecks = (): CheckResult[] => [checkVocabulary()];
