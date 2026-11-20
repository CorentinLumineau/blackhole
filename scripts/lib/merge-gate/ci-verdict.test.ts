import { describe, expect, test } from 'bun:test';
import { spawnSync } from 'child_process';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { root } from '../build/paths.ts';
import { readJsonFile } from '../fs.ts';
import { checksFromSnapshot, ciVerdict, requiredChecksFromConfig, unconfiguredSkipWarning } from './ci-verdict.ts';

const fixture = (name: string) => {
  const file = path.join(root, 'fixtures', 'ci-verdict', name);
  return readJsonFile(file, file);
};

describe('ciVerdict (ADR-050)', () => {
  test('a recorded PR-event checks snapshot is green: a skipped check does not fail it', () => {
    expect(ciVerdict(checksFromSnapshot(fixture('pr-event-green.json')))).toEqual({
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

    test('without requiredChecks only the all-skipped rule changes the old behaviour', () => {
      expect(ciVerdict([done('detect', 'SUCCESS'), done(REPORT, 'SKIPPED')]).verdict).toBe('green');
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
    const green = run(['--checks', path.join(root, 'fixtures', 'ci-verdict', 'pr-event-green.json')]);
    expect(green.status).toBe(0);
    expect(JSON.parse(green.stdout).verdict).toBe('green');
    expect(run(['--checks', path.join(root, 'fixtures', 'ci-verdict', 'pr-event-red.json')]).status).toBe(1);
    expect(run([]).status).toBe(2);
  });

  describe('required checks from config and the unconfigured warning (#1364 incident shape)', () => {
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

    test('the warning names the skipped checks on the incident shape and stays silent when a required list is set or nothing is skipped', () => {
      expect(unconfiguredSkipWarning(incident, {})).toContain(REPORT);
      expect(unconfiguredSkipWarning(incident, { requiredChecks: [REPORT] })).toBeNull();
      expect(unconfiguredSkipWarning([done('verify', 'SUCCESS')], {})).toBeNull();
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

    test('an unconfigured incident shape warns loudly on stderr; a malformed config is a usage error', () => {
      const checks = tmp('checks.json', incident);
      const none = cli(['--checks', checks, '--config', path.join(os.tmpdir(), 'no-such-config.json')]);
      expect(none.stderr).toContain('no required checks configured');
      expect(none.stderr).toContain(REPORT);
      expect(cli(['--checks', checks, '--config', tmp('bad.json', { merge_ready: { required_checks: 'x' } })]).status).toBe(2);
    });
  });
});
