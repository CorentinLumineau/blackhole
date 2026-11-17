import * as path from 'path';
import { readJsonFile } from './fs.ts';
import { resolvePaceGateThresholds } from './pace-gate.ts';
import { readRateLimits, resolveRateLimitCachePath, type RateLimits } from './rate-limit-cache.ts';
import { detectHost, type Host } from './run-context.ts';
import { resolveUsageWindows, USAGE_WINDOWS, type UsageWindow } from './usage-budget.ts';

// The usage source for a host: where its rate-limit reading comes from, and which windows that
// reading shows. Claude reads the one rate-limit cache (written by the statusline or by
// usage-probe.ts from a rate_limit_event's unifiedWindows), and the windows are the ones present in
// it, so a plan with no five_hour window gates on the weekly window alone with no config. An unknown
// host means detection is unsure, not that the host is not Claude, so it reads the same cache: a
// configured or cached reading is never discarded for it. Cursor has no readable source: its reading
// is null with a reason, which the usage-budget gate turns into `unavailable`, never a silent GO.

export type UsageSourceName = 'rate-limit-cache' | 'none';

export type UsageReading = {
  source: UsageSourceName;
  /** The reading, restricted to `windows`; null ⇒ nothing usable, with `reason`. */
  limits: RateLimits | null;
  /** The windows the reading shows (after any `usage_budget.windows` override). */
  windows: UsageWindow[];
  reason: string | null;
};

export type UsageSource = {
  name: UsageSourceName;
  /** The file the source reads, when it reads one. */
  cachePath: string | null;
  read: (now: number) => UsageReading;
};

/** `limits` with only the windows `only` names (all when null); `limits` null when none is left. */
export const restrictWindows = (limits: RateLimits, only: UsageWindow[] | null): { limits: RateLimits | null; windows: UsageWindow[] } => {
  const kept: RateLimits = {};
  for (const name of USAGE_WINDOWS) if (limits[name] && (only === null || only.includes(name))) kept[name] = limits[name];
  const windows = USAGE_WINDOWS.filter((name) => kept[name] !== undefined);
  return { limits: windows.length ? kept : null, windows };
};

const noSource = (reason: string): UsageSource => ({
  name: 'none',
  cachePath: null,
  read: () => ({ source: 'none', limits: null, windows: [], reason }),
});

/** The source for `host`. Throws on an invalid `resource_policy.pace` or `usage_budget.windows`. */
export const usageSourceFor = (host: Host, config: Record<string, unknown>, options: { cachePath?: string } = {}): UsageSource => {
  if (host === 'cursor') return noSource('cursor: no readable usage source, usage-aware pacing not applied');
  const cachePath = options.cachePath || resolveRateLimitCachePath(config);
  const maxAge = resolvePaceGateThresholds(config).maxAgeSeconds;
  const only = resolveUsageWindows(config);
  return {
    name: 'rate-limit-cache',
    cachePath,
    read: (now) => {
      const { limits, reason } = readRateLimits(cachePath, now, maxAge);
      if (!limits) return { source: 'rate-limit-cache', limits: null, windows: [], reason: host === 'unknown' ? `host unknown: ${reason}` : reason };
      const kept = restrictWindows(limits, only);
      const dropped = kept.limits ? null : `usage_budget.windows ${JSON.stringify(only)} leaves none of the detected windows`;
      return { source: 'rate-limit-cache', ...kept, reason: dropped };
    },
  };
};

const isHost = (v: unknown): v is Host => v === 'claude' || v === 'cursor' || v === 'unknown';

/** The host `run-context.json` in `campaignDir` records, or null when absent or unreadable. */
export const readRecordedHost = (campaignDir: string): Host | null => {
  try {
    const file = path.join(campaignDir, 'run-context.json');
    const value = (readJsonFile(file, file) as { context?: { host?: { value?: unknown } } })?.context?.host?.value;
    return isHost(value) ? value : null;
  } catch {
    return null;
  }
};

/** The recorded host, else the one the environment shows. */
export const resolveHost = (campaignDir: string, env: Record<string, string | undefined>): Host => readRecordedHost(campaignDir) ?? detectHost(env);
