import { describe, expect, test } from 'bun:test';
import { DEFAULT_WEEKLY_TARGET_PCT, WEEK_HOURS, computePaceFloor } from './pace-floor.ts';

const at = (month: number, day: number, hour = 0, minute = 0, second = 0): number => Date.UTC(2026, month - 1, day, hour, minute, second) / 1000;
const NOV = 11;
// Week reset Tue 2026-11-24 10:00Z: the week runs Tue 17 Nov 10:00Z to Tue 24 Nov 10:00Z.
const RESET = at(NOV, 24, 10);
const START = RESET - 7 * 86400;
const floor = (now: number, extra: Partial<Parameters<typeof computePaceFloor>[0]> = {}) =>
  computePaceFloor({ now, resetsAt: RESET, usedPct: 0, ...extra });

describe('computePaceFloor linear schedule', () => {
  test('defaults: 80 percent over 168 hours', () => {
    expect(DEFAULT_WEEKLY_TARGET_PCT).toBe(80);
    expect(WEEK_HOURS).toBe(168);
  });

  test('week start is 0, the reset is the target, the midpoint is half of it', () => {
    expect(floor(START)).toMatchObject({ elapsed_h: 0, floor_pct: 0, target_pct: 80 });
    expect(floor(RESET)).toMatchObject({ elapsed_h: 168, floor_pct: 80, target_pct: 80 });
    expect(floor(START + 84 * 3600)).toMatchObject({ elapsed_h: 84, floor_pct: 40 });
  });

  test('weeklyTargetPct scales the floor and is echoed as target_pct', () => {
    expect(floor(RESET, { weeklyTargetPct: 50 })).toMatchObject({ floor_pct: 50, target_pct: 50 });
    expect(floor(START + 84 * 3600, { weeklyTargetPct: 60 }).floor_pct).toBe(30);
  });

  test('weekend hours count: the floor strictly rises Sat 21 to Mon 23', () => {
    const values = [at(NOV, 21, 6), at(NOV, 21, 18), at(NOV, 22, 12), at(NOV, 23, 0)].map((n) => floor(n).floor_pct);
    for (let i = 1; i < values.length; i++) expect(values[i]).toBeGreaterThan(values[i - 1]);
  });

  test('issue 1293 example: Wed 18 Nov 13:00Z of a Sat 21 Nov 20:00Z reset', () => {
    const resetsAt = at(NOV, 21, 20);
    expect(computePaceFloor({ now: at(NOV, 18, 13), resetsAt, usedPct: 54 })).toEqual({ floor_pct: 42.38, elapsed_h: 89, target_pct: 80, shortfall_pct: 0 });
  });

  test('now outside the week clamps to 0 before and the target after', () => {
    expect(floor(START - 5 * 86400)).toMatchObject({ elapsed_h: 0, floor_pct: 0 });
    expect(floor(RESET + 3 * 86400)).toMatchObject({ elapsed_h: 168, floor_pct: 80 });
  });

  test('shortfall is the floor minus the used percent, never negative', () => {
    expect(floor(START + 84 * 3600, { usedPct: 25 }).shortfall_pct).toBe(15);
    expect(floor(START + 84 * 3600, { usedPct: 70 }).shortfall_pct).toBe(0);
  });
});

describe('computePaceFloor input validation', () => {
  test.each([
    ['non-finite now', { now: Number.NaN }],
    ['non-finite resetsAt', { resetsAt: Number.POSITIVE_INFINITY }],
    ['usedPct above 100', { usedPct: 101 }],
    ['negative usedPct', { usedPct: -1 }],
    ['zero weeklyTargetPct', { weeklyTargetPct: 0 }],
    ['weeklyTargetPct above 100', { weeklyTargetPct: 101 }],
    ['NaN weeklyTargetPct', { weeklyTargetPct: Number.NaN }],
  ])('throws on %s', (_label, bad) => {
    expect(() => computePaceFloor({ now: RESET, resetsAt: RESET, usedPct: 0, ...bad })).toThrow(Error);
  });
});
