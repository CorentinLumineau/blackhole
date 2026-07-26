import * as fs from 'fs';
import * as path from 'path';
import { root, read, type CheckResult } from './check-utils.ts';
import { CONTENT_GATE_BUDGETS, type ContentGateBudget } from '../build.ts';

// ADR-007 T5/R2' — content-gates.check.ts: declared-budget section/file-size gate (split from
// the former catch-all check file, issue #322; generalized from a single hardcoded file to a
// declared `{file/glob -> {maxSectionLoc, maxFileLoc}}` map, issue #323, ADR-007 T6/R3′).

// Splits content into lines, dropping a trailing empty string produced by splitting content that
// ends in a newline, so the resulting line count matches `wc -l` exactly. Shared by
// parseSectionLineCounts and checkContentGate's whole-file LOC measurement (V-DRY-01).
const splitLines = (content: string): string[] => {
  const lines = content.split('\n');
  return lines.length && lines[lines.length - 1] === '' ? lines.slice(0, -1) : lines;
};

// V-CONTENTGATE-01 (ADR-007 T6/R3′): section-boundary parser, generalized (issue #323) to accept
// any boundary `RegExp` — defaults to the original `##`-level markdown heading pattern so every
// pre-existing call site and test is unaffected. Returns a header -> line-count map, where a
// section's line count spans from its boundary line up to (not including) the next boundary
// line, or EOF. Fence-awareness (lines inside ``` / ~~~ fences never count as a boundary) is
// preserved verbatim from the original markdown-only implementation.
export const parseSectionLineCounts = (
  content: string,
  boundaryPattern: RegExp = /^## /,
): Record<string, number> => {
  const lines = splitLines(content);

  const headerIdx: number[] = [];
  let inFence = false;
  lines.forEach((l, i) => {
    if (/^(```|~~~)/.test(l)) inFence = !inFence;
    if (!inFence && boundaryPattern.test(l)) headerIdx.push(i);
  });

  const sections: Record<string, number> = {};
  for (let k = 0; k < headerIdx.length; k++) {
    const start = headerIdx[k];
    const end = k + 1 < headerIdx.length ? headerIdx[k + 1] : lines.length;
    sections[lines[start]] = end - start;
  }
  return sections;
};

// Second boundary pattern (issue #323): every current `scripts/checks/*.check.ts` check function
// is declared in this exact style — `const check<Name> = (): CheckResult => {` or `(): CheckResult[]
// => {` — verified by grep against all 32 current check functions with zero exceptions. Widen
// (documented, tested) rather than silently skip a function that drifts from this convention.
export const CHECK_TS_SECTION_PATTERN = /^const check\w+\s*=\s*\(\):\s*CheckResult(\[\])?\s*=>\s*\{/;
const MARKDOWN_SECTION_PATTERN = /^## /;

const boundaryPatternFor = (target: string): RegExp =>
  target.endsWith('.check.ts') ? CHECK_TS_SECTION_PATTERN : MARKDOWN_SECTION_PATTERN;

// Resolves a CONTENT_GATE_BUDGETS key to the concrete file(s) it covers. A literal path (no `*`)
// resolves to itself. A pattern containing `*` is a glob *class* — e.g. `scripts/checks/*.check.ts`
// — resolved by listing its directory (`fs.readdirSync`, the existing directory-listing
// convention already used elsewhere in build.ts) filtered to entries matching the suffix after
// the `*`, sorted for determinism. Only a single trailing-`*` suffix match is needed (no nested
// wildcards), so this deliberately does not pull in a glob dependency (V-INT-02, V-YAGNI-01).
export const resolveContentGateTargets = (pattern: string): string[] => {
  if (!pattern.includes('*')) return [pattern];

  const dir = path.dirname(pattern);
  const suffix = path.basename(pattern).replace('*', '');
  return fs
    .readdirSync(path.join(root, dir))
    .filter((f) => f.endsWith(suffix))
    .map((f) => path.join(dir, f))
    .sort();
};

// Collects violations for one target file against its budget: any section exceeding
// `maxSectionLoc`, and/or the whole file exceeding `maxFileLoc`. Each violation names the
// target, the section header (or "whole file"), the measured LOC, and the configured limit.
export const findContentGateViolations = (
  target: string,
  sections: Record<string, number>,
  totalLoc: number,
  budget: ContentGateBudget,
): string[] => {
  const errors: string[] = [];
  for (const [header, loc] of Object.entries(sections)) {
    if (loc > budget.maxSectionLoc) {
      errors.push(`${target} — ${header}: ${loc} LOC, exceeds ${budget.maxSectionLoc}-LOC section budget`);
    }
  }
  if (totalLoc > budget.maxFileLoc) {
    errors.push(`${target} — whole file: ${totalLoc} LOC, exceeds ${budget.maxFileLoc}-LOC file budget`);
  }
  return errors;
};

const checkContentGate = (): CheckResult => {
  const errors: string[] = [];

  for (const [pattern, budget] of Object.entries(CONTENT_GATE_BUDGETS)) {
    for (const target of resolveContentGateTargets(pattern)) {
      const content = read(target);
      const sections = parseSectionLineCounts(content, boundaryPatternFor(target));
      const totalLoc = splitLines(content).length;
      errors.push(...findContentGateViolations(target, sections, totalLoc, budget));
    }
  }

  if (errors.length) return { id: 'V-CONTENTGATE-01', ok: false, detail: errors.join('; ') };
  return { id: 'V-CONTENTGATE-01', ok: true };
};

// ADR-007 T5/R2': domain entrypoint — see agents.check.ts's runChecks doc comment for the shared
// contract (pure, no side effects, glob-discovered by scripts/verify.ts).
export const runChecks = (): CheckResult[] => [checkContentGate()];
