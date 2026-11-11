import { spawnSync } from 'child_process';

// Merge-only stacked-PR recovery. Every operation here produces a NEW commit on top of the
// child's remote head and publishes it as a fast-forward push, so history is only ever appended.
// The git plumbing is `merge-tree --write-tree --merge-base` (a three-way merge with a caller
// chosen base, no worktree needed) plus `commit-tree` with two parents. The recorded parent tip is
// the merge base: after the parent lands (squash, commit-by-commit landing, closed unmerged, force-pushed) the child
// still contains that tip, so the merge sees exactly the child's own changes versus the parent's.

export type GitRun = { ok: boolean; code: number; stdout: string; stderr: string };

export type GitRunner = (repoRoot: string, args: string[], input?: string) => GitRun;

/** Campaign branch-naming convention — the sole derivation site. */
export const childBranchFor = (issue: number): string => `blackhole/issue-${issue}`;

// Closed allowlist: a subcommand outside this set never reaches git, so history-rewriting
// operations are unrepresentable rather than merely unused.
const ALLOWED_SUBCOMMANDS = new Set([
  'merge-tree',
  'commit-tree',
  'rev-parse',
  'merge-base',
  'diff',
  'patch-id',
  'fetch',
  'push',
  'merge',
]);

const PUSH_REFSPEC = /^[0-9a-f]{40}:refs\/heads\/blackhole\/issue-\d+$/;

/** Throws when `args` is not an operation this module is allowed to run. */
export const assertAllowedGit = (args: string[]): void => {
  const sub = args.find((a) => !a.startsWith('-'));
  if (sub === undefined || !ALLOWED_SUBCOMMANDS.has(sub)) {
    throw new Error(`git ${sub ?? '(none)'} is not an allowed stack-merge operation`);
  }
  if (sub === 'merge' && !args.includes('--ff-only')) {
    throw new Error('merge is only allowed as --ff-only');
  }
  if (sub === 'push') {
    const rest = args.slice(args.indexOf('push') + 1);
    const [remote, refspec, ...extra] = rest;
    if (extra.length > 0 || remote === undefined || remote.startsWith('-') || refspec === undefined || !PUSH_REFSPEC.test(refspec)) {
      throw new Error(`push must be exactly "<remote> <sha>:refs/heads/blackhole/issue-N" (got: ${rest.join(' ')})`);
    }
  }
};

export const realGit: GitRunner = (repoRoot, args, input) => {
  assertAllowedGit(args);
  const result = spawnSync('git', ['-C', repoRoot, ...args], { encoding: 'utf-8', input });
  return { ok: result.status === 0, code: result.status ?? -1, stdout: result.stdout ?? '', stderr: result.stderr ?? '' };
};

export const revParse = (repoRoot: string, rev: string, git: GitRunner = realGit): string | null => {
  const result = git(repoRoot, ['rev-parse', '--verify', '--quiet', `${rev}^{commit}`]);
  return result.ok ? result.stdout.trim() : null;
};

export const isAncestor = (repoRoot: string, ancestor: string, descendant: string, git: GitRunner = realGit): boolean =>
  git(repoRoot, ['merge-base', '--is-ancestor', ancestor, descendant]).ok;

/** Changed-file count between two revisions, the same number a PR's "files changed" reports. */
export const changedFileCount = (
  repoRoot: string,
  from: string,
  to: string,
  threeDot = false,
  git: GitRunner = realGit,
): number => {
  const range = threeDot ? `${from}...${to}` : `${from}..${to}`;
  const result = git(repoRoot, ['diff', '--name-only', range]);
  if (!result.ok) throw new Error(`git diff ${range} failed: ${result.stderr.trim()}`);
  return result.stdout.split('\n').filter((line) => line.trim() !== '').length;
};

/**
 * Stable patch-id of the diff `base..head`, or null when the diff is empty. Line numbers and
 * whitespace are ignored, so it is equal before and after a conflict-free replay that only moved
 * the child onto a base with the same content.
 */
export const ownPatchId = (repoRoot: string, base: string, head: string, git: GitRunner = realGit): string | null => {
  const diff = git(repoRoot, ['diff', '--no-color', '--binary', `${base}..${head}`]);
  if (!diff.ok) throw new Error(`git diff ${base}..${head} failed: ${diff.stderr.trim()}`);
  if (diff.stdout === '') return null;
  const id = git(repoRoot, ['patch-id', '--stable'], diff.stdout);
  if (!id.ok) throw new Error(`git patch-id failed: ${id.stderr.trim()}`);
  const first = id.stdout.trim().split(/\s+/)[0];
  return first === '' || first === undefined ? null : first;
};

export type MergeTreeSupport = { supported: true } | { supported: false; reason: string };

/**
 * `merge-tree --write-tree --merge-base` needs git 2.40. Probed by running it, not by parsing a
 * version string, so a distro backport or a stripped build is judged by behaviour. A failing
 * probe means "unsupported"; callers must stop, never fall back to another merge strategy.
 */
export const probeMergeTreeMergeBase = (repoRoot: string, git: GitRunner = realGit): MergeTreeSupport => {
  const probe = git(repoRoot, ['merge-tree', '--write-tree', '--merge-base=HEAD', 'HEAD', 'HEAD']);
  return probe.ok
    ? { supported: true }
    : { supported: false, reason: `git merge-tree --write-tree --merge-base is unavailable (git >= 2.40 required): ${probe.stderr.trim()}` };
};

export type TreeMerge = { clean: true; tree: string } | { clean: false; conflicts: string[] } | { clean: null; error: string };

const mergeTree = (repoRoot: string, git: GitRunner, sides: [string, string], mergeBase: string | null): TreeMerge => {
  const args = ['merge-tree', '--write-tree', '--name-only', ...(mergeBase === null ? [] : [`--merge-base=${mergeBase}`]), ...sides];
  const result = git(repoRoot, args);
  const lines = result.stdout.split('\n');
  if (result.code === 0) return { clean: true, tree: lines[0].trim() };
  if (result.code === 1) {
    const blank = lines.indexOf('');
    const conflicts = lines.slice(1, blank === -1 ? lines.length : blank).filter((l) => l.trim() !== '');
    return { clean: false, conflicts: [...new Set(conflicts)] };
  }
  return { clean: null, error: result.stderr.trim() || `git merge-tree exited ${result.code}` };
};

export type QueueLike = { issues?: Record<string, unknown> };

/** Refuses any push target that is not a `blackhole/issue-N` branch of an issue in the queue. */
export const assertOwnedBranch = (branch: string, queue: QueueLike): void => {
  const owned = Object.keys(queue.issues ?? {}).map((id) => childBranchFor(Number(id)));
  if (!owned.includes(branch)) {
    throw new Error(`refusing to push "${branch}": not a queue-owned blackhole/issue-N branch`);
  }
};

export type ReplayRefusalCode =
  | 'unresolved-rev'
  | 'not-ancestor'
  | 'merge-error'
  | 'file-count'
  | 'patch-id'
  | 'unowned'
  | 'push-rejected';

export type ReplayResult =
  | {
      status: 'merged';
      sha: string;
      parents: [string, string];
      expectedFiles: number;
      observedFiles: number;
      /** True when the child's own patch is unchanged, so an earlier review still applies. */
      reviewCarry: boolean;
      pushed: boolean;
    }
  | { status: 'up-to-date' }
  | { status: 'conflict'; conflicts: string[] }
  | { status: 'unsupported'; reason: string }
  | { status: 'refused'; code: ReplayRefusalCode; reason: string };

export type PushTarget = { remote: string; queue: QueueLike };

export type ReplayOptions = {
  repoRoot: string;
  /** Branch (or rev) of the child; its remote head is what the new commit extends. */
  child: string;
  /** Branch name pushed to. Defaults to `child`. */
  childBranch?: string;
  /** What the child must absorb: the target branch after a landing, or a force-pushed parent head. */
  newBase: string;
  /** The recorded parent tip. */
  mergeBase: string;
  /** Omit to build the commit locally without publishing it. */
  push?: PushTarget;
  /** Accept a changed patch-id after a clean merge (an explicitly approved case). */
  acceptPatchIdChange?: boolean;
  git?: GitRunner;
};

const commitMerge = (repoRoot: string, git: GitRunner, tree: string, parents: [string, string], message: string): string | null => {
  const result = git(repoRoot, ['commit-tree', tree, '-p', parents[0], '-p', parents[1], '-m', message]);
  return result.ok ? result.stdout.trim() : null;
};

const publish = (
  repoRoot: string,
  git: GitRunner,
  push: PushTarget,
  branch: string,
  sha: string,
): { ok: true } | { ok: false; code: ReplayRefusalCode; reason: string } => {
  try {
    assertOwnedBranch(branch, push.queue);
  } catch (error) {
    return { ok: false, code: 'unowned', reason: (error as Error).message };
  }
  const result = git(repoRoot, ['push', push.remote, `${sha}:refs/heads/${branch}`]);
  return result.ok ? { ok: true } : { ok: false, code: 'push-rejected', reason: result.stderr.trim() };
};

/**
 * Replay merge: three-way merge of `newBase` into `child` with `mergeBase` (the recorded parent
 * tip) as the base, committed with parents [child, newBase]. Guards, in order: git support,
 * `mergeBase` is an ancestor of `child`, a conflict-free tree, an unchanged own-diff file count,
 * an unchanged own patch-id, an owned branch, and a fast-forward-only push. Any failed guard
 * leaves nothing published.
 */
export const replayMerge = (options: ReplayOptions): ReplayResult => {
  const git = options.git ?? realGit;
  const { repoRoot } = options;
  const support = probeMergeTreeMergeBase(repoRoot, git);
  if (!support.supported) return { status: 'unsupported', reason: support.reason };

  const child = revParse(repoRoot, options.child, git);
  const newBase = revParse(repoRoot, options.newBase, git);
  const mergeBase = revParse(repoRoot, options.mergeBase, git);
  if (child === null || newBase === null || mergeBase === null) {
    return { status: 'refused', code: 'unresolved-rev', reason: `cannot resolve ${[options.child, options.newBase, options.mergeBase].join(', ')}` };
  }
  if (!isAncestor(repoRoot, mergeBase, child, git)) {
    return {
      status: 'refused',
      code: 'not-ancestor',
      reason: `recorded parent tip ${mergeBase} is not an ancestor of ${options.child} — the merge base is wrong and the replay would drop or duplicate work`,
    };
  }

  const expectedFiles = changedFileCount(repoRoot, mergeBase, child, false, git);
  const expectedPatchId = ownPatchId(repoRoot, mergeBase, child, git);

  const merged = mergeTree(repoRoot, git, [child, newBase], mergeBase);
  if (merged.clean === null) return { status: 'refused', code: 'merge-error', reason: merged.error };
  if (!merged.clean) return { status: 'conflict', conflicts: merged.conflicts };

  // An abandoned parent leaves newBase already in the child's history yet still needs the replay
  // to strip the parent lines, so ancestry alone is not enough: the merged tree must be unchanged.
  const childTree = git(repoRoot, ['rev-parse', '--verify', '--quiet', `${child}^{tree}`]).stdout.trim();
  if (isAncestor(repoRoot, newBase, child, git) && merged.tree === childTree) return { status: 'up-to-date' };

  const branch = options.childBranch ?? options.child;
  const sha = commitMerge(repoRoot, git, merged.tree, [child, newBase], `Merge ${options.newBase} into ${branch} (replay from recorded parent tip)`);
  if (sha === null) return { status: 'refused', code: 'merge-error', reason: 'git commit-tree failed' };

  const observedFiles = changedFileCount(repoRoot, newBase, sha, false, git);
  if (observedFiles !== expectedFiles) {
    return {
      status: 'refused',
      code: 'file-count',
      reason: `own-diff file count is ${observedFiles} after the replay, expected ${expectedFiles} — nothing pushed`,
    };
  }
  const reviewCarry = ownPatchId(repoRoot, newBase, sha, git) === expectedPatchId;
  if (!reviewCarry && options.acceptPatchIdChange !== true) {
    return { status: 'refused', code: 'patch-id', reason: 'own patch-id changed across a conflict-free replay — nothing pushed, route to review' };
  }

  if (options.push === undefined) {
    return { status: 'merged', sha, parents: [child, newBase], expectedFiles, observedFiles, reviewCarry, pushed: false };
  }
  const published = publish(repoRoot, git, options.push, branch, sha);
  if (!published.ok) return { status: 'refused', code: published.code, reason: published.reason };
  return { status: 'merged', sha, parents: [child, newBase], expectedFiles, observedFiles, reviewCarry, pushed: true };
};

export type RestackOptions = {
  repoRoot: string;
  child: string;
  childBranch?: string;
  /** Head of the parent branch the child is being stacked on. */
  parentHead: string;
  push?: PushTarget;
  git?: GitRunner;
};

export type RestackResult =
  | { status: 'merged'; sha: string; pushed: boolean }
  | { status: 'up-to-date' }
  | { status: 'conflict'; conflicts: string[] }
  | { status: 'unsupported'; reason: string }
  | { status: 'refused'; code: ReplayRefusalCode; reason: string };

/** Ordinary merge of the parent head into the child (merge-base found by git), then a fast-forward push. */
export const restackOnto = (options: RestackOptions): RestackResult => {
  const git = options.git ?? realGit;
  const { repoRoot } = options;
  const support = probeMergeTreeMergeBase(repoRoot, git);
  if (!support.supported) return { status: 'unsupported', reason: support.reason };

  const child = revParse(repoRoot, options.child, git);
  const parentHead = revParse(repoRoot, options.parentHead, git);
  if (child === null || parentHead === null) {
    return { status: 'refused', code: 'unresolved-rev', reason: `cannot resolve ${options.child} or ${options.parentHead}` };
  }
  if (isAncestor(repoRoot, parentHead, child, git)) return { status: 'up-to-date' };

  const merged = mergeTree(repoRoot, git, [child, parentHead], null);
  if (merged.clean === null) return { status: 'refused', code: 'merge-error', reason: merged.error };
  if (!merged.clean) return { status: 'conflict', conflicts: merged.conflicts };

  const branch = options.childBranch ?? options.child;
  const sha = commitMerge(repoRoot, git, merged.tree, [child, parentHead], `Merge ${options.parentHead} into ${branch}`);
  if (sha === null) return { status: 'refused', code: 'merge-error', reason: 'git commit-tree failed' };

  if (options.push === undefined) return { status: 'merged', sha, pushed: false };
  const published = publish(repoRoot, git, options.push, branch, sha);
  if (!published.ok) return { status: 'refused', code: published.code, reason: published.reason };
  return { status: 'merged', sha, pushed: true };
};

export type ForgeParentState = { state: 'open' | 'closed'; merged: boolean };

/**
 * - `merge-commit`: the parent landed with its tip in the target's history; the child needs a
 *   retarget only, no commit and no push.
 * - `rewrite`: the parent landed as new commits (squash, or commits replayed one by one); replay with the recorded tip.
 * - `abandoned`: closed without merging; replay against the parent's own base removes its lines.
 * - `force-pushed`: still open, its head no longer descends from the recorded tip; replay too.
 * - `advanced`: still open, head descends from the recorded tip; an ordinary restack applies.
 */
export type ParentLanding = 'merge-commit' | 'rewrite' | 'abandoned' | 'force-pushed' | 'advanced';

export type LandingAction = 'retarget-only' | 'replay' | 'restack';

export const landingAction = (kind: ParentLanding): LandingAction =>
  kind === 'merge-commit' ? 'retarget-only' : kind === 'advanced' ? 'restack' : 'replay';

export type ClassifyOptions = {
  repoRoot: string;
  /** Recorded parent tip. */
  parentTip: string;
  /** The target branch after a landing, or the parent's current head while it is open. */
  target: string;
  forge: ForgeParentState;
  git?: GitRunner;
};

export const classifyParentLanding = (options: ClassifyOptions): ParentLanding => {
  const { forge } = options;
  if (forge.state === 'closed' && !forge.merged) return 'abandoned';
  const reachable = isAncestor(options.repoRoot, options.parentTip, options.target, options.git ?? realGit);
  if (forge.state === 'open') return reachable ? 'advanced' : 'force-pushed';
  return reachable ? 'merge-commit' : 'rewrite';
};

/** Brings the checked-out child up to a commit this module just pushed; fast-forward only. */
export const fastForwardLocal = (repoRoot: string, sha: string, git: GitRunner = realGit): boolean =>
  git(repoRoot, ['merge', '--ff-only', '--quiet', sha]).ok;
