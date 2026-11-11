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
  head: { ref: string; sha: string; repo?: { full_name: string } | null };
  base: { ref: string; repo?: { full_name: string } | null };
};

type GiteaApiFile = { filename: string; previous_filename?: string };

const API_PAGE = 50;
// Gitea caps a page at its configured MAX_RESPONSE_ITEMS and 3000 files is GitHub's own cap, so
// both walks stop at a bounded page count; the open-PR walk also checks the server's own total.
const MAX_FILE_PAGES = 60;
const MAX_PR_PAGES = 100;

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
   * Open PRs through the REST API, because `tea pulls list --json` reports neither the base branch
   * nor the head repository. Pages until the server's X-Total-Count is read; an empty page before
   * that total is an error, so a server page cap never truncates the list silently.
   */
  private listOpenPrsRest(limit: number): ForgePr[] {
    const out: ForgePr[] = [];
    let total: number | null = null;
    for (let page = 1; page <= MAX_PR_PAGES; page++) {
      const { data, headers } = runTeaApiJson<GiteaApiPrRow[]>(
        'GET',
        `repos/${this.apiSlug()}/pulls?state=open&page=${page}&limit=${API_PAGE}`,
      );
      total ??= totalCount(headers);
      if (data.length === 0) {
        if (total !== null && out.length < total) {
          throw new Error(`open PR list ended at ${out.length} rows before the server total of ${total}`);
        }
        return out;
      }
      out.push(...data.map(mapGiteaApiPr));
      if (out.length >= limit || (total !== null && out.length >= total)) return out.slice(0, limit);
    }
    throw new Error(`open PR list passed ${MAX_PR_PAGES} pages`);
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
    if (filter.state === 'open') return this.listOpenPrsRest(filter.limit ?? 100);
    const args = ['pulls', 'list', ...this.repoFlag(), '--limit', String(filter.limit ?? 100)];
    if (filter.state && filter.state !== 'all') args.push('--state', filter.state);
    const rows = runTeaJson<TeaPrRow[] | { pulls: TeaPrRow[] }>(args);
    const list = Array.isArray(rows) ? rows : rows.pulls;
    return list.map(mapPr);
  }

  async prView(number: number): Promise<ForgePr> {
    return mapPr(runTeaJson<TeaPrRow>(['pull', 'view', String(number), ...this.repoFlag()]));
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

  // A `tea actions status` failure used to collapse to `[]` — indistinguishable from "no checks
  // configured" (issue #864). The merge gate reads an empty check list as nothing blocking the
  // merge, so a swallowed CLI failure here reads as CI green it never actually observed. Let the
  // error propagate instead, matching `GitHubForgeAdapter.prChecks` (github.ts), which has never
  // caught here — the caller must fail closed on a rejected `prChecks()`, not treat it as a clean
  // check list (V-INT-01: one adapter behavior for the shared `ForgeAdapter` interface method).
  async prChecks(number: number): Promise<ForgeCheck[]> {
    const rows = runTeaJson<Array<{ name: string; status: string; conclusion?: string | null }>>([
      'actions',
      'status',
      String(number),
      ...this.repoFlag(),
    ]);
    return rows.map((row) => ({
      name: row.name,
      status:
        row.status === 'in_progress'
          ? 'IN_PROGRESS'
          : row.status === 'queued'
            ? 'QUEUED'
            : 'COMPLETED',
      conclusion: (row.conclusion?.toUpperCase() ?? null) as ForgeCheck['conclusion'],
    }));
  }
}

export function createGiteaAdapter(repo: string): GiteaForgeAdapter {
  return new GiteaForgeAdapter(repo);
}
