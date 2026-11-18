import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';

// The one rate-limit cache reader. The statusline (or usage-probe.ts) writes the file; the pace
// gate and the usage source both read it through here. Imports no local module, so neither
// consumer can depend on the other through it.

export type RateWindow = { used_percentage: number; resets_at: number };
export type RateLimits = { five_hour?: RateWindow; seven_day?: RateWindow };

/** The window names the cache carries; the single list every reader iterates. */
export const RATE_WINDOW_NAMES = ['five_hour', 'seven_day'] as const;

export type RateLimitCacheReading = {
  limits: RateLimits | null;
  reason: string | null;
  /** File mtime in epoch seconds (the probe sets it to the event time); null on any failure. */
  observedAt: number | null;
  /** `probe` when the payload's `source` is `rate_limit_event`, else `statusline`; null on any failure. */
  origin: 'statusline' | 'probe' | null;
};

const isWindow = (value: unknown): value is RateWindow =>
  typeof value === 'object' &&
  value !== null &&
  typeof (value as RateWindow).used_percentage === 'number' &&
  typeof (value as RateWindow).resets_at === 'number';

/** The one rate-limit cache every reader and writer shares: `resource_policy.pace.cache_path`, else
 * the statusline default `~/.claude/cache/rate-limits.json`. */
export const resolveRateLimitCachePath = (config: Record<string, unknown>): string => {
  const pace = ((config.resource_policy ?? {}) as { pace?: { cache_path?: unknown } }).pace;
  return typeof pace?.cache_path === 'string' ? pace.cache_path : path.join(os.homedir(), '.claude', 'cache', 'rate-limits.json');
};

const failed = (reason: string): RateLimitCacheReading => ({ limits: null, reason, observedAt: null, origin: null });

export const readRateLimits = (cachePath: string, now: number, maxAgeSeconds: number): RateLimitCacheReading => {
  let raw: string;
  let mtimeSeconds: number;
  try {
    raw = fs.readFileSync(cachePath, 'utf-8');
    mtimeSeconds = fs.statSync(cachePath).mtimeMs / 1000;
  } catch {
    return failed(`no rate-limit cache at ${cachePath}`);
  }
  const ageSeconds = Math.round(now - mtimeSeconds);
  if (ageSeconds > maxAgeSeconds) {
    return failed(`rate-limit cache stale (${ageSeconds}s > ${maxAgeSeconds}s)`);
  }
  let payload: { rate_limits?: Record<string, unknown>; source?: unknown };
  try {
    payload = JSON.parse(raw);
  } catch {
    return failed(`rate-limit cache at ${cachePath} is not valid JSON`);
  }
  const limits: RateLimits = {};
  for (const name of RATE_WINDOW_NAMES) {
    const w = payload.rate_limits?.[name];
    // A window past its reset no longer applies; Claude Code drops it the same way.
    if (isWindow(w) && w.resets_at > now) limits[name] = w;
  }
  if (!limits.five_hour && !limits.seven_day) {
    return failed('rate-limit cache carries no current five_hour or seven_day window');
  }
  return { limits, reason: null, observedAt: Math.round(mtimeSeconds), origin: payload.source === 'rate_limit_event' ? 'probe' : 'statusline' };
};
