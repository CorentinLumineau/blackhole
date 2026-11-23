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
  updated_at?: string | null;
  assignees?: Array<{ login: string }> | null;
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
  updated_at?: string | null;
  state: string;
  merged_at: string | null;
  labels?: Array<{ name: string } | string>;
  mergeable?: boolean | null;
};

export type RestPrFile = { filename: string; previous_filename?: string };

/**
 * One `check_runs[]` row of `GET repos/{repo}/commits/{sha}/check-runs` (or the same row from an MCP
 * tool). `id` and `check_suite.id` are server-assigned; `started_at` is null or the zero time while
 * the run is queued.
 */
export type RestCheckRun = {
  id?: number;
  name: string;
  status: string;
  conclusion: string | null;
  started_at?: string | null;
  check_suite?: { id?: number } | null;
};
export type RestStatus = { context: string; state: string };

/** `GET repos/{repo}/actions/runs?head_sha=<sha>&per_page=100`: the part that names a suite's producer. */
export type RestWorkflowRuns = {
  workflow_runs: Array<{
    check_suite_id?: number;
    workflow_id?: number;
    event?: string;
    head_branch?: string | null;
    pull_requests?: Array<{ number?: number; base?: { ref?: string } | null }> | null;
  }>;
};

/**
 * Producer key of each check suite, by suite id, for `withoutSupersededCancelled`. Only a `pull_request`
 * run listing exactly one PR yields a key (workflow id, branch, PR number, base ref); any other event,
 * a missing field, or a `pull_requests` list that is empty, longer or malformed yields none, and a suite
 * claimed by two different keys is dropped.
 */
export const suiteProducers = (payload: unknown): Map<number, string> => {
  const runs = (payload as RestWorkflowRuns | null)?.workflow_runs;
  if (!Array.isArray(runs)) throw new Error('runs payload must be an object with a workflow_runs array');
  const producers = new Map<number, string>();
  const ambiguous = new Set<number>();
  for (const { check_suite_id: suite, workflow_id: workflow, event, head_branch: branch, pull_requests: prs } of runs) {
    if (typeof suite !== 'number' || typeof workflow !== 'number' || event !== 'pull_request' || typeof branch !== 'string') continue;
    if (!Array.isArray(prs) || prs.length !== 1) continue;
    const number = prs[0]?.number;
    const base = prs[0]?.base?.ref;
    if (typeof number !== 'number' || typeof base !== 'string') continue;
    const key = `actions:${workflow}:pull_request:${branch}:${number}:${base}`;
    if (producers.has(suite) && producers.get(suite) !== key) ambiguous.add(suite);
    producers.set(suite, key);
  }
  for (const suite of ambiguous) producers.delete(suite);
  return producers;
};

const PAGE_SIZE = 100;

export const mapRestIssue = (row: RestIssueRow): ForgeIssue => ({
  number: row.number,
  title: row.title,
  body: row.body ?? '',
  labels: row.labels.map((l) => ({ name: typeof l === 'string' ? l : l.name })),
  milestone: row.milestone ? { title: row.milestone.title } : null,
  state: row.state.toLowerCase() === 'closed' ? 'CLOSED' : 'OPEN',
  ...(row.assignees ? { assignees: row.assignees.map((a) => a.login) } : {}),
  ...(row.updated_at ? { updatedAt: row.updated_at } : {}),
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
  ...(row.updated_at ? { updatedAt: row.updated_at } : {}),
  state: row.merged_at ? 'MERGED' : row.state.toLowerCase() === 'closed' ? 'CLOSED' : 'OPEN',
  mergedAt: row.merged_at,
  labels: row.labels?.map((l) => (typeof l === 'string' ? l : l.name)),
  mergeable: row.mergeable,
});

/**
 * Maps a REST check run to a `ForgeCheck`: status and conclusion upper-cased, `runId`, `suiteId` and
 * `startedAt` copied when present. `suites` is the `suiteProducers` map; `producer` is set only when
 * the run's suite is in it, so without it the run is judged on its own.
 */
export const mapRestCheckRun = (row: RestCheckRun, suites?: Map<number, string>): ForgeCheck => {
  const suite = row.check_suite?.id;
  const producer = typeof suite === 'number' ? suites?.get(suite) : undefined;
  return {
    name: row.name,
    status: row.status === 'in_progress' ? 'IN_PROGRESS' : row.status === 'completed' ? 'COMPLETED' : 'QUEUED',
    conclusion: row.conclusion ? (row.conclusion.toUpperCase() as ForgeCheck['conclusion']) : null,
    ...(row.started_at ? { startedAt: row.started_at } : {}),
    ...(typeof row.id === 'number' ? { runId: row.id } : {}),
    ...(typeof suite === 'number' ? { suiteId: suite } : {}),
    ...(producer ? { producer } : {}),
  };
};

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

/** GitHub lists at most 1000 check runs of a commit; a read still short at the cap is refused, never returned partial. */
const CHECK_PAGES_MAX = 10;

/**
 * Every row of one paged commit list. `total` reads the body's count when the endpoint's count is the
 * whole list (check runs), and ends the read once reached; otherwise only a short page ends it. A body
 * without the list, a read below the count, or a read still going at the cap throws.
 */
const listCommitPages = <Row>(
  label: string,
  endpoint: string,
  key: 'check_runs' | 'statuses',
  total?: (body: Record<string, unknown>) => number | null,
): Row[] => {
  const out: Row[] = [];
  let expected: number | null = null;
  for (let page = 1; page <= CHECK_PAGES_MAX; page++) {
    const body = runGhApiRestJson<Record<string, unknown> | null>('GET', `${endpoint}?${query({ per_page: PAGE_SIZE, page })}`);
    const rows = body?.[key];
    const count = total && body ? total(body) : null;
    if (!Array.isArray(rows) || (total && count === null)) {
      throw new Error(`${label}: page ${page} is not a { ${total ? `total_count, ${key}` : key} } body`);
    }
    out.push(...(rows as Row[]));
    expected = count;
    const done = rows.length < PAGE_SIZE || (expected !== null && out.length >= expected);
    if (done) {
      if (expected !== null && out.length < expected) throw new Error(`${label}: read ${out.length} of total_count ${expected}`);
      return out;
    }
  }
  throw new Error(`${label}: still ${out.length}${expected === null ? '' : ` of total_count ${expected}`} after ${CHECK_PAGES_MAX} pages`);
};

const integerTotal = (body: Record<string, unknown>): number | null =>
  Number.isInteger(body.total_count) && (body.total_count as number) >= 0 ? (body.total_count as number) : null;

export const listChecks = (repo: string, sha: string): ForgeCheck[] => {
  const runs = listCommitPages<RestCheckRun>(`check runs of ${sha}`, `repos/${repo}/commits/${sha}/check-runs`, 'check_runs', integerTotal);
  const statuses = listCommitPages<RestStatus>(`statuses of ${sha}`, `repos/${repo}/commits/${sha}/status`, 'statuses');
  // Producers for `withoutSupersededCancelled`; without them every check run is judged on its own.
  let suites = new Map<number, string>();
  try {
    suites = suiteProducers(runGhApiRestJson('GET', `repos/${repo}/actions/runs?head_sha=${sha}&per_page=${PAGE_SIZE}`));
  } catch (error) {
    console.error(`listChecks: workflow-runs join failed (${error instanceof Error ? error.message : String(error)}); every check run is judged on its own`);
  }
  return [...runs.map((row) => mapRestCheckRun(row, suites)), ...statuses.map(mapRestStatus)];
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
