// CI-capacity input to worker sizing. A caller that has read the consumer's runners and queued
// jobs hands the counts over; the result can only lower the token-budget worker count, never raise
// it, and no reading means no change. Pure: no I/O, no clock reads, no assumption about runner layout.

export type CiCapacity = {
  /** Online runners with no job, already restricted to the labels the caller cares about. */
  idle_runners: number;
  /** Online runners running a job, same label restriction. With `idle_runners` 0 they mark a fully busy lane. */
  busy_runners?: number;
  /** Jobs waiting for a runner of those labels. */
  queued_jobs: number;
  /** Backlog beyond idle runners tolerated before workers are lowered, and the workers allowed on a fully busy lane; default 1. */
  queue_allowance?: number;
};

export type CiCapResult = { workers: number; applied: boolean; reason: string | null };

export const DEFAULT_QUEUE_ALLOWANCE = 1;

const isCount = (v: unknown): v is number => typeof v === 'number' && Number.isInteger(v) && v >= 0;

export const parseCiCapacity = (raw: string): CiCapacity => {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    throw new Error('--ci-capacity is not valid JSON');
  }
  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) throw new Error('--ci-capacity must be a JSON object');
  const { idle_runners, busy_runners, queued_jobs, queue_allowance } = parsed as Record<string, unknown>;
  if (!isCount(idle_runners) || !isCount(queued_jobs)) throw new Error('--ci-capacity needs non-negative integer idle_runners and queued_jobs');
  for (const [name, value] of [['busy_runners', busy_runners], ['queue_allowance', queue_allowance]] as const) {
    if (value !== undefined && !isCount(value)) throw new Error(`--ci-capacity ${name} must be a non-negative integer`);
  }
  return {
    idle_runners,
    queued_jobs,
    ...(busy_runners === undefined ? {} : { busy_runners: busy_runners as number }),
    ...(queue_allowance === undefined ? {} : { queue_allowance: queue_allowance as number }),
  };
};

export type CiCapacityInput = { capacity: CiCapacity | null; warning: string | null };

/**
 * The reading behind `--ci-capacity` / `--ci-capacity-file`. Fail-open on every shape of bad input:
 * a missing value, both flags, an unreadable file or a malformed reading is a warning and no
 * reading, never an error, so a bad reading can not drop the pacing verdict.
 */
export const resolveCiCapacityInput = (inline: string | true | undefined, file: string | true | undefined, readFile: (path: string) => string): CiCapacityInput => {
  const unread = (why: string): CiCapacityInput => ({ capacity: null, warning: `ci capacity unread, workers unchanged: ${why}` });
  if (inline === undefined && file === undefined) return { capacity: null, warning: null };
  if (inline === true) return unread('--ci-capacity needs a value');
  if (file === true) return unread('--ci-capacity-file needs a path');
  if (inline !== undefined && file !== undefined) return unread('--ci-capacity and --ci-capacity-file are exclusive');
  try {
    return { capacity: parseCiCapacity(inline ?? readFile(file as string)), warning: null };
  } catch (error) {
    return unread(error instanceof Error ? error.message : String(error));
  }
};

/**
 * Lowers `workers` from the CI reading, keeping at least one while `workers` > 0 and never raising it.
 * Two terms, the lower wins: with every runner busy (`idle_runners` 0, `busy_runners` > 0) it caps at
 * `idle_runners + queue_allowance` before anything queues, and each queued job beyond idle runners and
 * the allowance takes one worker off.
 */
export const capWorkersByCi = (workers: number, capacity: CiCapacity | null): CiCapResult => {
  if (capacity === null || workers <= 0) return { workers, applied: false, reason: null };
  const allowance = capacity.queue_allowance ?? DEFAULT_QUEUE_ALLOWANCE;
  const busy = capacity.busy_runners ?? 0;
  const laneFull = capacity.idle_runners === 0 && busy > 0;
  const excess = Math.max(0, capacity.queued_jobs - capacity.idle_runners - allowance);
  const capped = Math.max(1, Math.min(workers - excess, laneFull ? capacity.idle_runners + allowance : workers));
  if (capped >= workers) return { workers, applied: false, reason: null };
  const why = laneFull ? `${busy} busy runner(s), none idle` : `${capacity.idle_runners} idle runner(s)`;
  return {
    workers: capped,
    applied: true,
    reason: `ci capacity: ${capacity.queued_jobs} queued job(s), ${why}, workers ${workers} -> ${capped}`,
  };
};
