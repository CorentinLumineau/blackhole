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
      expect(r.out).toMatchObject({ status: 'ok', floor_pct: 61.25, credits: 3.5, shortfall_pct: 11.25, used_pct: 50, plan: 'max', source: 'usage-file' });
    });
  });

  test('catchup.pct_per_weekday scales the floor', () => {
    withTempDir('pace-floor-cli', (dir) => {
      expect(run(dir, ['--usage', usageFile(dir, week)], { catchup: { pct_per_weekday: 20 } }).out.floor_pct).toBe(70);
    });
  });

  test('no source is unreadable with a null floor and exit 0', () => {
    withTempDir('pace-floor-cli', (dir) => {
      const r = run(dir, ['--cache', path.join(dir, 'missing.json'), '--host', 'claude']);
      expect(r.code).toBe(0);
      expect(r.out).toMatchObject({ status: 'unreadable', floor_pct: null });
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
      expect(run(dir, ['--usage', usageFile(dir, week)], { catchup: { day_end_hour: 99 } }).code).toBe(2);
    });
  });
});
