import * as fs from 'fs';
import { readRateLimits, type RateLimits } from '../rate-limit-cache.ts';
import { resolvePaceGateThresholds } from '../pace-gate.ts';
import type { Host } from '../run-context.ts';
import { forecastWeekly, resolveUsageBudget, resolveUsageWindows, weeklyPace, workersAllowed, USAGE_WINDOWS, type UsageBudgetConfig, type UsageVerdict, type WeeklyPace, type WeeklyReading } from '../usage-budget.ts';
import { readUsageHistory } from '../usage-history.ts';
import { foreignCacheReason, restrictWindows, usageSourceFor, type UsageSourceName } from '../usage-source.ts';
import type { BudgetPanel } from './types.ts';

// The status page's usage-budget panel: the rate-limit reading pace-gate.ts and usage-budget.ts
// read (one cache file, through the host's usage source), the verdict workersAllowed() gives for it,
// and when the weekly thresholds would be reached. A plan with no five_hour window shows the weekly rows only.

const HOUR = 3600;
const WEEK = 7 * 24 * HOUR;
/** `parallel_max` when `config.json` has none (`config-template.md`). */
export const DEFAULT_PARALLEL_MAX = 4;

/** `config.parallel_max`, else `DEFAULT_PARALLEL_MAX`. */
export const parallelMaxOf = (config: Record<string, unknown>): number =>
  typeof config.parallel_max === 'number' ? config.parallel_max : DEFAULT_PARALLEL_MAX;

/** The resolved `usage_budget`, or null with the error when it is invalid: callers show `unavailable`, never throw. */
export function resolveBudgetSettings(config: Record<string, unknown>): { budget: UsageBudgetConfig; invalid: null } | { budget: null; invalid: string } {
  try {
    return { budget: resolveUsageBudget(config), invalid: null };
  } catch (error) {
    return { budget: null, invalid: error instanceof Error ? error.message : String(error) };
  }
}

const iso = (epoch: number): string => new Date(epoch * 1000).toISOString();

export const NOT_PROBED: BudgetPanel = {
  probed: false,
  reason: 'no usage reading',
  age_seconds: null,
  five_hour_pct: null,
  five_hour_resets_at: null,
  weekly_pct: null,
  resets_at: null,
  workers_allowed: null,
  verdict: null,
  verdict_reasons: [],
  forecast: null,
  source: null,
  windows: [],
  target_at_reset: null,
  stale: null,
  pace: { verdict: 'unknown', recent_pct_per_hour: null, required_pct_per_hour: null, points_vs_line: null, reason: 'no usage reading' },
};

const targetOf = (config: Record<string, unknown>): number | null => resolveBudgetSettings(config).budget?.weekly.target_at_reset ?? null;

/** The verdict the usage-budget CLI returns for this reading: `unavailable` when the budget is off or its config is invalid. */
function verdictFor(limits: RateLimits, now: number, config: Record<string, unknown>, override?: UsageBudgetConfig): { verdict: UsageVerdict; budget: UsageBudgetConfig | null } {
  const parallelMax = parallelMaxOf(config);
  const off = (reason: string): UsageVerdict => ({ verdict: 'unavailable', workers: parallelMax, reasons: [reason], wake_at: null, hours_to_reset: null, weekly_fit: null });
  // A catchup passes its floor budget (catchup.ts floorBudget): already resolved, always enabled.
  const settings = override ? { budget: override, invalid: null } : resolveBudgetSettings(config);
  if (settings.invalid !== null) return { verdict: off(`usage_budget config invalid: ${settings.invalid}`), budget: null };
  const { budget } = settings;
  return { verdict: budget.enabled ? workersAllowed(limits, now, budget, parallelMax) : off('usage_budget disabled'), budget };
}

/** The last weekly reading of a stale cache, with where the target line (0% at the window start, `target` at the reset) stands at `now`. */
function staleOf(stale: { limits: RateLimits; ageSeconds: number } | null, now: number, target: number | null): BudgetPanel['stale'] {
  const week = stale?.limits.seven_day;
  if (!stale || !week || week.resets_at <= now) return null;
  const elapsed = Math.min(1, Math.max(0, (now - (week.resets_at - WEEK)) / WEEK));
  return {
    weekly_pct: week.used_percentage,
    read_at: iso(now - stale.ageSeconds),
    age_seconds: stale.ageSeconds,
    target_line_pct: target === null ? null : Math.round(target * elapsed * 10) / 10,
  };
}

/** The pace over the history plus the reading on hand (current or stale), which replaces a history line with its own time. */
function paceOf(history: WeeklyReading[], limits: RateLimits | null, ageSeconds: number | null, now: number, target: number | null): WeeklyPace {
  const week = limits?.seven_day;
  const own = week ? [{ observed_at: now - (ageSeconds ?? 0), used_percentage: week.used_percentage, resets_at: week.resets_at }] : [];
  const readings = [...history.filter((r) => !own.some((o) => o.observed_at === r.observed_at)), ...own];
  return readings.length ? weeklyPace(readings, now, target) : NOT_PROBED.pace;
}

/** The panel for one reading; `limits` null ⇒ not probed, with `reason`. `now` is epoch seconds. */
export function buildBudgetPanel(input: {
  limits: RateLimits | null;
  reason: string | null;
  ageSeconds: number | null;
  now: number;
  config: Record<string, unknown>;
  source?: UsageSourceName;
  /** The resolved budget to judge by instead of `config.usage_budget` (the catchup's floor budget). */
  budget?: UsageBudgetConfig;
  /** The reading of a cache past its max age, kept for display only. */
  stale?: { limits: RateLimits; ageSeconds: number } | null;
  /** Earlier weekly readings (`usage-history.jsonl`), for the pace row. */
  history?: WeeklyReading[];
}): BudgetPanel {
  const { limits, now, config } = input;
  const history = input.history ?? [];
  if (!limits) {
    const target = targetOf(config);
    const stale = input.stale ?? null;
    return {
      ...NOT_PROBED,
      reason: input.reason ?? NOT_PROBED.reason,
      target_at_reset: target,
      stale: staleOf(stale, now, target),
      pace: paceOf(history, stale?.limits ?? null, stale?.ageSeconds ?? null, now, target),
    };
  }
  const { verdict, budget } = verdictFor(limits, now, config, input.budget);
  const five = limits.five_hour && limits.five_hour.resets_at > now ? limits.five_hour : undefined;
  const week = limits.seven_day && limits.seven_day.resets_at > now ? limits.seven_day : undefined;
  let forecast: BudgetPanel['forecast'] = null;
  if (week) {
    // The window opened at 0%, so the window start and the reading give the pace so far.
    const weekly = (budget ?? resolveUsageBudget({})).weekly;
    const f = forecastWeekly([{ at: week.resets_at - WEEK, used_percentage: 0 }, { at: now, used_percentage: week.used_percentage }], now, weekly);
    const reaches: Array<{ pct: number; at: string | null }> = [];
    for (const key of ['no_new_starts_at', 'stop_campaign_at'] as const) {
      const at = f.reaches_at_pct[key];
      if (!reaches.some((r) => r.pct === weekly[key])) reaches.push({ pct: weekly[key], at: at !== null && at < week.resets_at ? iso(at) : null });
    }
    forecast = { pct_per_hour: f.pct_per_hour, reaches };
  }
  return {
    probed: true,
    reason: null,
    age_seconds: input.ageSeconds,
    five_hour_pct: five ? five.used_percentage : null,
    five_hour_resets_at: five ? iso(five.resets_at) : null,
    weekly_pct: week ? week.used_percentage : null,
    resets_at: week ? iso(week.resets_at) : null,
    workers_allowed: verdict.workers,
    verdict: verdict.verdict,
    verdict_reasons: verdict.reasons,
    forecast,
    source: input.source ?? 'rate-limit-cache',
    windows: USAGE_WINDOWS.filter((name) => (name === 'five_hour' ? five : week) !== undefined),
    target_at_reset: budget?.weekly.target_at_reset ?? null,
    stale: null,
    pace: paceOf(history, limits, input.ageSeconds, now, budget?.weekly.target_at_reset ?? null),
  };
}

/** Reads `host`'s usage source (`usage-source.ts`): the rate-limit cache the config names on Claude, none elsewhere; `historyPath` is the campaign's `usage-history.jsonl`, `budget` the catchup's floor budget. */
export function readBudgetPanel(config: Record<string, unknown>, host: Host, now: number = Math.floor(Date.now() / 1000), historyPath: string | null = null, budget?: UsageBudgetConfig): BudgetPanel {
  let reading;
  let cachePath: string | null = null;
  try {
    const source = usageSourceFor(host, config, { historyPath });
    reading = source.read(now);
    cachePath = source.cachePath;
  } catch (error) {
    return { ...NOT_PROBED, reason: `usage source config invalid: ${error instanceof Error ? error.message : String(error)}` };
  }
  let ageSeconds: number | null = null;
  try {
    if (cachePath) ageSeconds = Math.max(0, Math.round(now - fs.statSync(cachePath).mtimeMs / 1000));
  } catch {
    // No cache: the source already gave the reason.
  }
  // Past max age the gate treats the cache as not probed; the page still shows its last reading, unrestricted by age.
  let stale: { limits: RateLimits; ageSeconds: number } | null = null;
  if (!reading.limits && cachePath && ageSeconds !== null && ageSeconds > resolvePaceGateThresholds(config).maxAgeSeconds) {
    const last = readRateLimits(cachePath, now, Number.POSITIVE_INFINITY).limits;
    // Another account's last reading is not this campaign's, stale or not.
    const ours = last && !foreignCacheReason(last, historyPath, now) ? last : null;
    const kept = ours ? restrictWindows(ours, resolveUsageWindows(config)).limits : null;
    if (kept) stale = { limits: kept, ageSeconds };
  }
  const history = historyPath ? readUsageHistory(historyPath) : [];
  return buildBudgetPanel({ limits: reading.limits, reason: reading.reason, ageSeconds, now, config, source: reading.source, budget, stale, history });
}

/** The panel for a reading the harness reported (`--usage`), restricted to `usage_budget.windows` as the usage source and usage-budget.ts restrict it. */
export function givenBudgetPanel(usage: RateLimits, config: Record<string, unknown>, now: number, budget?: UsageBudgetConfig): BudgetPanel {
  const settings = resolveBudgetSettings(config);
  // An invalid config is shown by the panel's own `unavailable` verdict; the reading is kept whole.
  const kept = settings.invalid === null ? restrictWindows(usage, settings.budget.windows).limits : usage;
  const reason = kept ? null : 'usage_budget.windows leaves none of the --usage windows';
  return buildBudgetPanel({ limits: kept, reason, ageSeconds: 0, now, config, budget });
}

const WINDOW_LABELS = { five_hour: '5-hour', seven_day: 'weekly' } as const;
const DAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const pad = (n: number): string => String(n).padStart(2, '0');
/** `Mon 18 Jan 20:00 UTC`: the same on every host, whatever its time zone. */
export const when = (isoTime: string): string => {
  const d = new Date(isoTime);
  return `${DAYS[d.getUTCDay()]} ${pad(d.getUTCDate())} ${MONTHS[d.getUTCMonth()]} ${pad(d.getUTCHours())}:${pad(d.getUTCMinutes())} UTC`;
};
/** `4h 15m old`: a stale reading is hours old, so minutes still count. */
const staleAge = (seconds: number): string => {
  const minutes = Math.round(seconds / 60);
  const h = Math.floor(minutes / 60);
  return `${h ? `${h}h ` : ''}${minutes % 60}m old`;
};
const age = (seconds: number): string => (seconds < 60 ? `${seconds}s old` : seconds < 2 * HOUR ? `${Math.round(seconds / 60)} min old` : `${Math.round(seconds / HOUR)} h old`);

/** `DECELERATE — 3.5%/h now vs 0.6%/h needed; 12 points over the line`, or `unknown — <reason>`. */
export function paceValue(p: WeeklyPace): string {
  if (p.verdict === 'unknown' || p.recent_pct_per_hour === null || p.required_pct_per_hour === null || p.points_vs_line === null) return `unknown — ${p.reason ?? 'no usage reading'}`;
  const points = Math.round(p.points_vs_line);
  const n = Math.abs(points);
  const line = points === 0 ? 'on the line' : `${n} point${n === 1 ? '' : 's'} ${points > 0 ? 'over' : 'under'} the line`;
  return `${p.verdict.toUpperCase()} — ${p.recent_pct_per_hour.toFixed(1)}%/h now vs ${p.required_pct_per_hour.toFixed(1)}%/h needed; ${line}`;
}

/** The panel as key/value rows: the text dashboard, `--html` and the `budget` dataset all print these. */
export function budgetRows(b: BudgetPanel): Array<{ key: string; value: string }> {
  const target = [
    ...(b.target_at_reset === null ? [] : [{ key: 'Weekly target', value: `${b.target_at_reset}% at the weekly reset` }]),
    { key: 'Pace', value: paceValue(b.pace) },
  ];
  if (!b.probed && b.stale) {
    const s = b.stale;
    const line = s.target_line_pct === null ? '' : `; target line ${s.target_line_pct}% now`;
    return [{ key: 'Usage', value: `weekly ${s.weekly_pct}% at ${when(s.read_at)}, ${staleAge(s.age_seconds)} (stale)${line}` }, ...target];
  }
  if (!b.probed) return [{ key: 'Usage', value: `usage not probed — ${b.reason ?? NOT_PROBED.reason}` }, ...target];
  const rows: Array<{ key: string; value: string }> = [];
  if (b.five_hour_pct !== null && b.five_hour_resets_at) rows.push({ key: '5-hour', value: `${b.five_hour_pct}% · resets ${when(b.five_hour_resets_at)}` });
  if (b.weekly_pct !== null && b.resets_at) rows.push({ key: 'Weekly', value: `${b.weekly_pct}% · resets ${when(b.resets_at)}` });
  rows.push(...target);
  const why = b.verdict_reasons[0];
  rows.push({ key: 'Workers allowed', value: `${b.workers_allowed} (${b.verdict}${why ? `: ${why}` : ''})` });
  const f = b.forecast;
  if (f) {
    const rate = f.pct_per_hour === null ? null : `${f.pct_per_hour.toFixed(2)}%/h`;
    if (rate === null) rows.push({ key: 'Forecast', value: 'no weekly trend yet' });
    else for (const r of f.reaches) rows.push({ key: 'Forecast', value: `weekly ${r.pct}% ${r.at ? `reached around ${when(r.at)}` : 'not reached before the reset'} (${rate})` });
  }
  if (b.age_seconds !== null) rows.push({ key: 'Usage reading', value: age(b.age_seconds) });
  if (b.windows.length) rows.push({ key: 'Usage windows', value: `${b.windows.map((w) => WINDOW_LABELS[w]).join(', ')} (${b.source})` });
  return rows;
}
