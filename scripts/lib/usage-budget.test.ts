import { describe, expect, test } from 'bun:test';
import { findUnregisteredConfigKeys, flattenConfigKeys, parseConfigTemplateKeys } from '../checks/config-registration.check.ts';
import * as fs from 'fs';
import * as path from 'path';
import { root } from './build/paths.ts';
import type { RateLimits } from './rate-limit-cache.ts';
import { DEFAULT_USAGE_BUDGET, forecastWeekly, resolveUsageBudget, workersAllowed, type UsageBudgetConfig } from './usage-budget.ts';

const NOW = 1_800_000_000;
const HOUR = 3600;
const budget: UsageBudgetConfig = { ...DEFAULT_USAGE_BUDGET, enabled: true };
const usage = (five: number | null, week: number | null, fiveResetsIn = 4 * HOUR): RateLimits => ({
  ...(five === null ? {} : { five_hour: { used_percentage: five, resets_at: NOW + fiveResetsIn } }),
  ...(week === null ? {} : { seven_day: { used_percentage: week, resets_at: NOW + 3 * 24 * HOUR } }),
});
const decide = (u: RateLimits | null) => workersAllowed(u, NOW, budget, 3);

describe('workersAllowed verdicts and boundaries', () => {
  const rows: [string, number, number, string][] = [
    ['5h 84.9 is GO', 84.9, 10, 'GO'],
    ['5h 85 is NO-SPAWN', 85, 10, 'NO-SPAWN'],
    ['5h 89.9 is NO-SPAWN', 89.9, 10, 'NO-SPAWN'],
    ['5h 90 is STOP-WORKERS', 90, 10, 'STOP-WORKERS'],
    ['weekly 77.9 is GO', 10, 77.9, 'GO'],
    ['weekly 78 is NO-NEW-STARTS', 10, 78, 'NO-NEW-STARTS'],
    ['weekly 79.9 is NO-NEW-STARTS', 10, 79.9, 'NO-NEW-STARTS'],
    ['weekly 80 is STOP-CAMPAIGN', 10, 80, 'STOP-CAMPAIGN'],
    ['STOP-CAMPAIGN beats STOP-WORKERS', 95, 80, 'STOP-CAMPAIGN'],
    ['STOP-WORKERS beats NO-NEW-STARTS', 90, 78, 'STOP-WORKERS'],
    ['NO-NEW-STARTS beats NO-SPAWN', 85, 78, 'NO-NEW-STARTS'],
  ];
  for (const [name, five, week, verdict] of rows) {
    test(name, () => {
      expect(decide(usage(five, week)).verdict).toBe(verdict as never);
    });
  }

  test('every blocking verdict allows zero workers; only STOP-WORKERS carries a wake time', () => {
    expect(decide(usage(85, 10)).workers).toBe(0);
    expect(decide(usage(10, 78)).workers).toBe(0);
    expect(decide(usage(10, 80)).workers).toBe(0);
    const stop = decide(usage(90, 10));
    expect(stop.workers).toBe(0);
    expect(stop.wake_at).toBe(NOW + 4 * HOUR);
    expect(decide(usage(85, 10)).wake_at).toBeNull();
  });
});

describe('GO worker count', () => {
  test('sizes to the headroom per hour minus the orchestrator, per worker rate', () => {
    // (90-10)/4 = 20 %/h; (20-6)/7 = 2
    expect(decide(usage(10, 10))).toMatchObject({ verdict: 'GO', workers: 2, hours_to_reset: 4 });
  });
  test('clamps to 1 when the formula is below 1', () => {
    expect(decide(usage(84, 10)).workers).toBe(1);
  });
  test('clamps to max_workers when the formula is above it', () => {
    expect(workersAllowed(usage(0, 0, 5 * HOUR), NOW, { ...budget, max_workers: 1 }, 3).workers).toBe(1);
    expect(workersAllowed(usage(0, 0, 900), NOW, budget, 9).workers).toBe(4);
  });
  for (const secondsLeft of [1, 899]) {
    test(`hours_to_reset is floored at 15 minutes (${secondsLeft}s left)`, () => {
      const r = workersAllowed(usage(10, 10, secondsLeft), NOW, budget, 9);
      expect(r.hours_to_reset).toBe(0.25);
      expect(r.workers).toBe(4);
    });
  }
});

describe('unavailable usage fails open with a reason', () => {
  test('usage null', () => {
    expect(decide(null)).toMatchObject({ verdict: 'unavailable', workers: 3, wake_at: null, hours_to_reset: null });
    expect(decide(null).reasons[0]).toContain('usage unavailable');
  });
  test('neither window current', () => {
    expect(decide({ five_hour: { used_percentage: 5, resets_at: NOW - 1 } }).verdict).toBe('unavailable');
  });
});

describe('weekly-only usage (no five_hour window) gates on the weekly rules alone', () => {
  test('five_hour window already past resets_at is treated as absent', () => {
    const r = decide(usage(95, 10, 0));
    expect(r.verdict).toBe('GO');
    expect(r.workers).toBe(3);
    expect(r.reasons.filter((l) => l.startsWith('five_hour absent'))).toHaveLength(1);
  });
  test('five_hour absent: the weekly lines still stop new starts and the campaign', () => {
    expect(decide(usage(null, 79)).verdict).toBe('NO-NEW-STARTS');
    expect(decide(usage(null, 80)).verdict).toBe('STOP-CAMPAIGN');
  });
  test('weekly absent skips weekly rules and says so', () => {
    const r = decide(usage(10, null));
    expect(r.verdict).toBe('GO');
    expect(r.reasons.join()).toContain('seven_day absent');
  });
  test('weekly window past its reset is ignored', () => {
    const r = decide({ five_hour: { used_percentage: 10, resets_at: NOW + HOUR }, seven_day: { used_percentage: 99, resets_at: NOW - 1 } });
    expect(r.verdict).toBe('GO');
  });
});

describe('resolveUsageBudget', () => {
  test('usage_budget.windows is validated with the rest of the block', () => {
    expect(resolveUsageBudget({ usage_budget: { windows: ['seven_day'] } }).windows).toEqual(['seven_day']);
    expect(() => resolveUsageBudget({ usage_budget: { windows: 'seven_day' } })).toThrow('usage_budget.windows');
  });
  test('absent block gives the defaults with enabled false', () => {
    expect(resolveUsageBudget({})).toEqual(DEFAULT_USAGE_BUDGET);
    expect(DEFAULT_USAGE_BUDGET.enabled).toBe(false);
  });
  test('overrides merge per key', () => {
    const r = resolveUsageBudget({ usage_budget: { enabled: true, five_hour: { no_spawn_at: 70 }, max_workers: 2 } });
    expect(r.enabled).toBe(true);
    expect(r.five_hour).toEqual({ no_spawn_at: 70, stop_workers_at: 90 });
    expect(r.max_workers).toBe(2);
  });
  const invalid: [string, Record<string, unknown>, string][] = [
    ['usage_budget not an object', { usage_budget: 3 }, 'usage_budget must be an object'],
    ['enabled not boolean', { usage_budget: { enabled: 'yes' } }, 'usage_budget.enabled'],
    ['no_spawn_at zero', { usage_budget: { five_hour: { no_spawn_at: 0 } } }, 'usage_budget.five_hour.no_spawn_at'],
    ['stop_workers_at above 100', { usage_budget: { five_hour: { stop_workers_at: 101 } } }, 'usage_budget.five_hour.stop_workers_at'],
    ['no_spawn_at not below stop_workers_at', { usage_budget: { five_hour: { no_spawn_at: 90 } } }, 'usage_budget.five_hour.no_spawn_at must be less'],
    ['no_new_starts_at wrong type', { usage_budget: { weekly: { no_new_starts_at: '78' } } }, 'usage_budget.weekly.no_new_starts_at'],
    ['no_new_starts_at not below stop_campaign_at', { usage_budget: { weekly: { no_new_starts_at: 80 } } }, 'usage_budget.weekly.no_new_starts_at must be less'],
    ['stop_campaign_at above 100', { usage_budget: { weekly: { stop_campaign_at: 120 } } }, 'usage_budget.weekly.stop_campaign_at'],
    ['orchestrator rate zero', { usage_budget: { rates: { orchestrator_pct_per_hour: 0 } } }, 'usage_budget.rates.orchestrator_pct_per_hour'],
    ['worker rate negative', { usage_budget: { rates: { worker_pct_per_hour: -1 } } }, 'usage_budget.rates.worker_pct_per_hour'],
    ['max_workers zero', { usage_budget: { max_workers: 0 } }, 'usage_budget.max_workers'],
    ['max_workers fractional', { usage_budget: { max_workers: 2.5 } }, 'usage_budget.max_workers'],
    ['unknown role', { usage_budget: { coordination: { role: 'boss' } } }, 'usage_budget.coordination.role'],
    ['peer without manager_session', { usage_budget: { coordination: { role: 'peer' } } }, 'usage_budget.coordination.manager_session'],
    ['peer with empty manager_session', { usage_budget: { coordination: { role: 'peer', manager_session: '' } } }, 'usage_budget.coordination.manager_session'],
    ['peer_floor negative', { usage_budget: { coordination: { peer_floor: -1 } } }, 'usage_budget.coordination.peer_floor'],
    ['section not an object', { usage_budget: { rates: [] } }, 'usage_budget.rates must be an object'],
  ];
  for (const [name, config, path] of invalid) {
    test(`throws with the key path: ${name}`, () => {
      expect(() => resolveUsageBudget(config)).toThrow(path);
    });
  }
  test('a peer with a manager_session is valid', () => {
    expect(resolveUsageBudget({ usage_budget: { coordination: { role: 'peer', manager_session: 's1' } } }).coordination.role).toBe('peer');
  });
});

describe('forecastWeekly', () => {
  const weekly = budget.weekly;
  const none = { pct_per_hour: null, reaches_at_pct: { no_new_starts_at: null, stop_campaign_at: null } };
  test('0 and 1 samples give nothing', () => {
    expect(forecastWeekly([], NOW, weekly)).toEqual(none);
    expect(forecastWeekly([{ at: NOW, used_percentage: 10 }], NOW, weekly)).toEqual(none);
  });
  test('2 samples extrapolate linearly to each threshold', () => {
    // 1 pct/h, 50% now: 78 in 28h, 80 in 30h
    const f = forecastWeekly([{ at: NOW - HOUR, used_percentage: 49 }, { at: NOW, used_percentage: 50 }], NOW, weekly);
    expect(f.pct_per_hour).toBeCloseTo(1, 6);
    expect(f.reaches_at_pct.no_new_starts_at).toBe(NOW + 28 * HOUR);
    expect(f.reaches_at_pct.stop_campaign_at).toBe(NOW + 30 * HOUR);
  });
  test('a flat or falling slope gives nothing', () => {
    expect(forecastWeekly([{ at: NOW - HOUR, used_percentage: 50 }, { at: NOW, used_percentage: 50 }], NOW, weekly)).toEqual(none);
    expect(forecastWeekly([{ at: NOW - HOUR, used_percentage: 60 }, { at: NOW, used_percentage: 50 }], NOW, weekly)).toEqual(none);
  });
  test('samples at one instant give nothing', () => {
    expect(forecastWeekly([{ at: NOW, used_percentage: 1 }, { at: NOW, used_percentage: 2 }], NOW, weekly)).toEqual(none);
  });
  test('an already-crossed threshold is null while the other still projects', () => {
    const f = forecastWeekly([{ at: NOW - HOUR, used_percentage: 78 }, { at: NOW, used_percentage: 79 }], NOW, weekly);
    expect(f.reaches_at_pct.no_new_starts_at).toBeNull();
    expect(f.reaches_at_pct.stop_campaign_at).toBe(NOW + HOUR);
  });
});

describe('config registration of the usage_budget block (V-CONFIG-02)', () => {
  const full = {
    usage_budget: {
      enabled: true,
      five_hour: { no_spawn_at: 85, stop_workers_at: 90 },
      weekly: { no_new_starts_at: 78, stop_campaign_at: 80 },
      rates: { orchestrator_pct_per_hour: 6, worker_pct_per_hour: 7 },
      max_workers: 4,
      coordination: { role: 'solo', manager_session: null, peer_floor: 1 },
    },
  };
  const keys = flattenConfigKeys(full);
  const template = fs.readFileSync(path.join(root, 'src', 'references', 'config-template.md'), 'utf-8');

  test('every leaf is registered in config-template.md', () => {
    expect(keys.length).toBe(11);
    expect(findUnregisteredConfigKeys(keys, parseConfigTemplateKeys(template))).toEqual([]);
  });
  test('removing any one row makes a leaf unregistered', () => {
    for (const key of keys) {
      const without = template.split('\n').filter((l) => !l.startsWith(`| \`${key}\` |`)).join('\n');
      expect(findUnregisteredConfigKeys(keys, parseConfigTemplateKeys(without))).toEqual([key]);
    }
  });
  test('the resolved default matches the documented shape', () => {
    expect(resolveUsageBudget(full)).toEqual({ ...DEFAULT_USAGE_BUDGET, enabled: true });
  });
});

describe('GO worker count is clamped to parallelMax', () => {
  test('min of max_workers and parallelMax', () => {
    // formula gives 4 (max_workers) on a 15-minute window; parallelMax 2 caps it
    expect(workersAllowed(usage(0, 0, 900), NOW, budget, 2).workers).toBe(2);
    expect(workersAllowed(usage(0, 0, 900), NOW, budget, 9).workers).toBe(4);
  });
});

describe('weekly pacing to target_at_reset', () => {
  const target = (t: number, extra: Record<string, unknown> = {}): UsageBudgetConfig =>
    resolveUsageBudget({ usage_budget: { enabled: true, weekly: { target_at_reset: t }, ...extra } });
  // weekly-only usage (the plan with no five-hour window)
  const weekOnly = (used: number, hoursToReset: number): RateLimits => ({
    seven_day: { used_percentage: used, resets_at: NOW + Math.round(hoursToReset * HOUR) },
  });
  const both = (five: number, week: number, weekHours: number): RateLimits => ({
    five_hour: { used_percentage: five, resets_at: NOW + 4 * HOUR },
    seven_day: { used_percentage: week, resets_at: NOW + weekHours * HOUR },
  });
  // light measured rates: 0.1 orchestrator, 0.2 per worker (weekly %/h)
  const light = { rates: { orchestrator_weekly_pct_per_hour: 0.1, worker_weekly_pct_per_hour: 0.2 } };

  const rows: [string, RateLimits, UsageBudgetConfig, string, number][] = [
    // shipped defaults 0.1 + 0.15/worker: (79/110 - 0.1)/0.15 = 4.12 -> 4
    ['owner case: seven_day only, 21% at 110h, target 100, shipped defaults -> GO', weekOnly(21, 110), target(100), 'GO', 4],
    // 0.05% left over the 15-minute floor = 0.2 %/h < one worker's 0.25 -> wait for the reset
    ['near the target at 1h -> PACE-WAIT', weekOnly(99.95, 1), target(100), 'PACE-WAIT', 0],
    // under pace: (50/10 - 0.1)/0.2 = 24.5 -> clamped to max_workers 4
    ['under pace clamps to max_workers', weekOnly(50, 10), target(100, light), 'GO', 4],
    // over pace with default rates: 10/100 = 0.1 %/h, all of it the orchestrator's -> nothing fits
    ['over pace with default rates -> PACE-WAIT', weekOnly(90, 100), target(100), 'PACE-WAIT', 0],
    // 5h leg gives 2 (see GO worker count), weekly leg gives 3 -> min 2
    ['min() picks the five_hour fit when it is smaller', both(10, 21, 110), target(100, light), 'GO', 2],
    // 5h leg gives 2, weekly leg (40/100 - 0.1)/0.2 = 1.5 -> 1
    ['min() picks the weekly fit when it is smaller', both(10, 60, 100), target(100, light), 'GO', 1],
    // 5h leg gives 2, weekly fit 0 -> PACE-WAIT, never STOP-CAMPAIGN
    ['weekly fit below 1 with a five_hour window -> PACE-WAIT', both(10, 90, 100), target(100), 'PACE-WAIT', 0],
    ['reaching the target is STOP-CAMPAIGN (stop_campaign_at defaults to target)', weekOnly(90, 10), target(90, light), 'STOP-CAMPAIGN', 0],
  ];
  for (const [name, u, b, verdict, workers] of rows) {
    test(name, () => {
      const r = workersAllowed(u, NOW, b, 9);
      expect(r.verdict).toBe(verdict as never);
      expect(r.workers).toBe(workers);
    });
  }

  test('PACE-WAIT wake_at is the first second one worker fits again', () => {
    const b = target(100);
    const u = weekOnly(90, 100);
    const r = workersAllowed(u, NOW, b, 9);
    // one worker needs 0.1 + 0.15 = 0.25 %/h: 10 / 0.25 = 40 h before the reset
    const expected = Math.ceil(NOW + 100 * HOUR - 40 * HOUR);
    expect(r.wake_at).toBe(expected);
    expect(workersAllowed(u, r.wake_at as number, b, 9)).toMatchObject({ verdict: 'GO', workers: 1 });
    expect(workersAllowed(u, (r.wake_at as number) - 60, b, 9).verdict).toBe('PACE-WAIT');
  });
  test('PACE-WAIT when no worker fits before the 15-minute floor wakes at the weekly reset', () => {
    expect(workersAllowed(weekOnly(99.95, 1), NOW, target(100), 9).wake_at).toBe(NOW + HOUR);
  });
  test('PACE-WAIT past an explicit no_new_starts_at above the target wakes at the weekly reset', () => {
    const b = target(90, { weekly: { target_at_reset: 90, no_new_starts_at: 95, stop_campaign_at: 100 } });
    expect(workersAllowed(weekOnly(96, 10), NOW, b, 9)).toMatchObject({ verdict: 'PACE-WAIT', wake_at: NOW + 10 * HOUR });
  });
  test('hours to the weekly reset are floored at 15 minutes', () => {
    // rates 1 + 10/worker: 3% left over 0.25h = 12 %/h -> (12-1)/10 = 1 (no floor would give thousands)
    const b = target(100, { rates: { orchestrator_weekly_pct_per_hour: 1, worker_weekly_pct_per_hour: 10 } });
    const r = workersAllowed({ seven_day: { used_percentage: 97, resets_at: NOW + 1 } }, NOW, b, 9);
    expect(r).toMatchObject({ verdict: 'GO', workers: 1, weekly_fit: 1, hours_to_reset: 0.25 });
  });
  test('five_hour absent skips the 5-hour legs with one reason line', () => {
    const r = workersAllowed(weekOnly(21, 110), NOW, target(100, light), 9);
    expect(r.reasons.filter((l) => l.includes('five_hour absent'))).toHaveLength(1);
    expect(r.weekly_fit).toBe(3);
  });
  test('five_hour absent and no target: GO capped at the ceiling, no weekly fit', () => {
    expect(workersAllowed(weekOnly(21, 110), NOW, budget, 3)).toMatchObject({ verdict: 'GO', workers: 3, weekly_fit: null });
  });
  test('seven_day absent with a target paces on the 5-hour leg alone', () => {
    const r = workersAllowed(usage(10, null), NOW, target(100), 3);
    expect(r).toMatchObject({ verdict: 'GO', workers: 2, weekly_fit: null });
    expect(r.reasons.join()).toContain('seven_day absent');
  });
  test('weekly-only fit is clamped to parallelMax', () => {
    expect(workersAllowed(weekOnly(50, 10), NOW, target(100, light), 2).workers).toBe(2);
  });
  test('measured weekly rates win over the configured ones', () => {
    // configured defaults PACE-WAIT at 90% / 100h; measured 0.01 + 0.02 give (0.1 - 0.01)/0.02 = 4.5 -> 4
    const r = workersAllowed(weekOnly(90, 100), NOW, target(100), 9, { orchestrator_weekly_pct_per_hour: 0.01, worker_weekly_pct_per_hour: 0.02 });
    expect(r).toMatchObject({ verdict: 'GO', workers: 4 });
  });
  const badMeasured: [string, number][] = [['NaN', Number.NaN], ['0', 0], ['negative', -1], ['Infinity', Number.POSITIVE_INFINITY]];
  for (const [name, value] of badMeasured) {
    test(`an invalid measured rate (${name}) falls back to the configured rate with a reason`, () => {
      const r = workersAllowed(weekOnly(90, 100), NOW, target(100), 9, { orchestrator_weekly_pct_per_hour: value, worker_weekly_pct_per_hour: value });
      expect(r.verdict).toBe('PACE-WAIT');
      expect(r.reasons.filter((l) => l.startsWith('measured ') && l.includes('configured rate used'))).toHaveLength(2);
    });
  }
  test('no target keeps weekly_fit null', () => {
    expect(decide(usage(10, 10)).weekly_fit).toBeNull();
  });
});

describe('resolveUsageBudget weekly target keys', () => {
  test('target absent keeps the existing weekly defaults', () => {
    expect(resolveUsageBudget({}).weekly).toEqual({ no_new_starts_at: 78, stop_campaign_at: 80, target_at_reset: null });
  });
  test('target set moves both unset weekly lines to the target', () => {
    expect(resolveUsageBudget({ usage_budget: { weekly: { target_at_reset: 100 } } }).weekly).toEqual({
      no_new_starts_at: 100,
      stop_campaign_at: 100,
      target_at_reset: 100,
    });
  });
  test('explicit weekly lines win over the target', () => {
    const w = resolveUsageBudget({ usage_budget: { weekly: { target_at_reset: 90, no_new_starts_at: 95, stop_campaign_at: 100 } } }).weekly;
    expect(w).toEqual({ no_new_starts_at: 95, stop_campaign_at: 100, target_at_reset: 90 });
  });
  test('an explicit target_at_reset null is the same as absent', () => {
    expect(resolveUsageBudget({ usage_budget: { weekly: { target_at_reset: null } } })).toEqual(DEFAULT_USAGE_BUDGET);
  });
  test('weekly rate defaults are the 0.1 / 0.15 starting points', () => {
    const r = resolveUsageBudget({}).rates;
    expect(r.orchestrator_weekly_pct_per_hour).toBe(0.1);
    expect(r.worker_weekly_pct_per_hour).toBe(0.15);
  });
  const invalid: [string, Record<string, unknown>, string][] = [
    ['target zero', { usage_budget: { weekly: { target_at_reset: 0 } } }, 'usage_budget.weekly.target_at_reset'],
    ['target above 100', { usage_budget: { weekly: { target_at_reset: 101 } } }, 'usage_budget.weekly.target_at_reset'],
    ['stop_campaign_at below the target', { usage_budget: { weekly: { target_at_reset: 100, stop_campaign_at: 80 } } }, 'usage_budget.weekly.stop_campaign_at must be >= usage_budget.weekly.target_at_reset'],
    ['no_new_starts_at below the target', { usage_budget: { weekly: { target_at_reset: 100, no_new_starts_at: 78 } } }, 'usage_budget.weekly.no_new_starts_at must be >= usage_budget.weekly.target_at_reset'],
    ['no_new_starts_at above stop_campaign_at with a target', { usage_budget: { weekly: { target_at_reset: 90, no_new_starts_at: 100, stop_campaign_at: 95 } } }, 'usage_budget.weekly.no_new_starts_at must be at most'],
    ['weekly worker rate zero', { usage_budget: { rates: { worker_weekly_pct_per_hour: 0 } } }, 'usage_budget.rates.worker_weekly_pct_per_hour'],
    ['weekly orchestrator rate string', { usage_budget: { rates: { orchestrator_weekly_pct_per_hour: '1' } } }, 'usage_budget.rates.orchestrator_weekly_pct_per_hour'],
  ];
  for (const [name, config, p] of invalid) {
    test(`throws with the key path: ${name}`, () => {
      expect(() => resolveUsageBudget(config)).toThrow(p);
    });
  }
  test('the three new keys are registered in config-template.md', () => {
    const template = fs.readFileSync(path.join(root, 'src', 'references', 'config-template.md'), 'utf-8');
    const keys = flattenConfigKeys({
      usage_budget: { weekly: { target_at_reset: 100 }, rates: { orchestrator_weekly_pct_per_hour: 1, worker_weekly_pct_per_hour: 1 } },
    });
    expect(keys.length).toBe(3);
    expect(findUnregisteredConfigKeys(keys, parseConfigTemplateKeys(template))).toEqual([]);
  });
});
