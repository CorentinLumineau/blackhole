import * as fs from 'fs';
import * as path from 'path';
import { root, read, type CheckResult } from './check-utils.ts';
import { CONTENT_GATE_BOUNDARY_UNITS, CONTENT_GATE_BUDGETS, CONTENT_GATE_GRANDFATHERED, CONTENT_GATE_WARN_RATIO } from '../lib/build/facts.ts';
import type { ContentGateBudget, ContentGateGrandfather } from '../lib/build/facts.ts';

// ADR-007 T5/R2' — content-gates.check.ts: declared-budget section/file-size gate (split from
// the former catch-all check file, issue #322; generalized from a single hardcoded file to a
// declared `{file/glob -> {maxSectionLoc, maxFileLoc}}` map, issue #323, ADR-007 T6/R3′).

export const DECISION_INDEX = 'documentation/decisions/INDEX.md';

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

// Second boundary pattern: anchors on the one invariant every `scripts/checks/*.check.ts` check
// function declaration actually shares — a top-level `check<Name>` const assigned via `(`,
// optionally `export`ed — without also requiring the closing `): CheckResult => {` signature shape
// on the same line. That stronger requirement silently detected zero sections for any declaration
// whose signature wraps or that is expression-bodied (no trailing `{`), leaving the file's
// per-section budget unenforced instead of failing loud (issue #562, generalizing #554).
export const CHECK_TS_SECTION_PATTERN = /^(export )?const check\w+\s*=\s*\(/;

// A `.check.ts` target with zero detected sections has nothing for its section-LOC budget to
// measure — `findContentGateViolations` reports no error even though the file's check functions
// are completely unenforced. Scoped to `.check.ts` targets only: `scripts/lib/build/*.ts` is
// legitimately section-less under the markdown boundary pattern (no `##` headers in TS) and must
// not false-positive (issue #562).
export const checkZeroSections = (target: string, sections: Record<string, number>): string | null =>
  target.endsWith('.check.ts') && Object.keys(sections).length === 0
    ? `${target} — zero check-function sections detected; CHECK_TS_SECTION_PATTERN matched nothing, so its section-LOC budget is silently unenforced`
    : null;

const MARKDOWN_SECTION_PATTERN = /^## /;

// The `###` unit declared per file in `CONTENT_GATE_BOUNDARY_UNITS`: matching `##` as well as
// `###` is what makes `###` a *unit* rather than a second, overlapping outline — a `###` section
// must end at the next heading of either level, or it runs through the following `##` and reports
// a span longer than the `##` measurement it was meant to refine.
export const H3_SECTION_PATTERN = /^#{2,3} /;

export const boundaryPatternFor = (target: string): RegExp =>
  target.endsWith('.check.ts')
    ? CHECK_TS_SECTION_PATTERN
    : CONTENT_GATE_BOUNDARY_UNITS[target] === '###'
      ? H3_SECTION_PATTERN
      : MARKDOWN_SECTION_PATTERN;

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

const checkContentGate = (): CheckResult[] => {
  const errors: string[] = [];
  const warnings: string[] = [];
  const classBudgets = new Map<string, ContentGateBudget>();
  const grandfathered = new Map(CONTENT_GATE_GRANDFATHERED.map((g) => [g.file, g.ceiling]));

  for (const [pattern, classBudget] of Object.entries(CONTENT_GATE_BUDGETS)) {
    for (const target of resolveContentGateTargets(pattern)) {
      classBudgets.set(target, classBudget);
      const budget = grandfathered.get(target) ?? classBudget;
      const content = read(target);
      const sections = parseSectionLineCounts(content, boundaryPatternFor(target));
      const totalLoc = splitLines(content).length;
      const zeroSectionsViolation = checkZeroSections(target, sections);
      if (zeroSectionsViolation) errors.push(zeroSectionsViolation);
      errors.push(...findContentGateViolations(target, sections, totalLoc, budget));
      warnings.push(...findContentGateWarnings(target, sections, totalLoc, budget, CONTENT_GATE_WARN_RATIO));
    }
  }

  const hard: CheckResult = errors.length
    ? { id: 'V-CONTENTGATE-01', ok: false, detail: errors.join('; ') }
    : { id: 'V-CONTENTGATE-01', ok: true };
  const warn: CheckResult = { id: 'V-CONTENTGATE-02', ok: true, ...(warnings.length ? { detail: warnings.join('; ') } : {}) };

  return [hard, warn, checkGrandfatherExceptions(classBudgets)];
};

const checkGrandfatherExceptions = (classBudgets: Map<string, ContentGateBudget>): CheckResult => {
  const uncited = findUncitedGrandfatherAdrs(CONTENT_GATE_GRANDFATHERED, classBudgets, read(DECISION_INDEX));
  return { id: 'V-CONTENTGATE-03', ok: true, ...(uncited.length ? { detail: uncited.join('; ') } : {}) };
};

// V-CONTENTGATE-03: a ceiling above a file's glob-class budget may exist only as a declared
// `CONTENT_GATE_GRANDFATHERED` entry naming the ADR whose completion retires it. Two advisory
// legs: (A) `sunset_adr` is not `ADR-NNN`-shaped, or names an ADR with no `DECISION_INDEX` row —
// the exception cites nothing a reader can check; (B) the ceiling no longer exceeds its class on
// either metric, or no class covers the file — it grants nothing, the residue a class-budget
// raise that swallowed a grandfathered ceiling leaves behind. Declared boundary: a raise in a
// class with no grandfather entry is invisible to leg B — the budget map's own raise surfaces as
// a reviewed diff hunk, not as a measurement takeable here.
export const findUncitedGrandfatherAdrs = (
  entries: ContentGateGrandfather[],
  classBudgets: Map<string, ContentGateBudget>,
  decisionIndex: string,
): string[] => {
  const indexed = (a: string) => decisionIndex.split('\n').some((l) => l.trimStart().startsWith(`| ${a}-`));
  const warnings: string[] = [];
  for (const { file, ceiling, sunset_adr } of entries) {
    if (!/^ADR-\d{3}$/.test(sunset_adr)) {
      warnings.push(`${file} — sunset_adr "${sunset_adr}" is not ADR-NNN-shaped`);
    } else if (!indexed(sunset_adr)) {
      warnings.push(`${file} — sunset_adr ${sunset_adr} has no ${DECISION_INDEX} row`);
    }
    const cls = classBudgets.get(file);
    if (!cls) {
      warnings.push(`${file} — grandfather entry matches no CONTENT_GATE_BUDGETS glob class`);
    } else if (ceiling.maxSectionLoc <= cls.maxSectionLoc && ceiling.maxFileLoc <= cls.maxFileLoc) {
      warnings.push(`${file} — grandfather ceiling no longer exceeds its class budget; delete the entry`);
    }
  }
  return warnings;
};

// V-CONTENTGATE-02 (issue #545): advisory companion to findContentGateViolations — flags a
// section or whole file that has crossed `warnRatio` of its budget. Deliberately mirrors
// findContentGateViolations's signature (plus `warnRatio`) rather than sharing an accumulator
// with it: a target already over budget is findContentGateViolations's case to report, and this
// function's `<= budget` upper bound keeps the two from double-reporting the same target.
// Declared after checkContentGate (not alongside findContentGateViolations) so it lands inside
// checkContentGate's own CHECK_TS_SECTION_PATTERN section rather than growing checkZeroSections's
// — `find...` functions don't match the `check\w+` boundary themselves, so they are absorbed into
// whichever check-section precedes them.
export const findContentGateWarnings = (
  target: string,
  sections: Record<string, number>,
  totalLoc: number,
  budget: ContentGateBudget,
  warnRatio: number,
): string[] => {
  const warnings: string[] = [];
  const pctOf = (loc: number, max: number) => Math.round((loc / max) * 100);
  for (const [header, loc] of Object.entries(sections)) {
    if (loc >= budget.maxSectionLoc * warnRatio && loc <= budget.maxSectionLoc) {
      warnings.push(`${target} — ${header}: ${loc}/${budget.maxSectionLoc} LOC (${pctOf(loc, budget.maxSectionLoc)}% of section budget)`);
    }
  }
  if (totalLoc >= budget.maxFileLoc * warnRatio && totalLoc <= budget.maxFileLoc) {
    warnings.push(`${target} — whole file: ${totalLoc}/${budget.maxFileLoc} LOC (${pctOf(totalLoc, budget.maxFileLoc)}% of file budget)`);
  }
  return warnings;
};

// ADR-007 T5/R2': domain entrypoint — see agents.check.ts's runChecks doc comment for the shared contract.
export const runChecks = (): CheckResult[] => checkContentGate();
