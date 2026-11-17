import * as fs from 'fs';
import * as path from 'path';
import { parseFlags, unknownFlagKeys } from './lib/argv-flags.ts';
import { readJsonFile } from './lib/fs.ts';
import { resolveRateLimitCachePath, type RateLimits } from './lib/pace-gate.ts';

// Usage: bun run scripts/usage-probe.ts --from-events <file|-> [--cache <path>] [--config <path>] [--now <epoch s>]
// Turns raw `rate_limit_event` JSON (what the claude-code-remote `list_events` tool returns, either
// one event or its `{"ccr":{"data":[...]}}` wrapper, newest event wins) into the normalized
// RateLimits shape and writes it to the statusline rate-limit cache, so pace-gate.ts and
// usage-budget.ts read one place. The cache file's mtime is set to the event's own time, so the
// readers' max-age check measures how old the reading is, not when the probe ran.
// Exit 0 written; 1 no current window in the event (nothing written); 2 bad usage or malformed input.
const USAGE = 'usage: usage-probe.ts --from-events <file|-> [--cache <path>] [--config <path>] [--now <epoch s>]';
const WINDOWS = ['five_hour', 'seven_day'] as const;

export class NoCurrentWindow extends Error {}

type Info = { unifiedWindows?: Record<string, { utilization?: unknown; resetsAt?: unknown }> };
type Event = { created_at?: unknown; rate_limit_event?: Record<string, { rate_limit_info?: Info }> };

const isObject = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);
const eventTime = (e: Event): number => {
  const t = typeof e.created_at === 'string' ? Date.parse(e.created_at) : NaN;
  return Number.isFinite(t) ? Math.floor(t / 1000) : 0;
};

const pickNewestEvent = (parsed: unknown): Event => {
  const candidates = isObject(parsed) && isObject(parsed.ccr) && Array.isArray(parsed.ccr.data) ? parsed.ccr.data : [parsed];
  const events = candidates.filter((e): e is Event => isObject(e) && isObject(e.rate_limit_event));
  if (events.length === 0) throw new Error('input carries no rate_limit_event');
  return events.reduce((a, b) => (eventTime(b) > eventTime(a) ? b : a));
};

export const eventsToRateLimits = (raw: string, now: number): { limits: RateLimits; observedAt: number | null } => {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    throw new Error('input is not valid JSON');
  }
  const event = pickNewestEvent(parsed);
  const limits: RateLimits = {};
  for (const entry of Object.values(event.rate_limit_event ?? {})) {
    const windows = entry?.rate_limit_info?.unifiedWindows;
    if (!isObject(windows)) continue;
    for (const name of WINDOWS) {
      const w = windows[name];
      if (w === undefined) continue;
      const { utilization, resetsAt } = w as { utilization?: unknown; resetsAt?: unknown };
      if (typeof utilization !== 'number' || !(utilization >= 0 && utilization <= 1)) {
        throw new Error(`${name}.utilization must be a number 0-1`);
      }
      if (typeof resetsAt !== 'number' || !Number.isFinite(resetsAt) || resetsAt <= 0) {
        throw new Error(`${name}.resetsAt must be epoch seconds > 0`);
      }
      // A window past its reset no longer applies — the same rule readRateLimits uses.
      if (resetsAt <= now) continue;
      limits[name] = { used_percentage: Math.round(utilization * 10000) / 100, resets_at: resetsAt };
    }
  }
  if (!limits.five_hour && !limits.seven_day) throw new NoCurrentWindow('rate_limit_event carries no current five_hour or seven_day window');
  const observedAt = eventTime(event);
  return { limits, observedAt: observedAt > 0 ? observedAt : null };
};

const main = (): void => {
  const fail = (message: string, code = 2): never => {
    console.error(`usage-probe: ${message}${code === 2 ? `\n${USAGE}` : ''}`);
    process.exit(code);
  };
  const flags = parseFlags(process.argv.slice(2));
  const unknown = unknownFlagKeys(flags, ['from-events', 'cache', 'config', 'now']);
  if (unknown.length) fail(`unknown flag(s): ${unknown.map((k) => `--${k}`).join(', ')}`);
  const source = flags['from-events'];
  if (typeof source !== 'string') fail('--from-events <file|-> is required');
  const nowFlag = Number(flags.now);
  if (flags.now !== undefined && !(typeof flags.now === 'string' && Number.isInteger(nowFlag) && nowFlag >= 0)) {
    fail('--now must be a non-negative integer');
  }
  const now = flags.now === undefined ? Math.floor(Date.now() / 1000) : nowFlag;

  let cachePath = typeof flags.cache === 'string' ? flags.cache : '';
  let raw: string;
  try {
    const configPath = typeof flags.config === 'string' ? flags.config : '.blackhole/config.json';
    const config = fs.existsSync(configPath) ? (readJsonFile(configPath, configPath) as Record<string, unknown>) : {};
    if (!cachePath) cachePath = resolveRateLimitCachePath(config);
    raw = fs.readFileSync(source === '-' ? 0 : (source as string), 'utf-8');
  } catch (error) {
    return fail(error instanceof Error ? error.message : String(error));
  }

  let reading: ReturnType<typeof eventsToRateLimits>;
  try {
    reading = eventsToRateLimits(raw, now);
  } catch (error) {
    return fail(error instanceof Error ? error.message : String(error), error instanceof NoCurrentWindow ? 1 : 2);
  }
  const observedAt = reading.observedAt ?? now;
  fs.mkdirSync(path.dirname(cachePath), { recursive: true });
  fs.writeFileSync(`${cachePath}.tmp`, JSON.stringify({ rate_limits: reading.limits, source: 'rate_limit_event', observed_at: observedAt }));
  fs.renameSync(`${cachePath}.tmp`, cachePath);
  fs.utimesSync(cachePath, observedAt, observedAt);
  console.log(JSON.stringify({ cache: cachePath, observed_at: observedAt, age_seconds: Math.max(0, now - observedAt), rate_limits: reading.limits }));
};

if (import.meta.main) main();
