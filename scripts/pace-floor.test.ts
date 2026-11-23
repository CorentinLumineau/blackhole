import { describe, expect, test } from 'bun:test';
import * as fs from 'fs';
import * as path from 'path';
import { spawnSync } from 'child_process';
import { root } from './lib/build/paths.ts';
import { withTempDir } from './lib/test-fixtures.ts';

const cli = path.join(root, 'scripts', 'pace-floor.ts');
const NOW = Date.UTC(2026, 10, 13, 9, 30) / 1000;
const RESET = Date.UTC(2026, 10, 16, 9, 30) / 1000;

const run = (dir: string, args: string[], config: unknown = {}) => {
  const configPath = path.join(dir, 'config.json');
  fs.writeFileSync(configPath, JSON.stringify(config));
  const r = spawnSync('bun', ['run', cli, '--config', configPath, '--now', String(NOW), ...args], {
    encoding: 'utf-8',
    env: { PATH: process.env.PATH ?? '', TZ: 'UTC' },
  });
  return { code: r.status, stdout: r.stdout, out: r.stdout.trim() ? JSON.parse(r.stdout) : null, err: r.stderr };
};
const usageFile = (dir: string, body: unknown) => {
  const file = path.join(dir, 'usage.json');
  fs.writeFileSync(file, JSON.stringify(body));
  fs.utimesSync(file, NOW - 5, NOW - 5);
  return file;
};
const week = { plan: 'max', read_at: NOW - 5, windows: [{ name: 'seven_day', used_pct: 50, resets_at: RESET }] };

describe('pace-floor CLI', () => {
  test('a normalized file gives the floor and the shortfall on one line', () => {
    withTempDir('pace-floor-cli', (dir) => {
      const r = run(dir, ['--usage', usageFile(dir, week)]);
      expect(r.code).toBe(0);
      expect(r.stdout.trim().split('\n')).toHaveLength(1);
      expect(r.out).toMatchObject({ status: 'ok', floor_pct: 45.71, elapsed_h: 96, target_pct: 80, shortfall_pct: 0, used_pct: 50, plan: 'max', source: 'usage-file' });
    });
  });

  test('catchup.weekly_target_pct scales the floor', () => {
    withTempDir('pace-floor-cli', (dir) => {
      expect(run(dir, ['--usage', usageFile(dir, week)], { catchup: { weekly_target_pct: 60 } }).out.floor_pct).toBe(34.29);
    });
  });

  test('no source is unreadable with a null floor and exit 0', () => {
    withTempDir('pace-floor-cli', (dir) => {
      const r = run(dir, ['--cache', path.join(dir, 'missing.json'), '--host', 'claude']);
      expect(r.code).toBe(0);
      expect(r.out).toMatchObject({ status: 'unreadable', floor_pct: null });
    });
  });

  test('a stale --usage file is unreadable with its reason, never a floor from a fresh cache', () => {
    withTempDir('pace-floor-cli', (dir) => {
      const file = usageFile(dir, { plan: 'max', windows: week.windows });
      fs.utimesSync(file, NOW - 700, NOW - 700);
      const cache = path.join(dir, 'rate-limits.json');
      fs.writeFileSync(cache, JSON.stringify({ rate_limits: { seven_day: { used_percentage: 10, resets_at: RESET } } }));
      fs.utimesSync(cache, NOW - 5, NOW - 5);
      const r = run(dir, ['--usage', file, '--cache', cache, '--host', 'claude']);
      expect(r.code).toBe(0);
      expect(r.out).toMatchObject({ status: 'unreadable', floor_pct: null, used_pct: null, source: 'none' });
      expect(r.out.reason).toMatch(/^usage file stale \(700s > 600s\)$/);
      expect(r.err).toContain('pace-floor: unreadable: usage file stale');
    });
  });

  test('a plan-none file is no-weekly', () => {
    withTempDir('pace-floor-cli', (dir) => {
      const r = run(dir, ['--usage', usageFile(dir, { plan: 'none', read_at: NOW - 5, windows: [] })]);
      expect(r.out).toMatchObject({ status: 'no-weekly', floor_pct: null, reason: 'no plan limits' });
    });
  });

  test('a malformed file, a bad --now, an unknown flag and a bad catchup block exit 2', () => {
    withTempDir('pace-floor-cli', (dir) => {
      const bad = path.join(dir, 'bad.json');
      fs.writeFileSync(bad, '{nope');
      expect(run(dir, ['--usage', bad]).code).toBe(2);
      expect(run(dir, ['--now', 'abc']).code).toBe(2);
      expect(run(dir, ['--wat']).code).toBe(2);
    });
  });

  test.each([
    ['pct_per_weekday', 'catchup.pct_per_weekday was removed (ADR-054 amendment): the pace floor is now linear over all 168 h of the week.'],
    ['day_end_hour', 'catchup.day_end_hour was removed (ADR-054 amendment): the pace floor no longer follows working days.'],
  ])('a stale removed key %s exits 2 with the removal message', (key, message) => {
    withTempDir('pace-floor-cli', (dir) => {
      const r = run(dir, ['--usage', usageFile(dir, week)], { catchup: { [key]: 1 } });
      expect(r.code).toBe(2);
      expect(r.err).toContain(message);
    });
  });
});

describe('pace-floor CLI, desktop get_usage payload', () => {
  test('--usage accepts the raw payload and prints a floor line', () => {
    withTempDir('pace-floor-cli', (dir) => {
      const raw = { plan: { status: 'ok', plan: 'Max', windows: [
        { label: '5-hour limit', percentUsed: 19, resetsAt: NOW + 3600 },
        { label: 'Weekly \u00b7 all models', percentUsed: 27, resetsAt: RESET },
      ], extraUsage: { enabled: false } } };
      const r = run(dir, ['--usage', usageFile(dir, raw)]);
      expect(r.code).toBe(0);
      expect(r.out).toMatchObject({ status: 'ok', used_pct: 27, plan: 'max', source: 'usage-file' });
      expect(typeof r.out.floor_pct).toBe('number');
    });
  });
});
