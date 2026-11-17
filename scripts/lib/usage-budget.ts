import { RATE_WINDOW_NAMES, type RateLimits } from './rate-limit-cache.ts';

// Usage-budget gate: owner-set two-tier thresholds per rate-limit window, and a worker count
// derived from the tokens left until the 5-hour window resets and, when `weekly.target_at_reset`
// is set, from the weekly headroom left to land on that target exactly at the weekly reset. A sibling of the pace gate
// (pace-gate.ts), which stays as is; both read the same `RateLimits` shape. Pure: no I/O, no
// clock reads. Anything unreadable is `unavailable`, which fails open with the caller's
// `parallel_max` and always carries a reason.

export const USAGE_WINDOWS = RATE_WINDOW_NAMES;
export type UsageWindow = (typeof USAGE_WINDOWS)[number];

export type UsageBudgetConfig = {
  enabled: boolean;
  /** Windows to gate on; null auto-detects them from the reading (usage-source.ts). */
  windows: UsageWindow[] | null;
  five_hour: { no_spawn_at: number; stop_workers_at: number };
  weekly: { no_new_starts_at: number; stop_campaign_at: number; target_at_reset: number | null };
  rates: {
    orchestrator_pct_per_hour: number;
    worker_pct_per_hour: number;
    orchestrator_weekly_pct_per_hour: number;
    worker_weekly_pct_per_hour: number;
  };
  max_workers: number;
  coordination: { role: 'manager' | 'peer' | 'solo'; manager_session: string | null; peer_floor: number };
};

export type UsageVerdictName = 'GO' | 'NO-SPAWN' | 'STOP-WORKERS' | 'NO-NEW-STARTS' | 'STOP-CAMPAIGN' | 'PACE-WAIT' | 'SKIP' | 'unavailable';

export type UsageVerdict = {
  verdict: UsageVerdictName;
  workers: number;
  reasons: string[];
  wake_at: number | null;
  hours_to_reset: number | null;
  /** Workers the weekly target leaves room for, before the max_workers/parallelMax clamp; null without a target. */
  weekly_fit: number | null;
};

/** Weekly %/h rates measured from probe samples; each one present wins over its configured rate. */
export type MeasuredWeeklyRates = { orchestrator_weekly_pct_per_hour?: number; worker_weekly_pct_per_hour?: number };

export type WeeklySample = { at: number; used_percentage: number };
export type WeeklyForecast = {
  pct_per_hour: number | null;
  reaches_at_pct: { no_new_starts_at: number | null; stop_campaign_at: number | null };
};

export const DEFAULT_USAGE_BUDGET: UsageBudgetConfig = {
  enabled: false,
  windows: null,
  five_hour: { no_spawn_at: 85, stop_workers_at: 90 },
  weekly: { no_new_starts_at: 78, stop_campaign_at: 80, target_at_reset: null },
  // Weekly rates are starting points for a plan where ~1.2M subagent tokens moved the weekly % by
  // under a point; probe calibration replaces them.
  rates: { orchestrator_pct_per_hour: 6, worker_pct_per_hour: 7, orchestrator_weekly_pct_per_hour: 0.1, worker_weekly_pct_per_hour: 0.15 },
  max_workers: 4,
  coordination: { role: 'solo', manager_session: null, peer_floor: 1 },
};

const ROLES = ['manager', 'peer', 'solo'];
// A window about to roll must not divide by ~0 hours.
const MIN_SECONDS_TO_RESET = 900;
const HOUR = 3600;

export const section = (block: Record<string, unknown>, key: string, prefix = 'usage_budget'): Record<string, unknown> => {
  const value = block[key];
  if (value === undefined) return {};
  if (typeof value !== 'object' || value === null || Array.isArray(value)) throw new Error(`${prefix}.${key} must be an object`);
  return value as Record<string, unknown>;
};

export const pick = <T>(src: Record<string, unknown>, key: string, path: string, fallback: T, ok: (v: unknown) => boolean, want: string): T => {
  const value = src[key];
  if (value === undefined) return fallback;
  if (!ok(value)) throw new Error(`${path} must be ${want}`);
  return value as T;
};

export const isPct = (v: unknown): boolean => typeof v === 'number' && Number.isFinite(v) && v > 0 && v <= 100;
export const isPositive = (v: unknown): boolean => typeof v === 'number' && Number.isFinite(v) && v > 0;

/** `usage_budget.windows`: absent or null auto-detects from the reading; a list keeps only those windows. */
export const resolveUsageWindows = (config: Record<string, unknown>): UsageWindow[] | null => {
  const block = config.usage_budget;
  const value = typeof block === 'object' && block !== null ? (block as Record<string, unknown>).windows : undefined;
  if (value === undefined || value === null) return null;
  const ok = Array.isArray(value) && value.length > 0 && value.every((w) => (USAGE_WINDOWS as readonly unknown[]).includes(w));
  if (!ok) throw new Error(`usage_budget.windows must be null or a non-empty list of ${USAGE_WINDOWS.join(', ')}`);
  return [...new Set(value as UsageWindow[])];
};

export const resolveUsageBudget = (config: Record<string, unknown>): UsageBudgetConfig => {
  const d = DEFAULT_USAGE_BUDGET;
  const raw = (config.usage_budget ?? {}) as unknown;
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) throw new Error('usage_budget must be an object');
  const block = raw as Record<string, unknown>;
  const five = section(block, 'five_hour');
  const weekly = section(block, 'weekly');
  const rates = section(block, 'rates');
  const coord = section(block, 'coordination');
  const P = 'usage_budget';
  // null is the same as absent: no weekly pacing.
  const target = pick<number | null>(weekly, 'target_at_reset', `${P}.weekly.target_at_reset`, d.weekly.target_at_reset, (v) => v === null || isPct(v), 'a number in (0, 100] or null');
  // With a target, unset weekly lines default to the target itself, so usage can land on it.
  const stopCampaignAt = pick(weekly, 'stop_campaign_at', `${P}.weekly.stop_campaign_at`, target ?? d.weekly.stop_campaign_at, isPct, 'a number in (0, 100]');
  const noNewDefault = target ?? d.weekly.no_new_starts_at;

  const resolved: UsageBudgetConfig = {
    enabled: pick(block, 'enabled', `${P}.enabled`, d.enabled, (v) => typeof v === 'boolean', 'a boolean'),
    windows: resolveUsageWindows(config),
    five_hour: {
      no_spawn_at: pick(five, 'no_spawn_at', `${P}.five_hour.no_spawn_at`, d.five_hour.no_spawn_at, isPct, 'a number in (0, 100]'),
      stop_workers_at: pick(five, 'stop_workers_at', `${P}.five_hour.stop_workers_at`, d.five_hour.stop_workers_at, isPct, 'a number in (0, 100]'),
    },
    weekly: {
      no_new_starts_at: pick(weekly, 'no_new_starts_at', `${P}.weekly.no_new_starts_at`, noNewDefault, isPct, 'a number in (0, 100]'),
      stop_campaign_at: stopCampaignAt,
      target_at_reset: target,
    },
    rates: {
      orchestrator_pct_per_hour: pick(rates, 'orchestrator_pct_per_hour', `${P}.rates.orchestrator_pct_per_hour`, d.rates.orchestrator_pct_per_hour, isPositive, 'a number > 0'),
      worker_pct_per_hour: pick(rates, 'worker_pct_per_hour', `${P}.rates.worker_pct_per_hour`, d.rates.worker_pct_per_hour, isPositive, 'a number > 0'),
      orchestrator_weekly_pct_per_hour: pick(rates, 'orchestrator_weekly_pct_per_hour', `${P}.rates.orchestrator_weekly_pct_per_hour`, d.rates.orchestrator_weekly_pct_per_hour, isPositive, 'a number > 0'),
      worker_weekly_pct_per_hour: pick(rates, 'worker_weekly_pct_per_hour', `${P}.rates.worker_weekly_pct_per_hour`, d.rates.worker_weekly_pct_per_hour, isPositive, 'a number > 0'),
    },
    max_workers: pick(block, 'max_workers', `${P}.max_workers`, d.max_workers, (v) => Number.isInteger(v) && (v as number) >= 1, 'an integer >= 1'),
    coordination: {
      role: pick(coord, 'role', `${P}.coordination.role`, d.coordination.role, (v) => typeof v === 'string' && ROLES.includes(v), 'one of manager, peer, solo'),
      manager_session: pick<string | null>(coord, 'manager_session', `${P}.coordination.manager_session`, d.coordination.manager_session, (v) => v === null || typeof v === 'string', 'a string or null'),
      peer_floor: pick(coord, 'peer_floor', `${P}.coordination.peer_floor`, d.coordination.peer_floor, (v) => Number.isInteger(v) && (v as number) >= 0, 'an integer >= 0'),
    },
  };

  if (resolved.five_hour.no_spawn_at >= resolved.five_hour.stop_workers_at) {
    throw new Error(`${P}.five_hour.no_spawn_at must be less than ${P}.five_hour.stop_workers_at`);
  }
  if (target === null) {
    if (resolved.weekly.no_new_starts_at >= resolved.weekly.stop_campaign_at) {
      throw new Error(`${P}.weekly.no_new_starts_at must be less than ${P}.weekly.stop_campaign_at`);
    }
  } else {
    // A weekly line below the target would stop the campaign before it lands; both may equal it.
    for (const key of ['stop_campaign_at', 'no_new_starts_at'] as const) {
      if (resolved.weekly[key] < target) throw new Error(`${P}.weekly.${key} must be >= ${P}.weekly.target_at_reset`);
    }
    if (resolved.weekly.no_new_starts_at > resolved.weekly.stop_campaign_at) {
      throw new Error(`${P}.weekly.no_new_starts_at must be at most ${P}.weekly.stop_campaign_at`);
    }
  }
  if (resolved.coordination.role === 'peer' && !resolved.coordination.manager_session) {
    throw new Error(`${P}.coordination.manager_session must be a non-empty string when role is peer`);
  }
  return resolved;
};

const unavailable = (parallelMax: number, reasons: string[]): UsageVerdict => ({
  verdict: 'unavailable',
  workers: parallelMax,
  reasons,
  wake_at: null,
  hours_to_reset: null,
  weekly_fit: null,
});

const hoursLeft = (resetsAt: number, now: number): number => Math.max(resetsAt - now, MIN_SECONDS_TO_RESET) / HOUR;
// Absorbs float error so a worker that fits exactly is counted.
const fitFloor = (x: number): number => Math.floor(x + 1e-9);

/** The weekly leg: workers that fit the headroom left to `target` spread over the hours to the
 * weekly reset, and, when none fits, the first second one worker fits again (usage held still while
 * the campaign waits), or the reset itself when that moment is inside the 15-minute floor. */
const weeklyLeg = (week: { used_percentage: number; resets_at: number }, now: number, target: number, orch: number, worker: number) => {
  const left = target - week.used_percentage;
  const fit = Math.max(0, fitFloor((left / hoursLeft(week.resets_at, now) - orch) / worker));
  const hoursForOne = left / (orch + worker);
  const wakeAt = hoursForOne < MIN_SECONDS_TO_RESET / HOUR ? week.resets_at : Math.ceil(week.resets_at - hoursForOne * HOUR);
  return { fit, wakeAt };
};

/** The verdict for the current usage. First match wins: weekly stop, 5-hour stop, weekly
 * no-new-starts (PACE-WAIT until the reset when a target is set), 5-hour no-spawn, else GO with a
 * worker count sized to the tokens left — the smaller of the 5-hour fit and the weekly fit, and
 * PACE-WAIT when the weekly fit is below one. Without a five_hour window (a weekly-only plan) the
 * weekly rules alone gate: the weekly fit sizes the round when a target is set, else the ceiling
 * does. With neither window usage is unavailable. `now` is epoch seconds;
 * `parallelMax` is the count returned when usage cannot be read and a ceiling on every count. */
export const workersAllowed = (
  usage: RateLimits | null,
  now: number,
  budget: UsageBudgetConfig,
  parallelMax: number,
  measured: MeasuredWeeklyRates = {},
): UsageVerdict => {
  if (usage === null) return unavailable(parallelMax, ['usage unavailable: usage-aware pacing not applied']);
  // A window past its reset already rolled and no longer applies.
  const five = usage.five_hour && usage.five_hour.resets_at > now ? usage.five_hour : undefined;
  const week = usage.seven_day && usage.seven_day.resets_at > now ? usage.seven_day : undefined;
  const target = budget.weekly.target_at_reset;
  const paced = week !== undefined && target !== null;
  if (!five && !week) return unavailable(parallelMax, ['usage unavailable: no current five_hour or seven_day window']);
  const reasons: string[] = [];
  // A measured rate that is not a finite number > 0 is ignored in favour of the configured one.
  const weeklyRate = (key: keyof MeasuredWeeklyRates): number => {
    const value = measured[key];
    if (value === undefined) return budget.rates[key];
    if (Number.isFinite(value) && value > 0) return value;
    reasons.push(`measured ${key} ${value} is not a number > 0: configured rate used`);
    return budget.rates[key];
  };

  const hoursToReset = five ? hoursLeft(five.resets_at, now) : hoursLeft((week as { resets_at: number }).resets_at, now);
  const leg = paced
    ? weeklyLeg(
        week,
        now,
        target,
        weeklyRate('orchestrator_weekly_pct_per_hour'),
        weeklyRate('worker_weekly_pct_per_hour'),
      )
    : null;
  const base = { hours_to_reset: hoursToReset, weekly_fit: leg ? leg.fit : null };
  if (!week) reasons.push('seven_day absent: weekly rules skipped');
  if (!five) {
    reasons.push(paced
      ? 'five_hour absent: 5-hour rules skipped, the weekly target sizes the round'
      : 'five_hour absent: 5-hour rules skipped, the weekly thresholds gate and max_workers caps the round');
  }
  const ceiling = Math.min(budget.max_workers, parallelMax);

  if (week && week.used_percentage >= budget.weekly.stop_campaign_at) {
    return { ...base, verdict: 'STOP-CAMPAIGN', workers: 0, wake_at: null, reasons: [`seven_day ${week.used_percentage}% >= ${budget.weekly.stop_campaign_at}%`, ...reasons] };
  }
  if (five && five.used_percentage >= budget.five_hour.stop_workers_at) {
    return { ...base, verdict: 'STOP-WORKERS', workers: 0, wake_at: five.resets_at, reasons: [`five_hour ${five.used_percentage}% >= ${budget.five_hour.stop_workers_at}%`, ...reasons] };
  }
  if (week && week.used_percentage >= budget.weekly.no_new_starts_at) {
    const reason = `seven_day ${week.used_percentage}% >= ${budget.weekly.no_new_starts_at}%`;
    if (paced) return { ...base, verdict: 'PACE-WAIT', workers: 0, wake_at: week.resets_at, reasons: [`${reason}: waiting for the weekly reset`, ...reasons] };
    return { ...base, verdict: 'NO-NEW-STARTS', workers: 0, wake_at: null, reasons: [reason, ...reasons] };
  }
  if (five && five.used_percentage >= budget.five_hour.no_spawn_at) {
    return { ...base, verdict: 'NO-SPAWN', workers: 0, wake_at: null, reasons: [`five_hour ${five.used_percentage}% >= ${budget.five_hour.no_spawn_at}%`, ...reasons] };
  }
  if (leg && leg.fit < 1) {
    return { ...base, verdict: 'PACE-WAIT', workers: 0, wake_at: leg.wakeAt, reasons: [`0 workers fit the weekly pace to ${target}% at reset`, ...reasons] };
  }

  let workers = ceiling;
  if (five) {
    const headroomPerHour = (budget.five_hour.stop_workers_at - five.used_percentage) / hoursToReset;
    const raw = Math.round((headroomPerHour - budget.rates.orchestrator_pct_per_hour) / budget.rates.worker_pct_per_hour);
    workers = Math.min(ceiling, Math.max(1, raw));
    reasons.unshift(`${raw} workers fit the five_hour headroom, clamped to ${workers}`);
  }
  if (leg) {
    workers = Math.min(workers, leg.fit);
    reasons.unshift(`${leg.fit} workers fit the weekly pace to ${target}% at reset`);
  }
  return { ...base, verdict: 'GO', workers, wake_at: null, reasons };
};

/** Least-squares slope (pct per second) through the samples and their means; null with fewer than two distinct times. */
const linearFit = (samples: WeeklySample[]): { slope: number; meanT: number; meanU: number } | null => {
  const n = samples.length;
  if (n < 2) return null;
  const meanT = samples.reduce((s, p) => s + p.at, 0) / n;
  const meanU = samples.reduce((s, p) => s + p.used_percentage, 0) / n;
  const denom = samples.reduce((s, p) => s + (p.at - meanT) ** 2, 0);
  if (denom === 0) return null;
  return { slope: samples.reduce((s, p) => s + (p.at - meanT) * (p.used_percentage - meanU), 0) / denom, meanT, meanU };
};

/** Linear fit of weekly usage over probe samples, and when each weekly threshold would be reached.
 * A threshold already crossed, a non-positive slope or fewer than two samples give null. */
export const forecastWeekly = (
  samples: WeeklySample[],
  now: number,
  weekly: UsageBudgetConfig['weekly'],
): WeeklyForecast => {
  const none: WeeklyForecast = { pct_per_hour: null, reaches_at_pct: { no_new_starts_at: null, stop_campaign_at: null } };
  const fit = linearFit(samples);
  if (!fit || !(fit.slope > 0)) return none;
  const { slope } = fit;
  const current = fit.meanU + slope * (now - fit.meanT);
  const reach = (threshold: number): number | null => (current >= threshold ? null : Math.round(now + (threshold - current) / slope));
  return {
    pct_per_hour: slope * HOUR,
    reaches_at_pct: { no_new_starts_at: reach(weekly.no_new_starts_at), stop_campaign_at: reach(weekly.stop_campaign_at) },
  };
};

/** One weekly reading as `.blackhole/usage-history.jsonl` keeps it (`usage-history.ts`); times in epoch seconds. */
export type WeeklyReading = { observed_at: number; used_percentage: number; resets_at: number };
export type PaceVerdictName = 'accelerate' | 'on track' | 'decelerate' | 'unknown';
export type WeeklyPace = {
  verdict: PaceVerdictName;
  recent_pct_per_hour: number | null;
  required_pct_per_hour: number | null;
  /** Used minus the straight line from this window's first reading to the target at the reset; positive is over. */
  points_vs_line: number | null;
  /** Why the verdict is `unknown`; null otherwise. */
  reason: string | null;
};
/** Hours of history the recent rate is measured over (issue #1261). */
export const PACE_RATE_WINDOW_HOURS = 3;
/** Recent rate within this fraction of the required rate is `on track`. */
const PACE_TOLERANCE = 0.15;
/** Readings whose reset is within this of the newest one belong to the same weekly window. */
const SAME_WINDOW_SECONDS = HOUR;

/**
 * Whether the run spends too fast or too slow to land on `target` at the weekly reset: the slope
 * over the readings of the last `windowHours` (the two newest when fewer) against the rate the
 * headroom needs. Visibility only; nothing throttles on it.
 */
export const weeklyPace = (readings: WeeklyReading[], now: number, target: number | null, windowHours = PACE_RATE_WINDOW_HOURS): WeeklyPace => {
  const unknown = (reason: string): WeeklyPace => ({ verdict: 'unknown', recent_pct_per_hour: null, required_pct_per_hour: null, points_vs_line: null, reason });
  if (target === null) return unknown('no weekly target_at_reset');
  const sorted = [...readings].sort((a, b) => a.observed_at - b.observed_at);
  const newest = sorted.at(-1);
  const inWindow = newest ? sorted.filter((r) => Math.abs(r.resets_at - newest.resets_at) < SAME_WINDOW_SECONDS) : [];
  if (!newest || inWindow.length < 2) return unknown('fewer than 2 weekly readings in this window');
  if (now >= newest.resets_at) return unknown('the weekly window has reset');
  const recentSet = inWindow.filter((r) => r.observed_at >= newest.observed_at - windowHours * HOUR);
  const fit = linearFit((recentSet.length >= 2 ? recentSet : inWindow.slice(-2)).map((r) => ({ at: r.observed_at, used_percentage: r.used_percentage })));
  if (!fit) return unknown('the readings share one time');
  const recent = Math.max(0, fit.slope * HOUR);
  const required = Math.max(0, (target - newest.used_percentage) / ((newest.resets_at - now) / HOUR));
  const first = inWindow[0];
  const line = first.used_percentage + ((target - first.used_percentage) * (newest.observed_at - first.observed_at)) / (newest.resets_at - first.observed_at);
  const verdict: PaceVerdictName = recent < (1 - PACE_TOLERANCE) * required ? 'accelerate' : recent > (1 + PACE_TOLERANCE) * required ? 'decelerate' : 'on track';
  return { verdict, recent_pct_per_hour: recent, required_pct_per_hour: required, points_vs_line: newest.used_percentage - line, reason: null };
};
