import { readOriginUrl } from '../forge-detection.ts';
import { runGhApi, runGhApiJson, runGhApiRestJson, runGhApiText } from './cli.ts';
import {
  listChecks,
  listIssues,
  listPrs,
  mapRestIssue,
  mapRestPr,
  removeLabel,
  repoSlugFromOrigin,
  viewPr,
  type RestIssueRow,
  type RestPrRow,
} from './github-rest.ts';
import type {
  ForgeAdapter,
  ForgeAuthStatus,
  ForgeCheck,
  ForgeIssue,
  ForgePr,
  IssueCreateParams,
  IssueEditParams,
  IssueListFilter,
  PrCreateParams,
} from './types.ts';

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

  async prChecks(number: number): Promise<ForgeCheck[]> {
    const pr = viewPr(this.repo, number);
    return listChecks(this.repo, pr.headRefOid ?? '');
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
