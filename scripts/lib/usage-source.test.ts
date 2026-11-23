import { describe, expect, test } from 'bun:test';
import * as fs from 'fs';
import * as path from 'path';
import { withTempDir } from './test-fixtures.ts';
import { resolveUsageBudget, resolveUsageWindows, workersAllowed } from './usage-budget.ts';
import { UsageFileError } from './usage-normalize.ts';
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

  test('unknown host still reads a present rate-limit cache: an unsure detection never discards it', () => {
    withTempDir('usage-source', (dir) => {
      const reading = usageSourceFor('unknown', cfg(writeCache(dir, both))).read(NOW);
      expect(reading).toMatchObject({ source: 'rate-limit-cache', windows: ['five_hour', 'seven_day'], reason: null });
    });
  });

  test('unknown host with no cache is unavailable, and the reason names the unknown host', () => {
    withTempDir('usage-source', (dir) => {
      const reading = usageSourceFor('unknown', cfg(path.join(dir, 'missing.json'))).read(NOW);
      expect(reading.limits).toBeNull();
      expect(reading.reason).toMatch(/^host unknown: no rate-limit cache at /);
    });
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

const writeUsageFile = (dir: string, payload: unknown, mtime = NOW - 10): string => {
  const file = path.join(dir, 'usage.json');
  fs.writeFileSync(file, typeof payload === 'string' ? payload : JSON.stringify(payload));
  fs.utimesSync(file, mtime, mtime);
  return file;
};
const fileWindows = [
  { name: 'five_hour', used_pct: 40, resets_at: NOW + 2 * HOUR },
  { name: 'seven_day', used_pct: 30, resets_at: NOW + 90 * HOUR },
  { name: 'seven_day_opus', used_pct: 12, resets_at: NOW + 90 * HOUR },
];

describe('usageSourceFor provider chain', () => {
  test('an explicit file reports plan, every window and extra_usage; read() keeps the two gate windows', () => {
    withTempDir('usage-source', (dir) => {
      const usageFile = writeUsageFile(dir, { plan: 'max', extra_usage: { enabled: true, currency: 'USD' }, windows: fileWindows });
      const source = usageSourceFor('claude', cfg(path.join(dir, 'missing.json')), { usageFile });
      expect(source.report(NOW)).toEqual({
        plan: 'max',
        windows: fileWindows,
        extra_usage: { enabled: true, currency: 'USD' },
        source: 'usage-file',
        provider: 'usage-file',
        read_at: NOW - 10,
        reason: null,
      });
      const reading = source.read(NOW);
      expect(reading).toMatchObject({ source: 'usage-file', windows: ['five_hour', 'seven_day'], reason: null });
      expect(reading.limits).toEqual(both);
    });
  });

  test('a desktop-shaped file converts utilization and an ISO reset', () => {
    withTempDir('usage-source', (dir) => {
      const iso = new Date((NOW + 90 * HOUR) * 1000).toISOString();
      const usageFile = writeUsageFile(dir, { seven_day: { utilization: 0.09, resetsAt: iso } });
      expect(usageSourceFor('claude', cfg('/none.json'), { usageFile }).report(NOW).windows).toEqual([{ name: 'seven_day', used_pct: 9, resets_at: NOW + 90 * HOUR }]);
    });
  });

  test('plan none with no window is a valid reading: no limits, reason "no plan limits"', () => {
    withTempDir('usage-source', (dir) => {
      const usageFile = writeUsageFile(dir, { plan: 'none', windows: [] });
      const source = usageSourceFor('claude', cfg('/none.json'), { usageFile });
      expect(source.report(NOW)).toMatchObject({ plan: 'none', windows: [], source: 'usage-file', reason: null });
      expect(source.read(NOW)).toEqual({ source: 'usage-file', limits: null, windows: [], reason: 'no plan limits' });
    });
  });

  test('a stale file fails closed: a fresh cache is never read in its place, the reason names the stale file', () => {
    withTempDir('usage-source', (dir) => {
      const usageFile = writeUsageFile(dir, { windows: fileWindows }, NOW - 700);
      const source = usageSourceFor('claude', cfg(writeCache(dir, weeklyOnly)), { usageFile });
      const report = source.report(NOW);
      expect(report).toMatchObject({ source: 'none', provider: 'none', plan: 'unknown', windows: [], extra_usage: null, read_at: null });
      expect(report.reason).toMatch(/^usage file stale \(\d+s > 600s\)$/);
      const reading = source.read(NOW);
      expect(reading).toMatchObject({ limits: null, windows: [] });
      expect(reading.reason).toMatch(/^usage file stale /);
    });
  });

  test('a stale file and no cache: the reason is the stale file alone, the cache is not consulted', () => {
    withTempDir('usage-source', (dir) => {
      const usageFile = writeUsageFile(dir, { windows: fileWindows }, NOW - 700);
      const report = usageSourceFor('claude', cfg(path.join(dir, 'missing.json')), { usageFile }).report(NOW);
      expect(report).toMatchObject({ source: 'none', provider: 'none', plan: 'unknown', windows: [], extra_usage: null, read_at: null });
      expect(report.reason).toMatch(/^usage file stale \(\d+s > 600s\)$/);
    });
  });

  test('a file whose windows are all past their reset fails the provider, the chain moves on', () => {
    withTempDir('usage-source', (dir) => {
      const usageFile = writeUsageFile(dir, { windows: [{ name: 'seven_day', used_pct: 5, resets_at: NOW - 1 }] });
      const report = usageSourceFor('claude', cfg(writeCache(dir, both)), { usageFile }).report(NOW);
      expect(report.provider).toBe('statusline');
    });
  });

  test('a missing or malformed file throws UsageFileError naming the path', () => {
    withTempDir('usage-source', (dir) => {
      const missing = path.join(dir, 'nope.json');
      expect(() => usageSourceFor('claude', cfg('/none.json'), { usageFile: missing }).report(NOW)).toThrow(UsageFileError);
      expect(() => usageSourceFor('claude', cfg('/none.json'), { usageFile: missing }).report(NOW)).toThrow(missing);
      const bad = writeUsageFile(dir, '{not json');
      expect(() => usageSourceFor('claude', cfg('/none.json'), { usageFile: bad }).read(NOW)).toThrow(bad);
      const noWindow = writeUsageFile(dir, { plan: 'max', windows: [] });
      expect(() => usageSourceFor('claude', cfg('/none.json'), { usageFile: noWindow }).report(NOW)).toThrow(UsageFileError);
    });
  });

  test('a statusline cache reports provider statusline, plan unknown, read_at = the file mtime', () => {
    withTempDir('usage-source', (dir) => {
      const report = usageSourceFor('claude', cfg(writeCache(dir, both))).report(NOW);
      expect(report).toMatchObject({
        plan: 'unknown',
        extra_usage: null,
        source: 'rate-limit-cache',
        provider: 'statusline',
        read_at: NOW - 10,
        reason: null,
      });
      expect(report.windows).toEqual([
        { name: 'five_hour', used_pct: 40, resets_at: NOW + 2 * HOUR },
        { name: 'seven_day', used_pct: 30, resets_at: NOW + 90 * HOUR },
      ]);
    });
  });

  test('a probe-written cache reports provider probe under source rate-limit-cache', () => {
    withTempDir('usage-source', (dir) => {
      const cache = path.join(dir, 'rate-limits.json');
      fs.writeFileSync(cache, JSON.stringify({ rate_limits: both, source: 'rate_limit_event' }));
      fs.utimesSync(cache, NOW - 20, NOW - 20);
      expect(usageSourceFor('claude', cfg(cache)).report(NOW)).toMatchObject({ provider: 'probe', source: 'rate-limit-cache', read_at: NOW - 20 });
    });
  });

  test('cursor uses an explicit file; without one it reports none with the cursor reason', () => {
    withTempDir('usage-source', (dir) => {
      const usageFile = writeUsageFile(dir, { windows: fileWindows });
      expect(usageSourceFor('cursor', cfg('/none.json'), { usageFile }).report(NOW)).toMatchObject({ source: 'usage-file' });
      const none = usageSourceFor('cursor', cfg('/none.json')).report(NOW);
      expect(none).toMatchObject({ source: 'none', provider: 'none' });
      expect(none.reason).toContain('cursor');
    });
  });

  test('usage_budget.windows restricts read() only; the report still lists every window', () => {
    withTempDir('usage-source', (dir) => {
      const usageFile = writeUsageFile(dir, { windows: fileWindows });
      const source = usageSourceFor('claude', cfg('/none.json', { enabled: true, windows: ['seven_day'] }), { usageFile });
      expect(source.read(NOW).windows).toEqual(['seven_day']);
      expect(source.report(NOW).windows.map((w) => w.name)).toEqual(['five_hour', 'seven_day', 'seven_day_opus']);
    });
  });

  describe('another account wrote the shared cache', () => {
    const writeHistory = (dir: string, readings: unknown[]): string => {
      const file = path.join(dir, 'usage-history.jsonl');
      fs.writeFileSync(file, readings.map((r) => JSON.stringify(r)).join('\n') + '\n');
      return file;
    };
    const ours = { observed_at: NOW - 600, used_percentage: 34, resets_at: NOW + 90 * HOUR };

    test('a cache whose weekly resets_at differs from the campaign last probe is refused', () => {
      withTempDir('usage-source', (dir) => {
        const other = { seven_day: { used_percentage: 26, resets_at: NOW + 109 * HOUR } };
        const historyPath = writeHistory(dir, [ours]);
        const source = usageSourceFor('claude', cfg(writeCache(dir, other)), { historyPath });
        const report = source.report(NOW);
        expect(report).toMatchObject({ source: 'none', windows: [] });
        expect(report.reason).toContain('another account');
        expect(source.read(NOW).limits).toBeNull();
      });
    });

    test('a weekly-less cache is refused while the campaign holds a current weekly probe', () => {
      withTempDir('usage-source', (dir) => {
        const historyPath = writeHistory(dir, [ours]);
        const fiveOnly = { five_hour: { used_percentage: 10, resets_at: NOW + HOUR } };
        expect(usageSourceFor('claude', cfg(writeCache(dir, fiveOnly)), { historyPath }).report(NOW).source).toBe('none');
      });
    });

    test('a cache matching the latest probe is read', () => {
      withTempDir('usage-source', (dir) => {
        const older = { observed_at: NOW - 9000, used_percentage: 20, resets_at: NOW - HOUR };
        const historyPath = writeHistory(dir, [older, ours]);
        expect(usageSourceFor('claude', cfg(writeCache(dir, weeklyOnly)), { historyPath }).report(NOW)).toMatchObject({ source: 'rate-limit-cache', reason: null });
      });
    });

    test('a past-reset last probe or no history leaves the cache unchecked', () => {
      withTempDir('usage-source', (dir) => {
        const other = { seven_day: { used_percentage: 26, resets_at: NOW + 109 * HOUR } };
        const past = writeHistory(dir, [{ observed_at: NOW - 9000, used_percentage: 90, resets_at: NOW - HOUR }]);
        expect(usageSourceFor('claude', cfg(writeCache(dir, other)), { historyPath: past }).report(NOW).source).toBe('rate-limit-cache');
        expect(usageSourceFor('claude', cfg(writeCache(dir, other)), { historyPath: path.join(dir, 'none.jsonl') }).report(NOW).source).toBe('rate-limit-cache');
      });
    });
  });
});
