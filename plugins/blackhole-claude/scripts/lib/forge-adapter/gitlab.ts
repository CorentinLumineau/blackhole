import { runGlab, runGlabJson, runGlabText } from './glab-cli.ts';
import { claimIssue, latestClosingPrActivity, releaseIssue, type ClaimOps } from './claim.ts';
import { isUnavailable, readDependencies, writeDependencies, type BodyChannel, type NativeDependencyChannel } from './dependencies.ts';
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

type GlabIssueRow = {
  iid?: number;
  number?: number;
  title: string;
  description?: string;
  body?: string;
  labels?: string[];
  milestone?: { title: string } | null;
  state?: string;
  updated_at?: string | null;
  assignees?: Array<{ id?: number; username?: string }> | null;
};

type GlabMrRow = {
  iid?: number;
  number?: number;
  title: string;
  description?: string;
  body?: string;
  source_branch?: string;
  headRefName?: string;
  state?: string;
  merged_at?: string | null;
  mergedAt?: string | null;
  labels?: string[];
  updated_at?: string | null;
  has_conflicts?: boolean;
};

/** One row of `GET merge_requests/:iid/blocks`: a merge request that blocks this one. */
type GlabBlockRow = { id: number; blocking_merge_request: { iid: number; references?: { full?: string } } };

const glabApiJson = <T>(endpoint: string, method = 'GET'): T => {
  const text = runGlabText(['api', endpoint, '--method', method]);
  return (text.trim() ? JSON.parse(text) : null) as T;
};

function issueNumber(row: GlabIssueRow): number {
  return row.iid ?? row.number ?? 0;
}

function mrNumber(row: GlabMrRow): number {
  return row.iid ?? row.number ?? 0;
}

function mapIssue(row: GlabIssueRow): ForgeIssue {
  const state = (row.state ?? 'opened').toUpperCase();
  return {
    number: issueNumber(row),
    title: row.title,
    body: row.body ?? row.description ?? '',
    labels: (row.labels ?? []).map((name) => ({ name })),
    milestone: row.milestone ?? null,
    state: state === 'CLOSED' ? 'CLOSED' : 'OPEN',
    ...(row.assignees ? { assignees: row.assignees.map((a) => a.username ?? '').filter(Boolean) } : {}),
    ...(row.updated_at ? { updatedAt: row.updated_at } : {}),
  };
}

function mapMr(row: GlabMrRow): ForgePr {
  const stateRaw = (row.state ?? 'opened').toLowerCase();
  const state =
    stateRaw === 'merged' ? 'MERGED' : stateRaw === 'closed' ? 'CLOSED' : 'OPEN';
  return {
    number: mrNumber(row),
    title: row.title,
    body: row.body ?? row.description ?? '',
    headRefName: row.headRefName ?? row.source_branch ?? '',
    state,
    mergedAt: row.mergedAt ?? row.merged_at ?? null,
    labels: row.labels,
    ...(row.updated_at ? { updatedAt: row.updated_at } : {}),
    mergeable: row.has_conflicts === undefined ? undefined : !row.has_conflicts,
  };
}

export class GitLabForgeAdapter implements ForgeAdapter {
  readonly forge = 'gitlab' as const;

  constructor(readonly repo: string) {}

  async authStatus(): Promise<ForgeAuthStatus> {
    const result = runGlab(['auth', 'status']);
    if (result.error?.code === 'ENOENT') {
      return {
        ok: false,
        forge: 'gitlab',
        host: null,
        detail: 'GitLab CLI (glab) not found — install glab and run `glab auth login`',
      };
    }
    if (result.status !== 0) {
      return {
        ok: false,
        forge: 'gitlab',
        host: null,
        detail: result.stderr.trim() || result.stdout.trim() || 'glab auth status failed',
      };
    }
    const hostMatch = result.stdout.match(/GitLab:\s*(\S+)/);
    return {
      ok: true,
      forge: 'gitlab',
      host: hostMatch?.[1] ?? null,
    };
  }

  private repoFlag(): string[] {
    return ['--repo', this.repo];
  }

  // Stacking is built for the GitHub and Gitea PR graph; a merge request's file list and target
  // branch change are not wired here, so the engine reads these as an unsupported forge.
  async prFiles(_number: number): Promise<string[]> {
    throw new Error('not-supported: prFiles on the gitlab forge');
  }

  async prChangeBase(_number: number, _base: string): Promise<PrChangeBaseResult> {
    throw new Error('not-supported: prChangeBase on the gitlab forge');
  }

  async getDependencies(target: DependencyTarget): Promise<ForgeDependencies> {
    return readDependencies('gitlab', this.repo, target, this.nativeDependencies(), this.mrBodies());
  }

  async setDependencies(target: DependencyTarget, blockedBy: DependencyRef[]): Promise<ForgeDependencies> {
    return writeDependencies('gitlab', this.repo, target, blockedBy, this.nativeDependencies(), this.mrBodies());
  }

  /**
   * Merge request dependencies ("blocked by" merge requests, GitLab Premium) join two merge
   * requests, so edges are read and written on the merge request with a same-project merge
   * request as the blocker; an issue or cross-project blocker is a body line. A project without
   * the feature answers 404; any other failure, a 403 included, throws. The POST names the
   * blocker by its global `id`, so each add reads the blocking merge request first.
   */
  private nativeDependencies(): NativeDependencyChannel {
    const project = (repo: string) => encodeURIComponent(repo);
    const blocks = (mr: number) => `projects/${project(this.repo)}/merge_requests/${mr}/blocks`;
    return {
      list: ({ pr }) => {
        let rows: GlabBlockRow[];
        try {
          rows = glabApiJson<GlabBlockRow[]>(blocks(pr)) ?? [];
        } catch (error) {
          if (isUnavailable(String(error))) return null;
          throw error;
        }
        return rows.map((row) => {
          const full = row.blocking_merge_request.references?.full?.match(/^(.+)!\d+$/);
          return { ref: { repo: full?.[1] ?? this.repo, number: row.blocking_merge_request.iid, kind: 'pr' as const }, handle: row.id };
        });
      },
      holds: (ref) => ref.kind === 'pr' && ref.repo === this.repo,
      add: ({ pr }, ref) => {
        const { id } = glabApiJson<{ id: number }>(`projects/${project(ref.repo)}/merge_requests/${ref.number}`);
        glabApiJson(`${blocks(pr)}?blocking_merge_request_id=${id}`, 'POST');
      },
      remove: ({ pr }, edge) => {
        glabApiJson(`${blocks(pr)}/${edge.handle}`, 'DELETE');
      },
    };
  }

  private mrBodies(): BodyChannel {
    return {
      read: (pr) => mapMr(runGlabJson<GlabMrRow>(['mr', 'view', String(pr), ...this.repoFlag()])).body,
      write: (pr, body) => {
        runGlabText(['mr', 'update', String(pr), ...this.repoFlag(), '--description', body]);
      },
    };
  }

  async issueList(filter: IssueListFilter = {}): Promise<ForgeIssue[]> {
    const args = ['issue', 'list', ...this.repoFlag(), '--per-page', String(filter.limit ?? 200)];
    if (filter.state === 'closed') args.push('--closed');
    if (filter.state === 'open') args.push('--opened');
    const rows = runGlabJson<GlabIssueRow[]>(args);
    return rows.map(mapIssue);
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
    if (params.labels?.length) args.push('--label', params.labels.join(','));
    return mapIssue(runGlabJson<GlabIssueRow>(args));
  }

  async issueEdit(number: number, params: IssueEditParams): Promise<void> {
    const args = ['issue', 'update', String(number), ...this.repoFlag()];
    if (params.title) args.push('--title', params.title);
    if (params.body) args.push('--description', params.body);
    runGlabText(args);
  }

  async issueComment(number: number, body: string): Promise<void> {
    runGlabText(['issue', 'note', String(number), ...this.repoFlag(), '--message', body]);
  }

  async prList(filter: { state?: 'open' | 'closed' | 'all'; limit?: number } = {}): Promise<ForgePr[]> {
    const args = ['mr', 'list', ...this.repoFlag(), '--per-page', String(filter.limit ?? 100)];
    if (filter.state === 'closed') args.push('--closed');
    if (filter.state === 'open') args.push('--opened');
    // `glab mr list` shows opened merge requests only unless told otherwise; merged ones need --all.
    if (filter.state === 'all') args.push('--all');
    const rows = runGlabJson<GlabMrRow[]>(args);
    return rows.map(mapMr);
  }

  async prView(number: number): Promise<ForgePr> {
    return mapMr(runGlabJson<GlabMrRow>(['mr', 'view', String(number), ...this.repoFlag()]));
  }

  async prCreate(params: PrCreateParams): Promise<ForgePr> {
    const args = [
      'mr',
      'create',
      ...this.repoFlag(),
      '--title',
      params.title,
      '--description',
      params.body,
      '--source-branch',
      params.head,
      '--target-branch',
      params.base,
    ];
    return mapMr(runGlabJson<GlabMrRow>(args));
  }

  async prComment(number: number, body: string): Promise<void> {
    runGlabText(['mr', 'note', String(number), ...this.repoFlag(), '--message', body]);
  }

  async labelAdd(entity: { type: 'issue' | 'pr'; number: number }, labels: string[]): Promise<void> {
    if (labels.length === 0) return;
    const kind = entity.type === 'issue' ? 'issue' : 'mr';
    runGlabText([kind, 'update', String(entity.number), ...this.repoFlag(), '--label', labels.join(',')]);
  }

  async labelRemove(entity: { type: 'issue' | 'pr'; number: number }, labels: string[]): Promise<void> {
    if (labels.length === 0) return;
    const kind = entity.type === 'issue' ? 'issue' : 'mr';
    runGlabText([
      kind,
      'update',
      String(entity.number),
      ...this.repoFlag(),
      '--unlabel',
      labels.join(','),
    ]);
  }

  // A `glab ci status` failure used to collapse to `[]` — indistinguishable from "no pipeline
  // configured" (issue #864). The merge gate reads an empty check list as nothing blocking the
  // merge, so a swallowed CLI failure here reads as CI green it never actually observed. Let the
  // error propagate instead, matching `GitHubForgeAdapter.prChecks` (github.ts), which has never
  // caught here — the caller must fail closed on a rejected `prChecks()`, not treat it as a clean
  // check list (V-INT-01: one adapter behavior for the shared `ForgeAdapter` interface method).
  //
  // `glab ci status` wraps GitLab's `GetPipeline` — a single aggregate object, not a per-job
  // array — so synthesizing checks from it can only ever produce one `{ name: 'pipeline' }` row
  // regardless of how many jobs actually ran, violating the `ForgeAdapter` contract's per-check
  // shape that `gitea.ts`/`github.ts` both honor (V-SOLID-03). Reading GitLab's public REST API
  // directly via `glab api` (parallel to `runGhApiJson` in cli.ts) gives one row per real
  // pipeline job instead.
  async claim(issue: number, lane: string, user: string, lease?: ClaimLease): Promise<ClaimResult> {
    return claimIssue(this.claimOps(), issue, lane, user, lease);
  }

  async release(issue: number, lane: string): Promise<ReleaseResult> {
    return releaseIssue(this.claimOps(), issue, lane, await this.viewerLogin());
  }

  async viewerLogin(): Promise<string> {
    return glabApiJson<{ username: string }>('user').username;
  }

  /**
   * GitLab creates a label on first use, so `ensureLabel` is a no-op. Assignees are set as a whole
   * id list in the query string, so the existing `glabApiJson` helper needs no body flag.
   */
  private claimOps(): ClaimOps {
    const endpoint = (issue: number) => `projects/${encodeURIComponent(this.repo)}/issues/${issue}`;
    const userId = (username: string): number => {
      const [found] = glabApiJson<Array<{ id: number }>>(`users?username=${encodeURIComponent(username)}`);
      if (!found) throw new Error(`GitLab user ${username} not found`);
      return found.id;
    };
    const setAssignees = (issue: number, ids: number[]) => {
      glabApiJson(`${endpoint(issue)}?${ids.length ? ids.map((id) => `assignee_ids[]=${id}`).join('&') : 'assignee_ids[]='}`, 'PUT');
    };
    const idsOf = (issue: number): number[] => (glabApiJson<GlabIssueRow>(endpoint(issue)).assignees ?? []).flatMap((a) => (a.id === undefined ? [] : [a.id]));
    return {
      read: async (issue) => {
        const mapped = mapIssue(glabApiJson<GlabIssueRow>(endpoint(issue)));
        return { state: mapped.state, labels: mapped.labels.map((l) => l.name), assignees: mapped.assignees ?? [], updatedAt: mapped.updatedAt };
      },
      prActivity: async (issue) => latestClosingPrActivity(await this.prList({ state: 'open', limit: 100 }), issue),
      ensureLabel: async () => {},
      labelAdd: (issue, label) => this.labelAdd({ type: 'issue', number: issue }, [label]),
      labelRemove: (issue, label) => this.labelRemove({ type: 'issue', number: issue }, [label]),
      assign: async (issue, user) => setAssignees(issue, [...new Set([...idsOf(issue), userId(user)])]),
      unassign: async (issue, user) => {
        const id = userId(user);
        setAssignees(issue, idsOf(issue).filter((x) => x !== id));
      },
    };
  }

  async prChecks(number: number): Promise<ForgeCheck[]> {
    const project = encodeURIComponent(this.repo);
    const pipelines = runGlabJson<Array<{ id: number }>>([
      'api',
      `projects/${project}/merge_requests/${number}/pipelines`,
    ]);
    if (pipelines.length === 0) return [];
    const latest = pipelines.slice().sort((a, b) => b.id - a.id)[0];
    const jobs = runGlabJson<Array<{ name: string; status: string }>>([
      'api',
      `projects/${project}/pipelines/${latest.id}/jobs`,
    ]);
    return jobs.map((job) => ({
      name: job.name,
      status:
        job.status === 'running'
          ? 'IN_PROGRESS'
          : job.status === 'pending' || job.status === 'created'
            ? 'QUEUED'
            : 'COMPLETED',
      conclusion:
        job.status === 'success'
          ? 'SUCCESS'
          : job.status === 'failed'
            ? 'FAILURE'
            : job.status === 'canceled'
              ? 'CANCELLED'
              : job.status === 'skipped'
                ? 'SKIPPED'
                : null,
    }));
  }
}

export function createGitLabAdapter(repo: string): GitLabForgeAdapter {
  return new GitLabForgeAdapter(repo);
}
