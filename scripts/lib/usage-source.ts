import * as fs from 'fs';
import * as path from 'path';
import { readJsonFile } from './fs.ts';
import { resolvePaceGateThresholds } from './pace-gate.ts';
import { RATE_WINDOW_NAMES, readRateLimits, resolveRateLimitCachePath, type RateLimits } from './rate-limit-cache.ts';
import { detectHost, type Host } from './run-context.ts';
import { UsageFileError, normalizeUsagePayload, type ExtraUsage, type PlanName, type ReportWindow } from './usage-normalize.ts';
import { resolveUsageWindows, USAGE_WINDOWS, type UsageWindow } from './usage-budget.ts';

// The usage source for a host: where its rate-limit reading comes from, and which windows that
// reading shows. Claude reads the one rate-limit cache (written by the statusline or by
// usage-probe.ts from a rate_limit_event's unifiedWindows), and the windows are the ones present in
// it, so a plan with no five_hour window gates on the weekly window alone with no config. An unknown
// host means detection is unsure, not that the host is not Claude, so it reads the same cache: a
// configured or cached reading is never discarded for it. Cursor has no readable source: its reading
// is null with a reason, which the usage-budget gate turns into `unavailable`, never a silent GO.
// An explicit usage file (usage.ts --usage) is tried before the cache on every host, Cursor included;
// a stale one ends the chain with its reason rather than falling back to the cache;
// `report()` is the full normalized reading, `read()` the gate view of the same chain call.

export type UsageSourceName = 'usage-file' | 'rate-limit-cache' | 'none';
/** Which provider in the chain produced the reading: finer than `source`, which keeps the names the
 * run context and the status page already use. */
export type UsageProvider = 'usage-file' | 'statusline' | 'probe' | 'none';

export type UsageReading = {
  source: UsageSourceName;
  /** The reading, restricted to `windows`; null ⇒ nothing usable, with `reason`. */
  limits: RateLimits | null;
  /** The windows the reading shows (after any `usage_budget.windows` override). */
  windows: UsageWindow[];
  reason: string | null;
};

/** The full normalized reading `bun run usage` prints: every window the provider carries. */
export type UsageReport = {
  plan: PlanName;
  windows: ReportWindow[];
  extra_usage: ExtraUsage | null;
  source: UsageSourceName;
  provider: UsageProvider;
  read_at: number | null;
  reason: string | null;
};

export type UsageSource = {
  name: UsageSourceName;
  /** The file the source reads, when it reads one. */
  cachePath: string | null;
  read: (now: number) => UsageReading;
  report: (now: number) => UsageReport;
};

/** `limits` with only the windows `only` names (all when null); `limits` null when none is left. */
export const restrictWindows = (limits: RateLimits, only: UsageWindow[] | null): { limits: RateLimits | null; windows: UsageWindow[] } => {
  const kept: RateLimits = {};
  for (const name of USAGE_WINDOWS) if (limits[name] && (only === null || only.includes(name))) kept[name] = limits[name];
  const windows = USAGE_WINDOWS.filter((name) => kept[name] !== undefined);
  return { limits: windows.length ? kept : null, windows };
};

/** `final`: the chain stops here, with no fallback to a later provider. */
type ProviderResult = { ok: true; report: UsageReport } | { ok: false; reason: string; final?: boolean };
type Provider = { source: UsageSourceName; run: (now: number) => ProviderResult };

const fail = (reason: string): ProviderResult => ({ ok: false, reason });

const emptyReport = (reason: string): UsageReport => ({
  plan: 'unknown',
  windows: [],
  extra_usage: null,
  source: 'none',
  provider: 'none',
  read_at: null,
  reason,
});

const fileProvider = (usageFile: string, maxAgeSeconds: number): Provider => ({
  source: 'usage-file',
  run: (now) => {
    let raw: string;
    let mtime: number;
    try {
      raw = fs.readFileSync(usageFile, 'utf-8');
      mtime = Math.floor(fs.statSync(usageFile).mtimeMs / 1000);
    } catch (error) {
      throw new UsageFileError(`cannot read usage file ${usageFile}: ${error instanceof Error ? error.message : String(error)}`);
    }
    let usage;
    try {
      usage = normalizeUsagePayload(JSON.parse(raw));
    } catch (error) {
      const detail = error instanceof UsageFileError ? error.message : 'not valid JSON';
      throw new UsageFileError(`usage file ${usageFile}: ${detail}`);
    }
    const readAt = Math.min(usage.read_at ?? mtime, now);
    // A stale file the caller named fails closed: falling through would hand back a reading from a
    // source the caller did not choose (the cache may hold another account's usage).
    if (now - readAt > maxAgeSeconds) return { ok: false, reason: `usage file stale (${now - readAt}s > ${maxAgeSeconds}s)`, final: true };
    // A window past its reset no longer applies, as in the cache reader.
    const windows = usage.windows.filter((w) => w.resets_at > now);
    if (!windows.length && usage.plan !== 'none') return fail('usage file carries no current window');
    return { ok: true, report: { plan: usage.plan, windows, extra_usage: usage.extra_usage, source: 'usage-file', provider: 'usage-file', read_at: readAt, reason: null } };
  },
});

const cacheProvider = (cachePath: string, maxAgeSeconds: number, host: Host): Provider => ({
  source: 'rate-limit-cache',
  run: (now) => {
    const { limits, reason, observedAt, origin } = readRateLimits(cachePath, now, maxAgeSeconds);
    if (!limits) return fail(host === 'unknown' ? `host unknown: ${reason}` : (reason as string));
    const windows: ReportWindow[] = RATE_WINDOW_NAMES.flatMap((name) => {
      const w = limits[name];
      return w ? [{ name, used_pct: w.used_percentage, resets_at: w.resets_at }] : [];
    });
    return {
      ok: true,
      report: { plan: 'unknown', windows, extra_usage: null, source: 'rate-limit-cache', provider: origin ?? 'statusline', read_at: observedAt, reason: null },
    };
  },
});

const cursorProvider: Provider = {
  source: 'none',
  run: () => fail('cursor: no readable usage source, usage-aware pacing not applied'),
};

/** The source for `host`. Chain: the explicit `usageFile`, then the rate-limit cache (not on Cursor);
 * the first usable reading wins, except that a stale `usageFile` ends the chain with no reading. Throws on an invalid `resource_policy.pace` or `usage_budget.windows`,
 * and a missing or malformed `usageFile` throws UsageFileError when read. */
export const usageSourceFor = (host: Host, config: Record<string, unknown>, options: { cachePath?: string; usageFile?: string } = {}): UsageSource => {
  const maxAge = resolvePaceGateThresholds(config).maxAgeSeconds;
  const only = resolveUsageWindows(config);
  const cachePath = options.cachePath || resolveRateLimitCachePath(config);
  const chain: Provider[] = [];
  if (options.usageFile) chain.push(fileProvider(options.usageFile, maxAge));
  chain.push(host === 'cursor' ? cursorProvider : cacheProvider(cachePath, maxAge, host));
  const name = chain[0].source;
  const usesCache = host !== 'cursor';

  const report = (now: number): UsageReport => {
    const reasons: string[] = [];
    for (const provider of chain) {
      const result = provider.run(now);
      if (result.ok) return result.report;
      reasons.push(result.reason);
      if (result.final) break;
    }
    return emptyReport(reasons.join('; '));
  };

  return {
    name,
    cachePath: usesCache ? cachePath : null,
    report,
    read: (now) => {
      const r = report(now);
      if (r.source === 'none') return { source: name, limits: null, windows: [], reason: r.reason };
      const limits: RateLimits = {};
      for (const w of r.windows) {
        if ((RATE_WINDOW_NAMES as readonly string[]).includes(w.name)) limits[w.name as keyof RateLimits] = { used_percentage: w.used_pct, resets_at: w.resets_at };
      }
      if (!Object.keys(limits).length) return { source: r.source, limits: null, windows: [], reason: 'no plan limits' };
      const kept = restrictWindows(limits, only);
      const dropped = kept.limits ? null : `usage_budget.windows ${JSON.stringify(only)} leaves none of the detected windows`;
      return { source: r.source, ...kept, reason: dropped };
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
