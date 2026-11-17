import { describe, expect, test } from 'bun:test';
import * as fs from 'fs';
import * as path from 'path';
import { withTempDir } from './test-fixtures.ts';
import { resolveUsageBudget, resolveUsageWindows, workersAllowed } from './usage-budget.ts';
import { readRecordedHost, resolveHost, usageSourceFor } from './usage-source.ts';

const NOW = 1_800_000_000;
const HOUR = 3600;
const both = { five_hour: { used_percentage: 40, resets_at: NOW + 2 * HOUR }, seven_day: { used_percentage: 30, resets_at: NOW + 90 * HOUR } };
const weeklyOnly = { seven_day: { used_percentage: 30, resets_at: NOW + 90 * HOUR } };

const writeCache = (dir: string, rateLimits: unknown): string => {
  const cache = path.join(dir, 'rate-limits.json');
  fs.writeFileSync(cache, JSON.stringify({ rate_limits: rateLimits }));
  fs.utimesSync(cache, NOW - 10, NOW - 10);
  return cache;
};
const cfg = (cache: string, usageBudget: Record<string, unknown> = { enabled: true }) => ({
  resource_policy: { pace: { cache_path: cache } },
  usage_budget: usageBudget,
});

describe('usageSourceFor', () => {
  test('claude reads the rate-limit cache and detects both windows', () => {
    withTempDir('usage-source', (dir) => {
      const reading = usageSourceFor('claude', cfg(writeCache(dir, both))).read(NOW);
      expect(reading).toMatchObject({ source: 'rate-limit-cache', windows: ['five_hour', 'seven_day'], reason: null });
      expect(reading.limits).toEqual(both);
    });
  });

  test('claude with a weekly-only reading detects the weekly window alone', () => {
    withTempDir('usage-source', (dir) => {
      const reading = usageSourceFor('claude', cfg(writeCache(dir, weeklyOnly))).read(NOW);
      expect(reading.windows).toEqual(['seven_day']);
      expect(reading.limits?.five_hour).toBeUndefined();
    });
  });

  test('both windows detected: both legs gate the verdict', () => {
    withTempDir('usage-source', (dir) => {
      const fiveHigh = cfg(writeCache(dir, { ...both, five_hour: { used_percentage: 91, resets_at: NOW + HOUR } }));
      expect(workersAllowed(usageSourceFor('claude', fiveHigh).read(NOW).limits, NOW, resolveUsageBudget(fiveHigh), 4).verdict).toBe('STOP-WORKERS');
      const weekHigh = cfg(writeCache(dir, { ...both, seven_day: { used_percentage: 80, resets_at: NOW + 90 * HOUR } }));
      expect(workersAllowed(usageSourceFor('claude', weekHigh).read(NOW).limits, NOW, resolveUsageBudget(weekHigh), 4).verdict).toBe('STOP-CAMPAIGN');
    });
  });

  test('weekly-only detected: no 5-hour leg, the weekly thresholds still gate', () => {
    withTempDir('usage-source', (dir) => {
      const config = cfg(writeCache(dir, weeklyOnly));
      const r = workersAllowed(usageSourceFor('claude', config).read(NOW).limits, NOW, resolveUsageBudget(config), 4);
      expect(r.verdict).toBe('GO');
      expect(r.reasons.some((l) => l.includes('workers fit the five_hour headroom'))).toBe(false);
      const high = cfg(writeCache(dir, { seven_day: { used_percentage: 79, resets_at: NOW + 90 * HOUR } }));
      expect(workersAllowed(usageSourceFor('claude', high).read(NOW).limits, NOW, resolveUsageBudget(high), 4).verdict).toBe('NO-NEW-STARTS');
    });
  });

  test('config windows override drops a window the reading carries', () => {
    withTempDir('usage-source', (dir) => {
      const reading = usageSourceFor('claude', cfg(writeCache(dir, both), { enabled: true, windows: ['seven_day'] })).read(NOW);
      expect(reading.windows).toEqual(['seven_day']);
      expect(reading.limits).toEqual(weeklyOnly);
    });
  });

  test('an override leaving no detected window is unavailable with a reason', () => {
    withTempDir('usage-source', (dir) => {
      const reading = usageSourceFor('claude', cfg(writeCache(dir, weeklyOnly), { windows: ['five_hour'] })).read(NOW);
      expect(reading).toMatchObject({ limits: null, windows: [] });
      expect(reading.reason).toContain('usage_budget.windows');
    });
  });

  test('claude with no cache is unavailable with the reader reason', () => {
    withTempDir('usage-source', (dir) => {
      const cache = path.join(dir, 'missing.json');
      expect(usageSourceFor('claude', cfg(cache)).read(NOW)).toEqual({
        source: 'rate-limit-cache',
        limits: null,
        windows: [],
        reason: `no rate-limit cache at ${cache}`,
      });
    });
  });

  test('cursor has no readable source: unavailable verdict with a stated reason, never GO', () => {
    withTempDir('usage-source', (dir) => {
      const config = cfg(writeCache(dir, both));
      const reading = usageSourceFor('cursor', config).read(NOW);
      expect(reading).toMatchObject({ source: 'none', limits: null, windows: [] });
      expect(reading.reason).toContain('cursor');
      expect(workersAllowed(reading.limits, NOW, resolveUsageBudget(config), 4).verdict).toBe('unavailable');
    });
  });

  test('unknown host is unavailable with a reason', () => {
    expect(usageSourceFor('unknown', {}).read(NOW).reason).toContain('host unknown');
  });
});

describe('resolveUsageWindows', () => {
  test('absent or null is auto-detect', () => {
    expect(resolveUsageWindows({})).toBeNull();
    expect(resolveUsageWindows({ usage_budget: { windows: null } })).toBeNull();
  });
  test('rejects an unknown window or an empty list', () => {
    expect(() => resolveUsageWindows({ usage_budget: { windows: ['daily'] } })).toThrow('usage_budget.windows');
    expect(() => resolveUsageWindows({ usage_budget: { windows: [] } })).toThrow('usage_budget.windows');
  });
});

describe('host resolution', () => {
  test('the host recorded in run-context.json wins over the environment', () => {
    withTempDir('usage-source', (dir) => {
      fs.writeFileSync(path.join(dir, 'run-context.json'), JSON.stringify({ context: { host: { value: 'cursor', source: 'env' } } }));
      expect(readRecordedHost(dir)).toBe('cursor');
      expect(resolveHost(dir, { CLAUDECODE: '1' })).toBe('cursor');
    });
  });
  test('no run-context.json falls back to the environment', () => {
    withTempDir('usage-source', (dir) => {
      expect(readRecordedHost(dir)).toBeNull();
      expect(resolveHost(dir, { CLAUDECODE: '1' })).toBe('claude');
      expect(resolveHost(dir, {})).toBe('unknown');
    });
  });
});
