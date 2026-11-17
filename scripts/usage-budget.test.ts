import { describe, expect, test } from 'bun:test';
import * as fs from 'fs';
import * as path from 'path';
import { spawnSync } from 'child_process';
import { root } from './lib/build/paths.ts';
import { withTempDir } from './lib/test-fixtures.ts';
import { parseUsage } from './usage-budget.ts';

const cli = path.join(root, 'scripts', 'usage-budget.ts');
const NOW = 1_800_000_000;
const HOUR = 3600;
const usageJson = (five: number, week?: number) =>
  JSON.stringify({
    five_hour: { used_percentage: five, resets_at: NOW + 4 * HOUR },
    ...(week === undefined ? {} : { seven_day: { used_percentage: week, resets_at: NOW + 3 * 24 * HOUR } }),
  });

const run = (dir: string, args: string[], config: unknown = { usage_budget: { enabled: true } }) => {
  const configPath = path.join(dir, 'config.json');
  fs.writeFileSync(configPath, JSON.stringify(config));
  const r = spawnSync('bun', ['run', cli, '--config', configPath, '--now', String(NOW), '--parallel-max', '3', ...args], {
    encoding: 'utf-8',
    env: { PATH: process.env.PATH ?? '' },
  });
  return { code: r.status, out: r.stdout.trim() ? JSON.parse(r.stdout) : null, err: r.stderr };
};

describe('usage-budget CLI', () => {
  const cases: [string, string, string][] = [
    ['GO', usageJson(10, 10), 'GO'],
    ['NO-SPAWN', usageJson(85, 10), 'NO-SPAWN'],
    ['STOP-WORKERS', usageJson(90, 10), 'STOP-WORKERS'],
    ['NO-NEW-STARTS', usageJson(10, 78), 'NO-NEW-STARTS'],
    ['STOP-CAMPAIGN', usageJson(10, 80), 'STOP-CAMPAIGN'],
    ['GO (weekly-only plan, no five_hour)', JSON.stringify({ seven_day: { used_percentage: 5, resets_at: NOW + HOUR } }), 'GO'],
  ];
  for (const [name, usage, verdict] of cases) {
    test(`exits 0 on ${name}`, () => {
      withTempDir('usage-budget-cli', (dir) => {
        const r = run(dir, ['--usage', usage]);
        expect(r.code).toBe(0);
        expect(r.out.verdict).toBe(verdict);
      });
    });
  }

  test('usage_budget.windows drops a --usage window: weekly-only gating', () => {
    withTempDir('usage-budget-cli', (dir) => {
      const r = run(dir, ['--usage', usageJson(95, 10)], { usage_budget: { enabled: true, windows: ['seven_day'] } });
      expect(r.out.verdict).toBe('GO');
    });
  });

  test('disabled returns unavailable with workers = parallel_max', () => {
    withTempDir('usage-budget-cli', (dir) => {
      const r = run(dir, ['--usage', usageJson(99, 99)], {});
      expect(r.code).toBe(0);
      expect(r.out).toMatchObject({ verdict: 'unavailable', workers: 3, reasons: ['usage_budget disabled'] });
    });
  });

  test('echoes the 5-hour and weekly % it judged, for pace-log --usage', () => {
    withTempDir('usage-budget-cli', (dir) => {
      expect(run(dir, ['--usage', usageJson(42, 61)]).out).toMatchObject({ five_hour_pct: 42, weekly_pct: 61 });
      expect(run(dir, ['--usage', usageJson(42)]).out).toMatchObject({ five_hour_pct: 42, weekly_pct: null });
      expect(run(dir, ['--usage', usageJson(42, 61)], {}).out).toMatchObject({ five_hour_pct: null, weekly_pct: null });
    });
  });

  test('reads the statusline cache through readRateLimits when --usage is absent', () => {
    withTempDir('usage-budget-cli', (dir) => {
      const cache = path.join(dir, 'rl.json');
      fs.writeFileSync(cache, JSON.stringify({ rate_limits: JSON.parse(usageJson(90, 10)) }));
      fs.utimesSync(cache, NOW, NOW);
      expect(run(dir, ['--host', 'claude', '--cache', cache]).out.verdict).toBe('STOP-WORKERS');
    });
  });

  test('the host recorded in run-context.json picks the usage source', () => {
    withTempDir('usage-budget-cli', (dir) => {
      const cache = path.join(dir, 'rl.json');
      fs.writeFileSync(cache, JSON.stringify({ rate_limits: JSON.parse(usageJson(90, 10)) }));
      fs.utimesSync(cache, NOW, NOW);
      fs.writeFileSync(path.join(dir, 'run-context.json'), JSON.stringify({ context: { host: { value: 'claude', source: 'env' } } }));
      expect(run(dir, ['--cache', cache]).out.verdict).toBe('STOP-WORKERS');
    });
  });

  test('cursor has no readable usage source: unavailable with the reason, never GO', () => {
    withTempDir('usage-budget-cli', (dir) => {
      const cache = path.join(dir, 'rl.json');
      fs.writeFileSync(cache, JSON.stringify({ rate_limits: JSON.parse(usageJson(10, 10)) }));
      fs.utimesSync(cache, NOW, NOW);
      const r = run(dir, ['--host', 'cursor', '--cache', cache]);
      expect(r.code).toBe(0);
      expect(r.out).toMatchObject({ verdict: 'unavailable', workers: 3 });
      expect(r.out.reasons[0]).toContain('cursor: no readable usage source');
    });
  });

  test('a missing cache is unavailable, never an error', () => {
    withTempDir('usage-budget-cli', (dir) => {
      const r = run(dir, ['--host', 'claude', '--cache', path.join(dir, 'nope.json')]);
      expect(r.code).toBe(0);
      expect(r.out).toMatchObject({ verdict: 'unavailable', workers: 3 });
      expect(r.out.reasons[0]).toContain('no rate-limit cache');
    });
  });

  const bad: [string, string[]][] = [
    ['non-JSON --usage', ['--usage', '{nope']],
    ['non-object --usage', ['--usage', '[1]']],
    ['a window with string numbers', ['--usage', '{"five_hour":{"used_percentage":"9","resets_at":1}}']],
    ['used_percentage above 100', ['--usage', '{"five_hour":{"used_percentage":101,"resets_at":5}}']],
    ['negative used_percentage', ['--usage', '{"seven_day":{"used_percentage":-1,"resets_at":5}}']],
    ['resets_at not positive', ['--usage', '{"five_hour":{"used_percentage":5,"resets_at":0}}']],
    ['--usage with no windows', ['--usage', '{}']],
    ['a bad --parallel-max', ['--parallel-max', 'x', '--usage', usageJson(1)]],
    ['an unknown flag', ['--bogus', '1', '--usage', usageJson(1)]],
  ];
  for (const [name, args] of bad) {
    test(`exits 2 on ${name}`, () => {
      withTempDir('usage-budget-cli', (dir) => {
        expect(run(dir, args).code).toBe(2);
      });
    });
  }

  test('exits 2 on an invalid config and names the key path', () => {
    withTempDir('usage-budget-cli', (dir) => {
      const r = run(dir, ['--usage', usageJson(1)], { usage_budget: { enabled: true, max_workers: 0 } });
      expect(r.code).toBe(2);
      expect(r.err).toContain('usage_budget.max_workers');
    });
  });
});

describe('usage-budget CLI weekly pacing', () => {
  const weekOnly = (used: number, hours: number) => JSON.stringify({ seven_day: { used_percentage: used, resets_at: NOW + hours * HOUR } });
  const paced = { usage_budget: { enabled: true, weekly: { target_at_reset: 100 }, rates: { orchestrator_weekly_pct_per_hour: 0.1, worker_weekly_pct_per_hour: 0.2 } } };

  test('seven_day only with a target prints GO and the weekly fit', () => {
    withTempDir('usage-budget-cli', (dir) => {
      const r = run(dir, ['--usage', weekOnly(21, 110)], paced);
      expect(r.code).toBe(0);
      // (79/110 - 0.1)/0.2 = 3, within parallel_max 3
      expect(r.out).toMatchObject({ verdict: 'GO', workers: 3, weekly_fit: 3 });
      expect(r.err).toContain('weekly fit 3 worker(s) toward 100% at reset');
    });
  });
  test('prints PACE-WAIT with its wake time', () => {
    withTempDir('usage-budget-cli', (dir) => {
      // 0.05% left over the 15-minute floor fits no worker before the reset
      const r = run(dir, ['--usage', weekOnly(99.95, 1)], paced);
      expect(r.code).toBe(0);
      expect(r.out).toMatchObject({ verdict: 'PACE-WAIT', workers: 0, wake_at: NOW + HOUR });
      expect(r.err).toContain(`PACE-WAIT until ${NOW + HOUR}`);
    });
  });
  test('a malformed --usage exits 2 even when the budget is disabled', () => {
    withTempDir('usage-budget-cli', (dir) => {
      expect(run(dir, ['--usage', '{nope'], {}).code).toBe(2);
    });
  });
});

describe('parseUsage', () => {
  test('keeps only the two known windows', () => {
    expect(parseUsage('{"five_hour":{"used_percentage":1,"resets_at":2},"extra":3}')).toEqual({
      five_hour: { used_percentage: 1, resets_at: 2 },
    });
  });
});

describe('usage-budget CLI --floor (catchup gate)', () => {
  const week = (used: number) => JSON.stringify({ five_hour: { used_percentage: 40, resets_at: NOW + 4 * HOUR }, seven_day: { used_percentage: used, resets_at: NOW + 3 * 24 * HOUR } });
  const base = { usage_budget: { enabled: false } };

  test('below the floor is GO and echoes floor_pct, whatever usage_budget.enabled says', () => {
    withTempDir('usage-budget-floor', (dir) => {
      const r = run(dir, ['--floor', '87.5', '--usage', week(70)], base);
      expect(r.code).toBe(0);
      expect(r.out).toMatchObject({ verdict: 'GO', floor_pct: 87.5 });
    });
  });

  test('at or over the floor is STOP-CAMPAIGN with no wake', () => {
    withTempDir('usage-budget-floor', (dir) => {
      const r = run(dir, ['--floor', '61.25', '--usage', week(62)]);
      expect(r.out).toMatchObject({ verdict: 'STOP-CAMPAIGN', wake_at: null });
    });
  });

  test('no usage source is SKIP with a stderr line, where the plain call is unavailable', () => {
    withTempDir('usage-budget-floor', (dir) => {
      const none = ['--cache', path.join(dir, 'missing.json'), '--host', 'claude'];
      const r = run(dir, ['--floor', '87.5', ...none]);
      expect(r.code).toBe(0);
      expect(r.out.verdict).toBe('SKIP');
      expect(r.err).toContain('usage-budget: SKIP:');
      expect(run(dir, none).out.verdict).toBe('unavailable');
    });
  });

  test('a five-hour-only reading is SKIP', () => {
    withTempDir('usage-budget-floor', (dir) => {
      expect(run(dir, ['--floor', '87.5', '--usage', usageJson(40)]).out.verdict).toBe('SKIP');
    });
  });

  test('the catchup.five_hour block is honoured', () => {
    withTempDir('usage-budget-floor', (dir) => {
      const usage = JSON.stringify({ five_hour: { used_percentage: 65, resets_at: NOW + 4 * HOUR }, seven_day: { used_percentage: 50, resets_at: NOW + 3 * 24 * HOUR } });
      const r = run(dir, ['--floor', '87.5', '--usage', usage], { catchup: { five_hour: { no_spawn_at: 60, stop_workers_at: 70 } } });
      expect(r.out.verdict).toBe('NO-SPAWN');
    });
  });

  test('config.json is never written', () => {
    withTempDir('usage-budget-floor', (dir) => {
      const configPath = path.join(dir, 'config.json');
      run(dir, ['--floor', '87.5', '--usage', week(70)]);
      const before = fs.readFileSync(configPath);
      run(dir, ['--floor', '87.5', '--usage', week(70)]);
      expect(fs.readFileSync(configPath).equals(before)).toBe(true);
    });
  });

  test('a 0 floor (nothing owed yet) is STOP-CAMPAIGN, not a usage error', () => {
    withTempDir('usage-budget-floor', (dir) => {
      const r = run(dir, ['--floor', '0', '--usage', week(3)]);
      expect(r.code).toBe(0);
      expect(r.out).toMatchObject({ verdict: 'STOP-CAMPAIGN', floor_pct: 0 });
    });
  });

  test('--usage-file feeds the floor gate, so an app-only host is GO below the floor', () => {
    withTempDir('usage-budget-floor', (dir) => {
      const file = path.join(dir, 'usage.json');
      fs.writeFileSync(file, JSON.stringify({ plan: 'max', read_at: NOW - 5, windows: [
        { name: 'five_hour', used_pct: 40, resets_at: NOW + 4 * HOUR },
        { name: 'seven_day', used_pct: 70, resets_at: NOW + 3 * 24 * HOUR },
      ] }));
      const none = ['--cache', path.join(dir, 'missing.json'), '--host', 'claude'];
      const r = run(dir, ['--floor', '87.5', '--usage-file', file, ...none]);
      expect(r.code).toBe(0);
      expect(r.out).toMatchObject({ verdict: 'GO', weekly_pct: 70, floor_pct: 87.5 });
    });
  });

  test('an unreadable --usage-file fails closed as SKIP under --floor', () => {
    withTempDir('usage-budget-floor', (dir) => {
      const none = ['--cache', path.join(dir, 'missing.json'), '--host', 'claude'];
      const r = run(dir, ['--floor', '87.5', '--usage-file', path.join(dir, 'absent.json'), ...none]);
      expect(r.code).toBe(0);
      expect(r.out.verdict).toBe('SKIP');
      expect(r.err).toContain('usage-budget: SKIP:');
    });
  });

  test('--usage and --usage-file together exit 2', () => {
    withTempDir('usage-budget-floor', (dir) => {
      expect(run(dir, ['--floor', '87.5', '--usage', week(10), '--usage-file', path.join(dir, 'u.json')]).code).toBe(2);
    });
  });

  test.each([['-1'], ['101'], ['abc']])('--floor %s exits 2', (value) => {
    withTempDir('usage-budget-floor', (dir) => {
      expect(run(dir, ['--floor', value, '--usage', week(10)]).code).toBe(2);
    });
  });

  test('a bare --floor and an invalid catchup block exit 2', () => {
    withTempDir('usage-budget-floor', (dir) => {
      expect(run(dir, ['--usage', week(10), '--floor']).code).toBe(2);
      expect(run(dir, ['--floor', '80', '--usage', week(10)], { catchup: { lane: 'Bad Lane' } }).code).toBe(2);
    });
  });
});
