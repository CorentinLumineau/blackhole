import { afterEach, describe, expect, test } from 'bun:test';
import fs from 'node:fs';
import path from 'node:path';
import { makeTempDir } from './fs.ts';
import type { OpenPrSnapshot, SnapshotPr } from './open-pr-snapshot.ts';
import {
  chainDepth,
  chainTip,
  mergeTreeVerdict,
  pickParent,
  reachesNode,
  effectiveParent,
  verifiedPrMergeTree,
  STACK_DEPTH_CAP,
  type ConflictVerdict,
} from './stack-overlap.ts';

const spr = (number: number, files: string[] | null, extra: Partial<SnapshotPr> = {}): SnapshotPr => ({
  number,
  headRefName: `feat-${number}`,
  headSha: `sha${number}`,
  baseRefName: 'main',
  isFork: false,
  draft: false,
  createdAt: null,
  files,
  ...extra,
});

const snapshot = (...prs: SnapshotPr[]): OpenPrSnapshot => ({ status: 'ok', prs, filesSource: 'refs' });

const always =
  (v: ConflictVerdict) =>
  (): ConflictVerdict =>
    v;

describe('pickParent', () => {
  test('a non-queue open PR touching the same file is picked as parent', () => {
    const snap = snapshot(spr(7, ['CLAUDE.md']), spr(9, ['CLAUDE.md', 'x.ts']));
    expect(pickParent(9, snap, { conflicts: always('conflict') })).toEqual({
      kind: 'stack',
      parent: 7,
      parentBranch: 'feat-7',
      alsoOverlaps: [],
      depth: 2,
    });
  });

  test('a fork-head PR is never picked and is reported unstackable: fork', () => {
    const snap = snapshot(spr(7, ['a.ts'], { isFork: true }), spr(9, ['a.ts']));
    expect(pickParent(9, snap, { conflicts: always('conflict') })).toEqual({
      kind: 'unstackable',
      reason: 'fork',
      parent: 7,
    });
  });

  test('two overlapping chains: the tip of the lowest-numbered root is picked, the other is reported', () => {
    const snap = snapshot(
      spr(10, ['a.ts']),
      spr(12, ['a.ts'], { baseRefName: 'feat-10' }),
      spr(11, ['a.ts']),
      spr(20, ['a.ts']),
    );
    expect(pickParent(20, snap, { conflicts: always('conflict') })).toEqual({
      kind: 'stack',
      parent: 12,
      parentBranch: 'feat-12',
      alsoOverlaps: [11],
      depth: 3,
    });
  });

  test('a candidate whose base chain reaches the child is refused as a cycle', () => {
    const snap = snapshot(spr(5, ['a.ts']), spr(6, ['a.ts'], { baseRefName: 'feat-5' }));
    expect(pickParent(5, snap, { conflicts: always('conflict') })).toEqual({ kind: 'none' });
  });

  test('a corrupt base cycle in the data does not hang and is reported unknown', () => {
    const snap = snapshot(
      spr(1, ['a.ts'], { baseRefName: 'feat-2' }),
      spr(2, ['a.ts'], { baseRefName: 'feat-1' }),
      spr(3, ['a.ts']),
    );
    expect(pickParent(3, snap, { conflicts: always('conflict') })).toMatchObject({ kind: 'unknown', reason: expect.stringContaining('cycle') });
  });

  test('with D1(b), a file overlap whose merge-tree is clean yields no parent', () => {
    const snap = snapshot(spr(7, ['documentation/INDEX.md']), spr(9, ['documentation/INDEX.md']));
    expect(pickParent(9, snap, { conflicts: always('clean') })).toEqual({ kind: 'none' });
  });

  test('the merge-tree decider runs only for file-overlapping pairs', () => {
    const asked: Array<[number, number]> = [];
    const snap = snapshot(spr(7, ['a.ts']), spr(8, ['b.ts']), spr(9, ['a.ts']));
    pickParent(9, snap, {
      conflicts: (me, other) => {
        asked.push([me.number, other.number]);
        return 'conflict';
      },
    });
    expect(asked).toEqual([[9, 7]]);
  });

  test('an undecidable merge-tree is unknown, never none', () => {
    const snap = snapshot(spr(7, ['a.ts']), spr(9, ['a.ts']));
    expect(pickParent(9, snap, { conflicts: always('unknown') })).toMatchObject({ kind: 'unknown' });
  });

  test('an unknown snapshot is unknown, never none', () => {
    expect(pickParent(9, { status: 'unknown', reason: 'rate limited' }, { conflicts: always('conflict') })).toEqual({
      kind: 'unknown',
      reason: 'rate limited',
    });
  });

  test('a PR missing from the snapshot is unknown', () => {
    expect(pickParent(9, snapshot(spr(7, ['a.ts'])), { conflicts: always('conflict') })).toMatchObject({ kind: 'unknown' });
  });

  test('a PR with unreadable files makes a no-overlap answer unknown, but not a found parent', () => {
    const noOverlap = snapshot(spr(7, null), spr(9, ['a.ts']));
    expect(pickParent(9, noOverlap, { conflicts: always('conflict') })).toMatchObject({ kind: 'unknown' });
    const found = snapshot(spr(7, null), spr(8, ['a.ts']), spr(9, ['a.ts']));
    expect(pickParent(9, found, { conflicts: always('conflict') })).toMatchObject({ kind: 'stack', parent: 8 });
  });

  test('my own files being unreadable is unknown', () => {
    expect(pickParent(9, snapshot(spr(7, ['a.ts']), spr(9, null)), { conflicts: always('conflict') })).toMatchObject({
      kind: 'unknown',
    });
  });

  test('a PR already stacked on the overlapping PR needs nothing', () => {
    const snap = snapshot(spr(10, ['a.ts']), spr(11, ['a.ts'], { baseRefName: 'feat-10' }));
    expect(pickParent(11, snap, { conflicts: always('conflict') })).toEqual({ kind: 'none' });
  });

  test('stacked on a non-tip of a chain that has since grown, the tip is picked', () => {
    const snap = snapshot(
      spr(10, ['a.ts']),
      spr(11, ['a.ts'], { baseRefName: 'feat-10' }),
      spr(12, ['a.ts'], { baseRefName: 'feat-10' }),
    );
    expect(pickParent(12, snap, { conflicts: always('conflict') })).toMatchObject({ kind: 'stack', parent: 11 });
  });

  test('a chain already at the depth cap defers the next PR', () => {
    const chain = [
      spr(1, ['a.ts']),
      spr(2, ['a.ts'], { baseRefName: 'feat-1' }),
      spr(3, ['a.ts'], { baseRefName: 'feat-2' }),
      spr(4, ['a.ts'], { baseRefName: 'feat-3' }),
    ];
    expect(STACK_DEPTH_CAP).toBe(4);
    expect(pickParent(9, snapshot(...chain, spr(9, ['a.ts'])), { conflicts: always('conflict') })).toEqual({
      kind: 'defer',
      reason: 'depth',
      parent: 4,
    });
    expect(pickParent(9, snapshot(...chain.slice(0, 3), spr(9, ['a.ts'])), { conflicts: always('conflict') })).toMatchObject({
      kind: 'stack',
      parent: 3,
      depth: 4,
    });
  });

  test('a draft PR is a valid parent', () => {
    const snap = snapshot(spr(7, ['a.ts'], { draft: true }), spr(9, ['a.ts']));
    expect(pickParent(9, snap, { conflicts: always('conflict') })).toMatchObject({ kind: 'stack', parent: 7 });
  });
});

describe('graph helpers', () => {
  const parents: Record<number, number | null> = { 1: null, 2: 1, 3: 2, 4: 1 };
  const graph = { nodes: () => [1, 2, 3, 4], has: (n: number) => n in parents, parentOf: (n: number) => parents[n] ?? null };

  test('reachesNode follows parent edges and stops on a loop', () => {
    expect(reachesNode(graph, 3, 1)).toBe(true);
    expect(reachesNode(graph, 1, 3)).toBe(false);
    const loop = { nodes: () => [1, 2], has: () => true, parentOf: (n: number) => (n === 1 ? 2 : 1) };
    expect(reachesNode(loop, 1, 9)).toBe(false);
  });

  test('chainTip is the deepest descendant, lowest number breaking ties', () => {
    expect(chainTip(graph, 1)).toBe(3);
  });

  test('chainDepth counts the node itself', () => {
    expect(chainDepth(graph, 1)).toBe(1);
    expect(chainDepth(graph, 3)).toBe(3);
  });
});

describe('mergeTreeVerdict (real git)', () => {
  const dirs: string[] = [];
  afterEach(() => {
    for (const d of dirs.splice(0)) fs.rmSync(d, { recursive: true, force: true });
  });
  const git = (cwd: string, ...args: string[]): string => {
    const r = Bun.spawnSync(
      ['git', '-c', 'user.name=t', '-c', 'user.email=t@t', '-c', 'commit.gpgsign=false', ...args],
      { cwd, stdout: 'pipe', stderr: 'pipe' },
    );
    return r.stdout.toString().trim();
  };
  const runner = (cwd: string) => (args: string[]) => {
    const r = Bun.spawnSync(['git', ...args], { cwd, stdout: 'pipe', stderr: 'pipe' });
    return { code: r.exitCode, stdout: r.stdout.toString(), stderr: r.stderr.toString() };
  };

  test('reports conflict for overlapping edits, clean for disjoint ones, and unknown for a bad rev', () => {
    const repo = makeTempDir('merge-tree-verdict');
    dirs.push(repo);
    git(repo, 'init', '-q', '-b', 'main');
    fs.writeFileSync(path.join(repo, 'shared.txt'), 'one\ntwo\nthree\n');
    fs.writeFileSync(path.join(repo, 'other.txt'), 'o\n');
    git(repo, 'add', '.');
    git(repo, 'commit', '-q', '-m', 'base');
    git(repo, 'checkout', '-q', '-b', 'a');
    fs.writeFileSync(path.join(repo, 'shared.txt'), 'one\nA\nthree\n');
    git(repo, 'commit', '-q', '-am', 'a');
    git(repo, 'checkout', '-q', '-b', 'b', 'main');
    fs.writeFileSync(path.join(repo, 'shared.txt'), 'one\nB\nthree\n');
    git(repo, 'commit', '-q', '-am', 'b');
    git(repo, 'checkout', '-q', '-b', 'c', 'main');
    fs.writeFileSync(path.join(repo, 'other.txt'), 'changed\n');
    git(repo, 'commit', '-q', '-am', 'c');

    const run = runner(repo);
    expect(mergeTreeVerdict(run, 'a', 'b')).toBe('conflict');
    expect(mergeTreeVerdict(run, 'a', 'c')).toBe('clean');
    expect(mergeTreeVerdict(run, 'a', 'no-such-rev')).toBe('unknown');
  });
});

describe('verifiedPrMergeTree (real git)', () => {
  const dirs: string[] = [];
  afterEach(() => {
    for (const d of dirs.splice(0)) fs.rmSync(d, { recursive: true, force: true });
  });
  const git = (cwd: string, ...args: string[]): string => {
    const r = Bun.spawnSync(['git', '-c', 'user.name=t', '-c', 'user.email=t@t', '-c', 'commit.gpgsign=false', ...args], {
      cwd,
      stdout: 'pipe',
      stderr: 'pipe',
    });
    return r.stdout.toString().trim();
  };
  const runner = (cwd: string) => (args: string[]) => {
    const r = Bun.spawnSync(['git', ...args], { cwd, stdout: 'pipe', stderr: 'pipe' });
    return { code: r.exitCode, stdout: r.stdout.toString(), stderr: r.stderr.toString() };
  };

  test('reads the merge-tree only when both PR refs equal the snapshot heads', () => {
    const repo = makeTempDir('verified-merge-tree');
    dirs.push(repo);
    git(repo, 'init', '-q', '-b', 'main');
    fs.writeFileSync(path.join(repo, 'f.txt'), 'one\n');
    git(repo, 'add', '.');
    git(repo, 'commit', '-q', '-m', 'base');
    const oldHead = git(repo, 'rev-parse', 'HEAD');
    fs.writeFileSync(path.join(repo, 'f.txt'), 'two\n');
    git(repo, 'commit', '-q', '-am', 'next');
    const newHead = git(repo, 'rev-parse', 'HEAD');
    git(repo, 'update-ref', 'refs/blackhole/pr/1', newHead);
    git(repo, 'update-ref', 'refs/blackhole/pr/2', newHead);
    const run = runner(repo);
    const pfx = 'refs/blackhole/pr/';

    expect(verifiedPrMergeTree(run, pfx, { number: 1, headSha: newHead }, { number: 2, headSha: newHead })).toBe('clean');
    // The snapshot moved on (a fix-round push) but the ref fetch failed: the stale ref must not certify anything.
    expect(verifiedPrMergeTree(run, pfx, { number: 1, headSha: 'f'.repeat(40) }, { number: 2, headSha: newHead })).toBe('unknown');
    git(repo, 'update-ref', 'refs/blackhole/pr/2', oldHead);
    expect(verifiedPrMergeTree(run, pfx, { number: 1, headSha: newHead }, { number: 2, headSha: newHead })).toBe('unknown');
    expect(verifiedPrMergeTree(run, pfx, { number: 1, headSha: newHead }, { number: 9, headSha: newHead })).toBe('unknown');
  });
});

describe('effectiveParent', () => {
  const issues = { '7': { pr: 70 }, '9': { pr: 90, stacked_on_pr: 70 }, '8': { pr: 80, stacked_on: 7, stacked_on_pr: 99 }, '5': { pr: 50, stacked_on_pr: 1234 } };
  test('prefers stacked_on, falls back to the issue owning stacked_on_pr, else null', () => {
    expect(effectiveParent(issues, issues['9'])).toBe(7);
    expect(effectiveParent(issues, issues['8'])).toBe(7);
    expect(effectiveParent(issues, issues['5'])).toBeNull();
    expect(effectiveParent(issues, issues['7'])).toBeNull();
  });
});
