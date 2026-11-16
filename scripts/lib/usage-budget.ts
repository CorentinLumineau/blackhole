import type { RateLimits } from './pace-gate.ts';

// Usage-budget gate: owner-set two-tier thresholds per rate-limit window, and a worker count
// derived from the tokens left until the 5-hour window resets. A sibling of the pace gate
// (pace-gate.ts), which stays as is; both read the same `RateLimits` shape. Pure: no I/O, no
// clock reads. Anything unreadable is `unavailable`, which fails open with the caller's
// `parallel_max` and always carries a reason.

export type UsageBudgetConfig = {
  enabled: boolean;
  five_hour: { no_spawn_at: number; stop_workers_at: number };
  weekly: { no_new_starts_at: number; stop_campaign_at: number };
  rates: { orchestrator_pct_per_hour: number; worker_pct_per_hour: number };
  max_workers: number;
  coordination: { role: 'manager' | 'peer' | 'solo'; manager_session: string | null; peer_floor: number };
};

export type UsageVerdictName = 'GO' | 'NO-SPAWN' | 'STOP-WORKERS' | 'NO-NEW-STARTS' | 'STOP-CAMPAIGN' | 'unavailable';

export type UsageVerdict = {
  verdict: UsageVerdictName;
  workers: number;
  reasons: string[];
  wake_at: number | null;
  hours_to_reset: number | null;
};

export type WeeklySample = { at: number; used_percentage: number };
export type WeeklyForecast = {
  pct_per_hour: number | null;
  reaches_at_pct: { no_new_starts_at: number | null; stop_campaign_at: number | null };
};

export const DEFAULT_USAGE_BUDGET: UsageBudgetConfig = {
  enabled: false,
  five_hour: { no_spawn_at: 85, stop_workers_at: 90 },
  weekly: { no_new_starts_at: 78, stop_campaign_at: 80 },
  rates: { orchestrator_pct_per_hour: 6, worker_pct_per_hour: 7 },
  max_workers: 4,
  coordination: { role: 'solo', manager_session: null, peer_floor: 1 },
};

const ROLES = ['manager', 'peer', 'solo'];
// A window about to roll must not divide by ~0 hours.
const MIN_SECONDS_TO_RESET = 900;
const HOUR = 3600;

const section = (block: Record<string, unknown>, key: string): Record<string, unknown> => {
  const value = block[key];
  if (value === undefined) return {};
  if (typeof value !== 'object' || value === null || Array.isArray(value)) throw new Error(`usage_budget.${key} must be an object`);
  return value as Record<string, unknown>;
};

const pick = <T>(src: Record<string, unknown>, key: string, path: string, fallback: T, ok: (v: unknown) => boolean, want: string): T => {
  const value = src[key];
  if (value === undefined) return fallback;
  if (!ok(value)) throw new Error(`${path} must be ${want}`);
  return value as T;
};

const isPct = (v: unknown): boolean => typeof v === 'number' && Number.isFinite(v) && v > 0 && v <= 100;
const isPositive = (v: unknown): boolean => typeof v === 'number' && Number.isFinite(v) && v > 0;

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

  const resolved: UsageBudgetConfig = {
    enabled: pick(block, 'enabled', `${P}.enabled`, d.enabled, (v) => typeof v === 'boolean', 'a boolean'),
    five_hour: {
      no_spawn_at: pick(five, 'no_spawn_at', `${P}.five_hour.no_spawn_at`, d.five_hour.no_spawn_at, isPct, 'a number in (0, 100]'),
      stop_workers_at: pick(five, 'stop_workers_at', `${P}.five_hour.stop_workers_at`, d.five_hour.stop_workers_at, isPct, 'a number in (0, 100]'),
    },
    weekly: {
      no_new_starts_at: pick(weekly, 'no_new_starts_at', `${P}.weekly.no_new_starts_at`, d.weekly.no_new_starts_at, isPct, 'a number in (0, 100]'),
      stop_campaign_at: pick(weekly, 'stop_campaign_at', `${P}.weekly.stop_campaign_at`, d.weekly.stop_campaign_at, isPct, 'a number in (0, 100]'),
    },
    rates: {
      orchestrator_pct_per_hour: pick(rates, 'orchestrator_pct_per_hour', `${P}.rates.orchestrator_pct_per_hour`, d.rates.orchestrator_pct_per_hour, isPositive, 'a number > 0'),
      worker_pct_per_hour: pick(rates, 'worker_pct_per_hour', `${P}.rates.worker_pct_per_hour`, d.rates.worker_pct_per_hour, isPositive, 'a number > 0'),
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
  if (resolved.weekly.no_new_starts_at >= resolved.weekly.stop_campaign_at) {
    throw new Error(`${P}.weekly.no_new_starts_at must be less than ${P}.weekly.stop_campaign_at`);
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
});

/** The verdict for the current usage. First match wins: weekly stop, 5-hour stop, weekly
 * no-new-starts, 5-hour no-spawn, else GO with a worker count sized to the tokens left. `now` is
 * epoch seconds; `parallelMax` is the count returned when usage cannot be read. */
export const workersAllowed = (usage: RateLimits | null, now: number, budget: UsageBudgetConfig, parallelMax: number): UsageVerdict => {
  if (usage === null) return unavailable(parallelMax, ['usage unavailable: usage-aware pacing not applied']);
  // A window past its reset already rolled and no longer applies.
  const five = usage.five_hour && usage.five_hour.resets_at > now ? usage.five_hour : undefined;
  const week = usage.seven_day && usage.seven_day.resets_at > now ? usage.seven_day : undefined;
  if (!five) return unavailable(parallelMax, ['usage unavailable: no current five_hour window']);

  const hoursToReset = Math.max(five.resets_at - now, MIN_SECONDS_TO_RESET) / HOUR;
  const base = { hours_to_reset: hoursToReset };
  const reasons: string[] = [];
  if (!week) reasons.push('seven_day absent: weekly rules skipped');

  if (week && week.used_percentage >= budget.weekly.stop_campaign_at) {
    return { ...base, verdict: 'STOP-CAMPAIGN', workers: 0, wake_at: null, reasons: [`seven_day ${week.used_percentage}% >= ${budget.weekly.stop_campaign_at}%`, ...reasons] };
  }
  if (five.used_percentage >= budget.five_hour.stop_workers_at) {
    return { ...base, verdict: 'STOP-WORKERS', workers: 0, wake_at: five.resets_at, reasons: [`five_hour ${five.used_percentage}% >= ${budget.five_hour.stop_workers_at}%`, ...reasons] };
  }
  if (week && week.used_percentage >= budget.weekly.no_new_starts_at) {
    return { ...base, verdict: 'NO-NEW-STARTS', workers: 0, wake_at: null, reasons: [`seven_day ${week.used_percentage}% >= ${budget.weekly.no_new_starts_at}%`, ...reasons] };
  }
  if (five.used_percentage >= budget.five_hour.no_spawn_at) {
    return { ...base, verdict: 'NO-SPAWN', workers: 0, wake_at: null, reasons: [`five_hour ${five.used_percentage}% >= ${budget.five_hour.no_spawn_at}%`, ...reasons] };
  }

  const headroomPerHour = (budget.five_hour.stop_workers_at - five.used_percentage) / hoursToReset;
  const raw = Math.round((headroomPerHour - budget.rates.orchestrator_pct_per_hour) / budget.rates.worker_pct_per_hour);
  const workers = Math.min(budget.max_workers, Math.max(1, raw));
  return { ...base, verdict: 'GO', workers, wake_at: null, reasons: [`${raw} workers fit the five_hour headroom, clamped to ${workers}`, ...reasons] };
};

/** Linear fit of weekly usage over probe samples, and when each weekly threshold would be reached.
 * A threshold already crossed, a non-positive slope or fewer than two samples give null. */
export const forecastWeekly = (
  samples: WeeklySample[],
  now: number,
  weekly: UsageBudgetConfig['weekly'],
): WeeklyForecast => {
  const none: WeeklyForecast = { pct_per_hour: null, reaches_at_pct: { no_new_starts_at: null, stop_campaign_at: null } };
  if (samples.length < 2) return none;
  const n = samples.length;
  const meanT = samples.reduce((s, p) => s + p.at, 0) / n;
  const meanU = samples.reduce((s, p) => s + p.used_percentage, 0) / n;
  const denom = samples.reduce((s, p) => s + (p.at - meanT) ** 2, 0);
  if (denom === 0) return none;
  const slope = samples.reduce((s, p) => s + (p.at - meanT) * (p.used_percentage - meanU), 0) / denom; // pct per second
  if (!(slope > 0)) return none;
  const current = meanU + slope * (now - meanT);
  const reach = (threshold: number): number | null => (current >= threshold ? null : Math.round(now + (threshold - current) / slope));
  return {
    pct_per_hour: slope * HOUR,
    reaches_at_pct: { no_new_starts_at: reach(weekly.no_new_starts_at), stop_campaign_at: reach(weekly.stop_campaign_at) },
  };
};
