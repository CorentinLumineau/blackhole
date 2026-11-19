import type { UsageReport } from './usage-source.ts';
import { DEFAULT_WEEKLY_TARGET_PCT, computePaceFloor } from './pace-floor.ts';
import { DEFAULT_CLAIM_LEASE_HOURS, LANE_NAME } from './lane.ts';
import type { RateLimits } from './rate-limit-cache.ts';
import { isPct, isPositive, pick, section, workersAllowed, type MeasuredWeeklyRates, type UsageBudgetConfig, type UsageVerdict } from './usage-budget.ts';

// Catchup mode (ADR-054 C2, C3): the pacing preset, its invocation-only overrides, and the floor
// gate. The floor replaces the weekly lines for one invocation; unreadable usage fails closed with
// `SKIP`. Pure: every instant is passed in.

export type CatchupConfig = {
  weekly_target_pct: number;
  five_hour: { no_spawn_at: number; stop_workers_at: number };
  lane: string | null;
  claim_lease_hours: number;
};

export const DEFAULT_CATCHUP: CatchupConfig = {
  weekly_target_pct: DEFAULT_WEEKLY_TARGET_PCT,
  five_hour: { no_spawn_at: 75, stop_workers_at: 80 },
  lane: null,
  claim_lease_hours: DEFAULT_CLAIM_LEASE_HOURS,
};

const P = 'catchup';

/** Keys the pace floor no longer reads: a config still carrying one fails loudly instead of being ignored. */
export const REMOVED_CATCHUP_KEYS: Readonly<Record<string, string>> = {
  pct_per_weekday: `${P}.pct_per_weekday was removed (ADR-054 amendment): the pace floor is now linear over all 168 h of the week. Delete it and set ${P}.weekly_target_pct instead (a number in (0, 100], default 80; the old 17.5 x 5 weekdays equals 87.5).`,
  day_end_hour: `${P}.day_end_hour was removed (ADR-054 amendment): the pace floor no longer follows working days. Delete it from config.json.`,
};

const validate = (c: CatchupConfig, keyPath: { no_spawn: string; stop_workers: string }): CatchupConfig => {
  if (c.five_hour.no_spawn_at >= c.five_hour.stop_workers_at) {
    throw new Error(`${keyPath.no_spawn} must be less than ${keyPath.stop_workers}`);
  }
  return c;
};

export const resolveCatchup = (config: Record<string, unknown>): CatchupConfig => {
  const d = DEFAULT_CATCHUP;
  const raw = (config.catchup ?? {}) as unknown;
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) throw new Error(`${P} must be an object`);
  const block = raw as Record<string, unknown>;
  for (const [key, message] of Object.entries(REMOVED_CATCHUP_KEYS)) if (key in block) throw new Error(message);
  const five = section(block, 'five_hour', P);
  const resolved: CatchupConfig = {
    weekly_target_pct: pick(block, 'weekly_target_pct', `${P}.weekly_target_pct`, d.weekly_target_pct, isPct, 'a number in (0, 100]'),
    five_hour: {
      no_spawn_at: pick(five, 'no_spawn_at', `${P}.five_hour.no_spawn_at`, d.five_hour.no_spawn_at, isPct, 'a number in (0, 100]'),
      stop_workers_at: pick(five, 'stop_workers_at', `${P}.five_hour.stop_workers_at`, d.five_hour.stop_workers_at, isPct, 'a number in (0, 100]'),
    },
    lane: pick<string | null>(block, 'lane', `${P}.lane`, d.lane, (v) => v === null || (typeof v === 'string' && LANE_NAME.test(v)), 'null or a name matching [a-z0-9][a-z0-9._-]*'),
    claim_lease_hours: pick(block, 'claim_lease_hours', `${P}.claim_lease_hours`, d.claim_lease_hours, isPositive, 'a number > 0'),
  };
  return validate(resolved, { no_spawn: `${P}.five_hour.no_spawn_at`, stop_workers: `${P}.five_hour.stop_workers_at` });
};

export type CatchupOverrides = { floor_pct?: number; no_spawn_at?: number; stop_workers_at?: number; lane?: string | null };

/** Invocation-only merge of the owner's adjustments into the preset; the input is never mutated.
 * `floor_pct` is not a preset key: callers read it from the overrides themselves. */
export const applyOverrides = (preset: CatchupConfig, overrides: CatchupOverrides): CatchupConfig => {
  const ok = (key: string, value: unknown, check: (v: unknown) => boolean, want: string): void => {
    if (!check(value)) throw new Error(`${key} must be ${want}`);
  };
  if (overrides.floor_pct !== undefined) ok('--floor', overrides.floor_pct, isPct, 'a number in (0, 100]');
  if (overrides.no_spawn_at !== undefined) ok('--no-spawn-at', overrides.no_spawn_at, isPct, 'a number in (0, 100]');
  if (overrides.stop_workers_at !== undefined) ok('--stop-workers-at', overrides.stop_workers_at, isPct, 'a number in (0, 100]');
  if (overrides.lane !== undefined) ok('--lane', overrides.lane, (v) => v === null || (typeof v === 'string' && LANE_NAME.test(v)), 'null or a name matching [a-z0-9][a-z0-9._-]*');
  return validate(
    {
      ...preset,
      five_hour: {
        no_spawn_at: overrides.no_spawn_at ?? preset.five_hour.no_spawn_at,
        stop_workers_at: overrides.stop_workers_at ?? preset.five_hour.stop_workers_at,
      },
      lane: overrides.lane === undefined ? preset.lane : overrides.lane,
    },
    { no_spawn: '--no-spawn-at', stop_workers: '--stop-workers-at' },
  );
};

/** The budget the catchup gates on: forced on, both weekly lines at the floor, no weekly target
 * (a target would rank above the floor), the 5-hour caps from the preset. */
export const floorBudget = (budget: UsageBudgetConfig, preset: CatchupConfig, floor: number): UsageBudgetConfig => ({
  ...budget,
  enabled: true,
  five_hour: { ...preset.five_hour },
  weekly: { no_new_starts_at: floor, stop_campaign_at: floor, target_at_reset: null },
});

const skip = (reason: string): UsageVerdict => ({
  verdict: 'SKIP',
  workers: 0,
  reasons: [reason],
  wake_at: null,
  hours_to_reset: null,
  weekly_fit: null,
});

/** Fail-closed floor gate: `SKIP` unless the reading carries a current weekly window. */
export const workersAtFloor = (
  limits: RateLimits | null,
  now: number,
  budget: UsageBudgetConfig,
  parallelMax: number,
  floor: number,
  preset: CatchupConfig,
  measured: MeasuredWeeklyRates = {},
  unreadableReason: string | null = null,
): UsageVerdict => {
  if (limits === null) return skip(`usage unreadable: catchup skips (fail-closed)${unreadableReason ? `: ${unreadableReason}` : ''}`);
  if (!limits.seven_day || limits.seven_day.resets_at <= now) {
    return skip('no current seven_day window: catchup skips (fail-closed)');
  }
  return workersAllowed(limits, now, floorBudget(budget, preset, floor), parallelMax, measured);
};

export type PacingStatus = 'ok' | 'unreadable' | 'no-weekly';
export type Pacing = {
  status: PacingStatus;
  plan: UsageReport['plan'];
  used_pct: number | null;
  resets_at: number | null;
  five_hour_pct: number | null;
  floor_pct: number | null;
  elapsed_h: number | null;
  target_pct: number | null;
  shortfall_pct: number | null;
  reason: string | null;
};

/** The pace reading for the launch summary and `pace-floor.ts`: where the week stands against the floor. */
export const readPacing = (report: UsageReport, preset: CatchupConfig, now: number): Pacing => {
  const week = report.windows.find((w) => w.name === 'seven_day' && w.resets_at > now);
  const five = report.windows.find((w) => w.name === 'five_hour' && w.resets_at > now);
  const base = { plan: report.plan, used_pct: week?.used_pct ?? null, resets_at: week?.resets_at ?? null, five_hour_pct: five?.used_pct ?? null };
  const none = { floor_pct: null, elapsed_h: null, target_pct: null, shortfall_pct: null };
  if (report.source === 'none') return { ...base, ...none, status: 'unreadable', reason: report.reason ?? 'usage unreadable' };
  if (!week) {
    const reason = report.plan === 'none' || report.windows.length === 0 ? 'no plan limits' : 'no current seven_day window';
    return { ...base, ...none, status: 'no-weekly', reason };
  }
  const floor = computePaceFloor({
    now,
    resetsAt: week.resets_at,
    usedPct: week.used_pct,
    weeklyTargetPct: preset.weekly_target_pct,
  });
  return { ...base, status: 'ok', floor_pct: floor.floor_pct, elapsed_h: floor.elapsed_h, target_pct: floor.target_pct, shortfall_pct: floor.shortfall_pct, reason: null };
};

/** `pacing` against an owner-adjusted floor: the shortfall follows the floor; other fields are kept. */
export const adjustPacing = (pacing: Pacing, floor: number | null): Pacing => {
  if (pacing.status !== 'ok' || floor === null || pacing.used_pct === null) return pacing;
  return { ...pacing, floor_pct: floor, shortfall_pct: Math.max(0, Math.round((floor - pacing.used_pct) * 100) / 100) };
};
