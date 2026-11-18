import { afterEach, describe, expect, test } from 'bun:test';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { makeTempDir } from './fs.ts';
import { RATE_WINDOW_NAMES, readRateLimits, resolveRateLimitCachePath } from './rate-limit-cache.ts';

const NOW = 1_800_000_000;
const HOUR = 3600;
const DAY = 24 * HOUR;
const tempDirs: string[] = [];

afterEach(() => {
  for (const dir of tempDirs.splice(0)) fs.rmSync(dir, { recursive: true, force: true });
});

const win = (used: number, elapsed: number, length: number) => ({ used_percentage: used, resets_at: NOW + length - elapsed });
const limits = (weekly: [number, number], fiveHour: [number, number]) => ({
  seven_day: win(weekly[0], weekly[1], 7 * DAY),
  five_hour: win(fiveHour[0], fiveHour[1], 5 * HOUR),
});

const cacheFile = (content: unknown, ageSeconds = 0): string => {
  const dir = makeTempDir('rate-limit-cache');
  tempDirs.push(dir);
  const file = path.join(dir, 'rate-limits.json');
  fs.writeFileSync(file, typeof content === 'string' ? content : JSON.stringify(content));
  const t = new Date((NOW - ageSeconds) * 1000);
  fs.utimesSync(file, t, t);
  return file;
};

describe('readRateLimits', () => {
  test('reads rate_limits from a cached statusline payload', () => {
    const file = cacheFile({ model: {}, rate_limits: limits([50, DAY], [10, HOUR]) });
    expect(readRateLimits(file, NOW, 600).limits?.seven_day?.used_percentage).toBe(50);
  });

  test('a stale cache is unavailable, with its age in the reason', () => {
    const r = readRateLimits(cacheFile({ rate_limits: limits([50, DAY], [10, HOUR]) }, 3600), NOW, 600);
    expect(r.limits).toBeNull();
    expect(r.reason).toContain('stale');
  });

  test('a missing file, malformed JSON, or a payload with no windows is unavailable', () => {
    expect(readRateLimits('/nonexistent/rate-limits.json', NOW, 600).limits).toBeNull();
    expect(readRateLimits(cacheFile('{not json'), NOW, 600).limits).toBeNull();
    expect(readRateLimits(cacheFile({ rate_limits: {} }), NOW, 600).limits).toBeNull();
  });

  test('a window whose resets_at has passed is dropped, as Claude Code does', () => {
    const file = cacheFile({ rate_limits: { five_hour: { used_percentage: 90, resets_at: NOW - 1 }, seven_day: win(10, DAY, 7 * DAY) } });
    expect(readRateLimits(file, NOW, 600).limits?.five_hour).toBeUndefined();
  });

  test('a probe-written payload reports origin probe and the file mtime as observedAt', () => {
    const file = cacheFile({ rate_limits: limits([50, DAY], [10, HOUR]), source: 'rate_limit_event' }, 30);
    expect(readRateLimits(file, NOW, 600)).toMatchObject({ origin: 'probe', observedAt: NOW - 30 });
  });

  test('a statusline payload reports origin statusline', () => {
    const file = cacheFile({ rate_limits: limits([50, DAY], [10, HOUR]) });
    expect(readRateLimits(file, NOW, 600)).toMatchObject({ origin: 'statusline', observedAt: NOW });
  });

  test('any failure carries no observedAt and no origin', () => {
    for (const r of [readRateLimits('/nonexistent/x.json', NOW, 600), readRateLimits(cacheFile('{no'), NOW, 600), readRateLimits(cacheFile({ rate_limits: {} }), NOW, 600)]) {
      expect(r).toMatchObject({ limits: null, observedAt: null, origin: null });
    }
  });
});

describe('RATE_WINDOW_NAMES', () => {
  test('lists the two windows the cache carries', () => {
    expect([...RATE_WINDOW_NAMES]).toEqual(['five_hour', 'seven_day']);
  });
});

describe('resolveRateLimitCachePath', () => {
  test('defaults under the home directory, and honours resource_policy.pace.cache_path', () => {
    expect(resolveRateLimitCachePath({})).toBe(path.join(os.homedir(), '.claude', 'cache', 'rate-limits.json'));
    expect(resolveRateLimitCachePath({ resource_policy: { pace: { cache_path: '/x/y.json' } } })).toBe('/x/y.json');
  });
});

describe('layering', () => {
  const read = (name: string) => fs.readFileSync(path.join(import.meta.dir, name), 'utf-8');

  test('neither the cache reader nor the pace gate imports usage-source', () => {
    expect(read('rate-limit-cache.ts')).not.toContain('usage-source');
    expect(read('pace-gate.ts')).not.toContain('usage-source');
  });

  test('the cache reader has no relative import', () => {
    expect(read('rate-limit-cache.ts')).not.toMatch(/from '\.{1,2}\//);
  });
});
