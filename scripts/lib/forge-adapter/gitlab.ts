import { runGlab, runGlabJson, runGlabText } from './glab-cli.ts';
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

type GlabIssueRow = {
  iid?: number;
  number?: number;
  title: string;
  description?: string;
  body?: string;
  labels?: string[];
  milestone?: { title: string } | null;
  state?: string;
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

  async prChecks(number: number): Promise<ForgeCheck[]> {
    try {
      const pipeline = runGlabJson<{ status: string; detailed_status?: { group?: string } }>([
        'ci',
        'status',
        ...this.repoFlag(),
        '--mr',
        String(number),
      ]);
      return [
        {
          name: 'pipeline',
          status: pipeline.status === 'running' ? 'IN_PROGRESS' : 'COMPLETED',
          conclusion:
            pipeline.detailed_status?.group === 'success'
              ? 'SUCCESS'
              : pipeline.detailed_status?.group === 'failed'
                ? 'FAILURE'
                : null,
        },
      ];
    } catch {
      return [];
    }
  }
}

export function createGitLabAdapter(repo: string): GitLabForgeAdapter {
  return new GitLabForgeAdapter(repo);
}
