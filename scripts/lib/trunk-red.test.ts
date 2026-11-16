import { describe, expect, test } from 'bun:test';
import {
  classifyTrunkRed,
  fingerprintLog,
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

  test('the same PR listed twice counts once', () => {
    const result = classifyTrunkRed([pr(1, [fail('lint', 'fp-1'), fail('lint', 'fp-1')])]);
    expect(result.classification).toBe('per-pr');
  });

  test('empty input is per-pr', () => {
    expect(classifyTrunkRed([]).classification).toBe('per-pr');
  });
});

describe('fingerprintLog / pathsInLog', () => {
  test('fingerprint ignores digits, hashes and timestamps so one failure matches across PRs', () => {
    const a = 'error TS2322 at 2026-01-01T10:00:00Z run 123: Type X is not assignable (abc1234)';
    const b = 'error TS2322 at 2026-02-02T11:11:11Z run 456: Type X is not assignable (def5678)';
    expect(fingerprintLog(a)).toBe(fingerprintLog(b));
  });

  test('different errors fingerprint differently', () => {
    expect(fingerprintLog('error: boom A')).not.toBe(fingerprintLog('error: boom B'));
  });

  test('pathsInLog extracts repo-relative file paths from error lines', () => {
    expect(pathsInLog('src/foo/bar.ts:12:3 error TS1\nok\nscripts/x.test.ts(4,1): fail')).toEqual([
      'src/foo/bar.ts',
      'scripts/x.test.ts',
    ]);
  });
});
