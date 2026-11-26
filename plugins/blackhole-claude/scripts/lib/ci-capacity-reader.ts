import { pick } from './usage-budget.ts';
import { DEFAULT_QUEUE_ALLOWANCE, type CiCapacity } from './ci-capacity.ts';

// The forge side of the CI-capacity reading (ci-capacity.ts judges it). `ci_capacity.lanes` are
// runner labels the consumer's own PR gate needs; a runner or job counts when it carries any of them,
// so nothing here assumes a runner layout. Fail-open: any forge error is no reading and a warning.

export type CiCapacityConfig = { enabled: boolean; lanes: string[]; queue_allowance: number };

/** `ci_capacity`: absent block or key means the defaults (off, no lanes, allowance 1); a wrong type throws with the key path. */
export const resolveCiCapacityConfig = (config: Record<string, unknown>): CiCapacityConfig => {
  const raw = config.ci_capacity;
  if (raw !== undefined && (typeof raw !== 'object' || raw === null || Array.isArray(raw))) throw new Error('ci_capacity must be an object');
  const block = (raw ?? {}) as Record<string, unknown>;
  const lanes = pick<string[]>(block, 'lanes', 'ci_capacity.lanes', [], (v) => Array.isArray(v) && v.every((l) => typeof l === 'string' && l.trim() !== ''), 'a list of non-empty labels');
  return {
    enabled: pick(block, 'enabled', 'ci_capacity.enabled', false, (v) => typeof v === 'boolean', 'a boolean'),
    lanes: [...new Set(lanes)],
    queue_allowance: pick(block, 'queue_allowance', 'ci_capacity.queue_allowance', DEFAULT_QUEUE_ALLOWANCE, (v) => typeof v === 'number' && Number.isInteger(v) && v >= 0, 'a non-negative integer'),
  };
};

type Labelled = { labels?: unknown };

const labelNames = (item: Labelled): string[] =>
  Array.isArray(item.labels) ? item.labels.map((l) => (typeof l === 'string' ? l : (l as { name?: unknown } | null)?.name)).filter((n): n is string => typeof n === 'string') : [];

const inLanes = (item: Labelled, lanes: string[]): boolean => labelNames(item).some((n) => lanes.includes(n));

const listOf = (payload: unknown, key: string): Record<string, unknown>[] => {
  const list = (payload as Record<string, unknown> | null)?.[key];
  if (!Array.isArray(list)) throw new Error(`forge answer has no "${key}" list`);
  return list as Record<string, unknown>[];
};

/** Online runners in the lanes, split by whether they run a job. */
export const countRunners = (payload: unknown, lanes: string[]): { idle: number; busy: number } => {
  const runners = listOf(payload, 'runners').filter((r) => r.status === 'online' && inLanes(r, lanes));
  const busy = runners.filter((r) => r.busy === true).length;
  return { idle: runners.length - busy, busy };
};

/** Queued jobs in the lanes out of one run's job list. */
export const countQueuedJobs = (payload: unknown, lanes: string[]): number => listOf(payload, 'jobs').filter((j) => j.status === 'queued' && inLanes(j, lanes)).length;

/** Queued runs whose jobs are looked at one by one; a run past the cap counts as one queued job. */
export const MAX_RUNS_INSPECTED = 10;

export type ForgeGet = (endpoint: string) => unknown;

/**
 * Reads `{idle_runners, busy_runners, queued_jobs, queue_allowance}` for the lanes from GitHub's REST
 * API: one call for the runners, one for the queued runs, one per queued run (capped) for its jobs.
 * Returns the reading, or null and a warning on any error or when no lane is configured.
 */
export const readCiCapacity = (repo: string, config: CiCapacityConfig, get: ForgeGet): { capacity: CiCapacity | null; warning: string | null } => {
  if (config.lanes.length === 0) return { capacity: null, warning: 'ci capacity unread, workers unchanged: ci_capacity.lanes is empty' };
  try {
    const { idle, busy } = countRunners(get(`repos/${repo}/actions/runners?per_page=100`), config.lanes);
    const runs = listOf(get(`repos/${repo}/actions/runs?status=queued&per_page=100`), 'workflow_runs');
    let queued = Math.max(0, runs.length - MAX_RUNS_INSPECTED);
    for (const run of runs.slice(0, MAX_RUNS_INSPECTED)) {
      queued += countQueuedJobs(get(`repos/${repo}/actions/runs/${String(run.id)}/jobs?per_page=100`), config.lanes);
    }
    return { capacity: { idle_runners: idle, busy_runners: busy, queued_jobs: queued, queue_allowance: config.queue_allowance }, warning: null };
  } catch (error) {
    return { capacity: null, warning: `ci capacity unread, workers unchanged: ${error instanceof Error ? error.message : String(error)}` };
  }
};
