import { describe, expect, test } from 'bun:test';
import { DEFAULT_CATCHUP, applyOverrides, floorBudget, localUtcOffsetMinutes, readPacing, resolveCatchup, workersAtFloor } from './catchup.ts';
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
    expect(resolveCatchup({})).toEqual({ pct_per_weekday: 17.5, five_hour: { no_spawn_at: 75, stop_workers_at: 80 }, lane: null, claim_lease_hours: 24, day_end_hour: 18 });
  });
  test('a partial block merges over the defaults', () => {
    const c = resolveCatchup({ catchup: { pct_per_weekday: 20, five_hour: { no_spawn_at: 60 }, lane: 'acct-b' } });
    expect(c).toMatchObject({ pct_per_weekday: 20, lane: 'acct-b', claim_lease_hours: 24 });
    expect(c.five_hour).toEqual({ no_spawn_at: 60, stop_workers_at: 80 });
  });
  test.each([
    [{ catchup: 3 }, 'catchup must be an object'],
    [{ catchup: { pct_per_weekday: 0 } }, 'catchup.pct_per_weekday'],
    [{ catchup: { five_hour: 'x' } }, 'catchup.five_hour must be an object'],
    [{ catchup: { five_hour: { no_spawn_at: 80, stop_workers_at: 80 } } }, 'catchup.five_hour.no_spawn_at must be less than'],
    [{ catchup: { lane: 'Bad Lane' } }, 'catchup.lane'],
    [{ catchup: { claim_lease_hours: 0 } }, 'catchup.claim_lease_hours'],
    [{ catchup: { day_end_hour: 25 } }, 'catchup.day_end_hour'],
  ])('%j throws naming the key path', (config, message) => {
    expect(() => resolveCatchup(config as Record<string, unknown>)).toThrow(message);
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
  test('Fri 09:30Z, week 50%: floor 61.25, credits 3.5, shortfall 11.25', () => {
    const p = readPacing(report({ windows: [{ name: 'seven_day', used_pct: 50, resets_at: RESET }, { name: 'five_hour', used_pct: 40, resets_at: NOW + 2 * HOUR }] }), preset, NOW, 0);
    expect(p).toMatchObject({ status: 'ok', floor_pct: 61.25, credits: 3.5, shortfall_pct: 11.25, used_pct: 50, five_hour_pct: 40, resets_at: RESET });
  });
  test('no source is unreadable', () => {
    expect(readPacing(report({ source: 'none', reason: 'cache stale' }), preset, NOW, 0)).toMatchObject({ status: 'unreadable', floor_pct: null, reason: 'cache stale' });
  });
  test('plan none and five-hour-only are no-weekly', () => {
    expect(readPacing(report({ plan: 'none' }), preset, NOW, 0)).toMatchObject({ status: 'no-weekly', reason: 'no plan limits' });
    const five = readPacing(report({ windows: [{ name: 'five_hour', used_pct: 40, resets_at: NOW + HOUR }] }), preset, NOW, 0);
    expect(five).toMatchObject({ status: 'no-weekly', five_hour_pct: 40 });
  });
  test('the preset scales the floor', () => {
    const p = readPacing(report({ windows: [{ name: 'seven_day', used_pct: 50, resets_at: RESET }] }), { ...preset, pct_per_weekday: 20 }, NOW, 0);
    expect(p.floor_pct).toBe(70);
  });
});

describe('localUtcOffsetMinutes', () => {
  test('is a finite number of minutes', () => {
    expect(Number.isFinite(localUtcOffsetMinutes(NOW))).toBe(true);
  });
});
