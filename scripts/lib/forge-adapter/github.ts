import { readOriginUrl } from '../forge-detection.ts';
import { runGhApi, runGhApiJson, runGhApiRestJson, runGhApiText } from './cli.ts';
import {
  changePrBase,
  updatePrBranch,
  listChecks,
  listPrFiles,
  listIssues,
  listPrs,
  mapRestIssue,
  mapRestPr,
  removeLabel,
  repoSlugFromOrigin,
  viewIssue,
  viewPr,
  type RestIssueRow,
  type RestPrRow,
} from './github-rest.ts';
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
  PrUpdateBranchResult,
  PrCreateParams,
} from './types.ts';

/** One row of `GET issues/{n}/dependencies/blocked_by`: the blocking issue or pull request. */
type RestBlockerRow = { id: number; number: number; repository_url?: string; pull_request?: unknown };

const BLOCKER_PAGE = 100;
const BLOCKER_MAX_PAGES = 10;

// Every call is a REST call through `gh api` (ADR-048). The porcelain commands (`gh issue list`,
// `gh pr view`, `gh pr checks`, `gh repo view`) use GraphQL, which fails where GraphQL is blocked
// (cloud sessions) or a classic Project is attached to the repo; REST works with a plain token.

export class GitHubForgeAdapter implements ForgeAdapter {
  readonly forge = 'github' as const;

  constructor(readonly repo: string) {}

  async authStatus(): Promise<ForgeAuthStatus> {
    const result = runGhApi('GET', this.repo ? `repos/${this.repo}` : 'rate_limit');
    if (result.error?.code === 'ENOENT') {
      return {
        ok: false,
        forge: 'github',
        host: null,
        detail: 'GitHub CLI not found — install gh, then run `gh auth login` or set GH_TOKEN',
      };
    }
    if (result.status !== 0) {
      return {
        ok: false,
        forge: 'github',
        host: null,
        detail: result.stderr.trim() || result.stdout.trim() || 'gh api failed',
      };
    }
    return { ok: true, forge: 'github', host: 'github.com' };
  }

  async issueList(filter: IssueListFilter = {}): Promise<ForgeIssue[]> {
    return listIssues(this.repo, filter);
  }

  async issueCreate(params: IssueCreateParams): Promise<ForgeIssue> {
    const body = { title: params.title, body: params.body, labels: params.labels ?? [] };
    return mapRestIssue(runGhApiRestJson<RestIssueRow>('POST', `repos/${this.repo}/issues`, body));
  }

  async issueEdit(number: number, params: IssueEditParams): Promise<void> {
    const body: IssueEditParams = {};
    if (params.title) body.title = params.title;
    if (params.body) body.body = params.body;
    runGhApiRestJson('PATCH', `repos/${this.repo}/issues/${number}`, body);
  }

  async issueComment(number: number, body: string): Promise<void> {
    runGhApiRestJson('POST', `repos/${this.repo}/issues/${number}/comments`, { body });
  }

  async prList(filter: { state?: 'open' | 'closed' | 'all'; limit?: number } = {}): Promise<ForgePr[]> {
    return listPrs(this.repo, filter.state ?? 'open', filter.limit ?? 100);
  }

  async prView(number: number): Promise<ForgePr> {
    return viewPr(this.repo, number);
  }

  async prCreate(params: PrCreateParams): Promise<ForgePr> {
    return mapRestPr(runGhApiRestJson<RestPrRow>('POST', `repos/${this.repo}/pulls`, params));
  }

  /** A pull request's conversation is an issue thread, so this is the issue comment endpoint. */
  async prComment(number: number, body: string): Promise<void> {
    await this.issueComment(number, body);
  }

  async labelAdd(entity: { type: 'issue' | 'pr'; number: number }, labels: string[]): Promise<void> {
    if (labels.length === 0) return;
    runGhApiRestJson('POST', `repos/${this.repo}/issues/${entity.number}/labels`, { labels });
  }

  async labelRemove(entity: { type: 'issue' | 'pr'; number: number }, labels: string[]): Promise<void> {
    for (const label of labels) removeLabel(this.repo, entity.number, label);
  }

  async claim(issue: number, lane: string, user: string, lease?: ClaimLease): Promise<ClaimResult> {
    return claimIssue(this.claimOps(), issue, lane, user, lease);
  }

  async release(issue: number, lane: string): Promise<ReleaseResult> {
    return releaseIssue(this.claimOps(), issue, lane, await this.viewerLogin());
  }

  async viewerLogin(): Promise<string> {
    return runGhApiRestJson<{ login: string }>('GET', 'user').login;
  }

  /** GitHub creates a label on first use, so `ensureLabel` is a no-op. */
  private claimOps(): ClaimOps {
    const assignees = (issue: number) => `repos/${this.repo}/issues/${issue}/assignees`;
    return {
      read: async (issue) => {
        const row = mapRestIssue(viewIssue(this.repo, issue));
        return { state: row.state, labels: row.labels.map((l) => l.name), assignees: row.assignees ?? [], updatedAt: row.updatedAt };
      },
      prActivity: async (issue) => latestClosingPrActivity(listPrs(this.repo, 'open', 100), issue),
      ensureLabel: async () => {},
      labelAdd: (issue, label) => this.labelAdd({ type: 'issue', number: issue }, [label]),
      labelRemove: (issue, label) => this.labelRemove({ type: 'issue', number: issue }, [label]),
      assign: async (issue, user) => {
        runGhApiRestJson('POST', assignees(issue), { assignees: [user] });
      },
      unassign: async (issue, user) => {
        runGhApiRestJson('DELETE', assignees(issue), { assignees: [user] });
      },
    };
  }

  async prChecks(number: number): Promise<ForgeCheck[]> {
    const pr = viewPr(this.repo, number);
    return listChecks(this.repo, pr.headRefOid ?? '');
  }

  async prFiles(number: number): Promise<string[]> {
    return listPrFiles(this.repo, number);
  }

  async prChangeBase(number: number, base: string): Promise<PrChangeBaseResult> {
    return changePrBase(this.repo, number, base);
  }

  async prUpdateBranch(number: number, expectedHeadSha: string): Promise<PrUpdateBranchResult> {
    return updatePrBranch(this.repo, number, expectedHeadSha);
  }

  async getDependencies(target: DependencyTarget): Promise<ForgeDependencies> {
    return readDependencies('github', this.repo, target, this.nativeDependencies(), this.prBodies());
  }

  async setDependencies(target: DependencyTarget, blockedBy: DependencyRef[]): Promise<ForgeDependencies> {
    return writeDependencies('github', this.repo, target, blockedBy, this.nativeDependencies(), this.prBodies());
  }

  /**
   * GitHub's issue dependencies ("blocked by") join two ISSUES: a pull request on either end is
   * refused with 422 "Source issue may only be an issue". So edges are read and written on the
   * queue issue, and only a same-repo issue can be the blocker; a PR, cross-repo or issue-less
   * blocker is a PR-body line. The POST names the blocker by its global issue `id`, so each add
   * reads the blocker first and refuses one that turns out to be a pull request. A repo without
   * the feature answers 404 (or 410); any other failure, a 403 included, throws.
   */
  private nativeDependencies(): NativeDependencyChannel {
    const endpoint = (issue: number) => `repos/${this.repo}/issues/${issue}/dependencies/blocked_by`;
    return {
      list: ({ issue }) => {
        if (issue == null) return [];
        const edges: NativeEdge[] = [];
        for (let page = 1; page <= BLOCKER_MAX_PAGES; page++) {
          const result = runGhApi('GET', `${endpoint(issue)}?per_page=${BLOCKER_PAGE}&page=${page}`);
          if (result.status !== 0) {
            if (page === 1 && isUnavailable(result.stderr)) return null;
            throw new Error(result.stderr.trim() || `reading the blockers of issue #${issue} failed`);
          }
          const rows = JSON.parse(result.stdout || '[]') as RestBlockerRow[];
          for (const row of rows) {
            const repo = row.repository_url?.split('/repos/')[1] ?? this.repo;
            edges.push({ ref: { repo, number: row.number, kind: row.pull_request ? 'pr' : 'issue' }, handle: row.id });
          }
          if (rows.length < BLOCKER_PAGE) return edges;
        }
        throw new Error(`issue #${issue} lists more than ${BLOCKER_PAGE * BLOCKER_MAX_PAGES} blockers`);
      },
      holds: (ref, target) => target.issue != null && ref.repo === this.repo && ref.kind === 'issue',
      add: ({ issue }, ref) => {
        const row = runGhApiRestJson<{ id: number; pull_request?: unknown }>('GET', `repos/${ref.repo}/issues/${ref.number}`);
        if (row.pull_request) throw new Error(`#${ref.number} is a pull request; GitHub blocked_by joins issues only`);
        runGhApiRestJson('POST', endpoint(issue as number), { issue_id: row.id });
      },
      remove: ({ issue }, edge) => {
        runGhApiRestJson('DELETE', `${endpoint(issue as number)}/${edge.handle}`);
      },
    };
  }

  private prBodies(): BodyChannel {
    return {
      read: (pr) => viewPr(this.repo, pr).body,
      write: (pr, body) => {
        runGhApiRestJson('PATCH', `repos/${this.repo}/pulls/${pr}`, { body });
      },
    };
  }

  getPrHeadSha(pr: number): Promise<string> {
    return this.prView(pr).then((row) => {
      if (!row.headRefOid) {
        throw new Error(`pr ${pr} missing headRefOid`);
      }
      return row.headRefOid;
    });
  }

  listWorkflowRuns(sha: string): Promise<
    { id: number; name: string; head_sha: string; conclusion: string | null }[]
  > {
    return Promise.resolve(
      runGhApiJson<{
        workflow_runs: { id: number; name: string; head_sha: string; conclusion: string | null }[];
      }>(`repos/${this.repo}/actions/runs?head_sha=${sha}&per_page=20`).workflow_runs,
    );
  }

  listWorkflowJobs(runId: number): Promise<
    {
      id: number;
      name: string;
      conclusion: string | null;
      run_id: number;
      steps?: { name: string; conclusion: string | null; number: number }[];
    }[]
  > {
    return Promise.resolve(
      runGhApiJson<{
        jobs: {
          id: number;
          name: string;
          conclusion: string | null;
          run_id: number;
          steps?: { name: string; conclusion: string | null; number: number }[];
        }[];
      }>(`repos/${this.repo}/actions/runs/${runId}/jobs?per_page=100`).jobs,
    );
  }

  getJobLog(jobId: number): Promise<string> {
    return Promise.resolve(runGhApiText(`repos/${this.repo}/actions/jobs/${jobId}/logs`));
  }

  /** The logs of every failed job in the run, joined (REST equivalent of `gh run view --log-failed`). */
  async getFailedRunLog(runId: number): Promise<string> {
    const jobs = await this.listWorkflowJobs(runId);
    const failed = jobs.filter((job) => job.conclusion === 'failure');
    const logs = await Promise.all(failed.map(async (job) => `=== ${job.name} ===\n${await this.getJobLog(job.id)}`));
    return logs.join('\n');
  }

  resolveDefaultRepo(): string {
    const slug = repoSlugFromOrigin(readOriginUrl(process.cwd()));
    if (!slug) throw new Error('origin is not a GitHub remote; pass --repo owner/name');
    return slug;
  }
}

export function createGitHubAdapter(repo: string): GitHubForgeAdapter {
  return new GitHubForgeAdapter(repo);
}
