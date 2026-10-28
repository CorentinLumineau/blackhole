import * as fs from 'fs';

// Usage-pace gate the orchestrator runs beside resource-gate.ts before each spawn round
// (orchestrator-runtime.md § Background worker barrier). Input is Claude Code's statusline
// `rate_limits` payload, cached to a file by a statusline command
// (https://code.claude.com/docs/en/statusline.md): `used_percentage` is 0-100, `resets_at` is
// epoch seconds, and either window may be absent. Weekly-first: the seven-day window decides
// THROTTLE/SCALE-UP; either window can force STOP-NEW. Anything unreadable is `unavailable`,
// which fails open with the current concurrency but always carries a reason.

export type RateWindow = { used_percentage: number; resets_at: number };
export type RateLimits = { five_hour?: RateWindow; seven_day?: RateWindow };

export type PaceGateThresholds = {
  maxAgeSeconds: number;
  stopPct: number;
  throttlePct: number;
  throttleRatio: number;
  scaleUpRatio: number;
};

export type PaceGateVerdict = {
  verdict: 'STOP-NEW' | 'THROTTLE' | 'HOLD' | 'SCALE-UP' | 'unavailable';
  concurrency: number;
  reasons: string[];
};

export const DEFAULT_PACE_GATE: PaceGateThresholds = {
  maxAgeSeconds: 600,
  stopPct: 95,
  throttlePct: 80,
  throttleRatio: 1.2,
  scaleUpRatio: 0.7,
};

const CONFIG_KEYS: Record<keyof PaceGateThresholds, string> = {
  maxAgeSeconds: 'max_age_seconds',
  stopPct: 'stop_pct',
  throttlePct: 'throttle_pct',
  throttleRatio: 'throttle_ratio',
  scaleUpRatio: 'scale_up_ratio',
};

const WINDOW_SECONDS = { five_hour: 5 * 3600, seven_day: 7 * 24 * 3600 } as const;
type WindowName = keyof typeof WINDOW_SECONDS;

/** Share of the window's allowance used, divided by the share of the window elapsed: 1.0 is
 * exactly on pace. Elapsed is floored at 1% so a window that just opened stays finite. */
export const windowPace = (w: RateWindow, lengthSeconds: number, now: number): number => {
  const elapsed = Math.min(1, Math.max(0.01, 1 - (w.resets_at - now) / lengthSeconds));
  return w.used_percentage / 100 / elapsed;
};

const isWindow = (value: unknown): value is RateWindow =>
  typeof value === 'object' &&
  value !== null &&
  typeof (value as RateWindow).used_percentage === 'number' &&
  typeof (value as RateWindow).resets_at === 'number';

export const readRateLimits = (
  cachePath: string,
  now: number,
  maxAgeSeconds: number,
): { limits: RateLimits | null; reason: string | null } => {
  let raw: string;
  let ageSeconds: number;
  try {
    raw = fs.readFileSync(cachePath, 'utf-8');
    ageSeconds = Math.round(now - fs.statSync(cachePath).mtimeMs / 1000);
  } catch {
    return { limits: null, reason: `no rate-limit cache at ${cachePath}` };
  }
  if (ageSeconds > maxAgeSeconds) {
    return { limits: null, reason: `rate-limit cache stale (${ageSeconds}s > ${maxAgeSeconds}s)` };
  }
  let payload: { rate_limits?: Record<string, unknown> };
  try {
    payload = JSON.parse(raw);
  } catch {
    return { limits: null, reason: `rate-limit cache at ${cachePath} is not valid JSON` };
  }
  const limits: RateLimits = {};
  for (const name of Object.keys(WINDOW_SECONDS) as WindowName[]) {
    const w = payload.rate_limits?.[name];
    // A window past its reset no longer applies; Claude Code drops it the same way.
    if (isWindow(w) && w.resets_at > now) limits[name] = w;
  }
  if (!limits.five_hour && !limits.seven_day) {
    return { limits: null, reason: 'rate-limit cache carries no current five_hour or seven_day window' };
  }
  return { limits, reason: null };
};

// Budget compartments: the remaining weekly allowance split into per-day and per-five-hour-session
// shares. Both are measured in seven_day percentage points spent since the compartment began, so
// a baseline of the weekly usage at each compartment's start is persisted next to the cache.
export type Baseline = {
  seven_day_resets_at: number;
  day: { index: number; seven_day_used: number };
  session: { resets_at: number; seven_day_used: number };
};
export type BaselineInput = { baseline: Baseline | null; reason: string | null };
type WeeklyLimits = RateLimits & { seven_day: RateWindow };

const DAY_SECONDS = 24 * 3600;
const dayIndex = (w: RateWindow, now: number): number =>
  Math.min(6, Math.max(0, Math.floor((now - (w.resets_at - WINDOW_SECONDS.seven_day)) / DAY_SECONDS)));

const isCount = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);

export const readBaseline = (baselinePath: string): BaselineInput => {
  let raw: string;
  try {
    raw = fs.readFileSync(baselinePath, 'utf-8');
  } catch {
    return { baseline: null, reason: `no pace baseline at ${baselinePath}` };
  }
  let parsed: Partial<Baseline>;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return { baseline: null, reason: `pace baseline at ${baselinePath} is not valid JSON` };
  }
  const ok =
    isCount(parsed?.seven_day_resets_at) &&
    isCount(parsed?.day?.index) &&
    isCount(parsed?.day?.seven_day_used) &&
    isCount(parsed?.session?.resets_at) &&
    isCount(parsed?.session?.seven_day_used);
  if (!ok) return { baseline: null, reason: `pace baseline at ${baselinePath} is malformed` };
  return { baseline: parsed as Baseline, reason: null };
};

/** Restarts whichever compartment has rolled over (new day, new session, new weekly window) at the
 * current weekly usage; a still-current baseline is returned as is. */
export const rollBaseline = (limits: WeeklyLimits, stored: Baseline | null, now: number): Baseline => {
  const week = limits.seven_day;
  const sameWeek = stored !== null && stored.seven_day_resets_at === week.resets_at;
  const index = dayIndex(week, now);
  const day = sameWeek && stored.day.index === index ? stored.day : { index, seven_day_used: week.used_percentage };
  const five = limits.five_hour;
  const session =
    sameWeek && (!five || stored.session.resets_at === five.resets_at)
      ? stored.session
      : { resets_at: five?.resets_at ?? 0, seven_day_used: week.used_percentage };
  return { seven_day_resets_at: week.resets_at, day, session };
};

/** One reason per compartment whose spend since its baseline has reached its share of the weekly
 * allowance left when it began; a baseline that does not match the current windows checks nothing. */
export const compartmentBreaches = (limits: RateLimits, baseline: Baseline, now: number): string[] => {
  const week = limits.seven_day;
  if (!week || baseline.seven_day_resets_at !== week.resets_at) return [];
  const out: string[] = [];
  const dayShare = (100 - baseline.day.seven_day_used) / (7 - baseline.day.index);
  const daySpent = week.used_percentage - baseline.day.seven_day_used;
  if (baseline.day.index === dayIndex(week, now) && daySpent >= dayShare) {
    out.push(`day spent ${daySpent.toFixed(1)}% of its ${dayShare.toFixed(1)}% share`);
  }
  const five = limits.five_hour;
  if (five && baseline.session.resets_at === five.resets_at) {
    const sessions = (week.resets_at - (five.resets_at - WINDOW_SECONDS.five_hour)) / WINDOW_SECONDS.five_hour;
    const sessionShare = (100 - baseline.session.seven_day_used) / Math.max(1, sessions);
    const sessionSpent = week.used_percentage - baseline.session.seven_day_used;
    if (sessionSpent >= sessionShare) out.push(`session spent ${sessionSpent.toFixed(1)}% of its ${sessionShare.toFixed(1)}% share`);
  }
  return out;
};

export const resolvePaceGateThresholds =(config: Record<string, unknown>): PaceGateThresholds => {
  const policy = (config.resource_policy ?? {}) as Record<string, unknown>;
  const pace = (policy.pace ?? {}) as Record<string, unknown>;
  const thresholds = { ...DEFAULT_PACE_GATE };
  for (const [field, key] of Object.entries(CONFIG_KEYS) as [keyof PaceGateThresholds, string][]) {
    if (pace[key] === undefined) continue;
    if (typeof pace[key] !== 'number') throw new Error(`resource_policy.pace.${key} must be a number`);
    thresholds[field] = pace[key] as number;
  }
  return thresholds;
};

export const evaluatePaceGate = (
  limits: RateLimits | null,
  current: number,
  max: number,
  now: number,
  t: PaceGateThresholds,
  unavailableReason = 'rate limits unavailable — pace gate not applied',
  compartments?: BaselineInput,
): PaceGateVerdict => {
  if (limits === null) return { verdict: 'unavailable', concurrency: current, reasons: [unavailableReason] };
  const notes: string[] = [];
  const stop: string[] = [];
  const throttle: string[] = [];
  for (const name of Object.keys(WINDOW_SECONDS) as WindowName[]) {
    const w = limits[name];
    if (!w) {
      notes.push(`${name} absent`);
      continue;
    }
    if (w.used_percentage >= t.stopPct) stop.push(`${name} ${w.used_percentage}% >= ${t.stopPct}%`);
  }
  const weekly = limits.seven_day ? windowPace(limits.seven_day, WINDOW_SECONDS.seven_day, now) : null;
  if (weekly !== null && weekly > t.throttleRatio) throttle.push(`seven_day pace ${weekly.toFixed(2)} > ${t.throttleRatio}`);
  const fiveHour = limits.five_hour?.used_percentage;
  if (fiveHour !== undefined && fiveHour >= t.throttlePct) throttle.push(`five_hour ${fiveHour}% >= ${t.throttlePct}%`);
  if (compartments?.baseline) stop.push(...compartmentBreaches(limits, compartments.baseline, now));
  else if (compartments) notes.push(`compartments unavailable: ${compartments.reason ?? 'no baseline'}`);
  if (stop.length) return { verdict: 'STOP-NEW', concurrency: 0, reasons: [...stop, ...throttle, ...notes] };
  if (throttle.length) return { verdict: 'THROTTLE', concurrency: Math.min(1, current), reasons: [...throttle, ...notes] };
  if (weekly !== null && weekly < t.scaleUpRatio && (fiveHour ?? 0) < t.throttlePct) {
    return {
      verdict: 'SCALE-UP',
      concurrency: Math.min(current + 1, max),
      reasons: [`seven_day pace ${weekly.toFixed(2)} < ${t.scaleUpRatio}`, ...notes],
    };
  }
  return { verdict: 'HOLD', concurrency: current, reasons: notes };
};
