import { describe, expect, test } from 'bun:test';
import {
  classifyTrunkRed,
  failingPaths,
  fingerprintLog,
  normalizeRepoPath,
  pathsInLog,
  TRUNK_RED_MIN_PRS,
  type TrunkRedPr,
} from './trunk-red.ts';

const fail = (check: string, fingerprint: string, failingPaths?: string[]) => ({
  check,
  fingerprint,
  failingPaths,
});

const pr = (n: number, failingChecks: TrunkRedPr['failingChecks'], touchedFiles: string[] = ['src/a.ts']): TrunkRedPr => ({
  pr: n,
  failingChecks,
  touchedFiles,
});

describe('classifyTrunkRed', () => {
  test('threshold is two PRs', () => {
    expect(TRUNK_RED_MIN_PRS).toBe(2);
  });

  test('same check and fingerprint on two PRs with untouched failing path is trunk-red', () => {
    const result = classifyTrunkRed([
      pr(1, [fail('lint', 'fp-1', ['docs/x.md'])]),
      pr(2, [fail('lint', 'fp-1', ['docs/x.md'])], ['src/b.ts']),
    ]);
    expect(result.classification).toBe('trunk-red');
    expect(result.groups).toEqual([{ check: 'lint', fingerprint: 'fp-1', prs: [1, 2] }]);
  });

  test('a single failing PR is not trunk-red', () => {
    const result = classifyTrunkRed([pr(1, [fail('lint', 'fp-1')]), pr(2, [])]);
    expect(result.classification).toBe('per-pr');
    expect(result.groups).toEqual([]);
  });

  test('same check with different fingerprints is not trunk-red', () => {
    const result = classifyTrunkRed([pr(1, [fail('lint', 'fp-1')]), pr(2, [fail('lint', 'fp-2')])]);
    expect(result.classification).toBe('per-pr');
  });

  test('same fingerprint under different checks is not trunk-red', () => {
    const result = classifyTrunkRed([pr(1, [fail('lint', 'fp-1')]), pr(2, [fail('test', 'fp-1')])]);
    expect(result.classification).toBe('per-pr');
  });

  test('a failing path inside a PR diff excludes that PR, dropping the group below threshold', () => {
    const result = classifyTrunkRed([
      pr(1, [fail('lint', 'fp-1', ['src/a.ts'])], ['src/a.ts']),
      pr(2, [fail('lint', 'fp-1', ['src/a.ts'])], ['src/b.ts']),
    ]);
    expect(result.classification).toBe('per-pr');
  });

  test('three PRs, one of which owns the failing path, still trunk-red with the other two', () => {
    const result = classifyTrunkRed([
      pr(1, [fail('lint', 'fp-1', ['src/a.ts'])], ['src/a.ts']),
      pr(2, [fail('lint', 'fp-1', ['src/a.ts'])], ['src/b.ts']),
      pr(3, [fail('lint', 'fp-1', ['src/a.ts'])], ['src/c.ts']),
    ]);
    expect(result.classification).toBe('trunk-red');
    expect(result.groups[0].prs).toEqual([2, 3]);
  });

  test('one PR reporting the same failure twice is still a single PR', () => {
    const result = classifyTrunkRed([pr(1, [fail('lint', 'fp-1'), fail('lint', 'fp-1')])]);
    expect(result.classification).toBe('per-pr');
  });

  test('the same PR appearing twice in the input array counts once', () => {
    const result = classifyTrunkRed([pr(1, [fail('lint', 'fp-1')]), pr(1, [fail('lint', 'fp-1')])]);
    expect(result.classification).toBe('per-pr');
  });

  test('empty or blank fingerprints never classify trunk-red', () => {
    const result = classifyTrunkRed([pr(1, [fail('lint', '')]), pr(2, [fail('lint', '')]), pr(3, [fail('lint', '  ')])]);
    expect(result.classification).toBe('per-pr');
    expect(result.groups).toEqual([]);
  });

  test.each([
    ['absolute runner path', '/home/runner/work/blackhole/blackhole/src/a.ts', 'src/a.ts'],
    ['dot-slash path', './src/a.ts', 'src/a.ts'],
    ['root-level file', 'package.json', 'package.json'],
    ['dot-slash root-level file', './package.json', 'package.json'],
  ])('the PR owning the file is excluded: %s', (_n, failing, touched) => {
    const result = classifyTrunkRed([
      pr(1, [fail('lint', 'fp-1', [failing])], [touched]),
      pr(2, [fail('lint', 'fp-1', [failing])], ['src/other.ts']),
    ]);
    expect(result.classification).toBe('per-pr');
  });

  test('touchedFiles are normalised too', () => {
    const result = classifyTrunkRed([
      pr(1, [fail('lint', 'fp-1', ['src/a.ts'])], ['./src/a.ts']),
      pr(2, [fail('lint', 'fp-1', ['src/a.ts'])], ['src/other.ts']),
    ]);
    expect(result.classification).toBe('per-pr');
  });

  test('empty input is per-pr', () => {
    expect(classifyTrunkRed([]).classification).toBe('per-pr');
  });
});

describe('normalizeRepoPath', () => {
  test('strips ./, GitHub runner workspace prefixes and leaves repo-relative paths alone', () => {
    expect(normalizeRepoPath('./a/b.ts')).toBe('a/b.ts');
    expect(normalizeRepoPath('/home/runner/work/blackhole/blackhole/a/b.ts')).toBe('a/b.ts');
    expect(normalizeRepoPath('/Users/runner/work/r/r/package.json')).toBe('package.json');
    expect(normalizeRepoPath('/github/workspace/a.ts')).toBe('a.ts');
    expect(normalizeRepoPath('a/b.ts')).toBe('a/b.ts');
  });

  test('strips a self-hosted runner _work/<repo>/<repo>/ checkout prefix', () => {
    expect(normalizeRepoPath('/Users/someone/actions-runner/_work/blackhole/blackhole/src/a.ts')).toBe('src/a.ts');
    expect(normalizeRepoPath('/opt/runners/r1/_work/repo/repo/package.json')).toBe('package.json');
  });

  test('a self-hosted absolute failing path still excludes the PR that owns it', () => {
    const failing = '/Users/someone/actions-runner/_work/blackhole/blackhole/src/a.ts';
    const result = classifyTrunkRed([
      pr(1, [fail('lint', 'fp-1', [failing])], ['src/a.ts']),
      pr(2, [fail('lint', 'fp-1', [failing])], ['src/other.ts']),
    ]);
    expect(result.classification).toBe('per-pr');
  });
});

describe('fingerprintLog / pathsInLog', () => {
  test('an empty or blank log yields no fingerprint', () => {
    expect(fingerprintLog('')).toBe('');
    expect(fingerprintLog('  \n\t\n')).toBe('');
  });

  test('a log of only generic wrapper lines yields no fingerprint', () => {
    expect(fingerprintLog('error: script "test" exited with code 1\n##[error]Process completed with exit code 1.')).toBe('');
  });

  test('generic wrapper lines are skipped in favour of the real failure line', () => {
    const wrapped = 'error: script "test" exited with code 1\nerror: boom A\n##[error]Process completed with exit code 1.';
    expect(fingerprintLog(wrapped)).toBe(fingerprintLog('error: boom A'));
    expect(fingerprintLog(wrapped)).not.toBe(fingerprintLog('error: boom B'));
  });

  test('failingPaths reads only the window around the fingerprint line', () => {
    const lines = ['src/early.ts passed', ...Array(10).fill('ok'), 'error: boom at src/hit.ts:3:1', 'ok', ...Array(10).fill('ok'), 'src/late.ts done'];
    expect(failingPaths(lines.join('\n'))).toEqual(['src/hit.ts']);
  });

  test('pathsInLog normalises absolute, ./, root-level and trailing-punctuation paths', () => {
    const log = [
      '/home/runner/work/blackhole/blackhole/src/a.ts:1:1 error',
      'see ./src/b.ts, and package.json:1 (src/c.ts).',
    ].join('\n');
    expect(pathsInLog(log)).toEqual(['src/a.ts', 'src/b.ts', 'package.json', 'src/c.ts']);
  });

  test('fingerprint ignores digits, hashes and timestamps so one failure matches across PRs', () => {
    const a = 'error TS2322 at 2026-01-01T10:00:00Z run 123: Type X is not assignable (abc1234)';
    const b = 'error TS2322 at 2026-02-02T11:11:11Z run 456: Type X is not assignable (def5678)';
    expect(fingerprintLog(a)).toBe(fingerprintLog(b));
  });

  test('different errors fingerprint differently', () => {
    expect(fingerprintLog('error: boom A')).not.toBe(fingerprintLog('error: boom B'));
  });

  test('pathsInLog and failingPaths extract bracket-bounded paths', () => {
    expect(pathsInLog('##[error]src/b.ts(1,2): boom\nsee [src/c.ts]')).toEqual(['src/b.ts', 'src/c.ts']);
    expect(failingPaths('##[error]src/b.ts(1,2): error TS1')).toEqual(['src/b.ts']);
  });

  test.each([
    ['ungrouped Run line', 'Run bun test --fail-fast\n'],
    ['grouped echoed script and env', '##[group]Run bun test --fail-fast\nbun test --fail-fast\nshell: /usr/bin/bash -e {0}\nenv:\n  FAIL_FAST: 1\n##[endgroup]\n'],
  ])('an echoed preamble does not mask the real failure line: %s', (_n, preamble) => {
    const a = `${preamble}FAIL src/a.test.ts`;
    const b = `${preamble}FAIL src/b.test.ts`;
    expect(fingerprintLog(a)).not.toBe('');
    expect(fingerprintLog(a)).not.toBe(fingerprintLog(b));
    expect(fingerprintLog(a)).toBe(fingerprintLog('FAIL src/a.test.ts'));
    expect(failingPaths(a)).toEqual(['src/a.test.ts']);
  });

  test('an indented failure line after an ungrouped Run line is not skipped as an echoed setting', () => {
    const a = 'Run bun test\n  ● adds A';
    expect(fingerprintLog(a)).not.toBe('');
    expect(fingerprintLog(a)).not.toBe(fingerprintLog('Run bun test\n  ● adds B'));
  });

  test('ISO timestamp and BOM prefixes are stripped before matching', () => {
    const ts = (l: string) => `2026-08-12T10:00:03.1234567Z ${l}`;
    const log = (f: string) =>
      '\uFEFF' + [ts('##[group]Run bun test --fail-fast'), ts('bun test --fail-fast'), ts('##[endgroup]'), ts(`FAIL ${f}`)].join('\n');
    expect(fingerprintLog(log('src/a.test.ts'))).toBe(fingerprintLog('FAIL src/a.test.ts'));
    expect(fingerprintLog(log('src/a.test.ts'))).not.toBe(fingerprintLog(log('src/b.test.ts')));
    expect(failingPaths(log('src/a.test.ts'))).toEqual(['src/a.test.ts']);
  });

  test('pathsInLog extracts repo-relative file paths from error lines', () => {
    expect(pathsInLog('src/foo/bar.ts:12:3 error TS1\nok\nscripts/x.test.ts(4,1): fail')).toEqual([
      'src/foo/bar.ts',
      'scripts/x.test.ts',
    ]);
  });
});
