import { runTea, runTeaJson, runTeaText } from './tea-cli.ts';
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

  async prList(filter: { state?: 'open' | 'closed' | 'all'; limit?: number } = {}): Promise<ForgePr[]> {
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

  async prChecks(number: number): Promise<ForgeCheck[]> {
    try {
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
    } catch {
      return [];
    }
  }
}

export function createGiteaAdapter(repo: string): GiteaForgeAdapter {
  return new GiteaForgeAdapter(repo);
}
