/** Supported forge backends — ADR-027 */
export type ForgeType = 'github' | 'gitea' | 'gitlab';

export interface ForgeIssue {
  number: number;
  title: string;
  body: string;
  labels: Array<{ name: string }>;
  milestone: { title: string } | null;
  state: 'OPEN' | 'CLOSED';
  /** Assignee logins; absent when the channel does not report them. */
  assignees?: string[];
  /** Last update time; absent when the channel does not report it. */
  updatedAt?: string | null;
}

export interface ForgePr {
  number: number;
  title: string;
  body: string;
  headRefName: string;
  headRefOid?: string;
  /** Branch the PR targets; absent when the channel does not report it. */
  baseRefName?: string;
  /** True when the head branch lives in another repository, so it can never be a base branch. */
  headRepoIsFork?: boolean;
  draft?: boolean;
  createdAt?: string | null;
  /** Last update time; absent when the channel does not report it. */
  updatedAt?: string | null;
  state: 'OPEN' | 'CLOSED' | 'MERGED';
  mergedAt: string | null;
  /** Label names; absent when the channel does not report them. */
  labels?: string[];
  /** False when the forge reports a conflict, true when it reports none, null when it has not computed it yet; absent when the channel does not report it. */
  mergeable?: boolean | null;
}

/** `ok` is true only when the base read back after the change equals the requested base. */
export interface PrChangeBaseResult {
  ok: boolean;
  base: string | null;
  detail?: string;
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

/** Merge switches of a repository; Gitea spells the merge-commit and rebase switches differently from GitHub. */
export type RepoMergeSettings = {
  allow_squash_merge?: boolean;
  allow_merge_commit?: boolean;
  allow_merge_commits?: boolean;
  allow_rebase_merge?: boolean;
  allow_rebase?: boolean;
};

/**
 * One "blocked by" edge on the forge: issue or pull request `number` of `repo` (`owner/name`).
 * GitHub and Gitea number issues and PRs in one sequence; GitLab numbers issues (`#N`) and merge
 * requests (`!N`) apart, so `kind` names which one `number` is. `via` is set on a read: the channel
 * the edge was found in, so a write keeps an edge it cannot place anywhere else where it was.
 */
export interface DependencyRef {
  repo: string;
  number: number;
  kind: 'issue' | 'pr';
  via?: 'native' | 'body';
}

/**
 * Whose blockers: a queue issue and its open PR. GitHub's and Gitea's native "blocked by" edges
 * join two ISSUES (GitHub answers 422 "Source issue may only be an issue" for a PR), so they are
 * read and written on `issue`; GitLab's join merge requests, so on `pr`. Body lines live in the PR
 * body. `issue` is null for a PR with no queue issue: its edges are body lines only.
 */
export interface DependencyTarget {
  issue: number | null;
  pr: number;
}

/**
 * The blockers declared on the forge: native "blocked by" edges plus the `Blocked by #N` lines of
 * the PR body. `native` is false when the forge answered that the native feature does not exist
 * here (HTTP 404/410), so every edge is a body line; any other failure throws.
 */
export interface ForgeDependencies {
  native: boolean;
  blockedBy: DependencyRef[];
}

/**
 * One claim of an issue for a lane (ADR-054 C4). `HELD`: another lane holds a live claim (`held_by`).
 * `RECLAIMED`: a stale claim was taken over. `CLOSED`: the issue is closed, nothing was written.
 */
export interface ClaimResult {
  verdict: 'CLAIMED' | 'ALREADY-OWN' | 'RECLAIMED' | 'HELD' | 'CLOSED';
  held_by?: string;
}

export interface ReleaseResult {
  verdict: 'RELEASED' | 'NOT-HELD';
}

export interface ClaimLease {
  leaseHours: number;
  /** Epoch ms; defaults to the clock. */
  now?: number;
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

  /** Every path the PR changes; both sides of a rename. Throws when the list may be truncated. */
  prFiles(number: number): Promise<string[]>;
  /** Retargets the PR, then reads the base back: exit status is not evidence the base moved. */
  prChangeBase(number: number, base: string): Promise<PrChangeBaseResult>;

  /** The target's forge-declared blockers (native edges and PR-body lines), each once. */
  getDependencies(target: DependencyTarget): Promise<ForgeDependencies>;
  /**
   * Makes the target's blockers exactly `blockedBy`: native edges where the forge holds them, a
   * PR-body line otherwise; edges and lines outside the set are removed. Writes nothing when the
   * set already matches. Returns the set read back after the write.
   */
  setDependencies(target: DependencyTarget, blockedBy: DependencyRef[]): Promise<ForgeDependencies>;

  /**
   * Claims the issue for `lane`: adds `in-progress:<lane>` and assigns `user`. A live claim of
   * another lane answers `HELD` and writes nothing; a claim stale past the lease is taken over.
   */
  claim(issue: number, lane: string, user: string, lease?: ClaimLease): Promise<ClaimResult>;
  /** Removes the lane label and the authenticated user's assignment; `NOT-HELD` writes nothing. */
  release(issue: number, lane: string): Promise<ReleaseResult>;
  /** The login the forge CLI is authenticated as. */
  viewerLogin(): Promise<string>;
}
