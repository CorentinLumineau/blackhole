import { describe, expect, test } from 'bun:test';
import * as fs from 'fs';
import * as path from 'path';
import { read } from './checks/check-utils.ts';
import {
  parseSectionLineCounts,
  findContentGateViolations,
  findContentGateWarnings,
  resolveContentGateTargets,
  checkZeroSections,
  findUncitedGrandfatherAdrs,
  boundaryPatternFor,
  CHECK_TS_SECTION_PATTERN,
  H3_SECTION_PATTERN,
  runChecks,
} from './checks/content-gates.check.ts';
import {
  CONTENT_GATE_BUDGETS,
  CONTENT_GATE_BOUNDARY_UNITS,
  CONTENT_GATE_GRANDFATHERED,
  CONTENT_GATE_WARN_RATIO,
  type ContentGateBudget,
} from './lib/build/facts.ts';

// V-CONTENTGATE-01 (ADR-007 T6/R3′, generalized issue #323): declared-budget section/file-size
// gate. Inline fixtures cover the parser, the glob-class resolver, and the violation-finding
// logic; a final live integration case runs the real budget map against the real repo to confirm
// zero false positives.
describe('parseSectionLineCounts (markdown default)', () => {
  test('ignores ## headings inside fenced code blocks (fence-aware)', () => {
    const content = [
      '## Real Section',
      'text',
      '```',
      '## Not A Heading',
      '```',
      'more text',
      '## Second Section',
      'body',
    ].join('\n');
    const counts = parseSectionLineCounts(content);
    expect(Object.keys(counts)).toEqual(['## Real Section', '## Second Section']);
    expect(counts['## Real Section']).toBe(6);
  });

  test('maps each `##` header to its line count, up to the next `##` header', () => {
    const content = ['## First', 'a', 'b', '## Second', 'c'].join('\n');
    expect(parseSectionLineCounts(content)).toEqual({
      '## First': 3,
      '## Second': 2,
    });
  });

  test('extends the last section to end of content and drops a trailing empty split element', () => {
    const content = '## Only\nline one\nline two\n';
    expect(parseSectionLineCounts(content)).toEqual({ '## Only': 3 });
  });

  test('does not treat a `###` subsection as its own `##`-level boundary', () => {
    const content = ['## Parent', '### Child', 'body', '## Next'].join('\n');
    expect(parseSectionLineCounts(content)).toEqual({
      '## Parent': 3,
      '## Next': 1,
    });
  });

  test('returns {} for content with no `##` headers', () => {
    expect(parseSectionLineCounts('no headers here\njust prose')).toEqual({});
  });
});

describe('parseSectionLineCounts (CHECK_TS_SECTION_PATTERN boundary)', () => {
  test('maps each check function declaration to its line span', () => {
    const content = [
      'const checkFoo = (): CheckResult => {',
      '  return { id: "X", ok: true };',
      '};',
      'const checkBar = (): CheckResult[] => {',
      '  return [];',
      '};',
    ].join('\n');
    expect(parseSectionLineCounts(content, CHECK_TS_SECTION_PATTERN)).toEqual({
      'const checkFoo = (): CheckResult => {': 3,
      'const checkBar = (): CheckResult[] => {': 3,
    });
  });

  test('does not match non-check consts', () => {
    const content = ['const notACheck = 5;', 'const checkReal = (): CheckResult => {', '  x;', '};'].join('\n');
    expect(parseSectionLineCounts(content, CHECK_TS_SECTION_PATTERN)).toEqual({
      'const checkReal = (): CheckResult => {': 3,
    });
  });

  // Issue #554: a check function exported for unit-testing (`export const checkFoo = ...`, the
  // convention PR #550 introduced so split check functions can be tested individually) was
  // invisible to the section boundary — the pattern anchored on `^const check` and never matched
  // the `export ` prefix, so the whole file fell back to zero detected sections and the
  // 68-LOC-per-section budget went silently unenforced.
  test('matches an exported check function declaration', () => {
    const content = [
      'export const checkFoo = (): CheckResult => {',
      '  return { id: "X", ok: true };',
      '};',
      'export const checkBar = (): CheckResult[] => {',
      '  return [];',
      '};',
    ].join('\n');
    expect(parseSectionLineCounts(content, CHECK_TS_SECTION_PATTERN)).toEqual({
      'export const checkFoo = (): CheckResult => {': 3,
      'export const checkBar = (): CheckResult[] => {': 3,
    });
  });

  test('matches both exported and non-exported check declarations in the same file', () => {
    const content = [
      'const checkPrivate = (): CheckResult => {',
      '  x;',
      '};',
      'export const checkPublic = (): CheckResult => {',
      '  y;',
      '};',
    ].join('\n');
    expect(parseSectionLineCounts(content, CHECK_TS_SECTION_PATTERN)).toEqual({
      'const checkPrivate = (): CheckResult => {': 3,
      'export const checkPublic = (): CheckResult => {': 3,
    });
  });

  // Issue #562: gate-content-contract.check.ts's checkGateContentContract spans its parameter
  // list across three lines (`export const checkGateContentContract = (` / params / `):
  // CheckResult => {`), so the boundary pattern's requirement to match the closing signature
  // shape on the same declaration line never fires — the file falls back to zero detected
  // sections, same failure mode as issue #554.
  test('matches a check declaration whose parameter list spans multiple lines', () => {
    const content = [
      'export const checkFoo = (',
      '  param: string,',
      '): CheckResult => {',
      '  return { id: "X", ok: true };',
      '};',
    ].join('\n');
    expect(parseSectionLineCounts(content, CHECK_TS_SECTION_PATTERN)).toEqual({
      'export const checkFoo = (': 5,
    });
  });

  // Issue #562: checkpoint.check.ts's checkCheckpointAlignment (and two checks in
  // codex-build.check.ts) are expression-bodied arrows with no trailing `{` on the declaration
  // line — another zero-detected-sections instance found during planning, not in the issue text.
  test('matches an expression-bodied check declaration with no trailing brace', () => {
    const content = ['const checkFoo = (): CheckResult =>', '  helper(1, 2);'].join('\n');
    expect(parseSectionLineCounts(content, CHECK_TS_SECTION_PATTERN)).toEqual({
      'const checkFoo = (): CheckResult =>': 2,
    });
  });
});

describe('checkZeroSections', () => {
  // Issue #562: a `.check.ts` file with zero detected sections passes its budget gate silently
  // — there is nothing to measure, so `findContentGateViolations` reports no error even though
  // the file's check functions are completely unenforced. Fail loud instead.
  test('reports a violation naming the target when a .check.ts file detects zero sections', () => {
    const violation = checkZeroSections('scripts/checks/fake.check.ts', {});
    expect(violation).not.toBeNull();
    expect(violation).toContain('scripts/checks/fake.check.ts');
  });

  test('does not fire when sections were detected', () => {
    expect(checkZeroSections('scripts/checks/fake.check.ts', { 'const checkFoo = (': 3 })).toBeNull();
  });

  test('does not fire for a non-.check.ts target with zero sections (e.g. markdown boundary)', () => {
    expect(checkZeroSections('src/agents/orchestrator.md', {})).toBeNull();
  });
});

describe('resolveContentGateTargets', () => {
  test('resolves a literal path to itself, unchanged', () => {
    expect(resolveContentGateTargets('src/agents/orchestrator.md')).toEqual(['src/agents/orchestrator.md']);
  });

  test('resolves a glob-class key to every current matching file, sorted', () => {
    const liveFiles = fs
      .readdirSync(path.join(import.meta.dirname, 'checks'))
      .filter((f) => f.endsWith('.check.ts'))
      .map((f) => path.join('scripts/checks', f))
      .sort();
    expect(resolveContentGateTargets('scripts/checks/*.check.ts')).toEqual(liveFiles);
  });
});

describe('findContentGateViolations', () => {
  test('passes a section at or under maxSectionLoc and a file at or under maxFileLoc', () => {
    const violations = findContentGateViolations(
      'some/file.md',
      { '## A Section': 50 },
      100,
      { maxSectionLoc: 50, maxFileLoc: 100 },
    );
    expect(violations).toEqual([]);
  });

  test('fails a section one LOC over maxSectionLoc, naming the target, section, LOC, and limit', () => {
    const violations = findContentGateViolations(
      'some/file.md',
      { '## Sprawling Section': 51 },
      51,
      { maxSectionLoc: 50, maxFileLoc: 1000 },
    );
    expect(violations).toHaveLength(1);
    expect(violations[0]).toContain('some/file.md');
    expect(violations[0]).toContain('## Sprawling Section');
    expect(violations[0]).toContain('51 LOC');
    expect(violations[0]).toContain('50-LOC section budget');
  });

  test('fails a file one LOC over maxFileLoc, naming the target, "whole file", LOC, and limit', () => {
    const violations = findContentGateViolations(
      'some/file.md',
      {},
      101,
      { maxSectionLoc: 1000, maxFileLoc: 100 },
    );
    expect(violations).toHaveLength(1);
    expect(violations[0]).toContain('some/file.md');
    expect(violations[0]).toContain('whole file');
    expect(violations[0]).toContain('101 LOC');
    expect(violations[0]).toContain('100-LOC file budget');
  });

  test('can report both a section violation and a file violation for the same target', () => {
    const violations = findContentGateViolations(
      'some/file.md',
      { '## Over': 60 },
      200,
      { maxSectionLoc: 50, maxFileLoc: 100 },
    );
    expect(violations).toHaveLength(2);
  });
});

describe('findContentGateWarnings', () => {
  test('warns on a section between 85% and 100% of maxSectionLoc (exclusive of over-budget)', () => {
    // 45/50 = 90%, above the 85% warnRatio and at/under the 50-LOC budget.
    const warnings = findContentGateWarnings(
      'some/file.md',
      { '## Nearly Full': 45 },
      10,
      { maxSectionLoc: 50, maxFileLoc: 1000 },
      0.85,
    );
    expect(warnings).toHaveLength(1);
    expect(warnings[0]).toContain('some/file.md');
    expect(warnings[0]).toContain('## Nearly Full');
    expect(warnings[0]).toContain('45');
    expect(warnings[0]).toContain('50');
  });

  test('does not warn below the warnRatio threshold', () => {
    // 40/50 = 80%, below the 85% warnRatio.
    const warnings = findContentGateWarnings(
      'some/file.md',
      { '## Plenty Of Room': 40 },
      10,
      { maxSectionLoc: 50, maxFileLoc: 1000 },
      0.85,
    );
    expect(warnings).toEqual([]);
  });

  test('does not double-report a section already over budget (V-CONTENTGATE-01 owns that case)', () => {
    // 55/50 = 110%, already a hard violation — findContentGateWarnings must stay silent on it.
    const warnings = findContentGateWarnings(
      'some/file.md',
      { '## Already Over': 55 },
      10,
      { maxSectionLoc: 50, maxFileLoc: 1000 },
      0.85,
    );
    expect(warnings).toEqual([]);
  });

  test('still warns exactly at 100% of budget (the "landed at the ceiling" shape)', () => {
    // 50/50 = 100%, passes the hard gate (loc > budget is the violation condition) but should
    // still surface as an advisory warning — this is the planner.md-at-350 shape from the issue.
    const warnings = findContentGateWarnings(
      'some/file.md',
      { '## Exactly At Ceiling': 50 },
      10,
      { maxSectionLoc: 50, maxFileLoc: 1000 },
      0.85,
    );
    expect(warnings).toHaveLength(1);
    expect(warnings[0]).toContain('## Exactly At Ceiling');
  });

  test('also checks the whole-file LOC against maxFileLoc, same threshold rules', () => {
    const warnings = findContentGateWarnings(
      'some/file.md',
      {},
      90,
      { maxSectionLoc: 1000, maxFileLoc: 100 },
      0.85,
    );
    expect(warnings).toHaveLength(1);
    expect(warnings[0]).toContain('whole file');
    expect(warnings[0]).toContain('90');
    expect(warnings[0]).toContain('100');
  });
});

describe('boundaryPatternFor (per-file `###` unit, issue #722)', () => {
  test('a `.check.ts` target keeps the check-function boundary', () => {
    expect(boundaryPatternFor('scripts/checks/agents.check.ts')).toBe(CHECK_TS_SECTION_PATTERN);
  });

  test('a markdown target with no declared unit keeps the `##` boundary', () => {
    expect(boundaryPatternFor('src/agents/hunter.md').source).toBe('^## ');
  });

  test('a markdown target declared `###` in CONTENT_GATE_BOUNDARY_UNITS gets the `###` boundary', () => {
    const declared = Object.keys(CONTENT_GATE_BOUNDARY_UNITS);
    expect(declared.length).toBeGreaterThan(0);
    for (const file of declared) expect(boundaryPatternFor(file)).toBe(H3_SECTION_PATTERN);
  });

  test('the `###` unit ends a section at the next `##` OR `###`, so a `###` section never spans a `##`', () => {
    const content = ['## A', '### A1', 'x', '## B', 'y', 'z'].join('\n');
    expect(parseSectionLineCounts(content, H3_SECTION_PATTERN)).toEqual({
      '## A': 1,
      '### A1': 2,
      '## B': 3,
    });
  });
});

describe('findUncitedGrandfatherAdrs (V-CONTENTGATE-03, issue #722)', () => {
  const cls: ContentGateBudget = { maxSectionLoc: 100, maxFileLoc: 200 };
  const classBudgets = new Map([['src/agents/fake.md', cls]]);
  const INDEX_ROW = '| ADR-007-drift-proof-toolchain-reseating.md | s | adr | accepted | on protocol change |';
  const entry = (over: Partial<{ sunset_adr: string; ceiling: ContentGateBudget }> = {}) => ({
    file: 'src/agents/fake.md',
    ceiling: { maxSectionLoc: 100, maxFileLoc: 400 },
    sunset_adr: 'ADR-007',
    ...over,
  });

  test('stays silent for an entry citing an indexed ADR whose ceiling really exceeds its class', () => {
    expect(findUncitedGrandfatherAdrs([entry()], classBudgets, INDEX_ROW)).toEqual([]);
  });

  test('warns when sunset_adr names an ADR with no documentation/decisions/INDEX.md row', () => {
    const warnings = findUncitedGrandfatherAdrs([entry({ sunset_adr: 'ADR-999' })], classBudgets, INDEX_ROW);
    expect(warnings).toHaveLength(1);
    expect(warnings[0]).toContain('ADR-999');
    expect(warnings[0]).toContain('src/agents/fake.md');
  });

  test('warns when sunset_adr is not ADR-NNN-shaped', () => {
    const warnings = findUncitedGrandfatherAdrs([entry({ sunset_adr: 'see the plan' })], classBudgets, INDEX_ROW);
    expect(warnings).toHaveLength(1);
    expect(warnings[0]).toContain('see the plan');
  });

  test('warns when a class-budget raise has swallowed the grandfathered ceiling on both metrics', () => {
    const warnings = findUncitedGrandfatherAdrs(
      [entry({ ceiling: { maxSectionLoc: 90, maxFileLoc: 180 } })],
      classBudgets,
      INDEX_ROW,
    );
    expect(warnings).toHaveLength(1);
    expect(warnings[0]).toContain('no longer exceeds');
  });

  test('warns when the entry names a file no glob class covers', () => {
    const warnings = findUncitedGrandfatherAdrs([entry({})], new Map(), INDEX_ROW);
    expect(warnings).toHaveLength(1);
    expect(warnings[0]).toContain('no CONTENT_GATE_BUDGETS glob class');
  });
});

describe('CONTENT_GATE_BUDGETS integration (real repo content, zero false positives)', () => {
  test('is keyed by glob class only — exactly the 5 declared classes, no per-file key', () => {
    expect(Object.keys(CONTENT_GATE_BUDGETS).sort()).toEqual(
      [
        'src/agents/*.md',
        'src/references/*.md',
        'src/references/hunt/*.md',
        'scripts/checks/*.check.ts',
        'scripts/lib/build/*.ts',
      ].sort(),
    );
    for (const key of Object.keys(CONTENT_GATE_BUDGETS)) expect(key).toContain('*');
  });

  test('every grandfather entry cites an indexed ADR and really exceeds its class ceiling', () => {
    const root = path.resolve(import.meta.dirname, '..');
    const classBudgets = new Map<string, ContentGateBudget>();
    for (const [pattern, budget] of Object.entries(CONTENT_GATE_BUDGETS)) {
      for (const target of resolveContentGateTargets(pattern)) classBudgets.set(target, budget);
    }
    const index = fs.readFileSync(path.join(root, 'documentation/decisions/INDEX.md'), 'utf-8');
    expect(findUncitedGrandfatherAdrs(CONTENT_GATE_GRANDFATHERED, classBudgets, index)).toEqual([]);
    expect(CONTENT_GATE_GRANDFATHERED.length).toBeGreaterThan(0);
  });

  test('every covered file/glob passes its budget (class ceiling, or its grandfather ceiling)', () => {
    const root = path.resolve(import.meta.dirname, '..');
    const grandfathered = new Map(CONTENT_GATE_GRANDFATHERED.map((g) => [g.file, g.ceiling]));
    const allErrors: string[] = [];

    for (const [pattern, classBudget] of Object.entries(CONTENT_GATE_BUDGETS)) {
      const targets = resolveContentGateTargets(pattern);
      expect(targets.length).toBeGreaterThan(0);
      for (const target of targets) {
        const content = read(target);
        const sections = parseSectionLineCounts(content, boundaryPatternFor(target));
        const totalLoc = content.split('\n').filter((_, i, arr) => !(i === arr.length - 1 && arr[i] === '')).length;
        allErrors.push(...findContentGateViolations(target, sections, totalLoc, grandfathered.get(target) ?? classBudget));
      }
    }

    expect(allErrors).toEqual([]);
  });

  test('runChecks() returns the hard gate, the advisory ratio warning, and the exception audit', () => {
    // Operationalizes the plan's "Hard-gate regression" stop condition as a permanent test: the
    // hard gate must stay green, the near-ceiling advisory must keep reporting, and the
    // grandfather-exception audit must be clean against the live declarations.
    const results = runChecks();
    expect(results).toHaveLength(3);

    const hard = results.find((r) => r.id === 'V-CONTENTGATE-01');
    expect(hard).toBeDefined();
    expect(hard?.ok).toBe(true);

    const warn = results.find((r) => r.id === 'V-CONTENTGATE-02');
    expect(warn).toBeDefined();
    expect(warn?.ok).toBe(true);
    expect(warn?.detail).toBeDefined();
    expect(warn?.detail?.length).toBeGreaterThan(0);

    const audit = results.find((r) => r.id === 'V-CONTENTGATE-03');
    expect(audit).toBeDefined();
    expect(audit?.ok).toBe(true);
    expect(audit?.detail).toBeUndefined();
  });

  test('CONTENT_GATE_WARN_RATIO is the derived 85% threshold', () => {
    expect(CONTENT_GATE_WARN_RATIO).toBe(0.85);
  });
});
