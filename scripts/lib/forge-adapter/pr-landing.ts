import { runGhApiRestJson } from './cli.ts';
import { runTeaApiJson } from './tea-cli.ts';
import type { ForgeType } from './types.ts';

export type PrLandingState = 'open' | 'merged' | 'closed-unmerged';

export type PrLanding = { state: PrLandingState; mergedAt: string | null; mergeCommitSha: string | null };

type PrRow = {
  state?: string;
  merged?: boolean;
  merged_at?: string | null;
  merge_commit_sha?: string | null;
  head?: { sha?: string | null } | null;
};

/**
 * Landing of a PR from its REST row. The forge's merged flag (GitHub `merged`, Gitea `merged_at`)
 * is the only evidence: a squash or rebase landing is never an ancestor of the base, so history
 * cannot answer this. A row with no `state` is unreadable (null), never "open".
 */
export const prLandingFromRow = (row: PrRow | null | undefined): PrLanding | null => {
  if (row === null || row === undefined || typeof row.state !== 'string') return null;
  const mergedAt = row.merged_at ?? null;
  const mergeCommitSha = row.merge_commit_sha ?? null;
  if (row.merged === true || mergedAt !== null) return { state: 'merged', mergedAt, mergeCommitSha };
  if (row.state === 'open') return { state: 'open', mergedAt: null, mergeCommitSha: null };
  if (row.state !== 'closed') return null;
  return { state: 'closed-unmerged', mergedAt: null, mergeCommitSha: null };
};

export type PrRowFetcher = (forge: ForgeType, repo: string, pr: number) => PrRow | null;

const defaultFetch = (forge: ForgeType, repo: string, pr: number): PrRow | null => {
  if (forge === 'github') return runGhApiRestJson<PrRow>('GET', `repos/${repo}/pulls/${pr}`);
  if (forge === 'gitea') return runTeaApiJson<PrRow>('GET', `repos/${repo.split('/').slice(-2).join('/')}/pulls/${pr}`).data;
  return null;
};

/** The landing of `pr`, read through the forge's REST channel. Null when the read fails or the forge has no reader. */
export const readPrLanding = (
  forge: ForgeType,
  repo: string,
  pr: number,
  fetchRow: PrRowFetcher = defaultFetch,
): PrLanding | null => {
  if (forge !== 'github' && forge !== 'gitea') return null;
  try {
    return prLandingFromRow(fetchRow(forge, repo, pr));
  } catch {
    return null;
  }
};

/**
 * Head commit of `pr` as the forge reports it. A merged PR keeps this value after its branch is
 * deleted, and `refs/pull/<pr>/head` still resolves it, which is how a stacked child recovers a
 * parent tip that was never captured. Null when the read fails or the row carries no 40-hex sha.
 */
export const readPrHeadSha = (
  forge: ForgeType,
  repo: string,
  pr: number,
  fetchRow: PrRowFetcher = defaultFetch,
): string | null => {
  if (forge !== 'github' && forge !== 'gitea') return null;
  try {
    const sha = fetchRow(forge, repo, pr)?.head?.sha;
    return typeof sha === 'string' && /^[0-9a-f]{40}$/.test(sha) ? sha : null;
  } catch {
    return null;
  }
};
