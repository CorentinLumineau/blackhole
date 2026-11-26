import * as fs from 'fs';
import { validateStateWrite } from './lib/state-write-guard.ts';
import { readJsonFile } from './lib/fs.ts';
import { changePrBase } from './lib/forge-adapter/github-rest.ts';
import { changeGiteaPrBase, giteaApiSlug } from './lib/forge-adapter/gitea.ts';
import { readPrHeadSha, readPrLanding, type PrLanding, type PrRowFetcher } from './lib/forge-adapter/pr-landing.ts';
import { parseFlags, requireFlag, type Flags } from './lib/argv-flags.ts';
import {
  changedFileCount,
  childBranchFor,
  classifyParentLanding,
  fastForwardLocal,
  isAncestor,
  landingAction,
  mergeBaseOf,
  realGit,
  replayMerge,
  restackOnto,
  revParse,
  type ForgeParentState,
  type LandingAction,
  type ParentLanding,
} from './lib/stack-merge.ts';
import { forgeParentState, parentLandedReport, parentMergeMethod } from './lib/stack-lifecycle.ts';
import { effectiveParent } from './lib/stack-overlap.ts';
import { readRepoMergeSettings } from './lib/forge-adapter/merge-settings.ts';
import type { ForgeType, PrChangeBaseResult, RepoMergeSettings } from './lib/forge-adapter/types.ts';

export { changedFileCount, childBranchFor };

// Stacked-PR tip capture and post-parent-landing recovery. A parent that lands as a squash, as
// replayed commits, or not at all leaves the child claiming the parent's work as its own. The
// recovery is a merge, never a history rewrite: the child's remote head gains one commit whose
// tree is a three-way merge with the tip recorded at stack creation as the base, published as a
// fast-forward push (`lib/stack-merge.ts`). `<parent-tip>` is best recorded before the parent
// merges; a child without one derives it from the parent PR's head (`deriveParentTips`), because
// `refs/pull/<N>/head` still resolves after the parent branch is deleted.
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
  /** Set by `deriveParentTips`: `parentTipSha` is then the parent PR's head, not yet the merge base. */
  tipSource?: 'merged-parent-head';
  parentPr?: number | null;
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

/** The PR a child is stacked on: its own `stacked_on_pr` edge, else the parent issue's PR. */
export const parentPrOf = (issues: QueueIssues, childIssue: number, parentIssue: number): number | null =>
  issues[String(childIssue)]?.stacked_on_pr ?? issues[String(parentIssue)]?.pr ?? null;

/**
 * A child with no recorded tip takes its parent PR's head as the tip to resolve (`resolveDerivedTip`
 * turns it into the merge base once the ref is fetched). A recorded tip always wins, so a child
 * captured at stack creation behaves exactly as before. Without a readable head the tip stays null
 * and `planRepair` refuses.
 */
export const deriveParentTips = (
  children: StackedChild[],
  issues: QueueIssues,
  parentIssue: number,
  forge: ForgeType,
  repoSlug: string,
  fetchRow?: PrRowFetcher,
): StackedChild[] =>
  children.map((child) => {
    if (child.parentTipSha !== null) return child;
    const parentPr = parentPrOf(issues, child.issue, parentIssue);
    const head = parentPr === null ? null : readPrHeadSha(forge, repoSlug, parentPr, fetchRow);
    return head === null ? child : { ...child, parentTipSha: head, tipSource: 'merged-parent-head', parentPr };
  });

/**
 * Merge base for a derived tip: the last commit the child and the parent PR's head share, which is
 * the head itself when the child contains all of it and an earlier parent commit when the parent
 * gained fix rounds after the child was cut. Null when the ref cannot be fetched or shares nothing.
 */
const resolveDerivedTip = (repoRoot: string, child: StackedChild): string | null => {
  const head = child.parentTipSha as string;
  if (!realGit(repoRoot, ['fetch', '--quiet', 'origin', `refs/pull/${child.parentPr}/head`]).ok) return null;
  if (revParse(repoRoot, head) === null) return null;
  return mergeBaseOf(repoRoot, child.branch, head);
};

export type RepairPlan = { child: StackedChild; commands: string[]; refusal: string | null };

/** The retarget PATCH and its read-back, spelled for the forge's REST channel (`gh api` or `tea api`). */
const retargetCommands = (forge: ForgeType, repoSlug: string, pr: number, base: string): string[] =>
  forge === 'gitea'
    ? [
        `tea api -X PATCH repos/${giteaApiSlug(repoSlug)}/pulls/${pr} -d ${JSON.stringify(JSON.stringify({ base }))}`,
        `tea api repos/${giteaApiSlug(repoSlug)}/pulls/${pr} (compare .base.ref)`,
      ]
    : [`gh api -X PATCH repos/${repoSlug}/pulls/${pr} -f base=${base}`, `gh api repos/${repoSlug}/pulls/${pr} --jq .base.ref`];

/**
 * The exact command sequence for one child, in execution order, for a parent that landed as new
 * commits. A parent merged with a merge commit stops after the read-back: the child already
 * contains the parent tip, so there is nothing to commit or push. `gh pr edit --base` is
 * deliberately absent: on a repo with classic Projects enabled it exits non-zero from a GraphQL
 * deprecation before it ever applies the base change, so the REST PATCH form is the only one that
 * both works and can be read back.
 */
export const planRepair = (child: StackedChild, base: string, repoSlug: string, repoRoot: string, forge: ForgeType = 'github'): RepairPlan => {
  if (child.parentTipSha === null) {
    return {
      child,
      commands: [],
      refusal:
        `no parent_tip_sha recorded for #${child.issue} and the parent PR's head could not be read ` +
        '(no stacked_on_pr edge, no parent issue PR, or the forge read failed); record the tip with ' +
        "`capture` or recover it by hand from the merged parent PR's commit list",
    };
  }
  if (child.pr === null) {
    return { child, commands: [], refusal: `no PR recorded for #${child.issue} — nothing to retarget` };
  }
  return {
    child,
    commands: [
      `git -C ${repoRoot} fetch origin ${base}`,
      ...retargetCommands(forge, repoSlug, child.pr, base),
      `git -C ${repoRoot} merge-tree --write-tree --name-only --merge-base=${child.parentTipSha} ${child.branch} origin/${base}`,
      `git -C ${repoRoot} commit-tree <tree> -p ${child.branch} -p origin/${base} -m "Merge ${base} into ${child.branch} (replay from recorded parent tip)"`,
      `git -C ${repoRoot} push origin <merge-commit>:refs/heads/${child.branch}`,
    ],
    refusal: null,
  };
};

/** The commands a late restack runs: merge the parent head into the child, then retarget it. */
export const planRestack = (child: StackedChild, parentBranch: string, repoSlug: string, repoRoot: string, forge: ForgeType = 'github'): RepairPlan => {
  if (child.pr === null) {
    return { child, commands: [], refusal: `no PR recorded for #${child.issue} — nothing to retarget` };
  }
  return {
    child,
    commands: [
      `git -C ${repoRoot} fetch origin ${parentBranch}`,
      ...retargetCommands(forge, repoSlug, child.pr, parentBranch),
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

/** Verifies the commit that was published, so the evidence cannot drift onto a stale local branch. */
export const verifyPublishedReplay = (repoRoot: string, target: string, sha: string, expectedFiles: number): Verdict =>
  verifyChildFileCount(expectedFiles, changedFileCount(repoRoot, target, sha, true));

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

const FORCED_LANDING: Record<string, PrLanding> = {
  open: { state: 'open', mergedAt: null, mergeCommitSha: null },
  merged: { state: 'merged', mergedAt: null, mergeCommitSha: null },
  'closed-unmerged': { state: 'closed-unmerged', mergedAt: null, mergeCommitSha: null },
};

const readLanding = (flags: Flags, repoSlug: string, parentPr: number | null, fetchRow?: PrRowFetcher): PrLanding | null => {
  const forced = flags['parent-state'];
  if (forced !== undefined) {
    if (typeof forced !== 'string' || !Object.hasOwn(FORCED_LANDING, forced)) {
      throw new Error(`invalid --parent-state: expected open|merged|closed-unmerged`);
    }
    return FORCED_LANDING[forced];
  }
  return parentPr === null ? null : readPrLanding(forgeOf(flags), repoSlug, parentPr, fetchRow);
};

const readParentState = (flags: Flags, repoSlug: string, parentPr: number | null, fetchRow?: PrRowFetcher): ForgeParentState | null => {
  const landing = readLanding(flags, repoSlug, parentPr, fetchRow);
  return landing === null ? null : forgeParentState(landing);
};

/** PATCH then read back, through the forge adapter's REST channel. A failed call is a failed retarget, never an exception. */
const changeBase = (forge: ForgeType, repoSlug: string, pr: number, base: string): PrChangeBaseResult => {
  try {
    if (forge === 'github') return changePrBase(repoSlug, pr, base);
    if (forge === 'gitea') return changeGiteaPrBase(repoSlug, pr, base);
    return { ok: false, base: null, detail: `no retarget channel for forge "${forge}"` };
  } catch (error) {
    return { ok: false, base: null, detail: (error as Error).message };
  }
};

export const retargetAndVerify = (child: StackedChild, base: string, repoSlug: string, forge: ForgeType): boolean => {
  const result = changeBase(forge, repoSlug, child.pr as number, base);
  if (result.base === null) {
    console.error(`#${child.issue}: retarget failed — base not read back: ${result.detail ?? 'unknown error'}`);
    return false;
  }
  const retarget = verifyRetarget(result.base, base);
  console.log(`#${child.issue}: retarget — ${retarget.reason}`);
  return retarget.ok;
};

/**
 * Gitea does not re-run CI when a PR's base changes, and no re-run endpoint is assumed (owner
 * ruling: push-only). A recovery that pushed has already re-triggered CI; one that did not tells
 * the operator to push. GitHub needs no notice.
 */
export const ciRetriggerNotice = (
  forge: ForgeType,
  child: StackedChild,
  base: string,
  action: LandingAction,
  pushedSha: string | null,
): string | null => {
  if (forge !== 'gitea') return null;
  return pushedSha === null
    ? `ci-retrigger: #${child.issue} retargeted to ${base} with no push (${action}) — Gitea does not re-run CI on a base change; ` +
        `push ${child.branch} to re-trigger it (this script calls no re-run endpoint)`
    : `ci-retrigger: #${child.issue} retargeted to ${base} and pushed ${pushedSha} (${action}) — that push re-triggers CI; nothing else to do`;
};

const printCiRetrigger = (forge: ForgeType, child: StackedChild, base: string, action: LandingAction, pushedSha: string | null): void => {
  const notice = ciRetriggerNotice(forge, child, base, action, pushedSha);
  if (notice !== null) console.log(notice);
};

const gitFetch = (repoRoot: string, branch: string): boolean => realGit(repoRoot, ['fetch', '--quiet', 'origin', branch]).ok;

const applyOneRepair = (
  plan: RepairPlan,
  ctx: { base: string; repoSlug: string; repoRoot: string; queue: QueueJson; parentState: ForgeParentState; acceptPatchIdChange: boolean; forge: ForgeType },
): boolean => {
  const { child } = plan;
  const { base, repoSlug, repoRoot, queue } = ctx;
  let parentTip = child.parentTipSha as string;
  const target = `origin/${base}`;

  if (!gitFetch(repoRoot, base)) {
    console.error(`#${child.issue}: git fetch origin ${base} failed`);
    return false;
  }
  if (child.tipSource === 'merged-parent-head') {
    const derived = resolveDerivedTip(repoRoot, child);
    if (derived === null) {
      console.error(
        `#${child.issue}: cannot derive the merge base from parent PR #${child.parentPr} head ${parentTip} — ` +
          'refs/pull/<N>/head did not fetch, or it shares no commit with the child; nothing pushed',
      );
      return false;
    }
    console.log(`#${child.issue}: no recorded parent tip — merge base ${derived} derived from parent PR #${child.parentPr} head ${parentTip}`);
    parentTip = derived;
  }
  if (!isAncestor(repoRoot, parentTip, child.branch)) {
    console.error(
      `#${child.issue}: recorded parent tip ${parentTip} is not an ancestor of ${child.branch} — refusing, ` +
        'the merge base is wrong and the replay would drop or duplicate work',
    );
    return false;
  }

  const kind: ParentLanding = classifyParentLanding({ repoRoot, parentTip, target, forge: ctx.parentState });
  const action = landingAction(kind);
  console.log(`#${child.issue}: parent landing is "${kind}" — action ${action}`);
  const expectedFiles = changedFileCount(repoRoot, parentTip, child.branch);

  if (!retargetAndVerify(child, base, repoSlug, ctx.forge)) return false;

  if (action === 'retarget-only') {
    const observed = changedFileCount(repoRoot, target, child.branch, true);
    const counts = verifyChildFileCount(expectedFiles, observed);
    console.log(`#${child.issue}: repair — no commit, no push needed; ${counts.reason}`);
    printCiRetrigger(ctx.forge, child, base, action, null);
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
  if (result.status === 'up-to-date') {
    printCiRetrigger(ctx.forge, child, base, action, null);
    return true;
  }

  if (!fastForwardLocal(repoRoot, result.sha)) {
    console.error(`#${child.issue}: pushed ${result.sha} but the local fast-forward failed (dirty tree, wrong HEAD or diverged local branch) — local ${child.branch} is stale`);
  }
  const counts = verifyPublishedReplay(repoRoot, target, result.sha, expectedFiles);
  console.log(`#${child.issue}: repair — ${counts.reason}; pushed ${result.sha} as a fast-forward`);
  console.log(`#${child.issue}: review_carry: ${result.reviewCarry}`);
  printCiRetrigger(ctx.forge, child, base, action, result.sha);
  return counts.ok;
};

const repair = (flags: Flags, fetchRow?: PrRowFetcher): number => {
  const queuePath = requireFlag(flags, 'queue');
  const repoRoot = requireFlag(flags, 'repo-root');
  const repoSlug = requireFlag(flags, 'repo-slug');
  const base = requireFlag(flags, 'base');
  const parentIssue = Number(requireFlag(flags, 'parent-issue'));

  const only = typeof flags['child-issue'] === 'string' ? Number(flags['child-issue']) : null;

  const queue = readQueue(queuePath);
  const forge = forgeOf(flags);
  const all = findStackedChildren(queue.issues ?? {}, parentIssue);
  const selected = only === null ? all : all.filter((c) => c.issue === only);
  const children = deriveParentTips(selected, queue.issues ?? {}, parentIssue, forge, repoSlug, fetchRow);
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

  const plans = children.map((child) => planRepair(child, base, repoSlug, repoRoot, forge));
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

  const parentPr = queue.issues?.[String(parentIssue)]?.pr ?? parentPrOf(queue.issues ?? {}, plans[0].child.issue, parentIssue);
  const parentState = readParentState(flags, repoSlug, parentPr, fetchRow);
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
    if (!applyOneRepair(plan, { base, repoSlug, repoRoot, queue, parentState, acceptPatchIdChange, forge })) return 1;
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
  const forge = forgeOf(flags);
  const plan = planRestack(child, parentBranch, repoSlug, repoRoot, forge);
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
  if (!retargetAndVerify(child, parentBranch, repoSlug, forge)) return 1;

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
    printCiRetrigger(forge, child, parentBranch, 'restack', result.sha);
  } else {
    console.log(`#${childIssue}: already contains ${parentBranch}`);
    printCiRetrigger(forge, child, parentBranch, 'restack', null);
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

// Merge method for the parent about to merge (merge-risk.md): a merge commit when it has open
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

// Has the parent landed? The forge's merged state answers it; git ancestry never can, because a
// squash or rebase landing is not an ancestor of the base (merge-gate.md § 7).
const parentLanded = (flags: Flags, fetchRow?: PrRowFetcher): number => {
  const repoSlug = requireFlag(flags, 'repo-slug');
  let parentPr: number | null = typeof flags['parent-pr'] === 'string' ? Number(flags['parent-pr']) : null;
  if (parentPr === null) {
    const issues = readQueue(requireFlag(flags, 'queue')).issues ?? {};
    const child = issues[requireFlag(flags, 'child-issue')];
    const parentIssue = child === undefined ? undefined : effectiveParent(issues, child);
    parentPr = child?.stacked_on_pr ?? (parentIssue === undefined || parentIssue === null ? null : (issues[String(parentIssue)]?.pr ?? null));
  }
  if (parentPr === null || !Number.isInteger(parentPr)) {
    console.error('no parent PR: pass --parent-pr, or --queue and --child-issue naming a child with a stack edge');
    return 3;
  }
  const { report, exit } = parentLandedReport(parentPr, readLanding(flags, repoSlug, parentPr, fetchRow));
  if (report === null) console.error(`could not read PR #${parentPr} state — unknown, not open; retry next turn`);
  else console.log(JSON.stringify(report));
  return exit;
};

const USAGE = `Usage:
  bun run scripts/stack-repair.ts capture --queue <path> --repo-root <abs> \\
      --child-issue <N> --parent-issue <M> [--parent-branch <b>] [--repo-slug <owner/repo>] [--forge <github|gitea>] [--apply]
  bun run scripts/stack-repair.ts repair  --queue <path> --repo-root <abs> \\
      --repo-slug <owner/repo> --base <branch> --parent-issue <M> \\
      [--child-issue <N> --apply] [--parent-state merged|closed-unmerged] [--forge <github|gitea>] [--accept-patch-id-change]
  bun run scripts/stack-repair.ts restack --queue <path> --repo-root <abs> \\
      --repo-slug <owner/repo> --child-issue <N> (--parent-issue <M> | --parent-branch <b>) [--parent-pr <P>] [--forge <github|gitea>] [--apply]
  bun run scripts/stack-repair.ts parent-landed --repo-slug <owner/repo> [--forge <github|gitea>] (--parent-pr <P> | --queue <path> --child-issue <N>) [--parent-state open|merged|closed-unmerged]
      (exit 0 merged, 1 open, 4 closed unmerged, 3 unreadable)
  bun run scripts/stack-repair.ts merge-method --queue <path> --repo-slug <owner/repo> [--forge <github|gitea>] --issue <N>   (exit 3: hold)`;

export const main = (argv: string[], fetchRow?: PrRowFetcher): number => {
  const [subcommand, ...rest] = argv;
  const flags = parseFlags(rest);
  try {
    if (subcommand === 'capture') return capture(flags);
    if (subcommand === 'repair') return repair(flags, fetchRow);
    if (subcommand === 'restack') return restack(flags);
    if (subcommand === 'merge-method') return mergeMethod(flags);
    if (subcommand === 'parent-landed') return parentLanded(flags, fetchRow);
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
