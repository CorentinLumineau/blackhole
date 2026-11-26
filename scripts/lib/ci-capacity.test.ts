import { describe, expect, test } from 'bun:test';
import { capWorkersByCi, parseCiCapacity } from './ci-capacity.ts';

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

  test('queue_allowance in the reading widens the tolerated backlog', () => {
    expect(capWorkersByCi(4, { idle_runners: 0, queued_jobs: 3, queue_allowance: 3 }).workers).toBe(4);
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
