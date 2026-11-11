import * as fs from 'fs';
import { validateStateWrite } from './lib/state-write-guard.ts';
import { readJsonFile } from './lib/fs.ts';
import { runGh } from './lib/forge-adapter/cli.ts';
import { parseFlags, requireFlag, type Flags } from './lib/argv-flags.ts';
import {
  changedFileCount,
  childBranchFor,
  classifyParentLanding,
  fastForwardLocal,
  isAncestor,
  landingAction,
  realGit,
  replayMerge,
  restackOnto,
  revParse,
  type ForgeParentState,
  type ParentLanding,
} from './lib/stack-merge.ts';
import { parentMergeMethod } from './lib/stack-lifecycle.ts';
import { effectiveParent } from './lib/stack-overlap.ts';
import { readRepoMergeSettings } from './lib/forge-adapter/merge-settings.ts';
import type { ForgeType, RepoMergeSettings } from './lib/forge-adapter/types.ts';

export { changedFileCount, childBranchFor };

// Stacked-PR tip capture and post-parent-landing recovery. A parent that lands as a squash, as
// replayed commits, or not at all leaves the child claiming the parent's work as its own. The
// recovery is a merge, never a history rewrite: the child's remote head gains one commit whose
// tree is a three-way merge with the tip recorded at stack creation as the base, published as a
// fast-forward push (`lib/stack-merge.ts`). `<parent-tip>` has to be recorded before the parent
// merges, because after the parent branch is deleted the base is gone.
// The prose half (when to run each subcommand) lives in `merge-gate.md` § 7.

export type StackedIssue = {
  title?: string;
  status?: string;
  pr?: number | null;
  stacked_on?: number | null;
  stacked_on_pr?: number | null;
  parent_tip_sha?: string | null;
  [key: string]: unknown;
};

export type QueueIssues = Record<string, StackedIssue>;

export type QueueJson = { issues?: QueueIssues; [key: string]: unknown };

export type StackedChild = {
  issue: number;
  pr: number | null;
  branch: string;
  parentTipSha: string | null;
};

const OPEN_STATUSES_EXCLUDED = new Set(['merged', 'closed']);

/**
 * Open children stacked on `parentIssue`, ascending by issue number. A child whose own status is
 * already `merged`/`closed` needs no repair; everything else does, including one whose
 * `parent_tip_sha` was never recorded — that child is reported with a null tip so `planRepair`
 * can refuse loudly instead of the caller never learning it exists.
 */
export const findStackedChildren = (issues: QueueIssues, parentIssue: number): StackedChild[] =>
  Object.entries(issues)
    .filter(([, issue]) => effectiveParent(issues, issue) === parentIssue && !OPEN_STATUSES_EXCLUDED.has(issue.status ?? ''))
    .map(([id, issue]) => ({
      issue: Number(id),
      pr: issue.pr ?? null,
      branch: childBranchFor(Number(id)),
      parentTipSha: issue.parent_tip_sha ?? null,
    }))
    .sort((a, b) => a.issue - b.issue);

export type RepairPlan = { child: StackedChild; commands: string[]; refusal: string | null };

/**
 * The exact command sequence for one child, in execution order, for a parent that landed as new
 * commits. A parent merged with a merge commit stops after the read-back: the child already
 * contains the parent tip, so there is nothing to commit or push. `gh pr edit --base` is
 * deliberately absent: on a repo with classic Projects enabled it exits non-zero from a GraphQL
 * deprecation before it ever applies the base change, so the REST PATCH form is the only one that
 * both works and can be read back.
 */
export const planRepair = (child: StackedChild, base: string, repoSlug: string, repoRoot: string): RepairPlan => {
  if (child.parentTipSha === null) {
    return {
      child,
      commands: [],
      refusal:
        `no parent_tip_sha recorded for #${child.issue} — the merge base was never captured at ` +
        'stack creation and cannot be reconstructed once the parent branch is gone; recover it by hand ' +
        "from the merged parent PR's commit list",
    };
  }
  if (child.pr === null) {
    return { child, commands: [], refusal: `no PR recorded for #${child.issue} — nothing to retarget` };
  }
  return {
    child,
    commands: [
      `git -C ${repoRoot} fetch origin ${base}`,
      `gh api -X PATCH repos/${repoSlug}/pulls/${child.pr} -f base=${base}`,
      `gh api repos/${repoSlug}/pulls/${child.pr} --jq .base.ref`,
      `git -C ${repoRoot} merge-tree --write-tree --name-only --merge-base=${child.parentTipSha} ${child.branch} origin/${base}`,
      `git -C ${repoRoot} commit-tree <tree> -p ${child.branch} -p origin/${base} -m "Merge ${base} into ${child.branch} (replay from recorded parent tip)"`,
      `git -C ${repoRoot} push origin <merge-commit>:refs/heads/${child.branch}`,
    ],
    refusal: null,
  };
};

/** The commands a late restack runs: merge the parent head into the child, then retarget it. */
export const planRestack = (child: StackedChild, parentBranch: string, repoSlug: string, repoRoot: string): RepairPlan => {
  if (child.pr === null) {
    return { child, commands: [], refusal: `no PR recorded for #${child.issue} — nothing to retarget` };
  }
  return {
    child,
    commands: [
      `git -C ${repoRoot} fetch origin ${parentBranch}`,
      `gh api -X PATCH repos/${repoSlug}/pulls/${child.pr} -f base=${parentBranch}`,
      `gh api repos/${repoSlug}/pulls/${child.pr} --jq .base.ref`,
      `git -C ${repoRoot} merge-tree --write-tree --name-only ${child.branch} origin/${parentBranch}`,
      `git -C ${repoRoot} commit-tree <tree> -p ${child.branch} -p origin/${parentBranch} -m "Merge ${parentBranch} into ${child.branch}"`,
      `git -C ${repoRoot} push origin <merge-commit>:refs/heads/${child.branch}`,
    ],
    refusal: null,
  };
};

/** Queue update after a restack or a force-pushed parent: the parent tip moves, the stack link stays. */
export const recordParentTip = (queue: QueueJson, childIssue: number, tip: string, parentIssue?: number): boolean => {
  const entry = queue.issues?.[String(childIssue)];
  if (entry === undefined) return false;
  entry.parent_tip_sha = tip;
  if (parentIssue !== undefined) entry.stacked_on = parentIssue;
  return true;
};

/** The queue issue whose PR is `pr`, or undefined when the parent PR belongs to no queue issue. */
export const issueOfPr = (issues: QueueIssues, pr: number | undefined): number | undefined => {
  if (pr === undefined) return undefined;
  const hit = Object.entries(issues).find(([, v]) => v.pr === pr);
  return hit ? Number(hit[0]) : undefined;
};

/** Stack edge of a child restacked onto an open PR; `stacked_on_pr` also covers a parent with no queue issue. */
export const recordStackEdge = (queue: QueueJson, childIssue: number, parentPr: number, parentBranch: string): boolean => {
  const entry = queue.issues?.[String(childIssue)];
  if (entry === undefined) return false;
  entry.stacked_on_pr = parentPr;
  entry.parent_branch = parentBranch;
  return true;
};

export type Verdict = { ok: boolean; reason: string };

/**
 * Retarget verification. The PATCH's own exit status is not evidence: the observed `base.ref` read
 * back off the PR is.
 */
export const verifyRetarget = (observedBaseRef: string, expectedBase: string): Verdict => {
  const observed = observedBaseRef.trim();
  return observed === expectedBase
    ? { ok: true, reason: `base.ref == ${expectedBase}` }
    : { ok: false, reason: `retarget did not apply — base.ref is "${observed}", expected "${expectedBase}"` };
};

/**
 * Repair verification. `expected` is the child's own file count measured from the recorded parent
 * tip before the rebase runs, which is the same number the PR showed while its base was still the
 * parent branch — so this is the "returned to its pre-merge value" check without needing a
 * snapshot carried across the merge boundary.
 */
export const verifyChildFileCount = (expected: number, observed: number): Verdict =>
  expected === observed
    ? { ok: true, reason: `changed-file count ${observed} matches the pre-merge value` }
    : {
        ok: false,
        reason: `changed-file count is ${observed}, expected ${expected} — the child is still claiming the parent's files`,
      };

export type MergeSettings = RepoMergeSettings;

/**
 * Stack-creation-time warning. Squash is what makes stacking lossy; a repo that can also produce a
 * merge commit has an escape hatch for this stack, and one that cannot does not.
 */
export const squashMergeWarning = (settings: MergeSettings): string | null => {
  if (settings.allow_squash_merge !== true) return null;
  if ((settings.allow_merge_commit ?? settings.allow_merge_commits) === true) {
    return 'WARNING: this repo allows squash merges. Squash-merging the parent will break this stack unless the post-merge repair runs; merging the parent with a merge commit avoids the whole problem.';
  }
  return 'WARNING: this repo squash-merges and offers no merge-commit alternative. This stack WILL break when the parent lands — the post-merge repair is mandatory, not optional.';
};

const readQueue = (queuePath: string): QueueJson => readJsonFile(queuePath, queuePath) as QueueJson;

const writeQueue = (queuePath: string, queue: QueueJson): string | null => {
  const updated = { ...queue, refreshed_at: new Date().toISOString() };
  const tmpPath = `${queuePath}.tmp`;
  fs.writeFileSync(tmpPath, JSON.stringify(updated, null, 2));
  const validation = validateStateWrite({ tmpPath, livePath: queuePath, entityKey: 'issues' });
  if (!validation.ok) {
    fs.rmSync(tmpPath);
    return validation.reason ?? 'state-write-guard refused the install';
  }
  fs.renameSync(tmpPath, queuePath);
  return null;
};

const forgeOf = (flags: Flags): ForgeType => (typeof flags.forge === 'string' ? flags.forge : 'github') as ForgeType;

const fetchMergeSettings = (forge: ForgeType, repoSlug: string): MergeSettings | null => readRepoMergeSettings(forge, repoSlug);

const capture = (flags: Flags): number => {
  const queuePath = requireFlag(flags, 'queue');
  const repoRoot = requireFlag(flags, 'repo-root');
  const childIssue = Number(requireFlag(flags, 'child-issue'));
  const parentIssue = Number(requireFlag(flags, 'parent-issue'));
  const parentBranch = typeof flags['parent-branch'] === 'string' ? flags['parent-branch'] : childBranchFor(parentIssue);

  const tip = revParse(repoRoot, parentBranch);
  if (tip === null) {
    console.error(`cannot resolve ${parentBranch} in ${repoRoot} — the parent tip must be captured while its branch still exists`);
    return 1;
  }

  const repoSlug = typeof flags['repo-slug'] === 'string' ? flags['repo-slug'] : null;
  if (repoSlug === null) {
    console.log('no --repo-slug given — skipping the squash-merge warning (merge settings not read)');
  } else {
    const settings = fetchMergeSettings(forgeOf(flags), repoSlug);
    if (settings === null) console.log(`could not read merge settings for ${repoSlug} — squash-merge warning not evaluated`);
    else {
      const warning = squashMergeWarning(settings);
      console.log(warning ?? `${repoSlug} does not allow squash merges — stacking is lossless here.`);
    }
  }

  console.log(`#${childIssue}: stacked_on = ${parentIssue}, parent_tip_sha = ${tip} (${parentBranch})`);

  if (flags.apply !== true) {
    console.log('Dry run — no write performed. Re-run with --apply to record it in queue.json.');
    return 0;
  }

  const queue = readQueue(queuePath);
  const entry = queue.issues?.[String(childIssue)];
  if (entry === undefined) {
    console.error(`issue #${childIssue} is not in ${queuePath}`);
    return 1;
  }
  entry.stacked_on = parentIssue;
  entry.parent_tip_sha = tip;
  const failure = writeQueue(queuePath, queue);
  if (failure !== null) {
    console.error(`state-write-guard refused install: ${failure}`);
    return 1;
  }
  console.log('queue.json updated.');
  return 0;
};

const readParentState = (flags: Flags, repoSlug: string, parentPr: number | null): ForgeParentState | null => {
  const forced = flags['parent-state'];
  if (forced === 'merged') return { state: 'closed', merged: true };
  if (forced === 'closed-unmerged') return { state: 'closed', merged: false };
  if (parentPr === null) return null;
  const result = runGh(['api', `repos/${repoSlug}/pulls/${parentPr}`]);
  if (result.status !== 0) return null;
  try {
    const pr = JSON.parse(result.stdout) as { state?: string; merged?: boolean; merged_at?: string | null };
    return { state: pr.state === 'open' ? 'open' : 'closed', merged: pr.merged === true || (pr.merged_at ?? null) !== null };
  } catch {
    return null;
  }
};

const retargetAndVerify = (child: StackedChild, base: string, repoSlug: string): boolean => {
  const patch = runGh(['api', '-X', 'PATCH', `repos/${repoSlug}/pulls/${child.pr}`, '-f', `base=${base}`]);
  if (patch.status !== 0) console.error(`#${child.issue}: retarget PATCH reported failure — verifying the observed base anyway`);
  const readback = runGh(['api', `repos/${repoSlug}/pulls/${child.pr}`, '--jq', '.base.ref']);
  const retarget = verifyRetarget(readback.stdout, base);
  console.log(`#${child.issue}: retarget — ${retarget.reason}`);
  return retarget.ok;
};

const gitFetch = (repoRoot: string, branch: string): boolean => realGit(repoRoot, ['fetch', '--quiet', 'origin', branch]).ok;

const applyOneRepair = (
  plan: RepairPlan,
  ctx: { base: string; repoSlug: string; repoRoot: string; queue: QueueJson; parentState: ForgeParentState; acceptPatchIdChange: boolean },
): boolean => {
  const { child } = plan;
  const { base, repoSlug, repoRoot, queue } = ctx;
  const parentTip = child.parentTipSha as string;
  const target = `origin/${base}`;

  if (!gitFetch(repoRoot, base)) {
    console.error(`#${child.issue}: git fetch origin ${base} failed`);
    return false;
  }
  if (!isAncestor(repoRoot, parentTip, child.branch)) {
    console.error(
      `#${child.issue}: recorded parent tip ${parentTip} is not an ancestor of ${child.branch} — refusing, ` +
        'the merge base is wrong and the replay would drop or duplicate work',
    );
    return false;
  }

  const kind: ParentLanding = classifyParentLanding({ repoRoot, parentTip, target, forge: ctx.parentState });
  console.log(`#${child.issue}: parent landing is "${kind}" — action ${landingAction(kind)}`);
  const expectedFiles = changedFileCount(repoRoot, parentTip, child.branch);

  if (!retargetAndVerify(child, base, repoSlug)) return false;

  if (landingAction(kind) === 'retarget-only') {
    const observed = changedFileCount(repoRoot, target, child.branch, true);
    const counts = verifyChildFileCount(expectedFiles, observed);
    console.log(`#${child.issue}: repair — no commit, no push needed; ${counts.reason}`);
    return counts.ok;
  }

  const result = replayMerge({
    repoRoot,
    child: child.branch,
    newBase: target,
    mergeBase: parentTip,
    push: { remote: 'origin', queue },
    acceptPatchIdChange: ctx.acceptPatchIdChange,
  });
  if (result.status === 'conflict') {
    const note = kind === 'abandoned' ? ` (note: stack-parent-abandoned:#${child.issue}) ` : ' ';
    console.error(`#${child.issue}: replay conflict${note}in: ${result.conflicts.join(', ')} — nothing pushed`);
    return false;
  }
  if (result.status === 'unsupported') {
    console.error(`#${child.issue}: ${result.reason}`);
    return false;
  }
  if (result.status === 'refused') {
    console.error(`#${child.issue}: replay refused (${result.code}): ${result.reason}`);
    return false;
  }
  if (result.status === 'up-to-date') return true;

  fastForwardLocal(repoRoot, result.sha);
  const counts = verifyChildFileCount(expectedFiles, changedFileCount(repoRoot, target, child.branch, true));
  console.log(`#${child.issue}: repair — ${counts.reason}; pushed ${result.sha} as a fast-forward`);
  console.log(`#${child.issue}: review_carry: ${result.reviewCarry}`);
  return counts.ok;
};

const repair = (flags: Flags): number => {
  const queuePath = requireFlag(flags, 'queue');
  const repoRoot = requireFlag(flags, 'repo-root');
  const repoSlug = requireFlag(flags, 'repo-slug');
  const base = requireFlag(flags, 'base');
  const parentIssue = Number(requireFlag(flags, 'parent-issue'));

  const only = typeof flags['child-issue'] === 'string' ? Number(flags['child-issue']) : null;

  const queue = readQueue(queuePath);
  const all = findStackedChildren(queue.issues ?? {}, parentIssue);
  const children = only === null ? all : all.filter((c) => c.issue === only);
  if (children.length === 0) {
    console.log(`No open children stacked on #${parentIssue}${only === null ? '' : ` matching #${only}`} — nothing to repair.`);
    return 0;
  }
  // Planning is a read over queue.json, so a dry run covers every child at once. Applying is
  // per-child: `--repo-root` has to be that child's own worktree and cannot be shared across
  // siblings, because the fast-forward of the local branch happens inside it.
  if (flags.apply === true && only === null) {
    console.error('--apply requires --child-issue: the replay runs inside one child worktree at a time.');
    return 2;
  }

  const plans = children.map((child) => planRepair(child, base, repoSlug, repoRoot));
  for (const plan of plans) {
    if (plan.refusal !== null) console.log(`#${plan.child.issue}: REFUSED — ${plan.refusal}`);
    else for (const command of plan.commands) console.log(`#${plan.child.issue}: ${command}`);
  }

  const refused = plans.filter((p) => p.refusal !== null);
  if (flags.apply !== true) {
    console.log(`Dry run — ${plans.length - refused.length} child(ren) repairable, ${refused.length} refused. No command executed.`);
    return refused.length === 0 ? 0 : 1;
  }
  if (refused.length > 0) {
    console.error('Refusing to apply: at least one child cannot be repaired mechanically (see REFUSED above).');
    return 1;
  }

  const parentState = readParentState(flags, repoSlug, queue.issues?.[String(parentIssue)]?.pr ?? null);
  if (parentState === null) {
    console.error(`cannot tell how parent #${parentIssue} landed — pass --parent-state merged|closed-unmerged`);
    return 1;
  }
  if (parentState.state === 'open') {
    console.error(`parent #${parentIssue} is still open — use the restack subcommand, not repair`);
    return 1;
  }
  const acceptPatchIdChange = flags['accept-patch-id-change'] === true;
  for (const plan of plans) {
    if (!applyOneRepair(plan, { base, repoSlug, repoRoot, queue, parentState, acceptPatchIdChange })) return 1;
  }
  console.log(`Repaired ${plans.length} stacked child(ren) of #${parentIssue}.`);
  return 0;
};

// Late or lazy restack: the child gains overlap with an open parent, or conflicts against it. An
// ordinary merge of the parent head; a parent whose head no longer descends from the recorded tip
// (force-pushed by its author) is replayed with the recorded tip as the merge base instead.
const restack = (flags: Flags): number => {
  const queuePath = requireFlag(flags, 'queue');
  const repoRoot = requireFlag(flags, 'repo-root');
  const repoSlug = requireFlag(flags, 'repo-slug');
  const childIssue = Number(requireFlag(flags, 'child-issue'));
  const parentPr = typeof flags['parent-pr'] === 'string' ? Number(flags['parent-pr']) : undefined;
  const parentIssue =
    typeof flags['parent-issue'] === 'string'
      ? Number(flags['parent-issue'])
      : issueOfPr(readQueue(queuePath).issues ?? {}, parentPr);
  const parentBranch =
    typeof flags['parent-branch'] === 'string'
      ? flags['parent-branch']
      : parentIssue !== undefined
        ? childBranchFor(parentIssue)
        : requireFlag(flags, 'parent-branch');

  const queue = readQueue(queuePath);
  const entry = queue.issues?.[String(childIssue)];
  if (entry === undefined) {
    console.error(`issue #${childIssue} is not in ${queuePath}`);
    return 1;
  }
  const child: StackedChild = {
    issue: childIssue,
    pr: entry.pr ?? null,
    branch: childBranchFor(childIssue),
    parentTipSha: entry.parent_tip_sha ?? null,
  };
  const plan = planRestack(child, parentBranch, repoSlug, repoRoot);
  if (plan.refusal !== null) {
    console.error(`#${childIssue}: REFUSED — ${plan.refusal}`);
    return 1;
  }
  for (const command of plan.commands) console.log(`#${childIssue}: ${command}`);
  if (flags.apply !== true) {
    console.log('Dry run — no command executed. Re-run with --apply.');
    return 0;
  }

  if (!gitFetch(repoRoot, parentBranch)) {
    console.error(`#${childIssue}: git fetch origin ${parentBranch} failed`);
    return 1;
  }
  const parentHead = revParse(repoRoot, `origin/${parentBranch}`);
  if (parentHead === null) {
    console.error(`#${childIssue}: cannot resolve origin/${parentBranch}`);
    return 1;
  }
  if (!retargetAndVerify(child, parentBranch, repoSlug)) return 1;

  const forcePushed = child.parentTipSha !== null && !isAncestor(repoRoot, child.parentTipSha, parentHead);
  const push = { remote: 'origin', queue };
  const result = forcePushed
    ? replayMerge({ repoRoot, child: child.branch, newBase: parentHead, mergeBase: child.parentTipSha as string, push })
    : restackOnto({ repoRoot, child: child.branch, parentHead, push });
  if (result.status === 'conflict') {
    console.error(`#${childIssue}: restack conflict in: ${result.conflicts.join(', ')} — nothing pushed`);
    return 1;
  }
  if (result.status === 'unsupported') {
    console.error(`#${childIssue}: ${result.reason}`);
    return 1;
  }
  if (result.status === 'refused') {
    console.error(`#${childIssue}: restack refused (${result.code}): ${result.reason}`);
    return 1;
  }
  if (result.status === 'merged') {
    fastForwardLocal(repoRoot, result.sha);
    console.log(`#${childIssue}: restacked onto ${parentBranch} with ${result.sha} as a fast-forward push`);
  } else {
    console.log(`#${childIssue}: already contains ${parentBranch}`);
  }

  recordParentTip(queue, childIssue, parentHead, parentIssue);
  if (parentPr !== undefined) recordStackEdge(queue, childIssue, parentPr, parentBranch);
  const failure = writeQueue(queuePath, queue);
  if (failure !== null) {
    console.error(`state-write-guard refused install: ${failure}`);
    return 1;
  }
  console.log(`#${childIssue}: parent_tip_sha = ${parentHead}`);
  return 0;
};

// Merge method for the parent about to merge (merge-gate.md § 9): a merge commit when it has open
// stacked children and the repo allows one, squash otherwise. Prints the choice as JSON.
const mergeMethod = (flags: Flags): number => {
  const queue = readQueue(requireFlag(flags, 'queue'));
  const issue = Number(requireFlag(flags, 'issue'));
  const children = findStackedChildren(queue.issues ?? {}, issue);
  const settings = fetchMergeSettings(forgeOf(flags), requireFlag(flags, 'repo-slug'));
  const openChildren = children.map((c) => c.issue);
  if (settings === null && children.length > 0) {
    // A silent squash would strand the open children; hold the merge until the settings can be read.
    console.log(JSON.stringify({ method: null, flag: null, hold: true, reason: 'merge settings unreadable and the PR has open stacked children: do not merge, retry next turn or ask the owner', openChildren }));
    return 3;
  }
  const choice = parentMergeMethod({ hasOpenChildren: children.length > 0, settings });
  console.log(JSON.stringify({ ...choice, openChildren }));
  return 0;
};

const USAGE = `Usage:
  bun run scripts/stack-repair.ts capture --queue <path> --repo-root <abs> \\
      --child-issue <N> --parent-issue <M> [--parent-branch <b>] [--repo-slug <owner/repo>] [--forge <github|gitea>] [--apply]
  bun run scripts/stack-repair.ts repair  --queue <path> --repo-root <abs> \\
      --repo-slug <owner/repo> --base <branch> --parent-issue <M> \\
      [--child-issue <N> --apply] [--parent-state merged|closed-unmerged] [--accept-patch-id-change]
  bun run scripts/stack-repair.ts restack --queue <path> --repo-root <abs> \\
      --repo-slug <owner/repo> --child-issue <N> (--parent-issue <M> | --parent-branch <b>) [--parent-pr <P>] [--apply]
  bun run scripts/stack-repair.ts merge-method --queue <path> --repo-slug <owner/repo> [--forge <github|gitea>] --issue <N>   (exit 3: hold)`;

export const main = (argv: string[]): number => {
  const [subcommand, ...rest] = argv;
  const flags = parseFlags(rest);
  try {
    if (subcommand === 'capture') return capture(flags);
    if (subcommand === 'repair') return repair(flags);
    if (subcommand === 'restack') return restack(flags);
    if (subcommand === 'merge-method') return mergeMethod(flags);
  } catch (error) {
    console.error((error as Error).message);
    return 2;
  }
  console.error(USAGE);
  return 2;
};

if (import.meta.main) {
  process.exit(main(process.argv.slice(2)));
}
