import type { RateLimits, RateWindow } from '../pace-gate.ts';
import {
  forecastWeekly,
  resolveUsageBudget,
  workersAllowed,
  type UsageVerdictName,
  type WeeklyForecast,
  type WeeklySample,
} from '../usage-budget.ts';

/** `parallel_max` when `config.json` has none (`config-template.md`). */
const DEFAULT_PARALLEL_MAX = 4;

/**
 * The usage budget as the launch summary and the status page show it: the usage read, the verdict,
 * the workers allowed now, the four stop thresholds and the weekly forecast. The one place under
 * `campaign-status/` that calls the pacing gate, so the two surfaces never disagree.
 */
export type BudgetView = {
  /** `usage_budget.enabled`. Off ⇒ verdict `off` and workers = `parallel_max`. */
  enabled: boolean;
  /** Whether a usage reading was given; false ⇒ the row says `not probed`. */
  probed: boolean;
  five_hour: RateWindow | null;
  weekly: RateWindow | null;
  verdict: UsageVerdictName | 'off';
  workers: number;
  parallel_max: number;
  wake_at: number | null;
  reasons: string[];
  thresholds: {
    no_spawn_at: number;
    stop_workers_at: number;
    no_new_starts_at: number;
    stop_campaign_at: number;
    target_at_reset: number | null;
  };
  /** Null with fewer than two weekly samples. */
  forecast: WeeklyForecast | null;
};

export type BudgetViewInput = {
  config: Record<string, unknown>;
  /** The harness usage reading, or null when it was not probed. */
  usage: RateLimits | null;
  /** Epoch seconds. */
  now: number;
  samples?: WeeklySample[];
};

export function buildBudgetView({ config, usage, now, samples = [] }: BudgetViewInput): BudgetView {
  const budget = resolveUsageBudget(config);
  const parallelMax = typeof config.parallel_max === 'number' ? config.parallel_max : DEFAULT_PARALLEL_MAX;
  const verdict = budget.enabled
    ? workersAllowed(usage, now, budget, parallelMax)
    : { verdict: 'off' as const, workers: parallelMax, reasons: ['usage_budget disabled'], wake_at: null };
  const { no_new_starts_at, stop_campaign_at, target_at_reset } = budget.weekly;
  return {
    enabled: budget.enabled,
    probed: usage !== null,
    five_hour: usage?.five_hour ?? null,
    weekly: usage?.seven_day ?? null,
    verdict: verdict.verdict,
    workers: verdict.workers,
    parallel_max: parallelMax,
    wake_at: verdict.wake_at,
    reasons: verdict.reasons,
    thresholds: { ...budget.five_hour, no_new_starts_at, stop_campaign_at, target_at_reset },
    forecast: samples.length >= 2 ? forecastWeekly(samples, now, budget.weekly) : null,
  };
}
