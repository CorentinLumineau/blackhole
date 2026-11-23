import { describe, expect, test } from 'bun:test';
import { spawnSync } from 'child_process';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { root } from '../build/paths.ts';
import { readJsonFile } from '../fs.ts';
import type { ForgeCheck } from '../forge-adapter/types.ts';
import { checksFromSnapshot, ciVerdict, requiredChecksFromConfig, unconfiguredPendingMessage, withoutSupersededCancelled, type CiVerdictOptions } from './ci-verdict.ts';

const fixture = (name: string) => {
  const file = path.join(root, 'fixtures', 'ci-verdict', name);
  return readJsonFile(file, file);
};

describe('ciVerdict drops only a CANCELLED run a newer run of the same PR workflow replaced', () => {
  const PRODUCER = 'actions:1:pull_request:feat:7:main';
  const run = (conclusion: ForgeCheck['conclusion'], rest: Partial<ForgeCheck> = {}): ForgeCheck =>
    ({ name: 'pr-lint', status: 'COMPLETED', conclusion, producer: PRODUCER, ...rest });
  const T0 = '2026-11-20T11:00:00Z';
  const T1 = '2026-11-20T11:29:49Z';
  const T2 = '2026-11-20T11:45:34Z';
  const older = (c: ForgeCheck['conclusion']) => run(c, { startedAt: T1, runId: 1, suiteId: 11 });
  const newer = (c: ForgeCheck['conclusion'], status: ForgeCheck['status'] = 'COMPLETED') =>
    run(c, { startedAt: T2, runId: 2, suiteId: 12, status });

  const suiteRun = (id: number, suite: number, conclusion: string, startedAt: string, name = 'pr-lint') =>
    ({ id, name, status: 'completed', conclusion, started_at: startedAt, check_suite: { id: suite } });
  const pr = (number: number, base = 'main') => ({ number, head: { ref: 'feat' }, base: { ref: base } });
  type RunOpts = { event?: string; branch?: string; prs?: unknown[] };
  const workflowRun = (suite: number, workflow: number, { event = 'pull_request', branch = 'feat', prs = [pr(7)] }: RunOpts = {}) =>
    ({ check_suite_id: suite, workflow_id: workflow, event, head_branch: branch, pull_requests: prs });
  const verdictOf = (checkRuns: unknown[], workflowRuns?: unknown[], options: CiVerdictOptions = {}) =>
    ciVerdict(checksFromSnapshot({ check_runs: checkRuns }, workflowRuns === undefined ? undefined : { workflow_runs: workflowRuns }), options);
  const cancelledThenPassed = [suiteRun(1, 11, 'cancelled', T1), suiteRun(2, 12, 'success', T2)];
  const failedThenPassed = [suiteRun(1, 11, 'failure', T1), suiteRun(2, 12, 'success', T2)];

  test('matrix row 1 (issue 1381): the PR 1360 shape is green once joined by the runs payload, with and without a required list', () => {
    const checks = checksFromSnapshot(fixture('superseded-run.json'), fixture('superseded-run-runs.json'));
    expect(ciVerdict(checks, { requiredChecks: ['Protocol Conformance', 'pr-lint'] })).toEqual({ verdict: 'green', failing: [], pending: [], ignored: [] });
    const runs = [workflowRun(11, 5), workflowRun(12, 5)];
    expect(verdictOf(cancelledThenPassed, runs)).toMatchObject({ verdict: 'green', failing: [] });
    expect(verdictOf(cancelledThenPassed, runs, { requiredChecks: ['pr-lint'] })).toMatchObject({ verdict: 'green', failing: [] });
    expect(verdictOf([...cancelledThenPassed].reverse(), runs).verdict).toBe('green');
  });

  test('matrix row 2: two workflows sharing a job name never hide an older FAILURE behind the other workflow\'s newer SUCCESS', () => {
    const runs = [workflowRun(11, 5), workflowRun(12, 6)];
    expect(verdictOf(failedThenPassed, runs)).toMatchObject({ verdict: 'red', failing: ['pr-lint'] });
    expect(verdictOf(failedThenPassed, runs, { requiredChecks: ['pr-lint'] })).toMatchObject({ verdict: 'red', failing: ['pr-lint'] });
    expect(verdictOf(cancelledThenPassed, runs)).toMatchObject({ verdict: 'red', failing: ['pr-lint'] });
  });

  test('matrix row 3: one workflow fired by push and by pull_request for one SHA keeps the older event\'s FAILURE', () => {
    const runs = [workflowRun(11, 5, { event: 'push', prs: [] }), workflowRun(12, 5)];
    expect(verdictOf(failedThenPassed, runs)).toMatchObject({ verdict: 'red', failing: ['pr-lint'] });
    expect(verdictOf(cancelledThenPassed, runs)).toMatchObject({ verdict: 'red', failing: ['pr-lint'] });
  });

  test('matrix row 4: a commit status and a check run sharing a name are different producers', () => {
    const snapshot = { check_runs: [suiteRun(2, 12, 'success', T2)], statuses: [{ context: 'pr-lint', state: 'failure' }] };
    const checks = checksFromSnapshot(snapshot, { workflow_runs: [workflowRun(12, 5)] });
    expect(ciVerdict(checks)).toMatchObject({ verdict: 'red', failing: ['pr-lint'] });
    expect(ciVerdict(checks, { requiredChecks: ['pr-lint'] }).verdict).toBe('red');
  });

  test('matrix row 5: a newer SKIPPED or NEUTRAL run of the same proved producer leaves an older FAILURE red', () => {
    expect(ciVerdict([older('FAILURE'), newer('SKIPPED')])).toMatchObject({ verdict: 'red', failing: ['pr-lint'] });
    expect(ciVerdict([older('FAILURE'), newer('NEUTRAL')])).toMatchObject({ verdict: 'red', failing: ['pr-lint'] });
    const failSucceedSkip = [
      run('FAILURE', { startedAt: T0, runId: 1, suiteId: 10 }),
      run('SUCCESS', { startedAt: T1, runId: 2, suiteId: 11 }),
      run('SKIPPED', { startedAt: T2, runId: 3, suiteId: 12 }),
    ];
    expect(ciVerdict(failSucceedSkip)).toMatchObject({ verdict: 'red', failing: ['pr-lint'] });
  });

  test.each([
    ['null', null],
    ['an unparseable string', 'not a date'],
    ['the Go zero time', '0001-01-01T00:00:00Z'],
    ['the epoch', '1970-01-01T00:00:00Z'],
  ])('matrix row 6: a queued rerun whose startedAt is %s still judges the head pending, with and without a run id', (_label, startedAt) => {
    const done = older('SUCCESS');
    const queued = (runId?: number) => run(null, { status: 'QUEUED', startedAt: startedAt as string | undefined, suiteId: 12, ...(runId === undefined ? {} : { runId }) });
    expect(ciVerdict([done, queued(2)])).toMatchObject({ verdict: 'pending', pending: ['pr-lint'] });
    expect(ciVerdict([queued(2), done])).toMatchObject({ verdict: 'pending', pending: ['pr-lint'] });
    expect(ciVerdict([done, queued()])).toMatchObject({ verdict: 'pending', pending: ['pr-lint'] });
    expect(ciVerdict([{ ...done, runId: undefined }, queued()])).toMatchObject({ verdict: 'pending', pending: ['pr-lint'] });
  });

  test('matrix row 7: without a provable producer every run is kept, so an older CANCELLED still fails', () => {
    const bare = (c: ForgeCheck['conclusion'], startedAt: string, runId: number, suiteId: number): ForgeCheck =>
      ({ name: 'pr-lint', status: 'COMPLETED', conclusion: c, startedAt, runId, suiteId });
    expect(ciVerdict([bare('CANCELLED', T1, 1, 11), bare('SUCCESS', T2, 2, 12)])).toMatchObject({ verdict: 'red', failing: ['pr-lint'] });
    expect(verdictOf(cancelledThenPassed)).toMatchObject({ verdict: 'red', failing: ['pr-lint'] });
    expect(verdictOf(cancelledThenPassed, [workflowRun(99, 5)])).toMatchObject({ verdict: 'red', failing: ['pr-lint'] });
    expect(verdictOf(cancelledThenPassed, [workflowRun(11, 5)])).toMatchObject({ verdict: 'red', failing: ['pr-lint'] });
    expect(verdictOf(cancelledThenPassed, [workflowRun(11, 5), workflowRun(12, 5), workflowRun(12, 6)])).toMatchObject({ verdict: 'red', failing: ['pr-lint'] });
  });

  test('matrix row 8: a latest SKIPPED with an older SUCCESS of the same producer stays pending when no list is configured', () => {
    expect(ciVerdict([older('SUCCESS'), newer('SKIPPED')])).toMatchObject({ verdict: 'pending', missing_config: 'merge_ready.required_checks' });
    expect(unconfiguredPendingMessage([older('SUCCESS'), newer('SKIPPED')], {})).toContain('1 gating check(s) were SKIPPED: pr-lint');
  });

  test('matrix row 9a: two open PRs from one head branch to different bases never replace each other\'s runs', () => {
    const bothListed = [pr(7, 'main'), pr(8, 'release')];
    const listsBoth = [workflowRun(11, 5, { prs: bothListed }), workflowRun(12, 5, { prs: bothListed })];
    expect(verdictOf(cancelledThenPassed, listsBoth)).toMatchObject({ verdict: 'red', failing: ['pr-lint'] });
    expect(verdictOf(failedThenPassed, listsBoth)).toMatchObject({ verdict: 'red', failing: ['pr-lint'] });
    const ownPrEach = [workflowRun(11, 5, { prs: [pr(7, 'main')] }), workflowRun(12, 5, { prs: [pr(8, 'release')] })];
    expect(verdictOf(cancelledThenPassed, ownPrEach)).toMatchObject({ verdict: 'red', failing: ['pr-lint'] });
    expect(verdictOf(failedThenPassed, ownPrEach)).toMatchObject({ verdict: 'red', failing: ['pr-lint'] });
  });

  test('matrix row 9b: a pull_request run listing no PR (a fork or closed PR) proves nothing', () => {
    expect(verdictOf(cancelledThenPassed, [workflowRun(11, 5, { prs: [] }), workflowRun(12, 5, { prs: [] })])).toMatchObject({ verdict: 'red', failing: ['pr-lint'] });
  });

  test.each([['workflow_dispatch'], ['repository_dispatch']])('matrix row 10: two %s runs of one workflow never replace each other', (event) => {
    const runs = [workflowRun(11, 5, { event, prs: [] }), workflowRun(12, 5, { event, prs: [] })];
    expect(verdictOf(cancelledThenPassed, runs)).toMatchObject({ verdict: 'red', failing: ['pr-lint'] });
    expect(verdictOf(failedThenPassed, runs)).toMatchObject({ verdict: 'red', failing: ['pr-lint'] });
  });

  test('matrix row 10: two push runs of one workflow never replace each other', () => {
    const runs = [workflowRun(11, 5, { event: 'push', prs: [] }), workflowRun(12, 5, { event: 'push', prs: [] })];
    expect(verdictOf(cancelledThenPassed, runs)).toMatchObject({ verdict: 'red', failing: ['pr-lint'] });
  });

  test('matrix row 11: same-suite siblings with a tied start are never replaced, whatever their run ids', () => {
    const siblings = [suiteRun(1, 11, 'cancelled', T1), suiteRun(2, 11, 'success', T1)];
    expect(verdictOf(siblings, [workflowRun(11, 5)])).toMatchObject({ verdict: 'red', failing: ['pr-lint'] });
    expect(ciVerdict([run('CANCELLED', { startedAt: T1, runId: 1, suiteId: 11 }), run('SUCCESS', { startedAt: T1, runId: 2, suiteId: 11 })]).verdict).toBe('red');
  });

  test('matrix row 12: a rerun inside one suite stays red; the real PR 1384 filter=all shape is green through the newer suite', () => {
    const rerun = [suiteRun(1, 11, 'cancelled', T1), suiteRun(3, 11, 'success', T2)];
    expect(verdictOf(rerun, [workflowRun(11, 5)])).toMatchObject({ verdict: 'red', failing: ['pr-lint'] });
    const pr1384 = [
      suiteRun(136357151096, 121141391826, 'success', '2026-11-20T14:44:48Z'),
      suiteRun(136354750487, 121141393769, 'success', '2026-11-20T14:40:27Z'),
      suiteRun(136354740292, 121141391380, 'skipped', '2026-11-20T14:40:24Z', 'Release Notes Gate'),
      suiteRun(136354737752, 121141391826, 'cancelled', '2026-11-20T14:40:23Z'),
      suiteRun(136354737748, 121141391380, 'success', '2026-11-20T14:40:26Z', 'Protocol Conformance'),
    ];
    const runs1384 = [
      workflowRun(121141391380, 307277644, { branch: 'blackhole/issue-1374', prs: [pr(1384)] }),
      workflowRun(121141391826, 386981354, { branch: 'blackhole/issue-1374', prs: [pr(1384)] }),
      workflowRun(121141393769, 386981354, { branch: 'blackhole/issue-1374', prs: [pr(1384)] }),
    ];
    expect(verdictOf(pr1384, runs1384, { requiredChecks: ['Protocol Conformance', 'pr-lint'] })).toEqual({ verdict: 'green', failing: [], pending: [], ignored: [] });
  });

  test('matrix row 13a: a FAILURE with the higher ids but the earlier start is never dropped', () => {
    const failure = run('FAILURE', { startedAt: T1, runId: 2, suiteId: 12 });
    const success = run('SUCCESS', { startedAt: T2, runId: 1, suiteId: 11 });
    expect(ciVerdict([failure, success])).toMatchObject({ verdict: 'red', failing: ['pr-lint'] });
  });

  test('matrix row 13b: a CANCELLED with the higher ids but the earlier start is not replaced by a lower-id run', () => {
    const cancelled = run('CANCELLED', { startedAt: T1, runId: 2, suiteId: 12 });
    const success = run('SUCCESS', { startedAt: T2, runId: 1, suiteId: 11 });
    expect(ciVerdict([cancelled, success])).toMatchObject({ verdict: 'red', failing: ['pr-lint'] });
  });

  test('matrix row 13c: a later start on the lower-id CANCELLED vetoes its replacement', () => {
    const cancelled = run('CANCELLED', { startedAt: T2, runId: 1, suiteId: 11 });
    const success = run('SUCCESS', { startedAt: T1, runId: 2, suiteId: 12 });
    expect(ciVerdict([cancelled, success])).toMatchObject({ verdict: 'red', failing: ['pr-lint'] });
  });

  test('matrix row 14: an older FAILURE of the same proved producer stays red behind a newer SUCCESS', () => {
    expect(ciVerdict([older('FAILURE'), newer('SUCCESS')])).toMatchObject({ verdict: 'red', failing: ['pr-lint'] });
    expect(ciVerdict([older('FAILURE'), newer('SUCCESS')], { requiredChecks: ['pr-lint'] })).toMatchObject({ verdict: 'red', failing: ['pr-lint'] });
    expect(verdictOf(failedThenPassed, [workflowRun(11, 5), workflowRun(12, 5)])).toMatchObject({ verdict: 'red', failing: ['pr-lint'] });
  });

  test('matrix row 15: a newer NEUTRAL run of the same proved producer does not replace a CANCELLED run', () => {
    const x = (conclusion: ForgeCheck['conclusion'], runId: number, suiteId: number): ForgeCheck =>
      ({ name: 'x', status: 'COMPLETED', conclusion, producer: PRODUCER, runId, suiteId });
    expect(ciVerdict([x('CANCELLED', 1, 1), x('NEUTRAL', 2, 2)])).toMatchObject({ verdict: 'red', failing: ['x'] });
  });

  test('matrix row 16: a newer SKIPPED run leaves a CANCELLED run red beside a passing required check', () => {
    const verify: ForgeCheck = { name: 'verify', status: 'COMPLETED', conclusion: 'SUCCESS' };
    expect(ciVerdict([older('CANCELLED'), newer('SKIPPED'), verify], { requiredChecks: ['verify'] })).toMatchObject({ verdict: 'red', failing: ['pr-lint'] });
  });

  test('matrix row 17: a newer SKIPPED run of a required check leaves its CANCELLED run red, not pending', () => {
    expect(ciVerdict([older('CANCELLED'), newer('SKIPPED')], { requiredChecks: ['pr-lint'] })).toMatchObject({ verdict: 'red', failing: ['pr-lint'] });
  });

  test('matrix row 18: in a static-name matrix a newer-suite SUCCESS still replaces the CANCELLED sibling', () => {
    const t = (conclusion: ForgeCheck['conclusion'], runId: number, suiteId: number): ForgeCheck =>
      ({ name: 't', status: 'COMPLETED', conclusion, producer: PRODUCER, runId, suiteId });
    expect(ciVerdict([t('SUCCESS', 1, 1), t('CANCELLED', 2, 1), t('SUCCESS', 3, 2)])).toEqual({ verdict: 'green', failing: [], pending: [], ignored: [] });
  });

  test('matrix row 19: a CANCELLED run never replaces another, so the start veto cannot be bypassed through a chain', () => {
    const c1 = run('CANCELLED', { startedAt: T2, runId: 1, suiteId: 11 });
    const n2 = run('SUCCESS', { startedAt: T1, runId: 3, suiteId: 13 });
    expect(ciVerdict([c1, run('CANCELLED', { runId: 2, suiteId: 12 }), n2])).toMatchObject({ verdict: 'red', failing: ['pr-lint'] });
    expect(ciVerdict([c1, run('CANCELLED', { startedAt: '0001-01-01T00:00:00Z', runId: 2, suiteId: 12 }), n2])).toMatchObject({ verdict: 'red', failing: ['pr-lint'] });
  });

  test('withoutSupersededCancelled keeps every entry but the replaced CANCELLED, in input order', () => {
    const extra = { name: 'verify', status: 'COMPLETED', conclusion: 'FAILURE', producer: PRODUCER, startedAt: T1, runId: 3, suiteId: 11 } as const;
    expect(withoutSupersededCancelled([older('CANCELLED'), extra, newer('SUCCESS')])).toEqual([extra, newer('SUCCESS')]);
    expect(withoutSupersededCancelled([newer('SUCCESS'), older('CANCELLED')])).toEqual([newer('SUCCESS')]);
  });

  test('a replacement needs a different suite, a higher run id and no contrary start; missing data keeps every run', () => {
    expect(ciVerdict([run('CANCELLED', { runId: 1, suiteId: 11 }), run('SUCCESS', { runId: 2, suiteId: 12 })]).verdict).toBe('green');
    expect(ciVerdict([run('CANCELLED', { startedAt: T1, runId: 1, suiteId: 11 }), run('SUCCESS', { startedAt: T1, runId: 2, suiteId: 12 })]).verdict).toBe('green');
    expect(ciVerdict([run('CANCELLED', { runId: 1, suiteId: 12 }), run('SUCCESS', { runId: 2, suiteId: 11 })]).verdict).toBe('red');
    expect(ciVerdict([run('CANCELLED'), run('SUCCESS')]).verdict).toBe('red');
    expect(ciVerdict([run('CANCELLED', { runId: 1 }), run('SUCCESS', { runId: 2, suiteId: 12 })]).verdict).toBe('red');
    expect(ciVerdict([run('CANCELLED', { suiteId: 11 }), run('SUCCESS', { runId: 2, suiteId: 12 })]).verdict).toBe('red');
    expect(ciVerdict([run('CANCELLED', { runId: 1, suiteId: 11 }), run('SUCCESS', { suiteId: 12 })]).verdict).toBe('red');
    expect(ciVerdict([older('CANCELLED'), { ...newer('SUCCESS'), producer: 'actions:1:pull_request:feat:8:main' }]).verdict).toBe('red');
  });

  test('the replacing run is judged as is: a newer FAILURE stays red, a newer queued run stays pending, a latest CANCELLED stays red', () => {
    expect(ciVerdict([older('CANCELLED'), newer('FAILURE')])).toMatchObject({ verdict: 'red', failing: ['pr-lint'] });
    expect(ciVerdict([older('CANCELLED'), newer(null, 'QUEUED')])).toMatchObject({ verdict: 'pending', pending: ['pr-lint'], failing: [] });
    const queuedZeroStart = run(null, { status: 'QUEUED', startedAt: '0001-01-01T00:00:00Z', runId: 2, suiteId: 12 });
    expect(ciVerdict([older('CANCELLED'), queuedZeroStart])).toMatchObject({ verdict: 'pending', pending: ['pr-lint'], failing: [] });
    expect(ciVerdict([older('SUCCESS'), newer('CANCELLED')])).toMatchObject({ verdict: 'red', failing: ['pr-lint'] });
    expect(ciVerdict([older('CANCELLED'), newer('CANCELLED')])).toMatchObject({ verdict: 'red', failing: ['pr-lint', 'pr-lint'] });
  });

  test('an older SUCCESS never masks a newer FAILURE, CANCELLED or unfinished run', () => {
    expect(ciVerdict([older('SUCCESS'), newer('FAILURE')])).toMatchObject({ verdict: 'red', failing: ['pr-lint'] });
    expect(ciVerdict([older('SUCCESS'), newer('CANCELLED')], { requiredChecks: ['pr-lint'] }).verdict).toBe('red');
    expect(ciVerdict([older('SUCCESS'), newer(null, 'IN_PROGRESS')])).toMatchObject({ verdict: 'pending', pending: ['pr-lint'] });
    expect(ciVerdict([older('SUCCESS'), newer(null, 'QUEUED')], { requiredChecks: ['pr-lint'] }).verdict).toBe('pending');
  });

  test('distinct names are never collapsed, and a Vercel name still lands in ignored', () => {
    const other = { name: 'verify', status: 'COMPLETED', conclusion: 'CANCELLED', producer: PRODUCER, startedAt: T1, runId: 1, suiteId: 11 } as const;
    expect(ciVerdict([newer('SUCCESS'), other])).toMatchObject({ verdict: 'red', failing: ['verify'] });
    const vercel = (c: ForgeCheck['conclusion'], runId: number, suiteId: number): ForgeCheck => ({ name: 'Vercel', status: 'COMPLETED', conclusion: c, producer: PRODUCER, startedAt: T1, runId, suiteId });
    expect(ciVerdict([newer('SUCCESS'), vercel('FAILURE', 1, 11), vercel('SUCCESS', 2, 12)]).ignored).toEqual(['Vercel', 'Vercel']);
  });
});

describe('ciVerdict (ADR-050)', () => {
  test('a recorded PR-event checks snapshot is green when configured: a skipped optional check does not fail it', () => {
    expect(ciVerdict(checksFromSnapshot(fixture('pr-event-green.json')), { requiredChecks: ['Protocol Conformance'] })).toEqual({
      verdict: 'green',
      failing: [],
      pending: [],
      ignored: [],
    });
  });

  test('a failure is red even while another check runs, and Vercel never gates', () => {
    expect(ciVerdict(checksFromSnapshot(fixture('pr-event-red.json')))).toEqual({
      verdict: 'red',
      failing: ['Protocol Conformance'],
      pending: ['e2e-critical'],
      ignored: ['Vercel – invest'],
    });
  });

  test('in-progress checks or no gating checks at all are pending, never green', () => {
    expect(ciVerdict([{ name: 'verify', status: 'QUEUED', conclusion: null }]).verdict).toBe('pending');
    expect(ciVerdict([]).verdict).toBe('pending');
    expect(ciVerdict([{ name: 'Vercel', status: 'COMPLETED', conclusion: 'FAILURE' }]).verdict).toBe('pending');
  });

  test('an all-skipped set proves nothing ran, so it is pending, never green', () => {
    const skipped = (name: string) => ({ name, status: 'COMPLETED' as const, conclusion: 'SKIPPED' as const });
    expect(ciVerdict([skipped('a'), skipped('b')]).verdict).toBe('pending');
  });

  describe('requiredChecks', () => {
    const REPORT = 'ci-main / ci-report (pull_request)';
    const done = (name: string, conclusion: 'SUCCESS' | 'SKIPPED' | 'FAILURE') => ({ name, status: 'COMPLETED' as const, conclusion });
    const gatedOut = [done('ci-main / detect (pull_request)', 'SUCCESS'), done(REPORT, 'SKIPPED'), done('ci-main / test (pull_request)', 'SKIPPED')];

    test('detect passing while the rest is skipped is pending when the report check is required', () => {
      const result = ciVerdict(gatedOut, { requiredChecks: [REPORT] });
      expect(result.verdict).toBe('pending');
      expect(result.pending).toEqual([REPORT]);
    });

    test('a missing required check is pending', () => {
      expect(ciVerdict([done('detect', 'SUCCESS')], { requiredChecks: [REPORT] }).pending).toEqual([REPORT]);
    });

    test('a present, successful required check is green', () => {
      expect(ciVerdict([done('detect', 'SUCCESS'), done(REPORT, 'SUCCESS')], { requiredChecks: [REPORT] }).verdict).toBe('green');
    });

    test('a failed required check is red', () => {
      const result = ciVerdict([done('detect', 'SUCCESS'), done(REPORT, 'FAILURE')], { requiredChecks: [REPORT] });
      expect(result).toMatchObject({ verdict: 'red', failing: [REPORT] });
    });

    test('a queued required check is pending and the name match is exact', () => {
      expect(ciVerdict([done('detect', 'SUCCESS'), { name: REPORT, status: 'QUEUED', conclusion: null }], { requiredChecks: [REPORT] }).verdict).toBe('pending');
      expect(ciVerdict([done('detect', 'SUCCESS'), done('ci-report', 'SUCCESS')], { requiredChecks: [REPORT] }).verdict).toBe('pending');
    });

    test('unconfigured, the incident shape is pending, lists the skipped checks and names the missing key', () => {
      const result = ciVerdict(gatedOut);
      expect(result.verdict).toBe('pending');
      expect(result.pending).toEqual([REPORT, 'ci-main / test (pull_request)']);
      expect(result.missing_config).toBe('merge_ready.required_checks');
    });

    test('unconfigured, an ordinary pass plus a skipped optional check fails closed to pending', () => {
      const result = ciVerdict([done('Protocol Conformance', 'SUCCESS'), done('Release Notes Gate', 'SKIPPED')]);
      expect(result).toMatchObject({ verdict: 'pending', pending: ['Release Notes Gate'], missing_config: 'merge_ready.required_checks' });
    });

    test('configured, the same ordinary shape stays green and carries no missing_config', () => {
      const result = ciVerdict([done('Protocol Conformance', 'SUCCESS'), done('Release Notes Gate', 'SKIPPED')], { requiredChecks: ['Protocol Conformance'] });
      expect(result.verdict).toBe('green');
      expect(result.missing_config).toBeUndefined();
    });

    test('unconfigured with nothing skipped is green; a failure beats a skip; a skipped Vercel check is ignored', () => {
      const clean = ciVerdict([done('verify', 'SUCCESS')]);
      expect(clean.verdict).toBe('green');
      expect(clean.missing_config).toBeUndefined();
      const red = ciVerdict([done('verify', 'FAILURE'), done('Release Notes Gate', 'SKIPPED')]);
      expect(red).toMatchObject({ verdict: 'red', failing: ['verify'] });
      expect(ciVerdict([done('verify', 'SUCCESS'), done('Vercel – preview', 'SKIPPED')]).verdict).toBe('green');
    });

    test('the CLI repeats --required and exits 3 while a required check is missing', () => {
      const run = (args: string[]) => spawnSync('bun', ['run', path.join(root, 'scripts', 'ci-verdict.ts'), ...args], { encoding: 'utf-8' });
      const checks = path.join(root, 'fixtures', 'ci-verdict', 'pr-event-green.json');
      expect(run(['--checks', checks, '--required', 'Protocol Conformance']).status).toBe(0);
      const pending = run(['--checks', checks, '--required', 'Protocol Conformance', '--required', 'nope']);
      expect(pending.status).toBe(3);
      expect(JSON.parse(pending.stdout).pending).toEqual(['nope']);
    });

    test('a --required without a value is a usage error, never a skipped check', () => {
      const run = (args: string[]) => spawnSync('bun', ['run', path.join(root, 'scripts', 'ci-verdict.ts'), ...args], { encoding: 'utf-8' });
      const checks = path.join(root, 'fixtures', 'ci-verdict', 'pr-event-green.json');
      expect(run(['--checks', checks, '--required']).status).toBe(2);
      expect(run(['--required', '--checks', checks]).status).toBe(2);
      expect(run(['--checks', checks, '--required', '']).status).toBe(2);
    });
  });

  test('cancelled and action-required conclusions are red', () => {
    expect(ciVerdict([{ name: 'a', status: 'COMPLETED', conclusion: 'CANCELLED' }]).failing).toEqual(['a']);
    expect(ciVerdict([{ name: 'b', status: 'COMPLETED', conclusion: 'ACTION_REQUIRED' }]).failing).toEqual(['b']);
  });

  test('a ForgeCheck[] from the adapter goes through unchanged', () => {
    const checks = [{ name: 'verify', status: 'COMPLETED' as const, conclusion: 'SUCCESS' as const }];
    expect(checksFromSnapshot(checks)).toBe(checks);
  });

  describe('a snapshot that lists fewer runs than its total_count is pending, never green', () => {
    const greenRun = (i: number) => ({ id: i, name: `job-${i}`, status: 'completed', conclusion: 'success' });
    const thirtyGreen = Array.from({ length: 30 }, (_, i) => greenRun(i + 1));
    const BARE_TOTAL =
      'checks snapshot holds check_runs and statuses under one bare total_count: set check_runs_total_count to the check-runs total_count';
    const COMBINED_STATE = (state: string) =>
      `statuses combined state is ${state} but every listed status passes: read every status page`;

    test('30 green check runs of a total_count of 40 are pending, and the reason names the truncation', () => {
      const result = ciVerdict(checksFromSnapshot({ total_count: 40, check_runs: thirtyGreen }));
      expect(result.verdict).toBe('pending');
      expect(result.failing).toEqual([]);
      expect(result.pending).toEqual(['check_runs truncated: 30 of 40 fetched, read every page']);
    });

    test('a merged check_runs and statuses snapshot judges check_runs_total_count against the check runs, not the sum', () => {
      const statuses = Array.from({ length: 12 }, (_, i) => ({ context: `ctx-${i}`, state: 'success' }));
      const result = ciVerdict(checksFromSnapshot({ check_runs_total_count: 40, check_runs: thirtyGreen, statuses }));
      expect(result.verdict).toBe('pending');
      expect(result.pending).toEqual(['check_runs truncated: 30 of 40 fetched, read every page']);
    });

    test('a merged snapshot with a bare total_count is pending, whatever the merge order', () => {
      const statuses = [{ context: 'a', state: 'success' }, { context: 'b', state: 'success' }];
      const checkRunsPayload = { total_count: 40, check_runs: thirtyGreen };
      const statusPayload = { state: 'success', total_count: 2, statuses };
      const statusesLast = ciVerdict(checksFromSnapshot({ ...checkRunsPayload, ...statusPayload }));
      expect(statusesLast.verdict).toBe('pending');
      expect(statusesLast.pending).toEqual([BARE_TOTAL]);
      expect(ciVerdict(checksFromSnapshot({ ...statusPayload, ...checkRunsPayload })).verdict).toBe('pending');
    });

    test('the reviewed merge shape (statuses last, combined state failure) is pending, never green', () => {
      const snapshot = { ...{ total_count: 40, check_runs: thirtyGreen }, ...{ state: 'failure', total_count: 2, statuses: [{ context: 'a', state: 'success' }, { context: 'b', state: 'success' }] } };
      const result = ciVerdict(checksFromSnapshot(snapshot));
      expect(result.verdict).toBe('pending');
      expect(result.pending).toEqual([BARE_TOTAL, COMBINED_STATE('failure')]);
    });

    test('a merged snapshot whose bare total_count happens to equal its truncated check runs is pending, never green', () => {
      const thirtyStatuses = Array.from({ length: 30 }, (_, i) => ({ context: `ctx-${i}`, state: 'success' }));
      const snapshot = { ...{ total_count: 40, check_runs: thirtyGreen }, ...{ state: 'success', total_count: 30, statuses: thirtyStatuses } };
      const result = ciVerdict(checksFromSnapshot(snapshot));
      expect(result.verdict).toBe('pending');
      expect(result.pending).toEqual([BARE_TOTAL]);
    });

    test('a merged snapshot is judged against its explicit check_runs_total_count, whatever total_count says', () => {
      const statuses = Array.from({ length: 30 }, (_, i) => ({ context: `ctx-${i}`, state: 'success' }));
      const truncated = ciVerdict(checksFromSnapshot({ check_runs_total_count: 40, total_count: 30, check_runs: thirtyGreen, state: 'success', statuses }));
      expect(truncated.verdict).toBe('pending');
      expect(truncated.pending).toEqual(['check_runs truncated: 30 of 40 fetched, read every page']);
      expect(() => checksFromSnapshot({ check_runs_total_count: -1, check_runs: thirtyGreen, statuses })).toThrow('check_runs_total_count');
    });

    test('a merged snapshot whose check_runs_total_count equals its check runs is judged on its rows', () => {
      const statuses = [{ context: 'a', state: 'success' }];
      expect(ciVerdict(checksFromSnapshot({ check_runs_total_count: 30, check_runs: thirtyGreen, state: 'success', statuses })).verdict).toBe('green');
    });

    test('a combined state that is not success while every listed status passes means an unread status page', () => {
      const statuses = [{ context: 'a', state: 'success' }];
      const result = ciVerdict(checksFromSnapshot({ check_runs_total_count: 30, check_runs: thirtyGreen, state: 'failure', statuses }));
      expect(result.verdict).toBe('pending');
      expect(result.pending).toEqual([COMBINED_STATE('failure')]);
      expect(ciVerdict(checksFromSnapshot({ state: 'error', statuses })).pending).toEqual([COMBINED_STATE('error')]);
    });

    test('a combined state agrees with its listed statuses: a listed failure stays red, no statuses with state pending is no signal', () => {
      expect(ciVerdict(checksFromSnapshot({ state: 'failure', statuses: [{ context: 'a', state: 'failure' }] })).pending).toEqual([]);
      expect(ciVerdict(checksFromSnapshot({ check_runs_total_count: 30, check_runs: thirtyGreen, state: 'pending', statuses: [] })).verdict).toBe('green');
    });

    test('a required list does not let a truncated snapshot through: every required check fetched and green is still pending', () => {
      const result = ciVerdict(checksFromSnapshot({ total_count: 40, check_runs: thirtyGreen }), { requiredChecks: ['job-1', 'job-30'] });
      expect(result.verdict).toBe('pending');
      expect(result.pending).toEqual(['check_runs truncated: 30 of 40 fetched, read every page']);
    });

    test('a statuses-only snapshot judges total_count against the statuses', () => {
      const statuses = [{ context: 'ci', state: 'success' }];
      expect(ciVerdict(checksFromSnapshot({ total_count: 3, statuses })).pending).toEqual(['statuses truncated: 1 of 3 fetched, read every page']);
    });

    test('a fetched failure still makes a truncated snapshot red', () => {
      const runs = [...thirtyGreen.slice(1), { id: 99, name: 'verify', status: 'completed', conclusion: 'failure' }];
      expect(ciVerdict(checksFromSnapshot({ total_count: 40, check_runs: runs })).verdict).toBe('red');
    });

    test('a complete snapshot, or one with no total_count, is judged as before', () => {
      expect(ciVerdict(checksFromSnapshot({ total_count: 30, check_runs: thirtyGreen })).verdict).toBe('green');
      expect(ciVerdict(checksFromSnapshot({ check_runs: thirtyGreen })).verdict).toBe('green');
    });

    test('a total_count that is not a non-negative integer is rejected', () => {
      expect(() => checksFromSnapshot({ total_count: '40', check_runs: thirtyGreen })).toThrow('total_count');
    });
  });

  test('a snapshot with neither check runs nor statuses is rejected', () => {
    expect(() => checksFromSnapshot({ description: 'x' })).toThrow('neither check_runs nor statuses');
  });

  test('the CLI exits 0 on green, 1 on red and 2 on a malformed call', () => {
    const run = (args: string[]) => spawnSync('bun', ['run', path.join(root, 'scripts', 'ci-verdict.ts'), ...args], { encoding: 'utf-8' });
    const config = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'ci-verdict-')), 'config.json');
    fs.writeFileSync(config, JSON.stringify({ merge_ready: { required_checks: ['Protocol Conformance'] } }));
    const green = run(['--checks', path.join(root, 'fixtures', 'ci-verdict', 'pr-event-green.json'), '--config', config]);
    expect(green.status).toBe(0);
    expect(JSON.parse(green.stdout).verdict).toBe('green');
    expect(run(['--checks', path.join(root, 'fixtures', 'ci-verdict', 'pr-event-red.json'), '--config', config]).status).toBe(1);
    expect(run([]).status).toBe(2);
  });

  describe('required checks from config and the unconfigured pending message (#1364 incident shape)', () => {
    const REPORT = 'ci-main / ci-report (pull_request)';
    const done = (name: string, conclusion: 'SUCCESS' | 'SKIPPED') => ({ name, status: 'COMPLETED' as const, conclusion });
    const incident = [done('ci-main / detect (pull_request)', 'SUCCESS'), done(REPORT, 'SKIPPED'), done('ci-main / test (pull_request)', 'SKIPPED')];
    const cli = (args: string[]) => spawnSync('bun', ['run', path.join(root, 'scripts', 'ci-verdict.ts'), ...args], { encoding: 'utf-8' });
    const tmp = (name: string, body: unknown) => {
      const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ci-verdict-'));
      const file = path.join(dir, name);
      fs.writeFileSync(file, JSON.stringify(body));
      return file;
    };

    test('requiredChecksFromConfig reads merge_ready.required_checks and rejects a wrong type', () => {
      expect(requiredChecksFromConfig({ merge_ready: { required_checks: [REPORT] } })).toEqual([REPORT]);
      expect(requiredChecksFromConfig({})).toEqual([]);
      expect(() => requiredChecksFromConfig({ merge_ready: { required_checks: REPORT } })).toThrow('merge_ready.required_checks');
      expect(() => requiredChecksFromConfig({ merge_ready: { required_checks: [''] } })).toThrow('merge_ready.required_checks');
    });

    test('the message names the skipped checks and the missing key on the incident shape and stays silent when a list is set or nothing is skipped', () => {
      const message = unconfiguredPendingMessage(incident, {});
      expect(message).toContain(REPORT);
      expect(message).toContain('merge_ready.required_checks');
      expect(message).toContain('pending');
      expect(unconfiguredPendingMessage(incident, { requiredChecks: [REPORT] })).toBeNull();
      expect(unconfiguredPendingMessage([done('verify', 'SUCCESS')], {})).toBeNull();
    });

    test('the message names only the COMPLETED skipped checks when another gating check is still running', () => {
      const running = { name: 'build', status: 'IN_PROGRESS' as const, conclusion: null };
      const message = unconfiguredPendingMessage([running, done('docs', 'SKIPPED'), done('lint', 'SUCCESS')], {});
      expect(message).toContain('1 gating check(s) were SKIPPED: docs.');
      expect(message).not.toContain('build');
    });

    test('the superseded-run snapshot exits 0 with its runs payload and 1 without, never a false green', () => {
      const dir = path.join(root, 'fixtures', 'ci-verdict');
      const required = ['--required', 'pr-lint', '--required', 'Protocol Conformance'];
      const joined = cli(['--checks', path.join(dir, 'superseded-run.json'), '--runs', path.join(dir, 'superseded-run-runs.json'), ...required]);
      expect(joined.status).toBe(0);
      expect(JSON.parse(joined.stdout)).toMatchObject({ verdict: 'green', failing: [] });
      const unjoined = cli(['--checks', path.join(dir, 'superseded-run.json'), ...required]);
      expect(unjoined.status).toBe(1);
      expect(JSON.parse(unjoined.stdout)).toMatchObject({ verdict: 'red', failing: ['pr-lint'] });
    });

    test('a runs payload that is not {workflow_runs: []}, or a --runs without a file, is a usage error', () => {
      const checks = path.join(root, 'fixtures', 'ci-verdict', 'superseded-run.json');
      expect(cli(['--checks', checks, '--runs', tmp('runs.json', { workflow_runs: 'x' }), '--required', 'pr-lint']).status).toBe(2);
      expect(cli(['--checks', checks, '--runs', tmp('runs.json', [1]), '--required', 'pr-lint']).status).toBe(2);
      expect(cli(['--checks', checks, '--runs', '--required', 'pr-lint']).status).toBe(2);
      expect(cli(['--checks', checks, '--runs', path.join(os.tmpdir(), 'no-such-runs.json'), '--required', 'pr-lint']).status).toBe(2);
    });

    test('a configured list on the green fixture exits 0 with no missing_config', () => {
      const config = tmp('config.json', { merge_ready: { required_checks: ['Protocol Conformance'] } });
      const run = cli(['--checks', path.join(root, 'fixtures', 'ci-verdict', 'pr-event-green.json'), '--config', config]);
      expect(run.status).toBe(0);
      expect(JSON.parse(run.stdout).missing_config).toBeUndefined();
    });

    test('the CLI takes the required list from the config, so the incident is pending, and --required overrides it', () => {
      const checks = tmp('checks.json', incident);
      const config = tmp('config.json', { merge_ready: { required_checks: [REPORT] } });
      const fromConfig = cli(['--checks', checks, '--config', config]);
      expect(fromConfig.status).toBe(3);
      expect(JSON.parse(fromConfig.stdout).pending).toEqual([REPORT]);
      const overridden = cli(['--checks', checks, '--config', config, '--required', 'ci-main / detect (pull_request)']);
      expect(overridden.status).toBe(0);
    });

    test('an unconfigured incident exits 3 with a pending verdict naming the key; a malformed config is a usage error', () => {
      const checks = tmp('checks.json', incident);
      const none = cli(['--checks', checks, '--config', path.join(os.tmpdir(), 'no-such-config.json')]);
      expect(none.status).toBe(3);
      const out = JSON.parse(none.stdout);
      expect(out).toMatchObject({ verdict: 'pending', missing_config: 'merge_ready.required_checks' });
      expect(out.pending).toEqual([REPORT, 'ci-main / test (pull_request)']);
      expect(none.stderr).toContain('merge_ready.required_checks');
      expect(none.stderr).toContain(REPORT);
      expect(cli(['--checks', checks, '--config', tmp('bad.json', { merge_ready: { required_checks: 'x' } })]).status).toBe(2);
    });
  });
});
