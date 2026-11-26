// CI-capacity input to worker sizing. A caller that has read the consumer's runners and queued
// jobs hands the counts over; the result can only lower the token-budget worker count, never raise
// it, and no reading means no change. Pure: no I/O, no clock reads, no assumption about runner layout.

export type CiCapacity = {
  /** Online runners with no job, already restricted to the labels the caller cares about. */
  idle_runners: number;
  /** Jobs waiting for a runner of those labels. */
  queued_jobs: number;
  /** Backlog beyond idle runners tolerated before workers are lowered; default 1. */
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
  const { idle_runners, queued_jobs, queue_allowance } = parsed as Record<string, unknown>;
  if (!isCount(idle_runners) || !isCount(queued_jobs)) throw new Error('--ci-capacity needs non-negative integer idle_runners and queued_jobs');
  if (queue_allowance !== undefined && !isCount(queue_allowance)) throw new Error('--ci-capacity queue_allowance must be a non-negative integer');
  return { idle_runners, queued_jobs, ...(queue_allowance === undefined ? {} : { queue_allowance }) };
};

/** Lowers `workers` by the queue backlog beyond idle runners and the allowance; keeps at least one while `workers` > 0. */
export const capWorkersByCi = (workers: number, capacity: CiCapacity | null): CiCapResult => {
  if (capacity === null || workers <= 0) return { workers, applied: false, reason: null };
  const allowance = capacity.queue_allowance ?? DEFAULT_QUEUE_ALLOWANCE;
  const excess = capacity.queued_jobs - capacity.idle_runners - allowance;
  if (excess <= 0) return { workers, applied: false, reason: null };
  const capped = Math.max(1, workers - excess);
  if (capped === workers) return { workers, applied: false, reason: null };
  return {
    workers: capped,
    applied: true,
    reason: `ci capacity: ${capacity.queued_jobs} queued job(s) for ${capacity.idle_runners} idle runner(s), workers ${workers} -> ${capped}`,
  };
};
