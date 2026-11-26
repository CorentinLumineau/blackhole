import { describe, expect, test } from 'bun:test';
import { capWorkersByCi, parseCiCapacity, resolveCiCapacityInput } from './ci-capacity.ts';

describe('capWorkersByCi', () => {
  test('no capacity reading leaves the worker count unchanged', () => {
    expect(capWorkersByCi(3, null)).toEqual({ workers: 3, applied: false, reason: null });
  });

  test('queued jobs within idle runners leave the count unchanged', () => {
    expect(capWorkersByCi(3, { idle_runners: 2, queued_jobs: 2 }).workers).toBe(3);
    expect(capWorkersByCi(3, { idle_runners: 0, queued_jobs: 0 }).workers).toBe(3);
  });

  test('a backlog beyond the allowance lowers workers one for one', () => {
    // backlog 4-1=3, allowance 1 => 2 fewer workers
    const r = capWorkersByCi(4, { idle_runners: 1, queued_jobs: 4 });
    expect(r.workers).toBe(2);
    expect(r.applied).toBe(true);
    expect(r.reason).toContain('4 queued');
  });

  test('a backlog inside the allowance does not lower workers', () => {
    expect(capWorkersByCi(4, { idle_runners: 1, queued_jobs: 2 }).workers).toBe(4);
  });

  test('never drops to zero while the token budget allows a worker', () => {
    expect(capWorkersByCi(2, { idle_runners: 0, queued_jobs: 40 }).workers).toBe(1);
  });

  test('never raises above the token-budget count, idle runners or not', () => {
    expect(capWorkersByCi(2, { idle_runners: 9, queued_jobs: 0 }).workers).toBe(2);
  });

  test('a zero token-budget count stays zero', () => {
    expect(capWorkersByCi(0, { idle_runners: 0, queued_jobs: 40 })).toEqual({ workers: 0, applied: false, reason: null });
  });

  test('every runner busy and nothing queued caps at the allowance without waiting a round', () => {
    const r = capWorkersByCi(4, { idle_runners: 0, busy_runners: 3, queued_jobs: 0 });
    expect(r.workers).toBe(1);
    expect(r.applied).toBe(true);
    expect(r.reason).toContain('3 busy');
  });

  test('all-busy cap is idle runners plus queue_allowance, never above the token cap, never below one', () => {
    expect(capWorkersByCi(4, { idle_runners: 0, busy_runners: 2, queued_jobs: 0, queue_allowance: 3 }).workers).toBe(3);
    expect(capWorkersByCi(2, { idle_runners: 0, busy_runners: 2, queued_jobs: 0, queue_allowance: 3 }).workers).toBe(2);
    expect(capWorkersByCi(4, { idle_runners: 0, busy_runners: 2, queued_jobs: 0, queue_allowance: 0 }).workers).toBe(1);
  });

  test('a busy_runners count with an idle runner free, or zero busy runners, does not cap', () => {
    expect(capWorkersByCi(4, { idle_runners: 1, busy_runners: 5, queued_jobs: 0 }).workers).toBe(4);
    expect(capWorkersByCi(4, { idle_runners: 0, busy_runners: 0, queued_jobs: 0 }).workers).toBe(4);
  });

  test('all-busy cap and queue backlog compose: the lower count wins', () => {
    expect(capWorkersByCi(6, { idle_runners: 0, busy_runners: 2, queued_jobs: 5, queue_allowance: 2 }).workers).toBe(2);
    expect(capWorkersByCi(6, { idle_runners: 0, busy_runners: 2, queued_jobs: 9, queue_allowance: 2 }).workers).toBe(1);
  });

  test('queue_allowance in the reading widens the tolerated backlog', () => {
    expect(capWorkersByCi(4, { idle_runners: 0, queued_jobs: 3, queue_allowance: 3 }).workers).toBe(4);
  });
});

describe('parseCiCapacity busy_runners', () => {
  test('accepts an optional busy_runners count and rejects a bad one', () => {
    expect(parseCiCapacity('{"idle_runners":0,"busy_runners":2,"queued_jobs":0}')).toEqual({ idle_runners: 0, busy_runners: 2, queued_jobs: 0 });
    expect(() => parseCiCapacity('{"idle_runners":0,"busy_runners":-1,"queued_jobs":0}')).toThrow();
  });
});

describe('resolveCiCapacityInput', () => {
  const never = (): string => {
    throw new Error('file must not be read');
  };
  const good = '{"idle_runners":1,"queued_jobs":2}';

  test('neither flag is no reading and no warning', () => {
    expect(resolveCiCapacityInput(undefined, undefined, never)).toEqual({ capacity: null, warning: null });
  });
  test('an inline reading and a file reading both parse', () => {
    expect(resolveCiCapacityInput(good, undefined, never).capacity).toEqual({ idle_runners: 1, queued_jobs: 2 });
    expect(resolveCiCapacityInput(undefined, 'ci.json', () => good).capacity).toEqual({ idle_runners: 1, queued_jobs: 2 });
  });
  test('a malformed inline value warns and leaves no reading instead of failing', () => {
    const r = resolveCiCapacityInput('{"idle_runners":-1,"queued_jobs":0}', undefined, never);
    expect(r.capacity).toBeNull();
    expect(r.warning).toContain('workers unchanged');
  });
  test('an unreadable or malformed file warns and leaves no reading', () => {
    expect(resolveCiCapacityInput(undefined, 'a.json', never)).toMatchObject({ capacity: null, warning: expect.stringContaining('workers unchanged') });
    expect(resolveCiCapacityInput(undefined, 'a.json', () => 'nope').capacity).toBeNull();
  });
  test('a flag with no value warns and leaves no reading', () => {
    expect(resolveCiCapacityInput(true, undefined, never)).toMatchObject({ capacity: null, warning: expect.stringContaining('--ci-capacity needs a value') });
    expect(resolveCiCapacityInput(undefined, true, never)).toMatchObject({ capacity: null, warning: expect.stringContaining('--ci-capacity-file needs a path') });
  });
  test('both flags together warn and leave no reading', () => {
    const r = resolveCiCapacityInput(good, 'ci.json', () => good);
    expect(r.capacity).toBeNull();
    expect(r.warning).toContain('exclusive');
  });
});

describe('parseCiCapacity', () => {
  test('accepts a valid reading', () => {
    expect(parseCiCapacity('{"idle_runners":1,"queued_jobs":2}')).toEqual({ idle_runners: 1, queued_jobs: 2 });
  });
  test('rejects bad JSON, non-objects and negative or fractional counts', () => {
    for (const bad of ['nope', '[]', '{"idle_runners":-1,"queued_jobs":0}', '{"idle_runners":1.5,"queued_jobs":0}', '{"idle_runners":1}', '{"idle_runners":1,"queued_jobs":0,"queue_allowance":-2}']) {
      expect(() => parseCiCapacity(bad)).toThrow();
    }
  });
});
