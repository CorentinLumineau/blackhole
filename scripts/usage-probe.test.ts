import { describe, expect, test } from 'bun:test';
import * as fs from 'fs';
import * as path from 'path';
import { spawnSync } from 'child_process';
import { root } from './lib/build/paths.ts';
import { withTempDir } from './lib/test-fixtures.ts';
import { eventsToRateLimits } from './usage-probe.ts';

const probe = path.join(root, 'scripts', 'usage-probe.ts');
const budget = path.join(root, 'scripts', 'usage-budget.ts');
const NOW = 1_795_000_000;
const DAY = 24 * 3600;

type Win = { utilization: number; resetsAt: number };
// Same shape the claude-code-remote `list_events` tool returns for kind rate_limit_event.
const event = (windows: Record<string, Win>, createdAt = NOW - 60) => ({
  created_at: new Date(createdAt * 1000).toISOString(),
  rate_limit_event: {
    internal_anthropic_catchall: {
      rate_limit_info: {
        isUsingOverage: false,
        rateLimitType: Object.keys(windows)[0],
        resetsAt: Object.values(windows)[0]?.resetsAt,
        status: 'allowed',
        unifiedWindows: Object.fromEntries(Object.entries(windows).map(([k, w]) => [k, { ...w, status: 'allowed' }])),
      },
    },
  },
});

const runProbe = (dir: string, input: string, extra: string[] = []) => {
  const file = path.join(dir, 'events.json');
  fs.writeFileSync(file, input);
  const r = spawnSync('bun', ['run', probe, '--from-events', file, '--now', String(NOW), ...extra], {
    encoding: 'utf-8',
    env: { PATH: process.env.PATH ?? '' },
  });
  return { code: r.status, out: r.stdout.trim(), err: r.stderr };
};

describe('eventsToRateLimits', () => {
  const week = { utilization: 0.21, resetsAt: NOW + 3 * DAY };
  const five = { utilization: 0.5, resetsAt: NOW + 3600 };
  const cases: [string, unknown, unknown][] = [
    ['seven_day only', event({ seven_day: week }), { seven_day: { used_percentage: 21, resets_at: NOW + 3 * DAY } }],
    [
      'both windows',
      event({ five_hour: five, seven_day: week }),
      { five_hour: { used_percentage: 50, resets_at: NOW + 3600 }, seven_day: { used_percentage: 21, resets_at: NOW + 3 * DAY } },
    ],
    ['utilization 0', event({ seven_day: { ...week, utilization: 0 } }), { seven_day: { used_percentage: 0, resets_at: NOW + 3 * DAY } }],
    ['utilization 1', event({ seven_day: { ...week, utilization: 1 } }), { seven_day: { used_percentage: 100, resets_at: NOW + 3 * DAY } }],
    [
      'stale window past resetsAt is dropped',
      event({ five_hour: { utilization: 0.9, resetsAt: NOW - 10 }, seven_day: week }),
      { seven_day: { used_percentage: 21, resets_at: NOW + 3 * DAY } },
    ],
    [
      'newest event of the list_events wrapper wins',
      { ccr: { data: [event({ seven_day: week }, NOW - 30), event({ seven_day: { ...week, utilization: 0.1 } }, NOW - 900)] } },
      { seven_day: { used_percentage: 21, resets_at: NOW + 3 * DAY } },
    ],
  ];
  for (const [name, input, expected] of cases) {
    test(name, () => {
      expect(eventsToRateLimits(JSON.stringify(input), NOW).limits).toEqual(expected as never);
    });
  }

  test('reports the newest event time as observedAt', () => {
    expect(eventsToRateLimits(JSON.stringify(event({ seven_day: week }, NOW - 120)), NOW).observedAt).toBe(NOW - 120);
  });

  test('every window past its reset leaves no limits', () => {
    expect(() => eventsToRateLimits(JSON.stringify(event({ seven_day: { ...week, resetsAt: NOW - 1 } })), NOW)).toThrow(
      /no current five_hour or seven_day window/,
    );
  });

  test('utilization outside 0-1 is refused', () => {
    expect(() => eventsToRateLimits(JSON.stringify(event({ seven_day: { ...week, utilization: 21 } })), NOW)).toThrow(/utilization/);
  });

  test('a wrapper with no rate_limit_event is refused', () => {
    expect(() => eventsToRateLimits(JSON.stringify({ ccr: { data: [] } }), NOW)).toThrow(/no rate_limit_event/);
  });
});

describe('usage-probe CLI', () => {
  test('malformed JSON exits 2 and writes nothing', () => {
    withTempDir('usage-probe-cli', (dir) => {
      const cache = path.join(dir, 'rl.json');
      const r = runProbe(dir, '{not json', ['--cache', cache]);
      expect(r.code).toBe(2);
      expect(r.err).toContain('not valid JSON');
      expect(fs.existsSync(cache)).toBe(false);
    });
  });

  test('an event with no current window exits 1 and writes nothing', () => {
    withTempDir('usage-probe-cli', (dir) => {
      const cache = path.join(dir, 'rl.json');
      const r = runProbe(dir, JSON.stringify(event({ seven_day: { utilization: 0.2, resetsAt: NOW - 5 } })), ['--cache', cache]);
      expect(r.code).toBe(1);
      expect(fs.existsSync(cache)).toBe(false);
    });
  });

  test('writes the statusline cache shape, dated to the event', () => {
    withTempDir('usage-probe-cli', (dir) => {
      const cache = path.join(dir, 'nested', 'rl.json');
      const r = runProbe(dir, JSON.stringify(event({ seven_day: { utilization: 0.21, resetsAt: NOW + DAY } }, NOW - 90)), ['--cache', cache]);
      expect(r.code).toBe(0);
      expect(JSON.parse(fs.readFileSync(cache, 'utf-8'))).toEqual({
        rate_limits: { seven_day: { used_percentage: 21, resets_at: NOW + DAY } },
        source: 'rate_limit_event',
        observed_at: NOW - 90,
      });
      expect(Math.round(fs.statSync(cache).mtimeMs / 1000)).toBe(NOW - 90);
      expect(JSON.parse(r.out)).toMatchObject({ cache, observed_at: NOW - 90, age_seconds: 90 });
    });
  });

  test('usage-budget.ts with no --usage reads what usage-probe.ts wrote (shared config cache_path)', () => {
    withTempDir('usage-probe-cli', (dir) => {
      const cache = path.join(dir, 'rl.json');
      const configPath = path.join(dir, 'config.json');
      fs.writeFileSync(configPath, JSON.stringify({ usage_budget: { enabled: true }, resource_policy: { pace: { cache_path: cache } } }));
      const windows = { five_hour: { utilization: 0.1, resetsAt: NOW + 4 * 3600 }, seven_day: { utilization: 0.1, resetsAt: NOW + 3 * DAY } };
      expect(runProbe(dir, JSON.stringify(event(windows)), ['--config', configPath]).code).toBe(0);
      expect(fs.existsSync(cache)).toBe(true);
      const r = spawnSync('bun', ['run', budget, '--config', configPath, '--now', String(NOW), '--parallel-max', '3'], {
        encoding: 'utf-8',
        env: { PATH: process.env.PATH ?? '' },
      });
      expect(r.status).toBe(0);
      const verdict = JSON.parse(r.stdout);
      expect(verdict.verdict).not.toBe('unavailable');
      expect(verdict.reasons.join(' ')).not.toContain('rate-limit cache');
    });
  });

  test('with no cache_path configured, probe and usage-budget.ts both use the ~/.claude/cache default', () => {
    withTempDir('usage-probe-cli', (dir) => {
      const configPath = path.join(dir, 'config.json');
      fs.writeFileSync(configPath, JSON.stringify({ usage_budget: { enabled: true } }));
      const env = { PATH: process.env.PATH ?? '', HOME: dir };
      const windows = { five_hour: { utilization: 0.1, resetsAt: NOW + 4 * 3600 }, seven_day: { utilization: 0.1, resetsAt: NOW + 3 * DAY } };
      const file = path.join(dir, 'events.json');
      fs.writeFileSync(file, JSON.stringify(event(windows)));
      const p = spawnSync('bun', ['run', probe, '--from-events', file, '--config', configPath, '--now', String(NOW)], { encoding: 'utf-8', env });
      expect(p.status).toBe(0);
      expect(JSON.parse(p.stdout).cache).toBe(path.join(dir, '.claude', 'cache', 'rate-limits.json'));
      const r = spawnSync('bun', ['run', budget, '--config', configPath, '--now', String(NOW), '--parallel-max', '3'], { encoding: 'utf-8', env });
      expect(r.status).toBe(0);
      const verdict = JSON.parse(r.stdout);
      expect(verdict.verdict).not.toBe('unavailable');
      expect(verdict.reasons.join(' ')).not.toContain('rate-limit cache');
    });
  });
});
