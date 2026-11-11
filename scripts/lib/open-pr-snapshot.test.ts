import { afterEach, describe, expect, test } from 'bun:test';
import fs from 'node:fs';
import path from 'node:path';
import type { ForgePr } from './forge-adapter/types.ts';
import { makeTempDir } from './fs.ts';
import {
  buildOpenPrSnapshot,
  fsPrFilesCacheIo,
  MAX_OPEN_PRS,
  type GitResult,
  type PrFilesCache,
  type SnapshotIo,
} from './open-pr-snapshot.ts';

const pr = (number: number, extra: Partial<ForgePr> = {}): ForgePr => ({
  number,
  title: `p${number}`,
  body: '',
  headRefName: `feat-${number}`,
  headRefOid: `sha${number}`,
  baseRefName: 'main',
  headRepoIsFork: false,
  draft: false,
  createdAt: '2026-11-01T00:00:00Z',
  state: 'OPEN',
  mergedAt: null,
  ...extra,
});

type Harness = {
  io: SnapshotIo;
  gitCalls: string[][];
  prFilesCalls: number[];
  listCalls: number[];
  written: PrFilesCache[];
};

// The injected runner: every forge call and every git call is recorded, so a test can count them.
const harness = (opts: {
  prs: ForgePr[];
  files: Record<number, string[]>;
  fetchCode?: number;
  cache?: PrFilesCache | null;
  listThrows?: boolean;
  prFilesThrows?: number[];
}): Harness => {
  const gitCalls: string[][] = [];
  const prFilesCalls: number[] = [];
  const listCalls: number[] = [];
  const written: PrFilesCache[] = [];
  const git = (args: string[]): GitResult => {
    gitCalls.push(args);
    if (args[0] === 'fetch') return { code: opts.fetchCode ?? 0, stdout: '', stderr: 'fetch failed' };
    if (args[0] === 'merge-base') return { code: 0, stdout: `mb:${args[2]}\n`, stderr: '' };
    if (args[0] === 'diff') {
      const ref = args[args.length - 1];
      const n = Number(ref.split('/').pop());
      return { code: 0, stdout: (opts.files[n] ?? []).join('\n') + '\n', stderr: '' };
    }
    return { code: 1, stdout: '', stderr: 'unexpected git call' };
  };
  const io: SnapshotIo = {
    listOpenPrs: async (limit) => {
      listCalls.push(limit);
      if (opts.listThrows) throw new Error('rate limited');
      return opts.prs;
    },
    prFiles: async (n) => {
      prFilesCalls.push(n);
      if (opts.prFilesThrows?.includes(n)) throw new Error('boom');
      return opts.files[n] ?? [];
    },
    git,
    readCache: () => opts.cache ?? null,
    writeCache: (c) => {
      written.push(c);
    },
  };
  return { io, gitCalls, prFilesCalls, listCalls, written };
};

describe('buildOpenPrSnapshot, refs path', () => {
  test('one git fetch for the whole open set and no per-PR API call', async () => {
    const prs = Array.from({ length: 250 }, (_, i) => pr(i + 1));
    const files = Object.fromEntries(prs.map((p) => [p.number, [`src/f${p.number}.ts`]]));
    const h = harness({ prs, files });
    const snap = await buildOpenPrSnapshot(h.io);
    expect(snap.status).toBe('ok');
    if (snap.status !== 'ok') return;
    expect(snap.prs).toHaveLength(250);
    expect(snap.prs[0]).toMatchObject({ number: 1, headSha: 'sha1', files: ['src/f1.ts'], isFork: false });
    expect(h.gitCalls.filter((c) => c[0] === 'fetch')).toHaveLength(1);
    expect(h.prFilesCalls).toEqual([]);
    expect(snap.filesSource).toBe('refs');
  });

  test('the single fetch carries one refspec per open PR and no wildcard', async () => {
    const h = harness({ prs: [pr(1), pr(2)], files: {} });
    await buildOpenPrSnapshot(h.io);
    const fetch = h.gitCalls.find((c) => c[0] === 'fetch')!;
    expect(fetch).toContain('+refs/pull/1/head:refs/blackhole/pr/1');
    expect(fetch).toContain('+refs/pull/2/head:refs/blackhole/pr/2');
    expect(fetch.some((a) => a.includes('refs/pull/*'))).toBe(false);
  });

  test('a PR stacked on another open PR is diffed against that PR, not against the default branch', async () => {
    const prs = [pr(1), pr(2, { baseRefName: 'feat-1' })];
    const h = harness({ prs, files: { 1: ['a.ts'], 2: ['b.ts'] } });
    await buildOpenPrSnapshot(h.io);
    const mergeBase2 = h.gitCalls.find((c) => c[0] === 'merge-base' && c[2] === 'refs/blackhole/pr/2')!;
    expect(mergeBase2[1]).toBe('refs/blackhole/pr/1');
    const mergeBase1 = h.gitCalls.find((c) => c[0] === 'merge-base' && c[2] === 'refs/blackhole/pr/1')!;
    expect(mergeBase1[1]).toBe('refs/remotes/origin/main');
  });

  test('a fork head branch is never taken as the base of another PR', async () => {
    const prs = [pr(1, { headRefName: 'main', headRepoIsFork: true }), pr(2)];
    const h = harness({ prs, files: {} });
    await buildOpenPrSnapshot(h.io);
    const mergeBase2 = h.gitCalls.find((c) => c[0] === 'merge-base' && c[2] === 'refs/blackhole/pr/2')!;
    expect(mergeBase2[1]).toBe('refs/remotes/origin/main');
  });
});

describe('buildOpenPrSnapshot, unknown is never empty', () => {
  test('more than 1000 open PRs returns unknown', async () => {
    const prs = Array.from({ length: MAX_OPEN_PRS + 1 }, (_, i) => pr(i + 1));
    const h = harness({ prs, files: {} });
    const snap = await buildOpenPrSnapshot(h.io);
    expect(snap.status).toBe('unknown');
    expect(h.listCalls).toEqual([MAX_OPEN_PRS + 1]);
  });

  test('a failed list call returns unknown, never an empty snapshot', async () => {
    const h = harness({ prs: [], files: {}, listThrows: true });
    const snap = await buildOpenPrSnapshot(h.io);
    expect(snap).toEqual({ status: 'unknown', reason: 'open PR list failed: rate limited' });
  });

  test('a row without a head sha, base ref or fork flag returns unknown', async () => {
    for (const bad of [{ headRefOid: undefined }, { baseRefName: undefined }, { headRepoIsFork: undefined }]) {
      const h = harness({ prs: [pr(1, bad as Partial<ForgePr>)], files: {} });
      expect((await buildOpenPrSnapshot(h.io)).status).toBe('unknown');
    }
  });

  test('an empty open list is a real, empty snapshot', async () => {
    const h = harness({ prs: [], files: {} });
    expect(await buildOpenPrSnapshot(h.io)).toMatchObject({ status: 'ok', prs: [] });
  });
});

describe('buildOpenPrSnapshot, REST fallback', () => {
  const cacheOf = (entries: PrFilesCache['entries']): PrFilesCache => ({ version: 1, entries });

  test('only PRs whose head sha changed against the cache are re-read', async () => {
    const prs = [pr(1), pr(2, { headRefOid: 'sha2-new' }), pr(3)];
    const cache = cacheOf({
      '1': { headSha: 'sha1', baseRefName: 'main', files: ['cached1.ts'] },
      '2': { headSha: 'sha2-old', baseRefName: 'main', files: ['stale.ts'] },
    });
    const h = harness({ prs, files: { 2: ['fresh2.ts'], 3: ['fresh3.ts'] }, fetchCode: 1, cache });
    const snap = await buildOpenPrSnapshot(h.io);
    expect(h.prFilesCalls.sort()).toEqual([2, 3]);
    if (snap.status !== 'ok') throw new Error('expected ok');
    expect(snap.prs.map((p) => p.files)).toEqual([['cached1.ts'], ['fresh2.ts'], ['fresh3.ts']]);
    expect(snap.filesSource).toBe('rest');
  });

  test('a changed base ref also invalidates the cached entry', async () => {
    const cache = cacheOf({ '1': { headSha: 'sha1', baseRefName: 'old-base', files: ['x.ts'] } });
    const h = harness({ prs: [pr(1)], files: { 1: ['y.ts'] }, fetchCode: 1, cache });
    await buildOpenPrSnapshot(h.io);
    expect(h.prFilesCalls).toEqual([1]);
  });

  test('the refreshed cache is written back, keyed by head sha, and drops closed PRs', async () => {
    const cache = cacheOf({ '99': { headSha: 'gone', baseRefName: 'main', files: ['z.ts'] } });
    const h = harness({ prs: [pr(1)], files: { 1: ['a.ts'] }, fetchCode: 1, cache });
    await buildOpenPrSnapshot(h.io);
    expect(h.written).toEqual([cacheOf({ '1': { headSha: 'sha1', baseRefName: 'main', files: ['a.ts'] } })]);
  });

  test('a PR whose files cannot be read has null files, and the snapshot stays ok', async () => {
    const h = harness({ prs: [pr(1), pr(2)], files: { 2: ['b.ts'] }, fetchCode: 1, prFilesThrows: [1] });
    const snap = await buildOpenPrSnapshot(h.io);
    if (snap.status !== 'ok') throw new Error('expected ok');
    expect(snap.prs.map((p) => p.files)).toEqual([null, ['b.ts']]);
  });

  test('a PR whose local diff fails falls back to REST for that PR alone', async () => {
    const h = harness({ prs: [pr(1), pr(2)], files: { 1: ['a.ts'], 2: ['b.ts'] } });
    const realGit = h.io.git;
    h.io.git = (args) =>
      args[0] === 'merge-base' && args[2] === 'refs/blackhole/pr/2' ? { code: 1, stdout: '', stderr: 'no merge base' } : realGit(args);
    const snap = await buildOpenPrSnapshot(h.io);
    expect(h.prFilesCalls).toEqual([2]);
    if (snap.status !== 'ok') throw new Error('expected ok');
    expect(snap.prs.map((p) => p.files)).toEqual([['a.ts'], ['b.ts']]);
    expect(snap.filesSource).toBe('mixed');
  });
});

describe('fsPrFilesCacheIo', () => {
  const dirs: string[] = [];
  afterEach(() => {
    for (const d of dirs.splice(0)) fs.rmSync(d, { recursive: true, force: true });
  });

  test('reads null for a missing or corrupt file and round-trips a written cache', () => {
    const dir = makeTempDir('pr-files-cache');
    dirs.push(dir);
    const file = path.join(dir, '.blackhole', 'pr-files-cache.json');
    const io = fsPrFilesCacheIo(file);
    expect(io.readCache()).toBeNull();
    const cache: PrFilesCache = { version: 1, entries: { '1': { headSha: 's', baseRefName: 'main', files: ['a'] } } };
    io.writeCache(cache);
    expect(io.readCache()).toEqual(cache);
    fs.writeFileSync(file, '{not json');
    expect(io.readCache()).toBeNull();
  });
});
