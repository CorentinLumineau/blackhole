import { describe, expect, test } from 'bun:test';
import { DEFAULT_CATCHUP, applyOverrides, floorBudget, readPacing, resolveCatchup, workersAtFloor } from './catchup.ts';
import { resolveUsageBudget } from './usage-budget.ts';
import type { UsageReport } from './usage-source.ts';

const NOW = Date.UTC(2026, 10, 13, 9, 30) / 1000; // Fri 13 Nov 2026 09:30Z
const RESET = Date.UTC(2026, 10, 16, 9, 30) / 1000; // Mon 16 Nov 2026 09:30Z
const HOUR = 3600;
const budget = resolveUsageBudget({});
const preset = DEFAULT_CATCHUP;
const limits = (week: number | null, five: number | null) => ({
  ...(week === null ? {} : { seven_day: { used_percentage: week, resets_at: RESET } }),
  ...(five === null ? {} : { five_hour: { used_percentage: five, resets_at: NOW + 2 * HOUR } }),
});

describe('resolveCatchup', () => {
  test('the empty block is the defaults', () => {
    expect(resolveCatchup({})).toEqual({ weekly_target_pct: 80, five_hour: { no_spawn_at: 75, stop_workers_at: 80 }, lane: null, claim_lease_hours: 24 });
  });
  test('a partial block merges over the defaults', () => {
    const c = resolveCatchup({ catchup: { weekly_target_pct: 60, five_hour: { no_spawn_at: 60 }, lane: 'acct-b' } });
    expect(c).toMatchObject({ weekly_target_pct: 60, lane: 'acct-b', claim_lease_hours: 24 });
    expect(c.five_hour).toEqual({ no_spawn_at: 60, stop_workers_at: 80 });
  });
  test.each([
    [{ catchup: 3 }, 'catchup must be an object'],
    [{ catchup: { weekly_target_pct: 0 } }, 'catchup.weekly_target_pct'],
    [{ catchup: { weekly_target_pct: 101 } }, 'catchup.weekly_target_pct'],
    [{ catchup: { weekly_target_pct: 'x' } }, 'catchup.weekly_target_pct'],
    [{ catchup: { five_hour: 'x' } }, 'catchup.five_hour must be an object'],
    [{ catchup: { five_hour: { no_spawn_at: 80, stop_workers_at: 80 } } }, 'catchup.five_hour.no_spawn_at must be less than'],
    [{ catchup: { lane: 'Bad Lane' } }, 'catchup.lane'],
    [{ catchup: { claim_lease_hours: 0 } }, 'catchup.claim_lease_hours'],
  ])('%j throws naming the key path', (config, message) => {
    expect(() => resolveCatchup(config as Record<string, unknown>)).toThrow(message);
  });
  const PCT_MESSAGE =
    'catchup.pct_per_weekday was removed (ADR-054 amendment): the pace floor is now linear over all 168 h of the week. Delete it and set catchup.weekly_target_pct instead (a number in (0, 100], default 80; the old 17.5 x 5 weekdays equals 87.5).';
  const HOUR_MESSAGE = 'catchup.day_end_hour was removed (ADR-054 amendment): the pace floor no longer follows working days. Delete it from config.json.';
  test.each([
    ['pct_per_weekday', 17.5, PCT_MESSAGE],
    ['pct_per_weekday', null, PCT_MESSAGE],
    ['day_end_hour', 18, HOUR_MESSAGE],
    ['day_end_hour', null, HOUR_MESSAGE],
  ])('removed key %s=%j is rejected with the exact message (regression for 1293)', (key, value, message) => {
    expect(() => resolveCatchup({ catchup: { [key]: value } })).toThrow(new Error(message));
  });
  test('with both removed keys present the first reported is pct_per_weekday', () => {
    expect(() => resolveCatchup({ catchup: { day_end_hour: 18, pct_per_weekday: 17.5 } })).toThrow(new Error(PCT_MESSAGE));
  });
});

describe('applyOverrides', () => {
  test('an inverted 5h pair throws', () => {
    expect(() => applyOverrides(preset, { stop_workers_at: 70, no_spawn_at: 75 })).toThrow('--no-spawn-at must be less than --stop-workers-at');
  });
  test('a valid override leaves the preset untouched', () => {
    const before = structuredClone(preset);
    const next = applyOverrides(preset, { no_spawn_at: 60, lane: 'b' });
    expect(next.five_hour).toEqual({ no_spawn_at: 60, stop_workers_at: 80 });
    expect(next.lane).toBe('b');
    expect(preset).toEqual(before);
  });
  test('a bad floor or lane throws', () => {
    expect(() => applyOverrides(preset, { floor_pct: 101 })).toThrow('--floor');
    expect(() => applyOverrides(preset, { lane: 'No Good' })).toThrow('--lane');
  });
});

describe('floorBudget', () => {
  test('forces the gate on with both weekly lines at the floor', () => {
    const b = floorBudget(resolveUsageBudget({ usage_budget: { max_workers: 2, weekly: { target_at_reset: 50 } } }), preset, 87.5);
    expect(b.enabled).toBe(true);
    expect(b.weekly).toEqual({ no_new_starts_at: 87.5, stop_campaign_at: 87.5, target_at_reset: null });
    expect(b.five_hour).toEqual({ no_spawn_at: 75, stop_workers_at: 80 });
    expect(b.max_workers).toBe(2);
    expect(b.rates).toEqual(budget.rates);
  });
});

describe('workersAtFloor', () => {
  test('under the floor with 5h headroom is GO', () => {
    const v = workersAtFloor(limits(70, 40), NOW, budget, 4, 87.5, preset);
    expect(v.verdict).toBe('GO');
    expect(v.workers).toBeGreaterThanOrEqual(1);
  });
  test('at or over the floor stops the campaign without a wake', () => {
    for (const week of [87.5, 90]) {
      expect(workersAtFloor(limits(week, 40), NOW, budget, 4, 87.5, preset)).toMatchObject({ verdict: 'STOP-CAMPAIGN', wake_at: null });
    }
  });
  test('the 5h caps come from the preset', () => {
    expect(workersAtFloor(limits(80, 76), NOW, budget, 4, 87.5, preset).verdict).toBe('NO-SPAWN');
    expect(workersAtFloor(limits(80, 81), NOW, budget, 4, 87.5, preset).verdict).toBe('STOP-WORKERS');
  });
  test('a disabled base budget still gates', () => {
    const off = resolveUsageBudget({ usage_budget: { enabled: false } });
    expect(workersAtFloor(limits(70, 40), NOW, off, 4, 87.5, preset).verdict).toBe('GO');
    expect(workersAtFloor(limits(90, 40), NOW, off, 4, 87.5, preset).verdict).toBe('STOP-CAMPAIGN');
  });
  test('the default 78% no-new-starts line does not end a run below the floor', () => {
    expect(workersAtFloor(limits(80, 40), NOW, budget, 4, 87.5, preset).verdict).toBe('GO');
  });
  test('unreadable, expired and five-hour-only readings skip, weekly-only goes', () => {
    expect(workersAtFloor(null, NOW, budget, 4, 87.5, preset, {}, 'no cache')).toMatchObject({ verdict: 'SKIP', workers: 0 });
    expect(workersAtFloor(null, NOW, budget, 4, 87.5, preset).reasons[0]).toContain('fail-closed');
    const expired = { seven_day: { used_percentage: 10, resets_at: NOW - 1 } };
    expect(workersAtFloor(expired, NOW, budget, 4, 87.5, preset).verdict).toBe('SKIP');
    const fiveOnly = workersAtFloor(limits(null, 40), NOW, budget, 4, 87.5, preset);
    expect(fiveOnly.verdict).toBe('SKIP');
    expect(fiveOnly.reasons[0]).toContain('seven_day');
    expect(workersAtFloor(limits(70, null), NOW, budget, 4, 87.5, preset).verdict).toBe('GO');
  });
});

const report = (over: Partial<UsageReport>): UsageReport => ({
  plan: 'max',
  windows: [],
  extra_usage: null,
  source: 'usage-file',
  provider: 'usage-file',
  read_at: NOW,
  reason: null,
  ...over,
});

describe('readPacing', () => {
  test('Fri 09:30Z of a Mon 09:30Z reset, week 30%: 96 h elapsed, floor 45.71, shortfall 15.71', () => {
    const p = readPacing(report({ windows: [{ name: 'seven_day', used_pct: 30, resets_at: RESET }, { name: 'five_hour', used_pct: 40, resets_at: NOW + 2 * HOUR }] }), preset, NOW);
    expect(p).toMatchObject({ status: 'ok', floor_pct: 45.71, elapsed_h: 96, target_pct: 80, shortfall_pct: 15.71, used_pct: 30, five_hour_pct: 40, resets_at: RESET });
  });
  test('no source is unreadable', () => {
    expect(readPacing(report({ source: 'none', reason: 'cache stale' }), preset, NOW)).toMatchObject({ status: 'unreadable', floor_pct: null, elapsed_h: null, target_pct: null, reason: 'cache stale' });
  });
  test('plan none and five-hour-only are no-weekly', () => {
    expect(readPacing(report({ plan: 'none' }), preset, NOW)).toMatchObject({ status: 'no-weekly', reason: 'no plan limits' });
    const five = readPacing(report({ windows: [{ name: 'five_hour', used_pct: 40, resets_at: NOW + HOUR }] }), preset, NOW);
    expect(five).toMatchObject({ status: 'no-weekly', five_hour_pct: 40 });
  });
  test('the preset scales the floor', () => {
    const p = readPacing(report({ windows: [{ name: 'seven_day', used_pct: 50, resets_at: RESET }] }), { ...preset, weekly_target_pct: 60 }, NOW);
    expect(p.floor_pct).toBe(34.29);
  });
});

