import { runGh, runGhJson, runGhText, runGhApiJson, runGhApiText } from './cli.ts';
import type {
  ForgeAdapter,
  ForgeAdapterConfig,
  ForgeAuthStatus,
  ForgeCheck,
  ForgeIssue,
  ForgePr,
  IssueCreateParams,
  IssueEditParams,
  IssueListFilter,
  PrCreateParams,
} from './types.ts';

type GhIssueRow = {
  number: number;
  title: string;
  body: string;
  labels: Array<{ name: string }>;
  milestone: { title: string } | null;
  state: string;
};

type GhPrRow = {
  number: number;
  title: string;
  body: string;
  headRefName: string;
  headRefOid?: string;
  state: string;
  mergedAt: string | null;
};

type GhCheckRow = {
  name: string;
  state: string;
  conclusion: string | null;
};

function normalizeIssueState(state: string): ForgeIssue['state'] {
  return state === 'CLOSED' ? 'CLOSED' : 'OPEN';
}

function normalizePrState(state: string): ForgePr['state'] {
  if (state === 'MERGED') return 'MERGED';
  if (state === 'CLOSED') return 'CLOSED';
  return 'OPEN';
}

function normalizeCheck(row: GhCheckRow): ForgeCheck {
  const status =
    row.state === 'IN_PROGRESS'
      ? 'IN_PROGRESS'
      : row.state === 'QUEUED' || row.state === 'PENDING'
        ? 'QUEUED'
        : 'COMPLETED';
  const conclusion = row.conclusion as ForgeCheck['conclusion'];
  return { name: row.name, status, conclusion };
}

function mapIssue(row: GhIssueRow): ForgeIssue {
  return {
    number: row.number,
    title: row.title,
    body: row.body,
    labels: row.labels,
    milestone: row.milestone,
    state: normalizeIssueState(row.state),
  };
}

function mapPr(row: GhPrRow): ForgePr {
  return {
    number: row.number,
    title: row.title,
    body: row.body,
    headRefName: row.headRefName,
    headRefOid: row.headRefOid,
    state: normalizePrState(row.state),
    mergedAt: row.mergedAt,
  };
}

export class GitHubForgeAdapter implements ForgeAdapter {
  readonly forge = 'github' as const;

  constructor(readonly repo: string) {}

  async authStatus(): Promise<ForgeAuthStatus> {
    const result = runGh(['auth', 'status']);
    if (result.error?.code === 'ENOENT') {
      return {
        ok: false,
        forge: 'github',
        host: null,
        detail: 'GitHub CLI not found — install gh and run `gh auth login`',
      };
    }
    if (result.status !== 0) {
      return {
        ok: false,
        forge: 'github',
        host: null,
        detail: result.stderr.trim() || result.stdout.trim() || 'gh auth status failed',
      };
    }
    const hostMatch = result.stdout.match(/Logged in to github\.com/);
    return {
      ok: true,
      forge: 'github',
      host: hostMatch ? 'github.com' : null,
    };
  }

  async issueList(filter: IssueListFilter = {}): Promise<ForgeIssue[]> {
    const args = [
      'issue',
      'list',
      '--json',
      'number,title,body,labels,milestone,state',
      '--limit',
      String(filter.limit ?? 200),
    ];
    if (filter.state) args.push('--state', filter.state);
    if (filter.labels?.length) args.push('--label', filter.labels.join(','));
    if (filter.milestone) args.push('--milestone', filter.milestone);
    const rows = runGhJson<GhIssueRow[]>(args, { repo: this.repo });
    return rows.map(mapIssue);
  }

  async issueCreate(params: IssueCreateParams): Promise<ForgeIssue> {
    const args = [
      'issue',
      'create',
      '--title',
      params.title,
      '--body',
      params.body,
      '--json',
      'number,title,body,labels,milestone,state',
    ];
    if (params.labels?.length) args.push('--label', params.labels.join(','));
    return mapIssue(runGhJson<GhIssueRow>(args, { repo: this.repo }));
  }

  async issueEdit(number: number, params: IssueEditParams): Promise<void> {
    const args = ['issue', 'edit', String(number)];
    if (params.title) args.push('--title', params.title);
    if (params.body) args.push('--body', params.body);
    runGhText(args, { repo: this.repo });
  }

  async issueComment(number: number, body: string): Promise<void> {
    runGhText(['issue', 'comment', String(number), '--body', body], { repo: this.repo });
  }

  async prList(filter: { state?: 'open' | 'closed' | 'all'; limit?: number } = {}): Promise<ForgePr[]> {
    const args = [
      'pr',
      'list',
      '--json',
      'number,title,body,headRefName,state,mergedAt',
      '--limit',
      String(filter.limit ?? 100),
    ];
    if (filter.state) args.push('--state', filter.state);
    const rows = runGhJson<GhPrRow[]>(args, { repo: this.repo });
    return rows.map(mapPr);
  }

  async prView(number: number): Promise<ForgePr> {
    return mapPr(
      runGhJson<GhPrRow>(
        ['pr', 'view', String(number), '--json', 'number,title,body,headRefName,headRefOid,state,mergedAt'],
        { repo: this.repo },
      ),
    );
  }

  async prCreate(params: PrCreateParams): Promise<ForgePr> {
    const args = [
      'pr',
      'create',
      '--title',
      params.title,
      '--body',
      params.body,
      '--head',
      params.head,
      '--base',
      params.base,
      '--json',
      'number,title,body,headRefName,state,mergedAt',
    ];
    return mapPr(runGhJson<GhPrRow>(args, { repo: this.repo }));
  }

  async prComment(number: number, body: string): Promise<void> {
    runGhText(['pr', 'comment', String(number), '--body', body], { repo: this.repo });
  }

  async labelAdd(entity: { type: 'issue' | 'pr'; number: number }, labels: string[]): Promise<void> {
    if (labels.length === 0) return;
    const target = entity.type === 'issue' ? 'issue' : 'pr';
    runGhText([target, 'edit', String(entity.number), '--add-label', labels.join(',')], {
      repo: this.repo,
    });
  }

  async labelRemove(entity: { type: 'issue' | 'pr'; number: number }, labels: string[]): Promise<void> {
    if (labels.length === 0) return;
    const target = entity.type === 'issue' ? 'issue' : 'pr';
    runGhText([target, 'edit', String(entity.number), '--remove-label', labels.join(',')], {
      repo: this.repo,
    });
  }

  async prChecks(number: number): Promise<ForgeCheck[]> {
    const rows = runGhJson<GhCheckRow[]>(
      ['pr', 'checks', String(number), '--json', 'name,state,conclusion'],
      { repo: this.repo },
    );
    return rows.map(normalizeCheck);
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
      }>(`repos/${this.repo}/actions/runs?head_sha=${sha}&per_page=20`).then((d) => d.workflow_runs),
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
      }>(`repos/${this.repo}/actions/runs/${runId}/jobs?per_page=100`).then((d) => d.jobs),
    );
  }

  getJobLog(jobId: number): Promise<string> {
    return Promise.resolve(runGhApiText(`repos/${this.repo}/actions/jobs/${jobId}/logs`));
  }

  getFailedRunLog(runId: number): Promise<string> {
    return Promise.resolve(
      runGhText(['run', 'view', String(runId), '--log-failed'], { repo: this.repo }),
    );
  }

  resolveDefaultRepo(): string {
    const data = runGhJson<{ nameWithOwner: string }>(['repo', 'view', '--json', 'nameWithOwner']);
    return data.nameWithOwner;
  }
}

export function createGitHubAdapter(repo: string): GitHubForgeAdapter {
  return new GitHubForgeAdapter(repo);
}
