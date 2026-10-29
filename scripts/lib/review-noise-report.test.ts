import { describe, expect, test } from 'bun:test';
import { buildNoiseReport, parseSince, renderNoiseMarkdown } from './review-noise-report.ts';

const NOW = Date.parse('2026-10-29T00:00:00Z');
const row = (vcode: string, status: string, created_at = '2026-10-28T00:00:00Z', rounds?: number) => ({
  vcode,
  status,
  created_at,
  ...(rounds === undefined ? {} : { rounds_to_lgtm: rounds }),
});

const wrongHeavy = [
  row('V-A', 'wrong'),
  row('V-A', 'wrong'),
  row('V-A', 'fixed-in-pr', undefined, 1),
  row('V-A', 'resolved', undefined, 3),
  row('V-A', 'intentional'),
];
const fixedHeavy = Array.from({ length: 5 }, () => row('V-B', 'fixed-in-pr', undefined, 2));

describe('parseSince', () => {
  test('days, hours, invalid', () => {
    expect(parseSince('7d')).toBe(7 * 86400_000);
    expect(parseSince('12h')).toBe(12 * 3600_000);
    expect(() => parseSince('soon')).toThrow();
  });
});

describe('buildNoiseReport', () => {
  const report = buildNoiseReport([...wrongHeavy, ...fixedHeavy], { now: NOW, sinceMs: 7 * 86400_000 });
  const a = report.vcodes.find((v) => v.vcode === 'V-A')!;
  const b = report.vcodes.find((v) => v.vcode === 'V-B')!;

  test('exact percentages; fixed = fixed-in-pr + resolved', () => {
    expect(a.count).toBe(5);
    expect(a.fixed_pct).toBe(40);
    expect(a.wrong_pct).toBe(40);
    expect(a.intentional_pct).toBe(20);
    expect(a.not_worth_pct).toBe(0);
    expect(a.rounds_median).toBe(2);
    expect(a.rounds_p95).toBe(3);
  });
  test('flags', () => {
    expect(a.flags).toEqual(['tune or demote']);
    expect(b.fixed_pct).toBe(100);
    expect(b.flags).toEqual(['encode as lint/CI']);
  });
  test('wrong share needs n>=5', () => {
    const r = buildNoiseReport([row('V-C', 'wrong'), row('V-C', 'wrong')], { now: NOW, sinceMs: 7 * 86400_000 });
    expect(r.vcodes[0].flags).toEqual([]);
  });
  test('--since filters out old rows', () => {
    const r = buildNoiseReport([row('V-D', 'wrong', '2026-09-01T00:00:00Z'), row('V-E', 'resolved')], {
      now: NOW,
      sinceMs: 7 * 86400_000,
    });
    expect(r.vcodes.map((v) => v.vcode)).toEqual(['V-E']);
  });
  test('empty ledger', () => {
    const r = buildNoiseReport([], { now: NOW, sinceMs: 7 * 86400_000 });
    expect(r.vcodes).toEqual([]);
    expect(renderNoiseMarkdown(r)).toContain('No findings');
  });
  test('markdown has a row per vcode and the flag', () => {
    const md = renderNoiseMarkdown(report);
    expect(md).toContain('| V-A | 5 | 5 | 0 | 40% | 40% | 20% | 0% | 2 | 3 | tune or demote |');
  });

  const opts = { now: NOW, sinceMs: 7 * 86400_000 };
  const mix = (v: string, status: string, n: number) => Array.from({ length: n }, () => row(v, status));
  const flagsOf = (rows: ReturnType<typeof row>[]) => buildNoiseReport(rows, opts).vcodes[0].flags;

  test('open/deferred rows do not dilute shares; denominator is stated', () => {
    const r = buildNoiseReport([...mix('V-F', 'open', 8), ...mix('V-F', 'wrong', 2)], opts);
    const f = r.vcodes[0];
    expect(f.count).toBe(10);
    expect(f.triaged).toBe(2);
    expect(f.untriaged).toBe(8);
    expect(f.wrong_pct).toBe(100);
    expect(r.denominator).toContain('triaged');
    expect(renderNoiseMarkdown(r)).toContain('Percentages are over triaged rows');
  });
  test('wrong exactly 30% (3 of 10) flags', () => {
    // 3/10 = 30% with n=10
    expect(flagsOf([...mix('V-G', 'wrong', 3), ...mix('V-G', 'resolved', 7)])).toEqual(['tune or demote', 'encode as lint/CI']);
    expect(flagsOf([...mix('V-G', 'wrong', 3), ...mix('V-G', 'intentional', 7)])).toEqual(['tune or demote']);
  });
  test('wrong 28.6% (2 of 7) does not flag', () => {
    expect(flagsOf([...mix('V-G', 'wrong', 2), ...mix('V-G', 'intentional', 5)])).toEqual([]);
  });
  test('n=5 with 2 wrong (40%) flags; n=4 at 50% does not', () => {
    expect(flagsOf([...mix('V-G', 'wrong', 2), ...mix('V-G', 'intentional', 3)])).toEqual(['tune or demote']);
    expect(flagsOf([...mix('V-G', 'wrong', 2), ...mix('V-G', 'intentional', 2)])).toEqual([]);
  });
  test('fixed=5 flags, fixed=4 does not', () => {
    expect(flagsOf(mix('V-G', 'fixed-in-pr', 5))).toEqual(['encode as lint/CI']);
    expect(flagsOf(mix('V-G', 'fixed-in-pr', 4))).toEqual([]);
  });
  test('unparseable created_at is excluded from the window', () => {
    const r = buildNoiseReport([row('V-H', 'wrong', 'not-a-date'), row('V-I', 'wrong')], opts);
    expect(r.vcodes.map((v) => v.vcode)).toEqual(['V-I']);
  });
});
