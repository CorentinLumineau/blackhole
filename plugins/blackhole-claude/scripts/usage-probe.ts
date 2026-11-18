import * as fs from 'fs';
import * as path from 'path';
import { parseFlags, unknownFlagKeys } from './lib/argv-flags.ts';
import { readJsonFile } from './lib/fs.ts';
import { resolveRateLimitCachePath, type RateLimits } from './lib/rate-limit-cache.ts';
import { appendUsageReading, USAGE_HISTORY_FILE } from './lib/usage-history.ts';

// Usage: bun run scripts/usage-probe.ts (--from-events <file|-> | --from-ccd-usage <file|->) [--cache <path>] [--config <path>] [--now <epoch s>]
// --from-ccd-usage takes the Claude desktop app's `get_usage` JSON: `plan.windows[]` rows
// `{label, percentUsed (0-100), resetsAt (ISO or epoch s)}`; "5-hour limit" becomes five_hour and
// "Weekly · all models" becomes seven_day, per-model rows are ignored. That payload has no event time,
// so the reading is dated now.
// Turns raw `rate_limit_event` JSON (what the claude-code-remote `list_events` tool returns, either
// one event or its `{"ccr":{"data":[...]}}` wrapper, newest event wins) into the normalized
// RateLimits shape and writes it to the statusline rate-limit cache, so pace-gate.ts and
// usage-budget.ts read one place. The cache file's mtime is set to the event's own time, so the
// readers' max-age check measures how old the reading is, not when the probe ran; a `created_at`
// in the future is clamped to now. A weekly reading is also appended to usage-history.jsonl beside
// the config (`.blackhole/` by default), which the status page's pace row reads.
// Exit 0 written; 1 no current window in the event (nothing written); 2 bad usage or malformed input,
// including a missing or unparseable `created_at` (nothing written); 3 the cache or the usage history could not be written.
const USAGE = 'usage: usage-probe.ts (--from-events <file|-> | --from-ccd-usage <file|->) [--cache <path>] [--config <path>] [--now <epoch s>]';
const WINDOWS = ['five_hour', 'seven_day'] as const;

export class NoCurrentWindow extends Error {}

type Info = { unifiedWindows?: Record<string, { utilization?: unknown; resetsAt?: unknown }> };
type Event = { created_at?: unknown; rate_limit_event?: Record<string, { rate_limit_info?: Info }> };

const isObject = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);
// Without a readable event time the reading's age is unknown, so the event is refused rather than
// dated to the probe run.
const eventTime = (e: Event): number => {
  const t = typeof e.created_at === 'string' ? Date.parse(e.created_at) : NaN;
  if (!Number.isFinite(t)) throw new Error('rate_limit_event has a missing or unparseable created_at');
  return Math.floor(t / 1000);
};

const pickNewestEvent = (parsed: unknown): Event => {
  const candidates = isObject(parsed) && isObject(parsed.ccr) && Array.isArray(parsed.ccr.data) ? parsed.ccr.data : [parsed];
  const events = candidates.filter((e): e is Event => isObject(e) && isObject(e.rate_limit_event));
  if (events.length === 0) throw new Error('input carries no rate_limit_event');
  return events.reduce((a, b) => (eventTime(b) > eventTime(a) ? b : a));
};

export const eventsToRateLimits = (raw: string, now: number): { limits: RateLimits; observedAt: number } => {
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
  return { limits, observedAt: Math.min(eventTime(event), now) };
};

const CCD_LABELS: Array<[RegExp, (typeof WINDOWS)[number]]> = [
  [/^5[- ]hour limit$/, 'five_hour'],
  [/^weekly all models$/, 'seven_day'],
];
const normalizeLabel = (label: string): string => label.toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();

export const ccdUsageToRateLimits = (raw: string, now: number): { limits: RateLimits; observedAt: number } => {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    throw new Error('input is not valid JSON');
  }
  const rows = isObject(parsed) && isObject(parsed.plan) ? parsed.plan.windows : undefined;
  if (!Array.isArray(rows)) throw new Error('input carries no plan.windows array');
  const limits: RateLimits = {};
  for (const row of rows) {
    if (!isObject(row) || typeof row.label !== 'string') continue;
    const name = CCD_LABELS.find(([re]) => re.test(normalizeLabel(row.label as string)))?.[1];
    if (!name) continue;
    const { percentUsed, resetsAt } = row;
    if (typeof percentUsed !== 'number' || !(percentUsed >= 0 && percentUsed <= 100)) {
      throw new Error(`${name} percentUsed must be a number 0-100`);
    }
    const resets = typeof resetsAt === 'string' ? Math.floor(Date.parse(resetsAt) / 1000) : resetsAt;
    if (typeof resets !== 'number' || !Number.isFinite(resets) || resets <= 0) {
      throw new Error(`${name} resetsAt must be an ISO-8601 string or epoch seconds > 0`);
    }
    if (resets <= now) continue;
    limits[name] = { used_percentage: percentUsed, resets_at: resets };
  }
  if (!limits.five_hour && !limits.seven_day) throw new NoCurrentWindow('get_usage carries no current 5-hour or weekly all-models window');
  return { limits, observedAt: now };
};

const main = (): void => {
  const fail = (message: string, code = 2): never => {
    console.error(`usage-probe: ${message}${code === 2 ? `\n${USAGE}` : ''}`);
    process.exit(code);
  };
  const flags = parseFlags(process.argv.slice(2));
  const unknown = unknownFlagKeys(flags, ['from-events', 'from-ccd-usage', 'cache', 'config', 'now']);
  if (unknown.length) fail(`unknown flag(s): ${unknown.map((k) => `--${k}`).join(', ')}`);
  const events = flags['from-events'];
  const ccdUsage = flags['from-ccd-usage'];
  if ((events === undefined) === (ccdUsage === undefined)) fail('exactly one of --from-events or --from-ccd-usage is required');
  const source = events ?? ccdUsage;
  if (typeof source !== 'string') fail('the source flag needs a <file|-> value');
  const nowFlag = Number(flags.now);
  if (flags.now !== undefined && !(typeof flags.now === 'string' && Number.isInteger(nowFlag) && nowFlag >= 0)) {
    fail('--now must be a non-negative integer');
  }
  const now = flags.now === undefined ? Math.floor(Date.now() / 1000) : nowFlag;

  let cachePath = typeof flags.cache === 'string' ? flags.cache : '';
  const configPath = typeof flags.config === 'string' ? flags.config : '.blackhole/config.json';
  let raw: string;
  try {
    const config = fs.existsSync(configPath) ? (readJsonFile(configPath, configPath) as Record<string, unknown>) : {};
    if (!cachePath) cachePath = resolveRateLimitCachePath(config);
    raw = fs.readFileSync(source === '-' ? 0 : (source as string), 'utf-8');
  } catch (error) {
    return fail(error instanceof Error ? error.message : String(error));
  }

  let reading: ReturnType<typeof eventsToRateLimits>;
  const fromCcd = ccdUsage !== undefined;
  try {
    reading = fromCcd ? ccdUsageToRateLimits(raw, now) : eventsToRateLimits(raw, now);
  } catch (error) {
    return fail(error instanceof Error ? error.message : String(error), error instanceof NoCurrentWindow ? 1 : 2);
  }
  const { limits, observedAt } = reading;
  try {
    fs.mkdirSync(path.dirname(cachePath), { recursive: true });
    fs.writeFileSync(`${cachePath}.tmp`, JSON.stringify({ rate_limits: limits, source: fromCcd ? 'ccd_get_usage' : 'rate_limit_event', observed_at: observedAt }));
    fs.renameSync(`${cachePath}.tmp`, cachePath);
    fs.utimesSync(cachePath, observedAt, observedAt);
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    return fail(`cannot write rate-limit cache at ${cachePath}: ${detail.replace(/\s+/g, ' ')}`, 3);
  }
  const historyPath = path.join(path.dirname(configPath), USAGE_HISTORY_FILE);
  try {
    if (limits.seven_day) appendUsageReading(historyPath, { observed_at: observedAt, ...limits.seven_day });
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    return fail(`cannot append usage history at ${historyPath}: ${detail.replace(/\s+/g, ' ')}`, 3);
  }
  console.log(JSON.stringify({ cache: cachePath, observed_at: observedAt, age_seconds: Math.max(0, now - observedAt), rate_limits: limits }));
};

if (import.meta.main) main();
