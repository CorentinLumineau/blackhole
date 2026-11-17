import { describe, expect, test } from 'bun:test';
import { DEFAULT_DAY_END_HOUR, DEFAULT_PCT_PER_WEEKDAY, computePaceFloor } from './pace-floor.ts';

const at = (month: number, day: number, hour = 0, minute = 0, second = 0): number => Date.UTC(2026, month - 1, day, hour, minute, second) / 1000;
const NOV = 11;
// Week reset Tue 2026-11-24 10:00Z: the week runs Tue 17 Nov 10:00Z to Tue 24 Nov 10:00Z.
const RESET = at(NOV, 24, 10);
const floor = (now: number, extra: Partial<Parameters<typeof computePaceFloor>[0]> = {}) =>
  computePaceFloor({ now, resetsAt: RESET, usedPct: 0, ...extra });

describe('computePaceFloor credit schedule', () => {
  test('defaults match the scheduled 18:00 run and 17.5 points per weekday', () => {
    expect(DEFAULT_PCT_PER_WEEKDAY).toBe(17.5);
    expect(DEFAULT_DAY_END_HOUR).toBe(18);
  });

  test.each([
    ['Tue 17 Nov 17:59:59', at(NOV, 17, 17, 59, 59), 0, 0],
    ['Tue 17 Nov 18:00', at(NOV, 17, 18), 0.5, 8.75],
    ['Wed 18 Nov 18:00', at(NOV, 18, 18), 1.5, 26.25],
    ['Thu 19 Nov 18:00', at(NOV, 19, 18), 2.5, 43.75],
    ['Fri 20 Nov 18:00', at(NOV, 20, 18), 3.5, 61.25],
    ['Sat 21 Nov 12:00', at(NOV, 21, 12), 3.5, 61.25],
    ['Sun 22 Nov 18:00', at(NOV, 22, 18), 3.5, 61.25],
    ['Mon 23 Nov 18:00', at(NOV, 23, 18), 4.5, 78.75],
    ['Tue 24 Nov 09:59:59', at(NOV, 24, 9, 59, 59), 4.5, 78.75],
    ['Tue 24 Nov 10:00 (resetsAt)', RESET, 5, 87.5],
    ['Thu 26 Nov', at(NOV, 26, 12), 5, 87.5],
    ['before the week', at(NOV, 10, 12), 0, 0],
  ])('%s', (_label, now, credits, floorPct) => {
    expect(floor(now)).toMatchObject({ credits, floor_pct: floorPct });
  });

  test('shortfall is the floor minus the used percent, never negative', () => {
    expect(floor(at(NOV, 20, 18), { usedPct: 50 }).shortfall_pct).toBe(11.25);
    expect(floor(at(NOV, 20, 18), { usedPct: 70 }).shortfall_pct).toBe(0);
  });

  test('a UTC offset moves the day end: +120 min puts the first credit at 16:00Z', () => {
    expect(floor(at(NOV, 17, 15, 59, 59), { utcOffsetMinutes: 120 }).credits).toBe(0);
    expect(floor(at(NOV, 17, 16), { utcOffsetMinutes: 120 }).credits).toBe(0.5);
  });

  test('a Saturday reset credits nothing until Monday 18:00, then 1 per weekday', () => {
    const resetsAt = at(NOV, 21, 10);
    const credits = (now: number) => computePaceFloor({ now, resetsAt, usedPct: 0 }).credits;
    expect(credits(at(NOV, 16, 17, 59))).toBe(0);
    expect(credits(at(NOV, 16, 18))).toBe(1);
    expect(credits(at(NOV, 20, 18))).toBe(5);
    expect(credits(resetsAt)).toBe(5);
  });

  test('a Friday reset totals 5: the Friday half at the week start and the closing half at the reset', () => {
    const resetsAt = at(NOV, 20, 10);
    const credits = (now: number) => computePaceFloor({ now, resetsAt, usedPct: 0 }).credits;
    expect(credits(at(NOV, 13, 17, 59))).toBe(0);
    expect(credits(at(NOV, 13, 18))).toBe(0.5);
    expect(credits(at(NOV, 19, 18))).toBe(4.5);
    expect(credits(resetsAt)).toBe(5);
  });

  test('a reset hour after the day end credits the first half at the week start', () => {
    const resetsAt = at(NOV, 24, 20);
    const start = resetsAt - 7 * 86400;
    expect(computePaceFloor({ now: start - 1, resetsAt, usedPct: 0 }).credits).toBe(0);
    expect(computePaceFloor({ now: start, resetsAt, usedPct: 0 }).credits).toBe(0.5);
  });

  test('pctPerWeekday scales linearly and the floor caps at 100', () => {
    expect(floor(at(NOV, 20, 18), { pctPerWeekday: 20 }).floor_pct).toBe(70);
    expect(floor(RESET, { pctPerWeekday: 50 }).floor_pct).toBe(100);
  });

  test('dayEndHour 24 lands the credit at the next local midnight', () => {
    expect(floor(at(NOV, 17, 23, 59, 59), { dayEndHour: 24 }).credits).toBe(0);
    expect(floor(at(NOV, 18, 0), { dayEndHour: 24 }).credits).toBe(0.5);
  });
});

describe('computePaceFloor input validation', () => {
  test.each([
    ['non-finite now', { now: Number.NaN }],
    ['non-finite resetsAt', { resetsAt: Number.POSITIVE_INFINITY }],
    ['usedPct above 100', { usedPct: 101 }],
    ['negative usedPct', { usedPct: -1 }],
    ['zero pctPerWeekday', { pctPerWeekday: 0 }],
    ['pctPerWeekday above 100', { pctPerWeekday: 101 }],
    ['fractional dayEndHour', { dayEndHour: 17.5 }],
    ['dayEndHour 0', { dayEndHour: 0 }],
    ['dayEndHour 25', { dayEndHour: 25 }],
    ['non-finite offset', { utcOffsetMinutes: Number.NaN }],
  ])('throws on %s', (_label, bad) => {
    expect(() => computePaceFloor({ now: RESET, resetsAt: RESET, usedPct: 0, ...bad })).toThrow(Error);
  });
});
