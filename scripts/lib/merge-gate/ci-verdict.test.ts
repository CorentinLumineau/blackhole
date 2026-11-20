import { describe, expect, test } from 'bun:test';
import { spawnSync } from 'child_process';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { root } from '../build/paths.ts';
import { readJsonFile } from '../fs.ts';
import type { ForgeCheck } from '../forge-adapter/types.ts';
import { checksFromSnapshot, ciVerdict, requiredChecksFromConfig, unconfiguredPendingMessage } from './ci-verdict.ts';

const fixture = (name: string) => {
  const file = path.join(root, 'fixtures', 'ci-verdict', name);
  return readJsonFile(file, file);
};

describe('ciVerdict judges only the latest run per check name', () => {
  const run = (conclusion: ForgeCheck['conclusion'], rest: Partial<ForgeCheck> = {}): ForgeCheck =>
    ({ name: 'pr-lint', status: 'COMPLETED', conclusion, ...rest });
  const T1 = '2026-11-20T11:29:49Z';
  const T2 = '2026-11-20T11:45:34Z';
  const older = (c: ForgeCheck['conclusion']) => run(c, { startedAt: T1, runId: 1 });
  const newer = (c: ForgeCheck['conclusion'], status: ForgeCheck['status'] = 'COMPLETED') =>
    run(c, { startedAt: T2, runId: 2, status });

  test('the PR #1384 snapshot (older CANCELLED, newer SUCCESS, skipped gate) is green once required checks are configured', () => {
    const checks = checksFromSnapshot(fixture('superseded-run.json'));
    expect(ciVerdict(checks, { requiredChecks: ['Protocol Conformance', 'pr-lint'] })).toEqual({
      verdict: 'green',
      failing: [],
      pending: [],
      ignored: [],
    });
  });

  test('a superseded CANCELLED run is not failing, whatever the array order or the required list', () => {
    expect(ciVerdict([older('CANCELLED'), newer('SUCCESS')]).verdict).toBe('green');
    expect(ciVerdict([newer('SUCCESS'), older('CANCELLED')]).verdict).toBe('green');
    expect(ciVerdict([older('CANCELLED'), newer('SUCCESS')], { requiredChecks: ['pr-lint'] }).verdict).toBe('green');
    expect(ciVerdict([older('FAILURE'), newer('SUCCESS')], { requiredChecks: ['pr-lint'] }).failing).toEqual([]);
  });

  test('same-second starts are ordered by run id', () => {
    const a = run('CANCELLED', { startedAt: T1, runId: 10 });
    const b = run('SUCCESS', { startedAt: T1, runId: 11 });
    expect(ciVerdict([a, b]).verdict).toBe('green');
    expect(ciVerdict([b, a]).verdict).toBe('green');
    expect(ciVerdict([run('SUCCESS', { startedAt: T1, runId: 10 }), run('CANCELLED', { startedAt: T1, runId: 11 })]).verdict).toBe('red');
  });

  test('without startedAt on every run, run ids alone order the name', () => {
    expect(ciVerdict([run('CANCELLED', { runId: 1 }), run('SUCCESS', { runId: 2 })]).verdict).toBe('green');
    expect(ciVerdict([run('SUCCESS', { runId: 1 }), run('CANCELLED', { runId: 2 })]).verdict).toBe('red');
  });

  test('an older SUCCESS never masks a newer FAILURE or CANCELLED', () => {
    expect(ciVerdict([older('SUCCESS'), newer('FAILURE')])).toMatchObject({ verdict: 'red', failing: ['pr-lint'] });
    expect(ciVerdict([newer('CANCELLED'), older('SUCCESS')])).toMatchObject({ verdict: 'red', failing: ['pr-lint'] });
    expect(ciVerdict([older('SUCCESS'), newer('CANCELLED')], { requiredChecks: ['pr-lint'] }).verdict).toBe('red');
  });

  test('an older SUCCESS never masks a newer run that is still going', () => {
    expect(ciVerdict([older('SUCCESS'), newer(null, 'IN_PROGRESS')])).toMatchObject({ verdict: 'pending', pending: ['pr-lint'] });
    expect(ciVerdict([older('SUCCESS'), newer(null, 'QUEUED')], { requiredChecks: ['pr-lint'] }).verdict).toBe('pending');
  });

  test('an older SUCCESS never masks a newer SKIPPED: an unconfigured repo stays pending, a required name stays pending', () => {
    const checks = [older('SUCCESS'), newer('SKIPPED')];
    expect(ciVerdict(checks)).toMatchObject({ verdict: 'pending', missing_config: 'merge_ready.required_checks' });
    expect(ciVerdict(checks, { requiredChecks: ['pr-lint'] })).toMatchObject({ verdict: 'pending', pending: ['pr-lint'] });
  });

  test('the unconfigured warning follows the latest run: a superseded SKIPPED is not named', () => {
    const superseded = [older('SKIPPED'), newer('SUCCESS')];
    expect(unconfiguredPendingMessage(superseded, {})).toBeNull();
    const live = [older('SUCCESS'), newer('SKIPPED')];
    expect(unconfiguredPendingMessage(live, {})).toContain('1 gating check(s) were SKIPPED: pr-lint');
  });

  test('a name with no ordering data keeps every run, so a non-passing one stays red', () => {
    expect(ciVerdict([run('CANCELLED'), run('SUCCESS')]).verdict).toBe('red');
    expect(ciVerdict([run('CANCELLED', { startedAt: T1 }), run('SUCCESS', { startedAt: T1 })]).verdict).toBe('red');
    expect(ciVerdict([run('CANCELLED'), run('SUCCESS', { startedAt: T2, runId: 2 })]).verdict).toBe('red');
    expect(ciVerdict([run('CANCELLED', { startedAt: 'not a date', runId: 1 }), run('SUCCESS', { startedAt: T2 })]).verdict).toBe('red');
  });

  test('distinct names are never collapsed, and a Vercel name still lands in ignored', () => {
    const other = { name: 'verify', status: 'COMPLETED', conclusion: 'FAILURE', startedAt: T1, runId: 1 } as const;
    expect(ciVerdict([newer('SUCCESS'), other])).toMatchObject({ verdict: 'red', failing: ['verify'] });
    const vercel = (c: ForgeCheck['conclusion'], startedAt: string): ForgeCheck => ({ name: 'Vercel', status: 'COMPLETED', conclusion: c, startedAt, runId: 1 });
    expect(ciVerdict([newer('SUCCESS'), vercel('FAILURE', T1), vercel('SUCCESS', T2)]).ignored).toEqual(['Vercel']);
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

    test('the superseded-run snapshot exits 0 once required checks are configured', () => {
      const run = cli(['--checks', path.join(root, 'fixtures', 'ci-verdict', 'superseded-run.json'), '--required', 'pr-lint', '--required', 'Protocol Conformance']);
      expect(run.status).toBe(0);
      expect(JSON.parse(run.stdout)).toMatchObject({ verdict: 'green', failing: [] });
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
