import { afterEach, describe, expect, spyOn, test } from 'bun:test';
import * as childProcess from 'child_process';
import { ciOf, fetchPrSignals, reviewOf } from './pr-signals.ts';

describe('ciOf / reviewOf', () => {
  const check = (status: 'QUEUED' | 'IN_PROGRESS' | 'COMPLETED', conclusion: string | null, name = 'ci') =>
    ({ name, status, conclusion }) as Parameters<typeof ciOf>[0][number];

  test('no check is "none", never green; a running check is "running"; all success is green', () => {
    expect(ciOf([])).toEqual({ ci: 'none', failing: [] });
    expect(ciOf([check('COMPLETED', 'SUCCESS'), check('IN_PROGRESS', null)])).toEqual({ ci: 'running', failing: [] });
    expect(ciOf([check('COMPLETED', 'SUCCESS'), check('COMPLETED', 'SKIPPED')])).toEqual({ ci: 'green', failing: [] });
  });

  test('failed, cancelled or action-required checks fail CI and are named once, sorted', () => {
    expect(ciOf([check('COMPLETED', 'FAILURE', 'unit'), check('COMPLETED', 'CANCELLED', 'lint'), check('COMPLETED', 'FAILURE', 'unit')])).toEqual({
      ci: 'failing',
      failing: ['lint', 'unit'],
    });
  });

  test('the verdict is the ai-review label without its prefix', () => {
    expect(reviewOf([{ name: 'bug' }, { name: 'ai-review:NEEDS_CHANGES' }])).toBe('NEEDS_CHANGES');
    expect(reviewOf(['ai-review:LGTM'])).toBe('LGTM');
    expect(reviewOf([{ name: 'bug' }])).toBeNull();
    expect(reviewOf(undefined)).toBeNull();
  });
});

describe('fetchPrSignals', () => {
  let spy: ReturnType<typeof spyOn<typeof childProcess, 'spawnSync'>> | undefined;
  afterEach(() => spy?.mockRestore());

  test('reads the lowest PRs up to the cap, and leaves out a PR whose read fails', () => {
    spy = spyOn(childProcess, 'spawnSync').mockImplementation(((_cmd: string, args: string[]) => {
      const endpoint = String(args[3]);
      const ok = (v: unknown) => ({ status: 0, stdout: JSON.stringify(v), stderr: '' });
      if (endpoint.endsWith('/pulls/2')) return { status: 1, stdout: '', stderr: 'HTTP 502' };
      const pr = endpoint.match(/\/pulls\/(\d+)$/);
      if (pr) return ok({ number: Number(pr[1]), mergeable: null, head: { sha: `s${pr[1]}` }, labels: [] });
      if (endpoint.includes('/check-runs')) return ok({ check_runs: [] });
      if (endpoint.endsWith('/status')) return ok({ statuses: [{ context: 'build', state: 'pending' }] });
      return { status: 1, stdout: '', stderr: 'unexpected' };
    }) as typeof childProcess.spawnSync);
    const signals = fetchPrSignals('acme/widgets', [9, 2, 1, 5], 3);
    expect(Object.keys(signals).map(Number)).toEqual([1, 5]);
    expect(signals[1]).toEqual({ review: null, mergeable: null, ci: 'running', failing: [] });
  });
});
