import { runTea, runTeaApiJson, runTeaJson, runTeaText } from './tea-cli.ts';
import { claimIssue, latestClosingPrActivity, releaseIssue, type ClaimOps } from './claim.ts';
import { isUnavailable, readDependencies, writeDependencies, type BodyChannel, type NativeDependencyChannel, type NativeEdge } from './dependencies.ts';
import type {
  ClaimLease,
  ClaimResult,
  ReleaseResult,
  DependencyRef,
  DependencyTarget,
  ForgeAdapter,
  ForgeDependencies,
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
  index?: number | string;
  number?: number;
  title: string;
  content?: string;
  body?: string;
  labels?: Array<{ name: string } | string> | string;
  milestone?: { title: string } | string | null;
  state?: string;
  updated_at?: string | null;
  updated?: string | null;
  assignees?: Array<{ login?: string; username?: string } | string> | string | null;
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
  updated_at?: string | null;
  mergeable?: boolean | null;
  labels?: Array<{ name: string }> | null;
  head: { ref: string; sha: string; repo?: { full_name: string } | null };
  base: { ref: string; repo?: { full_name: string } | null };
};

/** One row of `GET issues/{n}/dependencies`: the blocking issue or pull request. */
type GiteaBlockerRow = { number: number; pull_request?: unknown; repository?: { full_name: string } | null };

const MAX_BLOCKER_PAGES = 20;

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
const MAX_LABEL_PAGES = 20;
const MAX_LIST_PAGES = 100;

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
    ...(row.updated_at ? { updatedAt: row.updated_at } : {}),
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

/** `owner/name` without the host prefix a `host/owner/name` repo string may carry. */
export const giteaApiSlug = (repo: string): string => repo.split('/').slice(-2).join('/');

/**
 * Retargets a pull request through `tea api` (`PATCH repos/{owner}/{repo}/pulls/N` with `{base}`),
 * then reads `base.ref` back with a `GET`: the PATCH's exit status is not evidence the base moved.
 * Synchronous so the stack-repair CLI can call it; throws when either call fails.
 */
export const changeGiteaPrBase = (repo: string, number: number, base: string): PrChangeBaseResult => {
  const endpoint = `repos/${giteaApiSlug(repo)}/pulls/${number}`;
  runTeaApiJson('PATCH', endpoint, { base });
  const actual = runTeaApiJson<GiteaApiPrRow>('GET', endpoint).data.base.ref;
  return actual === base
    ? { ok: true, base: actual }
    : { ok: false, base: actual, detail: `base is ${actual} after the change, expected ${base}` };
};

type TeaPrRow = {
  index?: number | string;
  number?: number;
  title: string;
  body?: string;
  head?: { name: string } | string;
  headRefName?: string;
  state?: string;
  merged_at?: string | null;
  mergedAt?: string | null;
};

/** `tea ... --output json` prints every cell as a string, `index` and the comma-joined lists included. */
function issueNumber(row: TeaIssueRow): number {
  return row.number ?? Number(row.index ?? 0);
}

function prNumber(row: TeaPrRow): number {
  return row.number ?? Number(row.index ?? 0);
}

const splitCsv = (cell: string): string[] => cell.split(',').map((v) => v.trim()).filter(Boolean);

function normalizeLabels(labels: TeaIssueRow['labels']): Array<{ name: string }> {
  if (!labels) return [];
  if (typeof labels === 'string') return splitCsv(labels).map((name) => ({ name }));
  return labels.map((l) => (typeof l === 'string' ? { name: l } : l));
}

function normalizeMilestone(m: TeaIssueRow['milestone']): { title: string } | null {
  if (!m) return null;
  if (typeof m === 'string') return { title: m };
  return m;
}

/** `updated_at` (REST) or `updated` (`tea` JSON); assignees as logins or as user objects. */
function claimFields(row: TeaIssueRow): Pick<ForgeIssue, 'assignees' | 'updatedAt'> {
  const updatedAt = row.updated_at ?? row.updated;
  const raw = typeof row.assignees === 'string' ? splitCsv(row.assignees) : row.assignees;
  const assignees = raw?.map((a) => (typeof a === 'string' ? a : (a.login ?? a.username ?? ''))).filter(Boolean);
  return { ...(assignees ? { assignees } : {}), ...(updatedAt ? { updatedAt } : {}) };
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
    ...claimFields(row),
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
    headRefName: row.headRefName ?? (typeof row.head === 'string' ? row.head : row.head?.name) ?? '',
    state,
    mergedAt: row.mergedAt ?? row.merged_at ?? null,
  };
}

// tea's default field set omits `body`, which `mapIssue`/`mapPr` need.
const ISSUE_LIST_FIELDS = 'index,title,body,state,labels,milestone,updated,assignees';
const PR_LIST_FIELDS = 'index,title,body,state,head';

/**
 * `tea ... list --limit` is a page size that Gitea clamps to its maximum, so one call returns at most
 * that many rows however large `--limit` is. Walks `--page` until an empty page or `limit` rows; a
 * short page is not the end because the clamp is invisible to the caller.
 */
function listTeaPages<T>(base: string[], limit: number, key: 'issues' | 'pulls'): T[] {
  const out: T[] = [];
  for (let page = 1; page <= MAX_LIST_PAGES; page++) {
    const rows = runTeaJson<T[] | Record<string, T[]>>([...base, '--limit', String(API_PAGE), '--page', String(page)]);
    const list = Array.isArray(rows) ? rows : rows[key];
    if (list.length === 0) return out;
    out.push(...list);
    if (out.length >= limit) return out.slice(0, limit);
  }
  throw new Error(`tea ${base[0]} list passed ${MAX_LIST_PAGES} pages`);
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
    const base = ['issues', 'list', ...this.repoFlag(), '--fields', ISSUE_LIST_FIELDS];
    if (filter.state && filter.state !== 'all') base.push('--state', filter.state);
    return listTeaPages<TeaIssueRow>(base, filter.limit ?? 200, 'issues').map(mapIssue);
  }

  /** `tea issue create` has no JSON output, so the issue is created through REST and its row is mapped as read. */
  async issueCreate(params: IssueCreateParams): Promise<ForgeIssue> {
    const body: Record<string, unknown> = { title: params.title, body: params.body };
    if (params.labels?.length) body.labels = this.labelIds(params.labels);
    return mapIssue(runTeaApiJson<TeaIssueRow>('POST', `repos/${this.apiSlug()}/issues`, body).data);
  }

  /** Gitea's REST create takes label ids; an unknown name fails here rather than filing the issue unlabelled. */
  private labelIds(names: string[]): number[] {
    const ids = new Map<string, number>();
    let done = false;
    for (let page = 1; !done; page++) {
      if (page > MAX_LABEL_PAGES) throw new Error(`label list passed ${MAX_LABEL_PAGES} pages`);
      const { data, headers } = runTeaApiJson<Array<{ id: number; name: string }>>('GET', `repos/${this.apiSlug()}/labels?page=${page}&limit=${API_PAGE}`);
      for (const l of data) ids.set(l.name, l.id);
      // A server may cap a page below the requested limit, so a short page is not the last one.
      const total = totalCount(headers);
      done = data.length === 0 || (total !== null && ids.size >= total);
    }
    return names.map((name) => {
      const id = ids.get(name);
      if (id === undefined) throw new Error(`label "${name}" does not exist in ${this.repo}`);
      return id;
    });
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

  private apiSlug(): string {
    return giteaApiSlug(this.repo);
  }

  /**
   * Pull requests of one state through the REST API, because `tea pulls list` reports neither
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
    return changeGiteaPrBase(this.repo, number, base);
  }

  async getDependencies(target: DependencyTarget): Promise<ForgeDependencies> {
    return readDependencies('gitea', this.apiSlug(), target, this.nativeDependencies(), this.prBodies());
  }

  async setDependencies(target: DependencyTarget, blockedBy: DependencyRef[]): Promise<ForgeDependencies> {
    return writeDependencies('gitea', this.apiSlug(), target, blockedBy, this.nativeDependencies(), this.prBodies());
  }

  /**
   * Gitea's issue dependencies, read and written on the queue issue with a same-repo issue as the
   * blocker, the same issue-to-issue shape as GitHub; a PR, cross-repo or issue-less blocker is a
   * PR-body line. A repo with dependencies turned off answers 404; any other failure, a 403
   * included, throws. Add and remove name the blocker by owner, repo and number.
   */
  private nativeDependencies(): NativeDependencyChannel {
    const endpoint = (issue: number) => `repos/${this.apiSlug()}/issues/${issue}/dependencies`;
    const meta = (ref: DependencyRef) => {
      const [owner, repo] = ref.repo.split('/');
      return { owner, repo, index: ref.number };
    };
    return {
      list: ({ issue }) => {
        if (issue == null) return [];
        const edges: NativeEdge[] = [];
        for (let page = 1; page <= MAX_BLOCKER_PAGES; page++) {
          let rows: GiteaBlockerRow[];
          try {
            rows = runTeaApiJson<GiteaBlockerRow[]>('GET', `${endpoint(issue)}?page=${page}&limit=${API_PAGE}`).data ?? [];
          } catch (error) {
            if (page === 1 && isUnavailable(String(error))) return null;
            throw error;
          }
          for (const row of rows) {
            const ref: DependencyRef = { repo: row.repository?.full_name ?? this.apiSlug(), number: row.number, kind: row.pull_request ? 'pr' : 'issue' };
            edges.push({ ref, handle: ref.number });
          }
          if (rows.length < API_PAGE) return edges;
        }
        throw new Error(`issue #${issue} blocker list passed ${MAX_BLOCKER_PAGES} pages`);
      },
      holds: (ref, target) => target.issue != null && ref.repo === this.apiSlug() && ref.kind === 'issue',
      add: ({ issue }, ref) => {
        runTeaApiJson('POST', endpoint(issue as number), meta(ref));
      },
      remove: ({ issue }, edge) => {
        runTeaApiJson('DELETE', endpoint(issue as number), meta(edge.ref));
      },
    };
  }

  private prBodies(): BodyChannel {
    const endpoint = (pr: number) => `repos/${this.apiSlug()}/pulls/${pr}`;
    return {
      read: (pr) => runTeaApiJson<GiteaApiPrRow>('GET', endpoint(pr)).data.body ?? '',
      write: (pr, body) => {
        runTeaApiJson('PATCH', endpoint(pr), { body });
      },
    };
  }

  async prList(filter: { state?: 'open' | 'closed' | 'all'; limit?: number } = {}): Promise<ForgePr[]> {
    if (filter.state) return this.listPrsRest(filter.state, filter.limit ?? 100);
    return listTeaPages<TeaPrRow>(['pulls', 'list', ...this.repoFlag(), '--fields', PR_LIST_FIELDS], filter.limit ?? 100, 'pulls').map(mapPr);
  }

  /** The REST row, because `tea pull view` reports neither labels, mergeability nor the head sha. */
  async prView(number: number): Promise<ForgePr> {
    return mapGiteaApiPr(runTeaApiJson<GiteaApiPrRow>('GET', `repos/${this.apiSlug()}/pulls/${number}`).data);
  }

  async prCreate(params: PrCreateParams): Promise<ForgePr> {
    const body = { title: params.title, body: params.body, head: params.head, base: params.base };
    return mapGiteaApiPr(runTeaApiJson<GiteaApiPrRow>('POST', `repos/${this.apiSlug()}/pulls`, body).data);
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
  async claim(issue: number, lane: string, user: string, lease?: ClaimLease): Promise<ClaimResult> {
    return claimIssue(this.claimOps(), issue, lane, user, lease);
  }

  async release(issue: number, lane: string): Promise<ReleaseResult> {
    return releaseIssue(this.claimOps(), issue, lane, await this.viewerLogin());
  }

  async viewerLogin(): Promise<string> {
    return runTeaApiJson<{ login: string }>('GET', 'user').data.login;
  }

  /** Gitea resolves labels by name and fails on an unknown one, so `ensureLabel` creates it; assignees are replaced as a whole list. */
  private claimOps(): ClaimOps {
    const endpoint = (issue: number) => `repos/${this.apiSlug()}/issues/${issue}`;
    const setAssignees = (issue: number, assignees: string[]) => {
      runTeaApiJson('PATCH', endpoint(issue), { assignees });
    };
    return {
      read: async (issue) => {
        const row = runTeaApiJson<TeaIssueRow>('GET', endpoint(issue)).data;
        const mapped = mapIssue(row);
        return { state: mapped.state, labels: mapped.labels.map((l) => l.name), assignees: mapped.assignees ?? [], updatedAt: mapped.updatedAt };
      },
      prActivity: async (issue) => latestClosingPrActivity(this.listPrsRest('open', 100), issue),
      ensureLabel: async (label) => {
        try {
          runTeaText(['labels', 'create', ...this.repoFlag(), '--name', label, '--color', '#1d76db']);
        } catch (error) {
          if (!/already exists/i.test(String(error))) throw error;
        }
      },
      labelAdd: (issue, label) => this.labelAdd({ type: 'issue', number: issue }, [label]),
      labelRemove: (issue, label) => this.labelRemove({ type: 'issue', number: issue }, [label]),
      assign: async (issue, user, current) => setAssignees(issue, [...current, user]),
      unassign: async (issue, user, current) => setAssignees(issue, current.filter((a) => a !== user)),
    };
  }

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
