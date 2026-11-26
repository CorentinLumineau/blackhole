import { beforeEach, describe, expect, test } from 'bun:test';
import { BUILD_REFERENCE_DIRS, REQUIRED_SITE_MARKERS, checkBuildFilingSites, findParetoLineViolations, runChecks } from './pareto-forge-line.check.ts';

// Pins the forge-line contract: line plus exactly the matching bucket label.

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

describe('build filing-site grounding (temp tree)', () => {
  const DIRS = ['a/references', 'b/references', 'c/references'] as const;
  const full = (file: string) => REQUIRED_SITE_MARKERS[file]!.join('\n');
  let tree: Record<string, string>;
  const reader = (rel: string) => (rel in tree ? tree[rel]! : null);
  beforeEach(() => {
    tree = {};
    for (const d of DIRS) for (const f of Object.keys(REQUIRED_SITE_MARKERS)) tree[`${d}/${f}`] = full(f);
  });

  test('every build carrying every marker passes, one result per build', () => {
    const r = checkBuildFilingSites(DIRS, reader);
    expect(r.map((x) => x.id)).toEqual(['V-PARETOLINE-01', 'V-PARETOLINE-02', 'V-PARETOLINE-03']);
    expect(r.every((x) => x.ok)).toBe(true);
  });

  test('a build forge-sync.md lacking the ingest heading fails only that build', () => {
    tree['b/references/forge-sync.md'] = full('forge-sync.md').replace('### Score on ingest', '');
    const r = checkBuildFilingSites(DIRS, reader);
    expect(r.map((x) => x.ok)).toEqual([true, false, true]);
    expect(r[1]!.id).toBe('V-PARETOLINE-02');
    expect(r[1]!.detail).toContain('b/references/forge-sync.md lacks `### Score on ingest`');
  });

  test('a phase-loop.md without the label flag fails its build', () => {
    tree['c/references/phase-loop.md'] = full('phase-loop.md').replace('--label "$pareto_label"', '');
    const r = checkBuildFilingSites(DIRS, reader);
    expect(r[2]!.ok).toBe(false);
    expect(r[2]!.detail).toContain('--label "$pareto_label"');
  });

  test('a missing file fails its build', () => {
    delete tree['a/references/hunt/filing.md'];
    const r = checkBuildFilingSites(DIRS, reader);
    expect(r[0]).toEqual({ id: 'V-PARETOLINE-01', ok: false, detail: 'a/references/hunt/filing.md missing' });
  });
});

describe('build filing-site grounding (live tree)', () => {
  test('all three builds carry every marker', () => {
    const results = runChecks();
    expect(results).toHaveLength(BUILD_REFERENCE_DIRS.length);
    expect(results.filter((r) => !r.ok)).toEqual([]);
  });
});
