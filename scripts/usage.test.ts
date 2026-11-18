import { describe, expect, test } from 'bun:test';
import * as fs from 'fs';
import * as path from 'path';
import { spawnSync } from 'child_process';
import { root } from './lib/build/paths.ts';
import { withTempDir } from './lib/test-fixtures.ts';

const cli = path.join(root, 'scripts', 'usage.ts');
const NOW = 1_800_000_000;
const HOUR = 3600;
const windows = [
  { name: 'five_hour', used_pct: 40, resets_at: NOW + 2 * HOUR },
  { name: 'seven_day', used_pct: 30, resets_at: NOW + 90 * HOUR },
];

const run = (dir: string, args: string[]) => {
  const r = spawnSync('bun', ['run', cli, '--config', path.join(dir, 'config.json'), '--now', String(NOW), ...args], {
    encoding: 'utf-8',
    env: { PATH: process.env.PATH ?? '' },
  });
  return { code: r.status, stdout: r.stdout, out: r.stdout.trim() ? JSON.parse(r.stdout) : null, err: r.stderr };
};

describe('usage CLI', () => {
  test('--usage file: one JSON line with plan, windows, source and read_at', () => {
    withTempDir('usage-cli', (dir) => {
      const file = path.join(dir, 'usage.json');
      fs.writeFileSync(file, JSON.stringify({ plan: 'max', read_at: NOW - 5, windows }));
      const r = run(dir, ['--usage', file]);
      expect(r.code).toBe(0);
      expect(r.stdout.trim().split('\n')).toHaveLength(1);
      expect(r.out).toMatchObject({ plan: 'max', windows, source: 'usage-file', provider: 'usage-file', read_at: NOW - 5, extra_usage: null, reason: null });
    });
  });

  test('--cache: the statusline cache is provider statusline', () => {
    withTempDir('usage-cli', (dir) => {
      const cache = path.join(dir, 'rate-limits.json');
      fs.writeFileSync(cache, JSON.stringify({ rate_limits: { seven_day: { used_percentage: 30, resets_at: NOW + 90 * HOUR } } }));
      fs.utimesSync(cache, NOW - 10, NOW - 10);
      expect(run(dir, ['--cache', cache, '--host', 'claude']).out).toMatchObject({ provider: 'statusline', source: 'rate-limit-cache' });
    });
  });

  test('no file and no cache: exit 0, source none, a reason on stdout and on stderr', () => {
    withTempDir('usage-cli', (dir) => {
      const r = run(dir, ['--cache', path.join(dir, 'missing.json'), '--host', 'claude']);
      expect(r.code).toBe(0);
      expect(r.out).toMatchObject({ source: 'none', provider: 'none', windows: [] });
      expect(r.out.reason).toBeTruthy();
      expect(r.err.startsWith('usage: ')).toBe(true);
    });
  });

  test('--host cursor without a file reports none with the cursor reason', () => {
    withTempDir('usage-cli', (dir) => {
      const r = run(dir, ['--host', 'cursor']);
      expect(r.code).toBe(0);
      expect(r.out.source).toBe('none');
      expect(r.out.reason).toContain('cursor');
    });
  });

  test('a malformed or missing --usage file, a bad --now or --host, an unknown flag: exit 2', () => {
    withTempDir('usage-cli', (dir) => {
      const bad = path.join(dir, 'bad.json');
      fs.writeFileSync(bad, '{nope');
      expect(run(dir, ['--usage', bad]).code).toBe(2);
      expect(run(dir, ['--usage', path.join(dir, 'missing.json')]).code).toBe(2);
      expect(run(dir, ['--now', 'abc']).code).toBe(2);
      expect(run(dir, ['--host', 'x']).code).toBe(2);
      expect(run(dir, ['--bogus', '1']).code).toBe(2);
    });
  });
});
