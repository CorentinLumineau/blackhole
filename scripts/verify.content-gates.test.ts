import { describe, expect, test } from 'bun:test';
import * as fs from 'fs';
import * as path from 'path';
import {
  parseSectionLineCounts,
  findContentGateViolations,
  resolveContentGateTargets,
  CHECK_TS_SECTION_PATTERN,
} from './checks/content-gates.check.ts';
import { CONTENT_GATE_BUDGETS } from './lib/build/facts.ts';

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

describe('CONTENT_GATE_BUDGETS integration (real repo content, zero false positives)', () => {
  test('covers exactly the 6 declared keys', () => {
    expect(Object.keys(CONTENT_GATE_BUDGETS).sort()).toEqual(
      [
        'src/agents/orchestrator.md',
        'src/agents/planner.md',
        'src/references/worker-schemas.md',
        'src/references/hook-schemas.md',
        'scripts/checks/*.check.ts',
        'scripts/lib/build/*.ts',
      ].sort(),
    );
  });

  test('every covered file/glob passes its budget against the current repo state', () => {
    const root = path.resolve(import.meta.dirname, '..');
    const allErrors: string[] = [];

    for (const [pattern, budget] of Object.entries(CONTENT_GATE_BUDGETS)) {
      const targets = resolveContentGateTargets(pattern);
      expect(targets.length).toBeGreaterThan(0);
      for (const target of targets) {
        const content = fs.readFileSync(path.join(root, target), 'utf-8');
        const boundaryPattern = target.endsWith('.check.ts') ? CHECK_TS_SECTION_PATTERN : /^## /;
        const sections = parseSectionLineCounts(content, boundaryPattern);
        const totalLoc = content.split('\n').filter((_, i, arr) => !(i === arr.length - 1 && arr[i] === '')).length;
        allErrors.push(...findContentGateViolations(target, sections, totalLoc, budget));
      }
    }

    expect(allErrors).toEqual([]);
  });
});
