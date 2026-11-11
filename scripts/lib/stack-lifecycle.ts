// Stack lifecycle decisions that sit above the git mechanics in `stack-merge.ts`: which merge
// method a parent gets, what recovery each merge mode runs for each way a parent can land, and
// whether an open PR must be restacked because it newly overlaps an older one. Pure functions;
// the prose half is `merge-gate.md` § 4, § 7, § 9 and `phase-loop.md` Step 0.4.

import type { RepoMergeSettings } from './forge-adapter/types.ts';
import type { OpenPrSnapshot } from './open-pr-snapshot.ts';
import { pickParent, type ConflictVerdict, type PickParentResult } from './stack-overlap.ts';

// ---- D2: merge method of a parent ----

export type { RepoMergeSettings };

export type MergeMethod = 'merge' | 'squash' | 'rebase';

export type MergeMethodChoice = { method: MergeMethod; flag: `--${MergeMethod}`; reason: string };

const choice = (method: MergeMethod, reason: string): MergeMethodChoice => ({ method, flag: `--${method}`, reason });

/**
 * A parent with open stacked children is merged with a merge commit when the repo allows one: the
 * child then already contains the parent's tip and needs a retarget only. Every other PR keeps the
 * squash default of `merge-gate.md` § 9. Unreadable settings fall back to squash, the only method
 * every repo this campaign has met accepts, and say so.
 */
export const parentMergeMethod = (input: { hasOpenChildren: boolean; settings: RepoMergeSettings | null }): MergeMethodChoice => {
  const { hasOpenChildren, settings } = input;
  if (settings === null) return choice('squash', 'merge settings unreadable; squash is the default');
  const mergeCommit = settings.allow_merge_commit ?? settings.allow_merge_commits;
  const squash = settings.allow_squash_merge;
  const rebase = settings.allow_rebase_merge ?? settings.allow_rebase;
  if (hasOpenChildren && mergeCommit === true) {
    return choice('merge', 'open stacked children and the repo allows merge commits: the child keeps the parent tip, so no replay is needed');
  }
  if (squash !== false) {
    return choice(
      'squash',
      hasOpenChildren
        ? 'open stacked children but the repo allows no merge commit: squash, and the child recovery of merge-gate.md § 7 is mandatory'
        : 'no open stacked children: squash',
    );
  }
  if (mergeCommit === true) return choice('merge', 'the repo does not allow squash merges');
  if (rebase === true) return choice('rebase', 'the repo allows only rebase merges');
  return choice('squash', 'the repo reports no allowed merge method; squash is the default');
};

// ---- recovery per merge mode x landing ----

export const MERGE_MODES = ['immediate', 'gated-batch', 'leave-open'] as const;
export type StackMergeMode = (typeof MERGE_MODES)[number];

export const LANDINGS = ['merge', 'squash', 'rebase', 'closed-unmerged'] as const;
export type Landing = (typeof LANDINGS)[number];

export type RecoveryRoute = {
  /** Where the recovery is triggered for this merge mode. */
  trigger: string;
  /** The `stack-repair.ts` invocation, per child. */
  command: string;
  /** What the command does for this landing. */
  outcome: string;
  /** The route when the command exits non-zero. */
  hitl: string;
  /** What must be true before the child's own review or merge continues. */
  ordering: string;
};

const TRIGGERS: Record<StackMergeMode, { trigger: string; ordering: string }> = {
  immediate: {
    trigger: 'phase-loop.md step 4.6, right after step 4.5',
    ordering: "same turn, before the child's review or CI wait",
  },
  'gated-batch': {
    trigger: "merge-gate.md § 4 per-issue loop, after each parent's merge",
    ordering: 'the recovered child re-reaches CI green before its own turn in the batch',
  },
  'leave-open': {
    trigger: 'merge-gate.md § 3 externally-observed merge, at turn start',
    ordering: "same turn; the child's delivered-at-LGTM note is revoked until recovery and CI finish",
  },
};

const COMMANDS: Record<Landing, { command: string; outcome: string; hitl: string }> = {
  merge: {
    command: 'repair --apply --child-issue <N>',
    outcome: 'retarget only, no commit, no push',
    hitl: 'a failed retarget read-back: AskQuestion, retry or hold the child',
  },
  squash: {
    command: 'repair --apply --child-issue <N>',
    outcome: 'replay merge with the recorded parent tip, fast-forward push',
    hitl: 'a replay conflict: AskQuestion, resolve through merge-conflict-protocol.md § Worker delegation or hold',
  },
  rebase: {
    command: 'repair --apply --child-issue <N>',
    outcome: 'replay merge with the recorded parent tip, fast-forward push',
    hitl: 'a replay conflict: AskQuestion, resolve through merge-conflict-protocol.md § Worker delegation or hold',
  },
  'closed-unmerged': {
    command: 'repair --apply --child-issue <N> --parent-state closed-unmerged',
    outcome: "replay against the parent's own base, removing the parent's lines",
    hitl: 'a conflict, noted stack-parent-abandoned:#<P>: AskQuestion, keep the parent work, unstack or close the child',
  },
};

export const recoveryRoute = (mode: StackMergeMode, landing: Landing): RecoveryRoute => ({
  ...TRIGGERS[mode],
  ...COMMANDS[landing],
});

// ---- re-check at PR open, after a push, at turn start and before merge ----

export type RecheckDecision =
  | { action: 'none' }
  /** The PR newly overlaps an older open PR: merge that PR's branch into ours and retarget. */
  | { action: 'restack'; parent: number; parentBranch: string; alsoOverlaps: number[] }
  | { action: 'defer'; reason: string }
  | { action: 'hold'; reason: string }
  /** The check could not run. Never read as "no overlap". */
  | { action: 'unknown'; reason: string };

export type RecheckOptions = {
  conflicts: (me: { number: number; headSha: string }, other: { number: number; headSha: string }) => ConflictVerdict;
  /** True for a head branch the campaign owns and may push to. */
  isOwned: (headRefName: string) => boolean;
};

/** The snapshot without PRs younger than `me`: a younger PR stacks on ours, ours never moves for it. */
export const olderOnly = (me: number, snapshot: OpenPrSnapshot): OpenPrSnapshot =>
  snapshot.status === 'ok' ? { ...snapshot, prs: snapshot.prs.filter((p) => p.number <= me) } : snapshot;

const toDecision = (result: PickParentResult): RecheckDecision => {
  switch (result.kind) {
    case 'none':
      return { action: 'none' };
    case 'stack':
      return { action: 'restack', parent: result.parent, parentBranch: result.parentBranch, alsoOverlaps: result.alsoOverlaps };
    case 'defer':
      return { action: 'defer', reason: `stack depth cap reached under #${result.parent}` };
    case 'unstackable':
      return { action: 'hold', reason: `unstackable-parent:${result.reason}:#${result.parent}` };
    case 'unknown':
      return { action: 'unknown', reason: result.reason };
  }
};

/**
 * What a campaign PR must do after a re-check. Only an owned PR is ever moved, and only for an
 * older overlapping PR that is not already in its chain.
 */
export const recheckStack = (meNumber: number, snapshot: OpenPrSnapshot, opts: RecheckOptions): RecheckDecision => {
  if (snapshot.status !== 'ok') return { action: 'unknown', reason: snapshot.reason };
  const me = snapshot.prs.find((p) => p.number === meNumber);
  if (!me) return { action: 'unknown', reason: `PR #${meNumber} is not in the open-PR snapshot` };
  if (!opts.isOwned(me.headRefName)) return { action: 'none' };
  return toDecision(pickParent(meNumber, olderOnly(meNumber, snapshot), { conflicts: (a, b) => opts.conflicts(a, b) }));
};

/** Changed files of each queue issue's open PR, read from the snapshot; a PR whose files are unknown stays out. */
export const snapshotParentFiles = (
  issues: Record<string, { pr?: number | null }>,
  snapshot: OpenPrSnapshot,
): Record<string, string[]> => {
  if (snapshot.status !== 'ok') return {};
  const byPr = new Map(snapshot.prs.map((p) => [p.number, p.files]));
  const out: Record<string, string[]> = {};
  for (const [id, issue] of Object.entries(issues)) {
    const files = issue.pr == null ? null : byPr.get(issue.pr);
    if (files) out[id] = files;
  }
  return out;
};
