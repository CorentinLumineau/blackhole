import { describe, expect, test } from 'bun:test';
import { BUILD_REFERENCE_DIRS, REQUIRED_SITE_MARKERS, findMissingSiteMarkers, findParetoLineViolations, runChecks } from './pareto-forge-line.check.ts';

// Issue #1530 — pins the forge-line contract: line plus exactly the matching bucket label.

const body = (line: string) => `## Problem\nx\n\n${line}\n`;

describe('findParetoLineViolations', () => {
  test('a valid line with its matching bucket label passes', () => {
    // 8 * (11 - 3) = 64 -> P2
    expect(findParetoLineViolations([{ number: 1, body: body('Pareto: gain=8 effort=3 priority=64'), labels: ['ready', 'pareto:P2'] }])).toEqual([]);
  });

  test('a ready issue with no Pareto line is reported', () => {
    expect(findParetoLineViolations([{ number: 2, body: 'no score here', labels: ['ready', 'pareto:P2'] }])).toEqual([
      { number: 2, reason: 'missing or invalid `Pareto:` body line' },
    ]);
  });

  test('a line whose priority disagrees with the formula reads as missing', () => {
    const v = findParetoLineViolations([{ number: 3, body: body('Pareto: gain=8 effort=3 priority=99'), labels: ['pareto:P1'] }]);
    expect(v).toEqual([{ number: 3, reason: 'missing or invalid `Pareto:` body line' }]);
  });

  test('a line without its bucket label is reported with the expected label', () => {
    const v = findParetoLineViolations([{ number: 4, body: body('Pareto: gain=8 effort=3 priority=64'), labels: ['ready'] }]);
    expect(v).toEqual([{ number: 4, reason: 'missing bucket label pareto:P2 for priority 64' }]);
  });

  test('a wrong bucket label is reported as missing the right one', () => {
    const v = findParetoLineViolations([{ number: 5, body: body('Pareto: gain=8 effort=3 priority=64'), labels: ['pareto:P3'] }]);
    expect(v).toEqual([{ number: 5, reason: 'missing bucket label pareto:P2 for priority 64' }]);
  });

  test('a stray second bucket label is reported', () => {
    const v = findParetoLineViolations([{ number: 6, body: body('Pareto: gain=8 effort=3 priority=64'), labels: ['pareto:P2', 'pareto:P4'] }]);
    expect(v).toEqual([{ number: 6, reason: 'stray bucket label(s) pareto:P4 beside pareto:P2' }]);
  });

  test('bucket boundaries map to the right label (70 -> P1, 30 -> P3)', () => {
    // 7 * (11 - 1) = 70 ; 3 * (11 - 1) = 30
    const ok = findParetoLineViolations([
      { number: 7, body: body('Pareto: gain=7 effort=1 priority=70'), labels: ['pareto:P1'] },
      { number: 8, body: body('Pareto: gain=3 effort=1 priority=30'), labels: ['pareto:P3'] },
    ]);
    expect(ok).toEqual([]);
  });
});

describe('findMissingSiteMarkers', () => {
  test('returns only the absent markers', () => {
    expect(findMissingSiteMarkers('has a and b', ['a', 'b', 'c'])).toEqual(['c']);
  });
});

describe('build filing-site grounding', () => {
  test('covers all three builds', () => {
    expect(BUILD_REFERENCE_DIRS).toEqual([
      'skills/blackhole/references',
      'plugins/blackhole-claude/skills/blackhole/references',
      'codex-skills/blackhole/references',
    ]);
    expect(Object.keys(REQUIRED_SITE_MARKERS)).toEqual(['forge-sync.md', 'hunt/filing.md', 'phase-loop.md']);
  });

  test('every build on the live tree carries every filing-site marker', () => {
    const results = runChecks();
    expect(results).toHaveLength(3);
    expect(results.filter((r) => !r.ok)).toEqual([]);
  });
});
