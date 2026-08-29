/** Supported forge backends — ADR-027 */
export type ForgeType = 'github' | 'gitea' | 'gitlab';

export interface ForgeIssue {
  number: number;
  title: string;
  body: string;
  labels: Array<{ name: string }>;
  milestone: { title: string } | null;
  state: 'OPEN' | 'CLOSED';
}

export interface ForgePr {
  number: number;
  title: string;
  body: string;
  headRefName: string;
  headRefOid?: string;
  state: 'OPEN' | 'CLOSED' | 'MERGED';
  mergedAt: string | null;
}

export interface ForgeCheck {
  name: string;
  status: 'QUEUED' | 'IN_PROGRESS' | 'COMPLETED';
  conclusion:
    | 'SUCCESS'
    | 'FAILURE'
    | 'NEUTRAL'
    | 'CANCELLED'
    | 'SKIPPED'
    | 'ACTION_REQUIRED'
    | null;
}

export interface ForgeAuthStatus {
  ok: boolean;
  forge: ForgeType;
  host: string | null;
  detail?: string;
}

export interface IssueListFilter {
  state?: 'open' | 'closed' | 'all';
  labels?: string[];
  milestone?: string;
  limit?: number;
}

export interface IssueCreateParams {
  title: string;
  body: string;
  labels?: string[];
}

export interface IssueEditParams {
  title?: string;
  body?: string;
}

export interface PrCreateParams {
  title: string;
  body: string;
  head: string;
  base: string;
}

export interface ForgeAdapterConfig {
  repo: string;
  forge?: ForgeType;
}

export interface ForgeAdapter {
  readonly forge: ForgeType;
  readonly repo: string;

  authStatus(): Promise<ForgeAuthStatus>;

  issueList(filter: IssueListFilter): Promise<ForgeIssue[]>;
  issueCreate(params: IssueCreateParams): Promise<ForgeIssue>;
  issueEdit(number: number, params: IssueEditParams): Promise<void>;
  issueComment(number: number, body: string): Promise<void>;

  prList(filter?: { state?: 'open' | 'closed' | 'all'; limit?: number }): Promise<ForgePr[]>;
  prView(number: number): Promise<ForgePr>;
  prCreate(params: PrCreateParams): Promise<ForgePr>;
  prComment(number: number, body: string): Promise<void>;

  labelAdd(entity: { type: 'issue' | 'pr'; number: number }, labels: string[]): Promise<void>;
  labelRemove(entity: { type: 'issue' | 'pr'; number: number }, labels: string[]): Promise<void>;

  prChecks(number: number): Promise<ForgeCheck[]>;
}
