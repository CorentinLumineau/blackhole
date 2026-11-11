import { isNotFound, runGhApi, runGhApiRestJson } from './cli.ts';
import type { ForgeCheck, ForgeIssue, ForgePr, IssueListFilter, PrChangeBaseResult } from './types.ts';

// GitHub REST rows and their mapping to the forge types (ADR-048). Pure mappers are exported so
// any channel that already holds REST-shaped JSON (an MCP tool result saved to a file, a fixture)
// maps through the same code as a live `gh api` call.

export type RestIssueRow = {
  number: number;
  title: string;
  body: string | null;
  labels: Array<{ name: string } | string>;
  milestone: { title: string } | null;
  state: string;
  closed_at?: string | null;
  pull_request?: unknown;
};

export type RestPrRow = {
  number: number;
  title: string;
  body: string | null;
  head: { ref: string; sha: string; repo?: { full_name: string } | null };
  base?: { ref: string; repo?: { full_name: string } | null };
  draft?: boolean;
  created_at?: string | null;
  state: string;
  merged_at: string | null;
};

export type RestPrFile = { filename: string; previous_filename?: string };

export type RestCheckRun = { name: string; status: string; conclusion: string | null };
export type RestStatus = { context: string; state: string };

const PAGE_SIZE = 100;

export const mapRestIssue = (row: RestIssueRow): ForgeIssue => ({
  number: row.number,
  title: row.title,
  body: row.body ?? '',
  labels: row.labels.map((l) => ({ name: typeof l === 'string' ? l : l.name })),
  milestone: row.milestone ? { title: row.milestone.title } : null,
  state: row.state.toLowerCase() === 'closed' ? 'CLOSED' : 'OPEN',
});

/** A deleted fork reads as `head.repo: null`; it is a fork all the same. Unknown without a base repo. */
const isForkHead = (row: RestPrRow): boolean | undefined => {
  const baseRepo = row.base?.repo?.full_name;
  if (!baseRepo || row.head.repo === undefined) return undefined;
  return row.head.repo === null || row.head.repo.full_name !== baseRepo;
};

export const mapRestPr = (row: RestPrRow): ForgePr => ({
  number: row.number,
  title: row.title,
  body: row.body ?? '',
  headRefName: row.head.ref,
  headRefOid: row.head.sha,
  baseRefName: row.base?.ref,
  headRepoIsFork: isForkHead(row),
  draft: row.draft,
  createdAt: row.created_at,
  state: row.merged_at ? 'MERGED' : row.state.toLowerCase() === 'closed' ? 'CLOSED' : 'OPEN',
  mergedAt: row.merged_at,
});

export const mapRestCheckRun = (row: RestCheckRun): ForgeCheck => ({
  name: row.name,
  status: row.status === 'in_progress' ? 'IN_PROGRESS' : row.status === 'completed' ? 'COMPLETED' : 'QUEUED',
  conclusion: row.conclusion ? (row.conclusion.toUpperCase() as ForgeCheck['conclusion']) : null,
});

/** Legacy commit statuses, which `gh pr checks` also lists next to check runs. */
export const mapRestStatus = (row: RestStatus): ForgeCheck => {
  if (row.state === 'pending') return { name: row.context, status: 'QUEUED', conclusion: null };
  return { name: row.context, status: 'COMPLETED', conclusion: row.state === 'success' ? 'SUCCESS' : 'FAILURE' };
};

const query = (params: Record<string, string | number | undefined>): string =>
  Object.entries(params)
    .filter(([, v]) => v !== undefined && v !== '')
    .map(([k, v]) => `${k}=${encodeURIComponent(String(v))}`)
    .join('&');

/** Reads pages until `limit` rows are kept or a short page ends the list. */
const listPaged = <Row, Out>(
  endpoint: string,
  params: Record<string, string | number | undefined>,
  limit: number,
  keep: (row: Row) => Out | null,
): Out[] => {
  const out: Out[] = [];
  for (let page = 1; out.length < limit; page++) {
    const rows = runGhApiRestJson<Row[]>('GET', `${endpoint}?${query({ ...params, per_page: PAGE_SIZE, page })}`);
    for (const row of rows) {
      const kept = keep(row);
      if (kept !== null && out.length < limit) out.push(kept);
    }
    if (rows.length < PAGE_SIZE) break;
  }
  return out;
};

/** The issues endpoint also returns pull requests; they are dropped. Milestone is matched by title. */
export const listIssues = (repo: string, filter: IssueListFilter = {}): ForgeIssue[] =>
  listPaged<RestIssueRow, ForgeIssue>(
    `repos/${repo}/issues`,
    { state: filter.state ?? 'open', labels: filter.labels?.join(',') },
    filter.limit ?? 200,
    (row) => {
      if (row.pull_request) return null;
      if (filter.milestone && row.milestone?.title !== filter.milestone) return null;
      return mapRestIssue(row);
    },
  );

export const viewIssue = (repo: string, number: number): RestIssueRow =>
  runGhApiRestJson<RestIssueRow>('GET', `repos/${repo}/issues/${number}`);

export const listPrs = (repo: string, state: 'open' | 'closed' | 'all' = 'open', limit = 100): ForgePr[] =>
  listPaged<RestPrRow, ForgePr>(`repos/${repo}/pulls`, { state }, limit, mapRestPr);

export const viewPr = (repo: string, number: number): ForgePr =>
  mapRestPr(runGhApiRestJson<RestPrRow>('GET', `repos/${repo}/pulls/${number}`));

/** GitHub lists at most 3000 files of a PR; a list that reaches the cap may be truncated. */
const PR_FILES_MAX_PAGES = 30;

export const listPrFiles = (repo: string, number: number): string[] => {
  const files: string[] = [];
  for (let page = 1; page <= PR_FILES_MAX_PAGES; page++) {
    const rows = runGhApiRestJson<RestPrFile[]>(
      'GET',
      `repos/${repo}/pulls/${number}/files?${query({ per_page: PAGE_SIZE, page })}`,
    );
    for (const row of rows) {
      files.push(row.filename);
      if (row.previous_filename) files.push(row.previous_filename);
    }
    if (rows.length < PAGE_SIZE) return files;
  }
  throw new Error(`PR #${number} lists ${PR_FILES_MAX_PAGES * PAGE_SIZE} files, the REST cap; its file list may be truncated`);
};

export const changePrBase = (repo: string, number: number, base: string): PrChangeBaseResult => {
  runGhApiRestJson('PATCH', `repos/${repo}/pulls/${number}`, { base });
  const actual = viewPr(repo, number).baseRefName ?? null;
  return actual === base
    ? { ok: true, base: actual }
    : { ok: false, base: actual, detail: `base is ${actual ?? 'unreadable'} after the change, expected ${base}` };
};

export const listChecks = (repo: string, sha: string): ForgeCheck[] => {
  const runs = runGhApiRestJson<{ check_runs: RestCheckRun[] }>(
    'GET',
    `repos/${repo}/commits/${sha}/check-runs?per_page=${PAGE_SIZE}`,
  ).check_runs;
  const statuses = runGhApiRestJson<{ statuses: RestStatus[] }>('GET', `repos/${repo}/commits/${sha}/status`).statuses;
  return [...runs.map(mapRestCheckRun), ...statuses.map(mapRestStatus)];
};

/** Removing a label the issue does not carry is not an error, matching `gh issue edit`. */
export const removeLabel = (repo: string, number: number, label: string): void => {
  const result = runGhApi('DELETE', `repos/${repo}/issues/${number}/labels/${encodeURIComponent(label)}`);
  if (result.status !== 0 && !isNotFound(result)) {
    throw new Error(result.stderr.trim() || `removing label ${label} from #${number} failed`);
  }
};

/** `owner/name` from a GitHub remote URL (https or ssh), or null. */
export const repoSlugFromOrigin = (url: string | null): string | null => {
  const match = url?.match(/github\.com[:/]([^/]+)\/([^/]+?)(?:\.git)?\/?$/);
  return match ? `${match[1]}/${match[2]}` : null;
};
