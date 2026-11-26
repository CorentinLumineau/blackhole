import { describe, expect, test } from 'bun:test';
import {
  decideCut,
  evaluateFreshness,
  nextCutVersion,
  parseFirstParentLog,
  type PendingCommit,
} from './release-policy.ts';

const NOW = new Date('2026-11-26T12:00:00Z');
const HOURS = 3_600_000;
const ago = (h: number): string => new Date(NOW.getTime() - h * HOURS).toISOString();

function rec(sha: string, at: string, subject: string, body: string, paths: string[]): string {
  return `\x1e${sha}\x1f${at}\x1f${subject}\x1f${body}\x1f\n\n${paths.join('\n')}\n`;
}

function commit(n: number, over: Partial<PendingCommit> = {}): PendingCommit {
  return {
    sha: `sha${n}`.padEnd(40, '0'),
    committedAt: ago(1),
    subject: `fix(x): change ${n} (#${n})`,
    body: '',
    paths: ['skills/blackhole/SKILL.md'],
    prNumber: n,
    isReleaseCommit: false,
    immediate: false,
    touchesShipped: true,
    ...over,
  };
}

const batchOf = (count: number, over: Partial<PendingCommit> = {}): PendingCommit[] =>
  Array.from({ length: count }, (_, i) => commit(i + 1, over));

describe('parseFirstParentLog', () => {
  test('reads sha, PR number, shipped flag and paths from one record', () => {
    const [c] = parseFirstParentLog(rec('a'.repeat(40), ago(2), 'feat(x): add y (#12)', '', ['skills/a.md', 'docs/b.md']));
    expect(c.sha).toBe('a'.repeat(40));
    expect(c.prNumber).toBe(12);
    expect(c.touchesShipped).toBe(true);
    expect(c.paths).toEqual(['skills/a.md', 'docs/b.md']);
    expect(c.immediate).toBe(false);
  });

  test('uses the last PR reference and none for a direct commit', () => {
    const [a, b] = parseFirstParentLog(
      rec('a'.repeat(40), ago(1), 'fix: revert (#3) again (#9)', '', ['src/x.ts']) +
        rec('b'.repeat(40), ago(1), 'docs: direct edit', '', ['README.md']),
    );
    expect(a.prNumber).toBe(9);
    expect(b.prNumber).toBeNull();
    expect(a.touchesShipped).toBe(false);
  });

  test('marks the release commit and recognises each immediate trigger', () => {
    const log =
      rec('1'.repeat(40), ago(1), 'chore(release): prepare v0.37.0 [skip release]', '', ['package.json']) +
      rec('2'.repeat(40), ago(1), 'docs: note (#2)', 'Release: immediate', ['README.md']) +
      rec('3'.repeat(40), ago(1), 'fix(security): close hole (#3)', '', ['scripts/a.ts']) +
      rec('4'.repeat(40), ago(1), 'fix(hooks): guard (#4)', '', ['scripts/a.ts']) +
      rec('5'.repeat(40), ago(1), 'refactor(x): tidy (#5)', '', ['templates/hooks/pretooluse/a.ts']) +
      rec('6'.repeat(40), ago(1), 'feat(hooks): plain (#6)', '', ['scripts/a.ts']);
    const flags = parseFirstParentLog(log).map((c) => [c.isReleaseCommit, c.immediate]);
    expect(flags).toEqual([
      [true, false],
      [false, true],
      [false, true],
      [false, true],
      [false, true],
      [false, false],
    ]);
  });

  test('returns an empty list for empty output', () => {
    expect(parseFirstParentLog('')).toEqual([]);
  });
});

describe('decideCut', () => {
  const lastTagAt = new Date(NOW.getTime() - 48 * HOURS);

  test('nothing pending is none', () => {
    expect(decideCut({ commits: [], now: NOW, lastTagAt })).toMatchObject({ class: 'none', cut: false });
  });

  test('a batch with no shipped path never cuts, whatever its size', () => {
    const d = decideCut({ commits: batchOf(30, { touchesShipped: false }), now: NOW, lastTagAt });
    expect(d).toMatchObject({ class: 'none', cut: false, reason: 'no shipped path changed' });
  });

  test('the batch class cuts at the threshold and not one PR below', () => {
    expect(decideCut({ commits: batchOf(10), now: NOW, lastTagAt })).toMatchObject({ class: 'batch', cut: true, pending: 10 });
    expect(decideCut({ commits: batchOf(9), now: NOW, lastTagAt })).toMatchObject({ class: 'none', cut: false, pending: 9 });
  });

  test('the age flush cuts one old PR, and waits when the oldest is young', () => {
    const old = [commit(1, { committedAt: ago(25) })];
    expect(decideCut({ commits: old, now: NOW, lastTagAt })).toMatchObject({ class: 'age', cut: true });
    expect(decideCut({ commits: [commit(1, { committedAt: ago(23) })], now: NOW, lastTagAt })).toMatchObject({ class: 'none', cut: false });
  });

  test('the cooldown holds batch and age but not immediate', () => {
    const recent = new Date(NOW.getTime() - 2 * HOURS);
    expect(decideCut({ commits: batchOf(10), now: NOW, lastTagAt: recent })).toMatchObject({ class: 'cooldown', cut: false });
    expect(decideCut({ commits: [commit(1, { committedAt: ago(30) })], now: NOW, lastTagAt: recent })).toMatchObject({ class: 'cooldown', cut: false });
    expect(decideCut({ commits: [commit(1, { immediate: true })], now: NOW, lastTagAt: recent })).toMatchObject({ class: 'immediate', cut: true });
  });

  test('an immediate commit that main CI has not verified does not cut at once', () => {
    const commits = [commit(1, { immediate: true })];
    expect(decideCut({ commits, now: NOW, lastTagAt, isVerified: () => false })).toMatchObject({ class: 'none', cut: false });
    expect(decideCut({ commits, now: NOW, lastTagAt, isVerified: (s) => s === commits[0].sha })).toMatchObject({ class: 'immediate', cut: true });
  });

  test('force cuts any pending work; release commits alone are not pending', () => {
    expect(decideCut({ commits: batchOf(1), now: NOW, lastTagAt, force: true })).toMatchObject({ class: 'force', cut: true });
    const release = [commit(0, { isReleaseCommit: true, prNumber: null })];
    expect(decideCut({ commits: release, now: NOW, lastTagAt, force: true })).toMatchObject({ class: 'none', cut: false });
  });

  test('a direct commit to a shipped path is relevant but is not counted as a PR', () => {
    const direct = commit(1, { prNumber: null, committedAt: ago(40) });
    expect(decideCut({ commits: [direct], now: NOW, lastTagAt })).toMatchObject({ class: 'none', cut: false, pending: 0 });
  });
});

describe('evaluateFreshness', () => {
  const run = (conclusion: string | null, headSha: string, status = 'completed') => ({ status, conclusion, headSha });

  test('a green run that is an ancestor of the tip is fresh', () => {
    expect(evaluateFreshness([run('success', 'v1')], (s) => s === 'v1')).toMatchObject({ ok: true, sha: 'v1' });
  });

  test('a newer red run blocks even when an older run is green', () => {
    const f = evaluateFreshness([run('failure', 'v2'), run('success', 'v1')], () => true);
    expect(f).toMatchObject({ ok: false, sha: 'v2' });
  });

  test('cancelled, skipped and in-progress runs are ignored', () => {
    const runs = [run(null, 'v4', 'in_progress'), run('cancelled', 'v3'), run('skipped', 'v2'), run('success', 'v1')];
    expect(evaluateFreshness(runs, () => true)).toMatchObject({ ok: true, sha: 'v1' });
  });

  test('a green run off the tip history is not fresh, and no run is not fresh', () => {
    expect(evaluateFreshness([run('success', 'v1')], () => false).ok).toBe(false);
    expect(evaluateFreshness([], () => true)).toMatchObject({ ok: false, sha: null });
  });
});

describe('nextCutVersion', () => {
  test('classifies feat as minor and fix as patch', () => {
    expect(nextCutVersion('0.36.0', '0.36.0', [commit(1, { subject: 'feat(a): b (#1)' })])).toEqual({ bump: 'minor', version: '0.37.0' });
    expect(nextCutVersion('0.36.0', '0.36.0', [commit(1)])).toEqual({ bump: 'patch', version: '0.36.1' });
  });

  test('a breaking change bumps minor while the major version is 0', () => {
    const breaking = [commit(1, { subject: 'feat(a)!: b (#1)' })];
    expect(nextCutVersion('0.36.0', '0.36.0', breaking)).toEqual({ bump: 'minor', version: '0.37.0' });
  });

  test('a breaking change bumps major from 1.x on', () => {
    const breaking = [commit(1, { subject: 'fix: b (#1)', body: 'BREAKING CHANGE: gone' })];
    expect(nextCutVersion('1.4.2', '1.4.2', breaking)).toEqual({ bump: 'major', version: '2.0.0' });
  });

  test('the cut never goes below a hand-bumped manifest, and ignores release commits', () => {
    const commits = [commit(1), commit(0, { isReleaseCommit: true, prNumber: null, subject: 'feat: release [skip release]' })];
    expect(nextCutVersion('0.36.0', '0.36.6', commits).version).toBe('0.36.6');
  });
});
