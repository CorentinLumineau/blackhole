import { describe, expect, test } from 'bun:test';
import * as fs from 'fs';
import * as path from 'path';
import { spawnSync } from 'child_process';
import { root } from './lib/build/paths.ts';
import { withTempDir } from './lib/test-fixtures.ts';
import { ccdUsageToRateLimits, eventsToRateLimits, NoCurrentWindow } from './usage-probe.ts';
import { readUsageHistory } from './lib/usage-history.ts';

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
    // In the temp dir, so the default .blackhole/usage-history.jsonl lands there, not in the repo.
    cwd: dir,
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
    [
      'newest event of the list_events wrapper wins when it comes last',
      { ccr: { data: [event({ seven_day: { ...week, utilization: 0.1 } }, NOW - 900), event({ seven_day: week }, NOW - 30)] } },
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

  test('a future created_at is clamped to now', () => {
    expect(eventsToRateLimits(JSON.stringify(event({ seven_day: week }, NOW + 500)), NOW).observedAt).toBe(NOW);
  });

  const badTimes: [string, unknown][] = [
    ['missing', undefined],
    ['unparseable', 'not-a-date'],
    ['non-string', 1795000000],
  ];
  for (const [name, createdAt] of badTimes) {
    test(`a ${name} created_at is refused`, () => {
      const e: Record<string, unknown> = event({ seven_day: week });
      if (createdAt === undefined) delete e.created_at;
      else e.created_at = createdAt;
      expect(() => eventsToRateLimits(JSON.stringify(e), NOW)).toThrow(/created_at/);
    });
  }

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

  test('a missing created_at exits 2 and writes nothing', () => {
    withTempDir('usage-probe-cli', (dir) => {
      const cache = path.join(dir, 'rl.json');
      const e: Record<string, unknown> = event({ seven_day: { utilization: 0.2, resetsAt: NOW + DAY } });
      delete e.created_at;
      const r = runProbe(dir, JSON.stringify(e), ['--cache', cache]);
      expect(r.code).toBe(2);
      expect(r.err).toContain('created_at');
      expect(fs.existsSync(cache)).toBe(false);
    });
  });

  test('a future created_at is written dated to now', () => {
    withTempDir('usage-probe-cli', (dir) => {
      const cache = path.join(dir, 'rl.json');
      const r = runProbe(dir, JSON.stringify(event({ seven_day: { utilization: 0.2, resetsAt: NOW + DAY } }, NOW + 500)), ['--cache', cache]);
      expect(r.code).toBe(0);
      expect(JSON.parse(fs.readFileSync(cache, 'utf-8')).observed_at).toBe(NOW);
      expect(Math.round(fs.statSync(cache).mtimeMs / 1000)).toBe(NOW);
      expect(JSON.parse(r.out).age_seconds).toBe(0);
    });
  });

  test('a cache write failure exits 3 with a one-line message', () => {
    withTempDir('usage-probe-cli', (dir) => {
      const blocker = path.join(dir, 'not-a-dir');
      fs.writeFileSync(blocker, '');
      const cache = path.join(blocker, 'rl.json');
      const r = runProbe(dir, JSON.stringify(event({ seven_day: { utilization: 0.2, resetsAt: NOW + DAY } })), ['--cache', cache]);
      expect(r.code).toBe(3);
      expect(r.err.trim().split('\n')).toHaveLength(1);
      expect(r.err).toContain(`cannot write rate-limit cache at ${cache}`);
      expect(r.out).toBe('');
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

  test('each weekly reading is appended to usage-history.jsonl beside the config, once per observed_at', () => {
    withTempDir('usage-probe-cli', (dir) => {
      const cache = path.join(dir, 'rl.json');
      const configPath = path.join(dir, 'state', 'config.json');
      fs.mkdirSync(path.dirname(configPath));
      fs.writeFileSync(configPath, JSON.stringify({ resource_policy: { pace: { cache_path: cache } } }));
      const week = (u: number) => ({ seven_day: { utilization: u, resetsAt: NOW + 3 * DAY } });
      expect(runProbe(dir, JSON.stringify(event(week(0.21), NOW - 600)), ['--config', configPath]).code).toBe(0);
      expect(runProbe(dir, JSON.stringify(event(week(0.36), NOW - 60)), ['--config', configPath]).code).toBe(0);
      expect(runProbe(dir, JSON.stringify(event(week(0.36), NOW - 60)), ['--config', configPath]).code).toBe(0);
      expect(readUsageHistory(path.join(dir, 'state', 'usage-history.jsonl'))).toEqual([
        { observed_at: NOW - 600, used_percentage: 21, resets_at: NOW + 3 * DAY },
        { observed_at: NOW - 60, used_percentage: 36, resets_at: NOW + 3 * DAY },
      ]);
    });
  });

  test('a five_hour-only reading adds no history line', () => {
    withTempDir('usage-probe-cli', (dir) => {
      const configPath = path.join(dir, 'config.json');
      fs.writeFileSync(configPath, JSON.stringify({ resource_policy: { pace: { cache_path: path.join(dir, 'rl.json') } } }));
      expect(runProbe(dir, JSON.stringify(event({ five_hour: { utilization: 0.1, resetsAt: NOW + 3600 } })), ['--config', configPath]).code).toBe(0);
      expect(fs.existsSync(path.join(dir, 'usage-history.jsonl'))).toBe(false);
    });
  });
});

const R5 = NOW + 3600;
const R7 = NOW + 3 * DAY;
const ccd = (windows: Array<{ label: string; percentUsed: unknown; resetsAt: unknown }>) => JSON.stringify({ plan: { status: 'ok', windows } });
const standard = ccd([
  { label: '5-hour limit', percentUsed: 12, resetsAt: R5 },
  { label: 'Weekly \u00b7 all models', percentUsed: 42, resetsAt: R7 },
  { label: 'Weekly \u00b7 Opus', percentUsed: 90, resetsAt: R7 },
]);

describe('ccdUsageToRateLimits', () => {
  test('maps the 5-hour and weekly all-models rows and ignores per-model rows', () => {
    expect(ccdUsageToRateLimits(standard, NOW).limits).toEqual({
      five_hour: { used_percentage: 12, resets_at: R5 },
      seven_day: { used_percentage: 42, resets_at: R7 },
    });
  });

  test('dates the reading now', () => {
    expect(ccdUsageToRateLimits(standard, NOW).observedAt).toBe(NOW);
  });

  test('an ISO resetsAt equals the same epoch', () => {
    const iso = new Date(R7 * 1000).toISOString();
    const raw = ccd([{ label: 'Weekly \u00b7 all models', percentUsed: 5, resetsAt: iso }]);
    expect(ccdUsageToRateLimits(raw, NOW).limits.seven_day).toEqual({ used_percentage: 5, resets_at: R7 });
  });

  test('an elapsed window is dropped', () => {
    const raw = ccd([
      { label: '5-hour limit', percentUsed: 12, resetsAt: NOW - 1 },
      { label: 'Weekly \u00b7 all models', percentUsed: 42, resetsAt: R7 },
    ]);
    expect(ccdUsageToRateLimits(raw, NOW).limits).toEqual({ seven_day: { used_percentage: 42, resets_at: R7 } });
  });

  test('per-model-only input has no current window', () => {
    const raw = ccd([{ label: 'Weekly \u00b7 Opus', percentUsed: 90, resetsAt: R7 }]);
    expect(() => ccdUsageToRateLimits(raw, NOW)).toThrow(NoCurrentWindow);
  });

  test.each([101, -1, '12', null])('percentUsed %p is rejected', (bad) => {
    const raw = ccd([{ label: '5-hour limit', percentUsed: bad, resetsAt: R5 }]);
    expect(() => ccdUsageToRateLimits(raw, NOW)).toThrow(/percentUsed/);
  });

  test('an unparseable resetsAt is rejected', () => {
    const raw = ccd([{ label: '5-hour limit', percentUsed: 5, resetsAt: 'soon' }]);
    expect(() => ccdUsageToRateLimits(raw, NOW)).toThrow(/resetsAt/);
  });

  test('a missing plan.windows is rejected', () => {
    expect(() => ccdUsageToRateLimits('{"plan":{"status":"not_applicable"}}', NOW)).toThrow(/plan\.windows/);
    expect(() => ccdUsageToRateLimits('{nope', NOW)).toThrow(/not valid JSON/);
  });
});

describe('usage-probe --from-ccd-usage CLI', () => {
  const run = (dir: string, args: string[], input?: string) =>
    spawnSync('bun', ['run', probe, ...args, '--now', String(NOW)], { encoding: 'utf-8', cwd: dir, input, env: { PATH: process.env.PATH ?? '' } });

  test('a file writes the cache, dates it now and appends one weekly history line', () => {
    withTempDir('usage-probe-cli', (dir) => {
      const cache = path.join(dir, 'rl.json');
      const file = path.join(dir, 'usage.json');
      fs.writeFileSync(file, standard);
      const r = run(dir, ['--from-ccd-usage', file, '--cache', cache]);
      expect(r.status).toBe(0);
      const written = JSON.parse(fs.readFileSync(cache, 'utf-8'));
      expect(written.rate_limits.five_hour.used_percentage).toBe(12);
      expect(written.rate_limits.seven_day.used_percentage).toBe(42);
      expect(written.source).toBe('ccd_get_usage');
      expect(written.observed_at).toBe(NOW);
      expect(Math.floor(fs.statSync(cache).mtimeMs / 1000)).toBe(NOW);
      expect(readUsageHistory(path.join(dir, '.blackhole', 'usage-history.jsonl')).length).toBe(1);
    });
  });

  test('stdin works the same', () => {
    withTempDir('usage-probe-cli', (dir) => {
      const cache = path.join(dir, 'rl.json');
      const r = run(dir, ['--from-ccd-usage', '-', '--cache', cache], standard);
      expect(r.status).toBe(0);
      expect(JSON.parse(fs.readFileSync(cache, 'utf-8')).rate_limits.seven_day.used_percentage).toBe(42);
    });
  });

  test('per-model-only input exits 1 and writes nothing', () => {
    withTempDir('usage-probe-cli', (dir) => {
      const cache = path.join(dir, 'rl.json');
      const r = run(dir, ['--from-ccd-usage', '-', '--cache', cache], ccd([{ label: 'Weekly \u00b7 Opus', percentUsed: 9, resetsAt: R7 }]));
      expect(r.status).toBe(1);
      expect(fs.existsSync(cache)).toBe(false);
    });
  });

  test('a percentUsed of 101 exits 2 and writes nothing', () => {
    withTempDir('usage-probe-cli', (dir) => {
      const cache = path.join(dir, 'rl.json');
      const r = run(dir, ['--from-ccd-usage', '-', '--cache', cache], ccd([{ label: '5-hour limit', percentUsed: 101, resetsAt: R5 }]));
      expect(r.status).toBe(2);
      expect(r.stderr).toContain('percentUsed');
      expect(fs.existsSync(cache)).toBe(false);
    });
  });

  test('both source flags, or neither, exits 2 with the usage line', () => {
    withTempDir('usage-probe-cli', (dir) => {
      const both = run(dir, ['--from-ccd-usage', '-', '--from-events', '-'], standard);
      expect(both.status).toBe(2);
      expect(both.stderr).toContain('usage:');
      const neither = run(dir, [], '');
      expect(neither.status).toBe(2);
      expect(neither.stderr).toContain('usage:');
    });
  });

  test('the written cache lifts usage-budget out of unavailable', () => {
    withTempDir('usage-probe-cli', (dir) => {
      const cache = path.join(dir, 'rl.json');
      const configPath = path.join(dir, 'config.json');
      fs.writeFileSync(configPath, JSON.stringify({ usage_budget: { enabled: true }, resource_policy: { pace: { cache_path: cache } } }));
      expect(run(dir, ['--from-ccd-usage', '-', '--config', configPath], standard).status).toBe(0);
      const r = spawnSync('bun', ['run', budget, '--config', configPath, '--now', String(NOW), '--parallel-max', '10'], { encoding: 'utf-8', env: { PATH: process.env.PATH ?? '' } });
      expect(r.status).toBe(0);
      const verdict = JSON.parse(r.stdout);
      expect(verdict.verdict).not.toBe('unavailable');
      expect(verdict.reasons.join(' ')).not.toContain('rate-limit cache');
    });
  });
});
