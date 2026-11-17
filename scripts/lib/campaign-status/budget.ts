import * as fs from 'fs';
import type { RateLimits } from '../pace-gate.ts';
import type { Host } from '../run-context.ts';
import { forecastWeekly, resolveUsageBudget, workersAllowed, USAGE_WINDOWS, type UsageBudgetConfig, type UsageVerdict } from '../usage-budget.ts';
import { restrictWindows, usageSourceFor, type UsageSourceName } from '../usage-source.ts';
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
};

/** The verdict the usage-budget CLI returns for this reading: `unavailable` when the budget is off or its config is invalid. */
function verdictFor(limits: RateLimits, now: number, config: Record<string, unknown>): { verdict: UsageVerdict; budget: UsageBudgetConfig | null } {
  const parallelMax = parallelMaxOf(config);
  const off = (reason: string): UsageVerdict => ({ verdict: 'unavailable', workers: parallelMax, reasons: [reason], wake_at: null, hours_to_reset: null, weekly_fit: null });
  const settings = resolveBudgetSettings(config);
  if (settings.invalid !== null) return { verdict: off(`usage_budget config invalid: ${settings.invalid}`), budget: null };
  const { budget } = settings;
  return { verdict: budget.enabled ? workersAllowed(limits, now, budget, parallelMax) : off('usage_budget disabled'), budget };
}

/** The panel for one reading; `limits` null ⇒ not probed, with `reason`. `now` is epoch seconds. */
export function buildBudgetPanel(input: {
  limits: RateLimits | null;
  reason: string | null;
  ageSeconds: number | null;
  now: number;
  config: Record<string, unknown>;
  source?: UsageSourceName;
}): BudgetPanel {
  const { limits, now, config } = input;
  if (!limits) return { ...NOT_PROBED, reason: input.reason ?? NOT_PROBED.reason };
  const { verdict, budget } = verdictFor(limits, now, config);
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
  };
}

/** Reads `host`'s usage source (`usage-source.ts`): the rate-limit cache the config names on Claude, none elsewhere. */
export function readBudgetPanel(config: Record<string, unknown>, host: Host, now: number = Math.floor(Date.now() / 1000)): BudgetPanel {
  let reading;
  let cachePath: string | null = null;
  try {
    const source = usageSourceFor(host, config);
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
  return buildBudgetPanel({ limits: reading.limits, reason: reading.reason, ageSeconds, now, config, source: reading.source });
}

/** The panel for a reading the harness reported (`--usage`), restricted to `usage_budget.windows` as the usage source and usage-budget.ts restrict it. */
export function givenBudgetPanel(usage: RateLimits, config: Record<string, unknown>, now: number): BudgetPanel {
  const settings = resolveBudgetSettings(config);
  // An invalid config is shown by the panel's own `unavailable` verdict; the reading is kept whole.
  const kept = settings.invalid === null ? restrictWindows(usage, settings.budget.windows).limits : usage;
  const reason = kept ? null : 'usage_budget.windows leaves none of the --usage windows';
  return buildBudgetPanel({ limits: kept, reason, ageSeconds: 0, now, config });
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
const age = (seconds: number): string => (seconds < 60 ? `${seconds}s old` : seconds < 2 * HOUR ? `${Math.round(seconds / 60)} min old` : `${Math.round(seconds / HOUR)} h old`);

/** The panel as key/value rows: the text dashboard, `--html` and the `budget` dataset all print these. */
export function budgetRows(b: BudgetPanel): Array<{ key: string; value: string }> {
  if (!b.probed) return [{ key: 'Usage', value: `usage not probed — ${b.reason ?? NOT_PROBED.reason}` }];
  const rows: Array<{ key: string; value: string }> = [];
  if (b.five_hour_pct !== null && b.five_hour_resets_at) rows.push({ key: '5-hour', value: `${b.five_hour_pct}% · resets ${when(b.five_hour_resets_at)}` });
  if (b.weekly_pct !== null && b.resets_at) rows.push({ key: 'Weekly', value: `${b.weekly_pct}% · resets ${when(b.resets_at)}` });
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
