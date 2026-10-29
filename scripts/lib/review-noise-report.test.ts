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
    expect(md).toContain('| V-A | 5 | 40% | 40% | 20% | 0% | 2 | 3 | tune or demote |');
  });
});
