import { afterEach, describe, expect, test } from 'bun:test';
import * as fs from 'fs';
import * as path from 'path';
import {
  DEFAULT_PACE_GATE,
  compartmentBreaches,
  evaluatePaceGate,
  readBaseline,
  rollBaseline,
  readRateLimits,
  resolvePaceGateThresholds,
  windowPace,
  type RateLimits,
  type Baseline,
  type RateWindow,
} from './pace-gate.ts';
import { makeTempDir } from './fs.ts';

const SCRIPT_PATH = path.join(import.meta.dir, '..', 'pace-gate.ts');
const NOW = 1_800_000_000;
const HOUR = 3600;
const DAY = 24 * HOUR;
const tempDirs: string[] = [];

afterEach(() => {
  for (const dir of tempDirs.splice(0)) fs.rmSync(dir, { recursive: true, force: true });
});

// A window `elapsed` seconds into its period, `used` percent consumed.
const win = (used: number, elapsed: number, length: number) => ({ used_percentage: used, resets_at: NOW + length - elapsed });
const limits = (weekly: [number, number], fiveHour: [number, number]): RateLimits => ({
  seven_day: win(weekly[0], weekly[1], 7 * DAY),
  five_hour: win(fiveHour[0], fiveHour[1], 5 * HOUR),
});

const cacheFile = (content: unknown, ageSeconds = 0): string => {
  const dir = makeTempDir('pace-gate');
  tempDirs.push(dir);
  const file = path.join(dir, 'rate-limits.json');
  fs.writeFileSync(file, typeof content === 'string' ? content : JSON.stringify(content));
  const t = new Date((NOW - ageSeconds) * 1000);
  fs.utimesSync(file, t, t);
  return file;
};

describe('windowPace', () => {
  test('is used share divided by elapsed share of the window', () => {
    expect(windowPace(win(50, 3.5 * DAY, 7 * DAY), 7 * DAY, NOW)).toBeCloseTo(1.0);
    expect(windowPace(win(25, 3.5 * DAY, 7 * DAY), 7 * DAY, NOW)).toBeCloseTo(0.5);
  });

  test('a window that just started does not divide by zero', () => {
    expect(Number.isFinite(windowPace(win(1, 0, 7 * DAY), 7 * DAY, NOW))).toBe(true);
  });
});

describe('evaluatePaceGate', () => {
  test('HOLD: on pace keeps the current concurrency', () => {
    expect(evaluatePaceGate(limits([50, 3.5 * DAY], [30, 2 * HOUR]), 3, 6, NOW, DEFAULT_PACE_GATE)).toMatchObject({
      verdict: 'HOLD',
      concurrency: 3,
    });
  });

  test('SCALE-UP: well under weekly pace adds one, capped at the maximum', () => {
    const under = limits([20, 3.5 * DAY], [10, 2 * HOUR]);
    expect(evaluatePaceGate(under, 3, 6, NOW, DEFAULT_PACE_GATE)).toMatchObject({ verdict: 'SCALE-UP', concurrency: 4 });
    expect(evaluatePaceGate(under, 6, 6, NOW, DEFAULT_PACE_GATE).concurrency).toBe(6);
  });

  test('THROTTLE: weekly burn above pace cuts to one', () => {
    const v = evaluatePaceGate(limits([80, 3.5 * DAY], [30, 2 * HOUR]), 4, 6, NOW, DEFAULT_PACE_GATE);
    expect(v).toMatchObject({ verdict: 'THROTTLE', concurrency: 1 });
    expect(v.reasons.join(' ')).toContain('seven_day');
  });

  test('THROTTLE: a hot five-hour window cuts to one even when weekly is fine', () => {
    expect(evaluatePaceGate(limits([20, 3.5 * DAY], [85, 2 * HOUR]), 4, 6, NOW, DEFAULT_PACE_GATE).verdict).toBe('THROTTLE');
  });

  test('STOP-NEW: either window at the stop threshold spawns nothing', () => {
    expect(evaluatePaceGate(limits([96, 6 * DAY], [10, 2 * HOUR]), 4, 6, NOW, DEFAULT_PACE_GATE)).toMatchObject({
      verdict: 'STOP-NEW',
      concurrency: 0,
    });
    expect(evaluatePaceGate(limits([20, 3.5 * DAY], [95, 4 * HOUR]), 4, 6, NOW, DEFAULT_PACE_GATE).verdict).toBe('STOP-NEW');
  });

  test('weekly-first: a weekly STOP-NEW is not softened by a cool five-hour window', () => {
    expect(evaluatePaceGate(limits([99, 6 * DAY], [1, 1 * HOUR]), 4, 6, NOW, DEFAULT_PACE_GATE).verdict).toBe('STOP-NEW');
  });

  test('a single present window still gates; the missing one is named', () => {
    const v = evaluatePaceGate({ seven_day: win(80, 3.5 * DAY, 7 * DAY) }, 4, 6, NOW, DEFAULT_PACE_GATE);
    expect(v.verdict).toBe('THROTTLE');
    expect(v.reasons.join(' ')).toContain('five_hour absent');
  });

  test('unavailable: no windows fails open with the current concurrency and a reason', () => {
    const v = evaluatePaceGate(null, 3, 6, NOW, DEFAULT_PACE_GATE);
    expect(v).toMatchObject({ verdict: 'unavailable', concurrency: 3 });
    expect(v.reasons[0]).toContain('unavailable');
  });
});

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
});

describe('resolvePaceGateThresholds', () => {
  test('absent resource_policy.pace resolves to the defaults', () => {
    expect(resolvePaceGateThresholds({})).toEqual(DEFAULT_PACE_GATE);
  });

  test('a non-numeric override is rejected', () => {
    expect(() => resolvePaceGateThresholds({ resource_policy: { pace: { stop_pct: 'high' } } })).toThrow('resource_policy.pace.stop_pct');
  });
});

describe('pace-gate CLI', () => {
  const run = (args: string[]) => {
    const r = Bun.spawnSync(['bun', 'run', SCRIPT_PATH, ...args], { stdout: 'pipe', stderr: 'pipe' });
    return { code: r.exitCode, out: r.stdout.toString(), err: r.stderr.toString() };
  };

  test('prints the verdict for a cached payload', () => {
    const file = cacheFile({ rate_limits: limits([96, 6 * DAY], [10, HOUR]) });
    const r = run(['--current', '4', '--max', '6', '--cache', file, '--now', String(NOW)]);
    expect(r.code).toBe(0);
    expect(JSON.parse(r.out)).toMatchObject({ verdict: 'STOP-NEW', concurrency: 0 });
  });

  test('an absent cache prints unavailable with the reason on stderr', () => {
    const r = run(['--current', '2', '--max', '6', '--cache', '/nonexistent/x.json', '--now', String(NOW)]);
    expect(JSON.parse(r.out)).toMatchObject({ verdict: 'unavailable', concurrency: 2 });
    expect(r.err).toContain('unavailable');
  });

  test('records a baseline on the first run, then stops once a compartment is spent', () => {
    const file = cacheFile({ rate_limits: limits([40, 3 * DAY], [5, HOUR]) });
    const args = ['--current', '3', '--max', '6', '--cache', file, '--now', String(NOW)];
    const first = run(args);
    expect(JSON.parse(first.out).reasons.join()).toContain('compartments unavailable');
    expect(fs.existsSync(path.join(path.dirname(file), 'pace-baseline.json'))).toBe(true);
    fs.writeFileSync(file, JSON.stringify({ rate_limits: limits([44, 3 * DAY], [5, HOUR]) }));
    const t = new Date(NOW * 1000);
    fs.utimesSync(file, t, t);
    expect(JSON.parse(run(args).out)).toMatchObject({ verdict: 'STOP-NEW', concurrency: 0 });
  });

  test('bad usage exits 2', () => {
    expect(run(['--current', 'x', '--max', '6']).code).toBe(2);
    expect(run([]).code).toBe(2);
  });
});

// Weekly window 3 days in (day index 3, 4 days left incl. today), 40% used: a 15% day share.
const WEEK_START = NOW - 3 * DAY - HOUR;
const dayBase = (used: number): Baseline => ({
  seven_day_resets_at: WEEK_START + 7 * DAY,
  day: { index: 3, seven_day_used: used },
  session: { resets_at: NOW + 4 * HOUR, seven_day_used: used },
});
const wk = (used: number): RateLimits & { seven_day: RateWindow } => ({
  seven_day: { used_percentage: used, resets_at: WEEK_START + 7 * DAY },
  five_hour: { used_percentage: 5, resets_at: NOW + 4 * HOUR },
});

describe('compartmentBreaches', () => {
  test('under both shares breaches nothing', () => {
    expect(compartmentBreaches(wk(41), dayBase(40), NOW)).toEqual([]);
  });

  test('a day that spent its share of the remaining weekly allowance breaches', () => {
    // remaining 60% over 4 days = 15% per day; 16% spent today
    const out = compartmentBreaches(wk(56), { ...dayBase(40), session: { resets_at: NOW + 4 * HOUR, seven_day_used: 56 } }, NOW);
    expect(out.join()).toContain('day');
  });

  test('a session that spent its share breaches while the weekly total looks fine', () => {
    // remaining 60% over ~19 sessions ~ 3.1% per session; 4% spent this session
    const out = compartmentBreaches(wk(44), dayBase(40), NOW);
    expect(out.join()).toContain('session');
  });
});

describe('rollBaseline', () => {
  test('a stale day and session are restarted at current usage', () => {
    const old = { ...dayBase(10), day: { index: 1, seven_day_used: 10 }, session: { resets_at: NOW - HOUR, seven_day_used: 10 } };
    const rolled = rollBaseline(wk(40), old, NOW);
    expect(rolled.day).toEqual({ index: 3, seven_day_used: 40 });
    expect(rolled.session).toEqual({ resets_at: NOW + 4 * HOUR, seven_day_used: 40 });
  });

  test('a new weekly window discards the whole baseline', () => {
    const old = { ...dayBase(90), seven_day_resets_at: WEEK_START - DAY };
    expect(rollBaseline(wk(2), old, NOW).day.seven_day_used).toBe(2);
  });

  test('a current baseline is kept untouched', () => {
    expect(rollBaseline(wk(41), dayBase(40), NOW)).toEqual(dayBase(40));
  });
});

describe('readBaseline', () => {
  test('missing file reports a reason', () => {
    expect(readBaseline('/nonexistent/baseline.json').reason).toContain('no pace baseline');
  });

  test('corrupt and malformed content report a reason', () => {
    expect(readBaseline(cacheFile('{nope')).reason).toContain('not valid JSON');
    expect(readBaseline(cacheFile({ day: 1 })).reason).toContain('malformed');
  });

  test('a valid file round-trips', () => {
    expect(readBaseline(cacheFile(dayBase(40)))).toEqual({ baseline: dayBase(40), reason: null });
  });
});

describe('evaluatePaceGate with compartments', () => {
  const t = DEFAULT_PACE_GATE;
  test('a spent compartment stops new tasks although the weekly pace is fine', () => {
    const v = evaluatePaceGate(wk(44), 3, 6, NOW, t, undefined, { baseline: dayBase(40), reason: null });
    expect(v).toMatchObject({ verdict: 'STOP-NEW', concurrency: 0 });
    expect(v.reasons.join()).toContain('session');
  });

  test('a missing baseline keeps the base verdict and states why the compartment check was skipped', () => {
    const v = evaluatePaceGate(wk(43), 3, 6, NOW, t, undefined, { baseline: null, reason: 'no pace baseline at x' });
    expect(v.verdict).not.toBe('STOP-NEW');
    expect(v.reasons.join()).toContain('compartments unavailable: no pace baseline at x');
  });

  test('omitting the baseline argument leaves behavior unchanged', () => {
    expect(evaluatePaceGate(wk(43), 3, 6, NOW, t).reasons.join()).not.toContain('compartment');
  });
});
