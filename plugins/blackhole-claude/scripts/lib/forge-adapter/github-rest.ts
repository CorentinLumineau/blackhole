import { isNotFound, runGhApi, runGhApiRestJson } from './cli.ts';
import type { ForgeCheck, ForgeIssue, ForgePr, IssueListFilter } from './types.ts';

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
  head: { ref: string; sha: string };
  state: string;
  merged_at: string | null;
};

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

export const mapRestPr = (row: RestPrRow): ForgePr => ({
  number: row.number,
  title: row.title,
  body: row.body ?? '',
  headRefName: row.head.ref,
  headRefOid: row.head.sha,
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
