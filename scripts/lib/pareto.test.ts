import { describe, expect, test } from 'bun:test';
import * as fs from 'fs';
import { formatParetoLine, paretoBucket, paretoLabel, paretoPriority, parseParetoLine, reconcileParetoLabels, upsertParetoLine } from './pareto.ts';

describe('paretoPriority', () => {
  test('is gain * (11 - effort)', () => {
    expect(paretoPriority(8, 5)).toBe(48);
    expect(paretoPriority(10, 1)).toBe(100);
    expect(paretoPriority(1, 10)).toBe(1);
  });
  test('rejects out-of-range and non-integer inputs', () => {
    for (const [g, e] of [[0, 5], [11, 5], [5, 0], [5, 11], [1.5, 5], [5, 2.5], [Number.NaN, 5]]) {
      expect(() => paretoPriority(g, e)).toThrow(RangeError);
    }
  });
});

describe('paretoBucket / paretoLabel', () => {
  test('boundary table', () => {
    const table: Array<[number, string]> = [[100, 'P1'], [70, 'P1'], [69, 'P2'], [50, 'P2'], [49, 'P3'], [30, 'P3'], [29, 'P4'], [1, 'P4']];
    for (const [priority, bucket] of table) expect(paretoBucket(priority)).toBe(bucket as 'P1');
  });
  test('label', () => {
    expect(paretoLabel(48)).toBe('pareto:P3');
    expect(paretoLabel(100)).toBe('pareto:P1');
  });
});

describe('parseParetoLine', () => {
  const ok = { gain: 8, effort: 5, priority: 48 };
  test('finds the line among prose, with LF and CRLF endings', () => {
    expect(parseParetoLine('Intro\n\nPareto: gain=8 effort=5 priority=48\n\nMore')).toEqual(ok);
    expect(parseParetoLine('Intro\r\nPareto: gain=8 effort=5 priority=48\r\nMore')).toEqual(ok);
    expect(parseParetoLine('  pareto:  gain=8   effort=5  priority=48  ')).toEqual(ok);
  });
  test('null when absent, mismatched, out of range, non-numeric or reordered', () => {
    for (const body of [
      '',
      'no line here',
      'Pareto: gain=8 effort=5 priority=47',
      'Pareto: gain=0 effort=5 priority=0',
      'Pareto: gain=11 effort=5 priority=66',
      'Pareto: gain=8 effort=11 priority=0',
      'Pareto: gain=x effort=5 priority=48',
      'Pareto: effort=5 gain=8 priority=48',
      'see Pareto: gain=8 effort=5 priority=48 inline',
    ]) expect(parseParetoLine(body)).toBeNull();
  });
  test('the first valid match wins, a fenced code block is not special-cased', () => {
    expect(parseParetoLine('```\nPareto: gain=2 effort=2 priority=18\n```\nPareto: gain=8 effort=5 priority=48')).toEqual({ gain: 2, effort: 2, priority: 18 });
    expect(parseParetoLine('Pareto: gain=8 effort=5 priority=47\nPareto: gain=8 effort=5 priority=48')).toEqual(ok);
  });
});

describe('formatParetoLine', () => {
  test('exact text', () => {
    expect(formatParetoLine({ gain: 8, effort: 5 })).toBe('Pareto: gain=8 effort=5 priority=48');
  });
  test('round-trips every gain/effort pair', () => {
    for (let gain = 1; gain <= 10; gain++) {
      for (let effort = 1; effort <= 10; effort++) {
        expect(parseParetoLine(formatParetoLine({ gain, effort }))).toEqual({ gain, effort, priority: paretoPriority(gain, effort) });
      }
    }
  });
});

test('the module is pure: no fs or child_process import', () => {
  const src = fs.readFileSync(new URL('./pareto.ts', import.meta.url), 'utf8');
  expect(src).not.toMatch(/^\s*import .*['"](?:node:)?(?:fs|child_process)['"]/m);
});

describe('upsertParetoLine', () => {
  const s = { gain: 7, effort: 5 };
  test('appends the line to a body lacking one', () => {
    expect(upsertParetoLine('text', s)).toBe('text\n\nPareto: gain=7 effort=5 priority=42');
  });
  test('replaces a stale line in place', () => {
    expect(upsertParetoLine('a\nPareto: gain=7 effort=5 priority=47\nb', s)).toBe('a\nPareto: gain=7 effort=5 priority=42\nb');
  });
  test('collapses duplicate lines to one', () => {
    const out = upsertParetoLine('a\nPareto: gain=1 effort=1 priority=10\nb\nPareto: gain=2 effort=2 priority=18\n', s);
    expect(out.match(/^Pareto:/gm)).toHaveLength(1);
    expect(out).toContain('Pareto: gain=7 effort=5 priority=42');
  });
  test('is idempotent', () => {
    const once = upsertParetoLine('x', s);
    expect(upsertParetoLine(once, s)).toBe(once);
  });
  test('preserves CRLF endings', () => {
    expect(upsertParetoLine('a\r\nPareto: gain=1 effort=1 priority=10\r\nb', s)).toBe('a\r\nPareto: gain=7 effort=5 priority=42\r\nb');
  });
  test('round-trips through parseParetoLine for every in-scale pair', () => {
    for (let gain = 1; gain <= 10; gain++) {
      for (let effort = 1; effort <= 10; effort++) {
        expect(parseParetoLine(upsertParetoLine('body', { gain, effort }))).toEqual({ gain, effort, priority: gain * (11 - effort) });
      }
    }
  });
  test('throws RangeError out of scale', () => {
    expect(() => upsertParetoLine('x', { gain: 0, effort: 5 })).toThrow(RangeError);
  });
});

describe('reconcileParetoLabels', () => {
  test('swaps a stale bucket label', () => {
    expect(reconcileParetoLabels(['kind/feature', 'pareto:P3', 'ready'], 55)).toEqual({ add: ['pareto:P2'], remove: ['pareto:P3'] });
  });
  test('already correct is a no-op', () => {
    expect(reconcileParetoLabels(['pareto:P2'], 55)).toEqual({ add: [], remove: [] });
  });
  test('removes every stale pareto label, including unknown ones', () => {
    expect(reconcileParetoLabels(['pareto:P1', 'pareto:P4', 'pareto:xyz'], 55)).toEqual({ add: ['pareto:P2'], remove: ['pareto:P1', 'pareto:P4', 'pareto:xyz'] });
  });
  test('never removes a non-pareto label', () => {
    expect(reconcileParetoLabels(['ready', 'kind/bug'], 10).remove).toEqual([]);
  });
});
