import { runTea, runTeaApiJson, runTeaJson, runTeaText } from './tea-cli.ts';
import type {
  ForgeAdapter,
  ForgeAuthStatus,
  ForgeCheck,
  ForgeIssue,
  ForgePr,
  IssueCreateParams,
  IssueEditParams,
  IssueListFilter,
  PrChangeBaseResult,
  PrCreateParams,
} from './types.ts';

type TeaIssueRow = {
  index?: number;
  number?: number;
  title: string;
  content?: string;
  body?: string;
  labels?: Array<{ name: string } | string>;
  milestone?: { title: string } | string | null;
  state?: string;
};

/** Gitea REST pull request row, as `tea api` prints it. */
type GiteaApiPrRow = {
  number: number;
  title: string;
  body?: string | null;
  state?: string;
  merged?: boolean;
  merged_at?: string | null;
  draft?: boolean;
  created_at?: string | null;
  mergeable?: boolean | null;
  labels?: Array<{ name: string }> | null;
  head: { ref: string; sha: string; repo?: { full_name: string } | null };
  base: { ref: string; repo?: { full_name: string } | null };
};

type GiteaApiFile = { filename: string; previous_filename?: string };

/** One commit status as Gitea reports it; `status` is pending, success, failure, error, warning or skipped. */
type GiteaCommitStatus = { context: string; status: string };

type GiteaCombinedStatus = { total_count?: number; statuses?: GiteaCommitStatus[] | null };

const API_PAGE = 50;
// Gitea caps a page at its configured MAX_RESPONSE_ITEMS and 3000 files is GitHub's own cap, so
// both walks stop at a bounded page count; the open-PR walk also checks the server's own total.
const MAX_FILE_PAGES = 60;
const MAX_PR_PAGES = 100;
const MAX_STATUS_PAGES = 20;

const STATUS_CONCLUSION: Record<string, ForgeCheck['conclusion']> = {
  success: 'SUCCESS',
  failure: 'FAILURE',
  error: 'FAILURE',
  warning: 'NEUTRAL',
  skipped: 'SKIPPED',
};

/** A state this adapter does not know reads as still running: never as a pass, never as a failure. */
export const mapGiteaStatus = (row: GiteaCommitStatus): ForgeCheck => {
  const conclusion = STATUS_CONCLUSION[row.status];
  return conclusion ? { name: row.context, status: 'COMPLETED', conclusion } : { name: row.context, status: 'IN_PROGRESS', conclusion: null };
};

export const mapGiteaApiPr = (row: GiteaApiPrRow): ForgePr => {
  const baseRepo = row.base.repo?.full_name;
  const merged = row.merged === true || !!row.merged_at;
  return {
    number: row.number,
    title: row.title,
    body: row.body ?? '',
    headRefName: row.head.ref,
    headRefOid: row.head.sha,
    baseRefName: row.base.ref,
    headRepoIsFork: baseRepo && row.head.repo !== undefined ? row.head.repo === null || row.head.repo.full_name !== baseRepo : undefined,
    draft: row.draft,
    createdAt: row.created_at,
    state: merged ? 'MERGED' : (row.state ?? 'open').toLowerCase() === 'closed' ? 'CLOSED' : 'OPEN',
    mergedAt: row.merged_at ?? null,
    labels: row.labels?.map((l) => l.name),
    mergeable: row.mergeable,
  };
};

const totalCount = (headers: string): number | null => {
  const m = headers.match(/x-total-count:\s*(\d+)/i);
  return m ? Number(m[1]) : null;
};

type TeaPrRow = {
  index?: number;
  number?: number;
  title: string;
  body?: string;
  head?: { name: string };
  headRefName?: string;
  state?: string;
  merged_at?: string | null;
  mergedAt?: string | null;
};

function issueNumber(row: TeaIssueRow): number {
  return row.number ?? row.index ?? 0;
}

function prNumber(row: TeaPrRow): number {
  return row.number ?? row.index ?? 0;
}

function normalizeLabels(labels: TeaIssueRow['labels']): Array<{ name: string }> {
  if (!labels) return [];
  return labels.map((l) => (typeof l === 'string' ? { name: l } : l));
}

function normalizeMilestone(m: TeaIssueRow['milestone']): { title: string } | null {
  if (!m) return null;
  if (typeof m === 'string') return { title: m };
  return m;
}

function mapIssue(row: TeaIssueRow): ForgeIssue {
  const state = (row.state ?? 'open').toUpperCase();
  return {
    number: issueNumber(row),
    title: row.title,
    body: row.body ?? row.content ?? '',
    labels: normalizeLabels(row.labels),
    milestone: normalizeMilestone(row.milestone),
    state: state === 'CLOSED' ? 'CLOSED' : 'OPEN',
  };
}

function mapPr(row: TeaPrRow): ForgePr {
  const stateRaw = (row.state ?? 'open').toUpperCase();
  const state =
    stateRaw === 'MERGED' ? 'MERGED' : stateRaw === 'CLOSED' ? 'CLOSED' : 'OPEN';
  return {
    number: prNumber(row),
    title: row.title,
    body: row.body ?? '',
    headRefName: row.headRefName ?? row.head?.name ?? '',
    state,
    mergedAt: row.mergedAt ?? row.merged_at ?? null,
  };
}

export class GiteaForgeAdapter implements ForgeAdapter {
  readonly forge = 'gitea' as const;

  constructor(readonly repo: string) {}

  async authStatus(): Promise<ForgeAuthStatus> {
    const result = runTea(['logins']);
    if (result.error?.code === 'ENOENT') {
      return {
        ok: false,
        forge: 'gitea',
        host: null,
        detail: 'Gitea CLI (tea) not found — install tea and run `tea login add`',
      };
    }
    if (result.status !== 0) {
      return {
        ok: false,
        forge: 'gitea',
        host: null,
        detail: result.stderr.trim() || result.stdout.trim() || 'tea logins failed',
      };
    }
    const host = this.repo.includes('/') ? this.repo.split('/')[0] : null;
    const loggedIn = result.stdout.trim().length > 0;
    return {
      ok: loggedIn,
      forge: 'gitea',
      host,
      detail: loggedIn ? undefined : 'no tea login configured',
    };
  }

  private repoFlag(): string[] {
    return ['--repo', this.repo];
  }

  async issueList(filter: IssueListFilter = {}): Promise<ForgeIssue[]> {
    const args = ['issues', 'list', ...this.repoFlag(), '--limit', String(filter.limit ?? 200)];
    if (filter.state && filter.state !== 'all') args.push('--state', filter.state);
    const rows = runTeaJson<TeaIssueRow[] | { issues: TeaIssueRow[] }>(args);
    const list = Array.isArray(rows) ? rows : rows.issues;
    return list.map(mapIssue);
  }

  async issueCreate(params: IssueCreateParams): Promise<ForgeIssue> {
    const args = [
      'issue',
      'create',
      ...this.repoFlag(),
      '--title',
      params.title,
      '--description',
      params.body,
    ];
    if (params.labels?.length) args.push('--labels', params.labels.join(','));
    const created = runTeaJson<TeaIssueRow>(args);
    return mapIssue(created);
  }

  async issueEdit(number: number, params: IssueEditParams): Promise<void> {
    const args = ['issue', 'edit', String(number), ...this.repoFlag()];
    if (params.title) args.push('--title', params.title);
    if (params.body) args.push('--description', params.body);
    runTeaText(args);
  }

  async issueComment(number: number, body: string): Promise<void> {
    runTeaText(['issue', 'comment', String(number), ...this.repoFlag(), '--content', body]);
  }

  /** `owner/name` without the host prefix a `host/owner/name` repo string may carry. */
  private apiSlug(): string {
    return this.repo.split('/').slice(-2).join('/');
  }

  /**
   * Pull requests of one state through the REST API, because `tea pulls list --json` reports neither
   * the base branch, the head repository nor the merge time. Pages until the server's X-Total-Count
   * is read; an empty page before that total is an error, so a server page cap never truncates the
   * list silently.
   */
  private listPrsRest(state: 'open' | 'closed' | 'all', limit: number): ForgePr[] {
    const out: ForgePr[] = [];
    let total: number | null = null;
    for (let page = 1; page <= MAX_PR_PAGES; page++) {
      const { data, headers } = runTeaApiJson<GiteaApiPrRow[]>(
        'GET',
        `repos/${this.apiSlug()}/pulls?state=${state}&page=${page}&limit=${API_PAGE}`,
      );
      total ??= totalCount(headers);
      if (data.length === 0) {
        if (total !== null && out.length < total) {
          throw new Error(`${state} PR list ended at ${out.length} rows before the server total of ${total}`);
        }
        return out;
      }
      out.push(...data.map(mapGiteaApiPr));
      if (out.length >= limit || (total !== null && out.length >= total)) return out.slice(0, limit);
    }
    throw new Error(`${state} PR list passed ${MAX_PR_PAGES} pages`);
  }

  async prFiles(number: number): Promise<string[]> {
    const files: string[] = [];
    for (let page = 1; page <= MAX_FILE_PAGES; page++) {
      const { data } = runTeaApiJson<GiteaApiFile[]>(
        'GET',
        `repos/${this.apiSlug()}/pulls/${number}/files?page=${page}&limit=${API_PAGE}`,
      );
      if (data.length === 0) return files;
      for (const row of data) {
        files.push(row.filename);
        if (row.previous_filename) files.push(row.previous_filename);
      }
    }
    throw new Error(`PR #${number} file list passed ${MAX_FILE_PAGES} pages and may be truncated`);
  }

  async prChangeBase(number: number, base: string): Promise<PrChangeBaseResult> {
    const endpoint = `repos/${this.apiSlug()}/pulls/${number}`;
    runTeaApiJson('PATCH', endpoint, { base });
    const actual = runTeaApiJson<GiteaApiPrRow>('GET', endpoint).data.base.ref;
    return actual === base
      ? { ok: true, base: actual }
      : { ok: false, base: actual, detail: `base is ${actual} after the change, expected ${base}` };
  }

  async prList(filter: { state?: 'open' | 'closed' | 'all'; limit?: number } = {}): Promise<ForgePr[]> {
    if (filter.state) return this.listPrsRest(filter.state, filter.limit ?? 100);
    const args = ['pulls', 'list', ...this.repoFlag(), '--limit', String(filter.limit ?? 100)];
    if (filter.state && filter.state !== 'all') args.push('--state', filter.state);
    const rows = runTeaJson<TeaPrRow[] | { pulls: TeaPrRow[] }>(args);
    const list = Array.isArray(rows) ? rows : rows.pulls;
    return list.map(mapPr);
  }

  /** The REST row, because `tea pull view --json` reports neither labels, mergeability nor the head sha. */
  async prView(number: number): Promise<ForgePr> {
    return mapGiteaApiPr(runTeaApiJson<GiteaApiPrRow>('GET', `repos/${this.apiSlug()}/pulls/${number}`).data);
  }

  async prCreate(params: PrCreateParams): Promise<ForgePr> {
    const args = [
      'pull',
      'create',
      ...this.repoFlag(),
      '--title',
      params.title,
      '--description',
      params.body,
      '--head',
      params.head,
      '--base',
      params.base,
    ];
    return mapPr(runTeaJson<TeaPrRow>(args));
  }

  async prComment(number: number, body: string): Promise<void> {
    runTeaText(['pull', 'comment', String(number), ...this.repoFlag(), '--content', body]);
  }

  async labelAdd(entity: { type: 'issue' | 'pr'; number: number }, labels: string[]): Promise<void> {
    if (labels.length === 0) return;
    const kind = entity.type === 'issue' ? 'issue' : 'pull';
    runTeaText([kind, 'edit', String(entity.number), ...this.repoFlag(), '--add-labels', labels.join(',')]);
  }

  async labelRemove(entity: { type: 'issue' | 'pr'; number: number }, labels: string[]): Promise<void> {
    if (labels.length === 0) return;
    const kind = entity.type === 'issue' ? 'issue' : 'pull';
    runTeaText([kind, 'edit', String(entity.number), ...this.repoFlag(), '--remove-labels', labels.join(',')]);
  }

  // `tea` has no per-PR CI command (`tea actions` only lists secrets, variables, runs and
  // workflows), so CI is the combined commit status of the PR's head commit, read through the REST
  // API. A failed read throws rather than returning `[]`: an empty list means "no status was
  // reported" and a caller must never be able to mistake a swallowed failure for it (issue #864).
  async prChecks(number: number): Promise<ForgeCheck[]> {
    const sha = (await this.prView(number)).headRefOid;
    if (!sha) throw new Error(`PR #${number} reports no head commit to read CI for`);
    const rows: GiteaCommitStatus[] = [];
    for (let page = 1; page <= MAX_STATUS_PAGES; page++) {
      const { data } = runTeaApiJson<GiteaCombinedStatus>('GET', `repos/${this.apiSlug()}/commits/${sha}/status?page=${page}&limit=${API_PAGE}`);
      const statuses = data?.statuses ?? [];
      if (statuses.length === 0) return rows.map(mapGiteaStatus);
      rows.push(...statuses);
      // `total_count` is the length of this page, not of the whole list: only a short page ends the read.
      if (statuses.length < API_PAGE) return rows.map(mapGiteaStatus);
    }
    throw new Error(`PR #${number} status list passed ${MAX_STATUS_PAGES} pages and may be truncated`);
  }
}

export function createGiteaAdapter(repo: string): GiteaForgeAdapter {
  return new GiteaForgeAdapter(repo);
}
