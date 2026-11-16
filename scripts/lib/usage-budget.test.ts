import { describe, expect, test } from 'bun:test';
import { findUnregisteredConfigKeys, flattenConfigKeys, parseConfigTemplateKeys } from '../checks/config-registration.check.ts';
import { read } from '../checks/check-utils.ts';
import type { RateLimits } from './pace-gate.ts';
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
    expect(workersAllowed(usage(0, 0, 900), NOW, budget, 3).workers).toBe(4);
  });
  for (const secondsLeft of [1, 899]) {
    test(`hours_to_reset is floored at 15 minutes (${secondsLeft}s left)`, () => {
      const r = decide(usage(10, 10, secondsLeft));
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
  test('five_hour window already past resets_at is treated as absent', () => {
    const r = decide(usage(95, 10, 0));
    expect(r.verdict).toBe('unavailable');
    expect(r.workers).toBe(3);
  });
  test('five_hour absent', () => {
    expect(decide(usage(null, 79)).verdict).toBe('unavailable');
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
  const template = read('src/references/config-template.md');

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
