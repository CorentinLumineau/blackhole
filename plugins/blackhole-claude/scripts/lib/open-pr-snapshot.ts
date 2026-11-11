import { spawnSync } from 'child_process';
import fs from 'node:fs';
import path from 'node:path';
import type { ForgeAdapter, ForgePr } from './forge-adapter/types.ts';

// One bounded read of every open PR in the target repo, shared by all campaign PRs in a turn
// (stack overlap, ADR-051). Files come from one `git fetch` of the open PRs' `refs/pull/N/head`;
// REST `prFiles` with a head-sha cache is the fallback. A snapshot that could not be read in full
// is `unknown`, never an empty list: "I could not look" must not certify "nothing overlaps".

/** Open PRs above this count make the snapshot unknown; 1000 is the 10-page budget at 100 a page. */
export const MAX_OPEN_PRS = 1000;

export const PR_REF_PREFIX = 'refs/blackhole/pr/';
const ORIGIN_REF_PREFIX = 'refs/remotes/origin/';

export type SnapshotPr = {
  number: number;
  headRefName: string;
  headSha: string;
  baseRefName: string;
  /** A fork head can never be a base branch. */
  isFork: boolean;
  draft: boolean;
  createdAt: string | null;
  /** Paths the PR changes against its own base; null when they could not be read (unknown, not empty). */
  files: string[] | null;
};

export type OpenPrSnapshot =
  | { status: 'ok'; prs: SnapshotPr[]; filesSource: 'refs' | 'rest' | 'mixed' }
  | { status: 'unknown'; reason: string };

export type GitResult = { code: number; stdout: string; stderr: string };

export type PrFilesCache = {
  version: 1;
  entries: Record<string, { headSha: string; baseRefName: string; files: string[] }>;
};

export type SnapshotIo = {
  /** Open PRs, at most `limit` rows. One call, however many pages the forge needs. */
  listOpenPrs(limit: number): Promise<ForgePr[]>;
  prFiles(pr: number): Promise<string[]>;
  git(args: string[]): GitResult;
  readCache(): PrFilesCache | null;
  writeCache(cache: PrFilesCache): void;
};

const prRef = (n: number): string => `${PR_REF_PREFIX}${n}`;

const toSnapshotPr = (pr: ForgePr): SnapshotPr | string => {
  if (!pr.headRefOid) return `PR #${pr.number} has no head sha`;
  if (!pr.baseRefName) return `PR #${pr.number} has no base branch`;
  if (typeof pr.headRepoIsFork !== 'boolean') return `PR #${pr.number} does not say whether its head is a fork`;
  return {
    number: pr.number,
    headRefName: pr.headRefName,
    headSha: pr.headRefOid,
    baseRefName: pr.baseRefName,
    isFork: pr.headRepoIsFork,
    draft: pr.draft === true,
    createdAt: pr.createdAt ?? null,
    files: null,
  };
};

/** Revision a PR's base resolves to locally: the fetched ref of the open PR it is stacked on, else origin's branch. */
const baseRevOf = (pr: SnapshotPr, byHeadBranch: Map<string, SnapshotPr>): string => {
  const parent = byHeadBranch.get(pr.baseRefName);
  return parent ? prRef(parent.number) : `${ORIGIN_REF_PREFIX}${pr.baseRefName}`;
};

const filesFromRefs = (io: SnapshotIo, pr: SnapshotPr, byHeadBranch: Map<string, SnapshotPr>): string[] | null => {
  const mergeBase = io.git(['merge-base', baseRevOf(pr, byHeadBranch), prRef(pr.number)]);
  const base = mergeBase.stdout.trim();
  if (mergeBase.code !== 0 || !base) return null;
  // --no-renames lists both sides of a rename, as the REST path does.
  const diff = io.git(['diff', '--name-only', '--no-renames', base, prRef(pr.number)]);
  if (diff.code !== 0) return null;
  return diff.stdout.split('\n').filter(Boolean);
};

const fetchOpenPrRefs = (io: SnapshotIo, prs: SnapshotPr[], byHeadBranch: Map<string, SnapshotPr>): boolean => {
  if (prs.length === 0) return true;
  const refspecs = prs.map((p) => `+refs/pull/${p.number}/head:${prRef(p.number)}`);
  const bases = new Set(prs.filter((p) => !byHeadBranch.has(p.baseRefName)).map((p) => p.baseRefName));
  for (const b of [...bases].sort()) refspecs.push(`+refs/heads/${b}:${ORIGIN_REF_PREFIX}${b}`);
  return io.git(['fetch', '--no-tags', '--quiet', 'origin', ...refspecs]).code === 0;
};

export const buildOpenPrSnapshot = async (io: SnapshotIo): Promise<OpenPrSnapshot> => {
  let rows: ForgePr[];
  try {
    rows = await io.listOpenPrs(MAX_OPEN_PRS + 1);
  } catch (err) {
    return { status: 'unknown', reason: `open PR list failed: ${(err as Error).message}` };
  }
  if (rows.length > MAX_OPEN_PRS) {
    return { status: 'unknown', reason: `more than ${MAX_OPEN_PRS} open PRs; the snapshot is bounded` };
  }
  const prs: SnapshotPr[] = [];
  for (const row of rows) {
    const mapped = toSnapshotPr(row);
    if (typeof mapped === 'string') return { status: 'unknown', reason: mapped };
    prs.push(mapped);
  }

  // A fork's head branch name is its own: it can never be the base another PR targets.
  const byHeadBranch = new Map(prs.filter((p) => !p.isFork).map((p) => [p.headRefName, p]));
  const fetched = fetchOpenPrRefs(io, prs, byHeadBranch);
  const cache = io.readCache();
  const next: PrFilesCache = { version: 1, entries: {} };
  let viaRefs = 0;
  let viaRest = 0;

  for (const pr of prs) {
    const local = fetched ? filesFromRefs(io, pr, byHeadBranch) : null;
    if (local) {
      pr.files = local;
      viaRefs++;
    } else {
      const hit = cache?.entries[String(pr.number)];
      if (hit && hit.headSha === pr.headSha && hit.baseRefName === pr.baseRefName) {
        pr.files = hit.files;
      } else {
        try {
          pr.files = await io.prFiles(pr.number);
        } catch {
          pr.files = null;
        }
      }
      viaRest++;
    }
    if (pr.files) next.entries[String(pr.number)] = { headSha: pr.headSha, baseRefName: pr.baseRefName, files: pr.files };
  }

  if (viaRest > 0) io.writeCache(next);
  return { status: 'ok', prs, filesSource: viaRest === 0 ? 'refs' : viaRefs === 0 ? 'rest' : 'mixed' };
};

/** The cache is orchestrator-written under `.blackhole/` (gitignored); a missing or corrupt file reads as no cache. */
export const fsPrFilesCacheIo = (file: string): Pick<SnapshotIo, 'readCache' | 'writeCache'> => ({
  readCache: () => {
    try {
      const parsed = JSON.parse(fs.readFileSync(file, 'utf8')) as PrFilesCache;
      return parsed.version === 1 && parsed.entries && typeof parsed.entries === 'object' ? parsed : null;
    } catch {
      return null;
    }
  },
  writeCache: (cache) => {
    fs.mkdirSync(path.dirname(file), { recursive: true });
    const tmp = `${file}.tmp`;
    fs.writeFileSync(tmp, JSON.stringify(cache));
    fs.renameSync(tmp, file);
  },
});

/** Binds the snapshot to a forge adapter, a git checkout and the cache file. */
export const adapterSnapshotIo = (adapter: ForgeAdapter, repoRoot: string, cacheFile: string): SnapshotIo => ({
  listOpenPrs: (limit) => adapter.prList({ state: 'open', limit }),
  prFiles: (n) => adapter.prFiles(n),
  git: (args) => {
    const r = spawnSync('git', args, { cwd: repoRoot, encoding: 'utf-8' });
    return { code: r.status ?? 1, stdout: r.stdout ?? '', stderr: r.stderr ?? '' };
  },
  ...fsPrFilesCacheIo(cacheFile),
});
