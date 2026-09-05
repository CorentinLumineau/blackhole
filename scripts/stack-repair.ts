import * as fs from 'fs';
import { spawnSync } from 'child_process';
import { validateStateWrite } from './lib/state-write-guard.ts';
import { runGh } from './lib/forge-adapter/cli.ts';

// Stacked-PR tip capture and post-merge `--onto` repair. A squash-merged parent rewrites its
// commits into one, so a child branched off that parent shares no history with the base ref and
// starts claiming the parent's work as its own. The only recipe that restores it is a retarget
// plus `git rebase --onto <base> <parent-tip> <child>`, and `<parent-tip>` has to be recorded
// before the parent merges — after the parent branch is deleted the upstream boundary is gone.
// The prose half (when to run each subcommand) lives in `merge-gate.md` § 7.

export type StackedIssue = {
  title?: string;
  status?: string;
  pr?: number | null;
  stacked_on?: number | null;
  parent_tip_sha?: string | null;
  [key: string]: unknown;
};

export type QueueIssues = Record<string, StackedIssue>;

export type QueueJson = { issues?: QueueIssues; [key: string]: unknown };

/** Campaign branch-naming convention (`V-BRANCH-03`) — the sole derivation site. */
export const childBranchFor = (issue: number): string => `blackhole/issue-${issue}`;

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
    .filter(([, issue]) => issue.stacked_on === parentIssue && !OPEN_STATUSES_EXCLUDED.has(issue.status ?? ''))
    .map(([id, issue]) => ({
      issue: Number(id),
      pr: issue.pr ?? null,
      branch: childBranchFor(Number(id)),
      parentTipSha: issue.parent_tip_sha ?? null,
    }))
    .sort((a, b) => a.issue - b.issue);

export type RepairPlan = { child: StackedChild; commands: string[]; refusal: string | null };

/**
 * The exact command sequence for one child, in execution order. `gh pr edit --base` is
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
        `no parent_tip_sha recorded for #${child.issue} — the --onto boundary was never captured at ` +
        'stack creation and cannot be reconstructed once the parent branch is gone; repair it by hand ' +
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
      `git -C ${repoRoot} rebase --onto origin/${base} ${child.parentTipSha} ${child.branch}`,
      `git -C ${repoRoot} push --force-with-lease origin ${child.branch}:${child.branch}`,
    ],
    refusal: null,
  };
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

export type MergeSettings = {
  allow_squash_merge?: boolean;
  allow_merge_commit?: boolean;
  allow_rebase_merge?: boolean;
};

/**
 * Stack-creation-time warning. Squash is what makes stacking lossy; a repo that can also produce a
 * merge commit has an escape hatch for this stack, and one that cannot does not.
 */
export const squashMergeWarning = (settings: MergeSettings): string | null => {
  if (settings.allow_squash_merge !== true) return null;
  if (settings.allow_merge_commit === true) {
    return 'WARNING: this repo allows squash merges. Squash-merging the parent will break this stack unless the post-merge repair runs; merging the parent with a merge commit avoids the whole problem.';
  }
  return 'WARNING: this repo squash-merges and offers no merge-commit alternative. This stack WILL break when the parent lands — the post-merge repair is mandatory, not optional.';
};

export type CommandRun = { ok: boolean; stdout: string; stderr: string };

const runGit = (args: string[]): CommandRun => {
  const result = spawnSync('git', args, { encoding: 'utf-8' });
  return { ok: result.status === 0, stdout: result.stdout ?? '', stderr: result.stderr ?? '' };
};

/** Changed-file count between two revisions, the same number a PR's "files changed" reports. */
export const changedFileCount = (repoRoot: string, from: string, to: string, threeDot = false): number => {
  const range = threeDot ? `${from}...${to}` : `${from}..${to}`;
  const result = runGit(['-C', repoRoot, 'diff', '--name-only', range]);
  if (!result.ok) throw new Error(`git diff ${range} failed: ${result.stderr.trim()}`);
  return result.stdout.split('\n').filter((line) => line.trim() !== '').length;
};

/**
 * The `--onto` rebase itself, isolated so it is exercisable against a real repository without any
 * forge access. A plain `git rebase <base>` here replays the parent's commits too and reproduces
 * exactly the wrong diff this whole module exists to prevent.
 */
export const rebaseOnto = (repoRoot: string, base: string, parentTipSha: string, childBranch: string): CommandRun => {
  const result = runGit(['-C', repoRoot, 'rebase', '--onto', base, parentTipSha, childBranch]);
  if (!result.ok) runGit(['-C', repoRoot, 'rebase', '--abort']);
  return result;
};

const revParse = (repoRoot: string, rev: string): string | null => {
  const result = runGit(['-C', repoRoot, 'rev-parse', rev]);
  return result.ok ? result.stdout.trim() : null;
};

const isAncestor = (repoRoot: string, ancestor: string, descendant: string): boolean =>
  runGit(['-C', repoRoot, 'merge-base', '--is-ancestor', ancestor, descendant]).ok;

const readQueue = (queuePath: string): QueueJson => JSON.parse(fs.readFileSync(queuePath, 'utf-8')) as QueueJson;

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

type Flags = Record<string, string | true>;

const parseFlags = (argv: string[]): Flags => {
  const flags: Flags = {};
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (!arg.startsWith('--')) continue;
    const key = arg.slice(2);
    const next = argv[i + 1];
    if (next !== undefined && !next.startsWith('--')) {
      flags[key] = next;
      i++;
    } else {
      flags[key] = true;
    }
  }
  return flags;
};

const requireFlag = (flags: Flags, name: string): string => {
  const value = flags[name];
  if (typeof value !== 'string') throw new Error(`missing required flag --${name}`);
  return value;
};

const fetchMergeSettings = (repoSlug: string): MergeSettings | null => {
  const result = runGh(['api', `repos/${repoSlug}`]);
  if (result.status !== 0) return null;
  try {
    return JSON.parse(result.stdout) as MergeSettings;
  } catch {
    return null;
  }
};

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
    const settings = fetchMergeSettings(repoSlug);
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

const applyOneRepair = (plan: RepairPlan, base: string, repoSlug: string, repoRoot: string): boolean => {
  const { child } = plan;
  const parentTip = child.parentTipSha as string;

  if (!runGit(['-C', repoRoot, 'fetch', 'origin', base]).ok) {
    console.error(`#${child.issue}: git fetch origin ${base} failed`);
    return false;
  }
  if (!isAncestor(repoRoot, parentTip, child.branch)) {
    console.error(
      `#${child.issue}: recorded parent tip ${parentTip} is not an ancestor of ${child.branch} — refusing to rebase, ` +
        'the boundary is wrong and --onto would replay the wrong commits',
    );
    return false;
  }

  const expectedFiles = changedFileCount(repoRoot, parentTip, child.branch);

  const patch = runGh(['api', '-X', 'PATCH', `repos/${repoSlug}/pulls/${child.pr}`, '-f', `base=${base}`]);
  if (patch.status !== 0) console.error(`#${child.issue}: retarget PATCH reported failure — verifying the observed base anyway`);
  const readback = runGh(['api', `repos/${repoSlug}/pulls/${child.pr}`, '--jq', '.base.ref']);
  const retarget = verifyRetarget(readback.stdout, base);
  console.log(`#${child.issue}: retarget — ${retarget.reason}`);
  if (!retarget.ok) return false;

  const rebase = rebaseOnto(repoRoot, `origin/${base}`, parentTip, child.branch);
  if (!rebase.ok) {
    console.error(`#${child.issue}: rebase --onto failed (aborted): ${rebase.stderr.trim()}`);
    return false;
  }
  if (!runGit(['-C', repoRoot, 'push', '--force-with-lease', 'origin', `${child.branch}:${child.branch}`]).ok) {
    console.error(`#${child.issue}: force-with-lease push failed`);
    return false;
  }

  const observedFiles = changedFileCount(repoRoot, `origin/${base}`, child.branch, true);
  const counts = verifyChildFileCount(expectedFiles, observedFiles);
  console.log(`#${child.issue}: repair — ${counts.reason}`);
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
  // per-child: the rebase checks the child branch out, so `--repo-root` has to be that child's own
  // worktree and cannot be shared across siblings.
  if (flags.apply === true && only === null) {
    console.error('--apply requires --child-issue: the rebase runs inside one child worktree at a time.');
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

  for (const plan of plans) {
    if (!applyOneRepair(plan, base, repoSlug, repoRoot)) return 1;
  }
  console.log(`Repaired ${plans.length} stacked child(ren) of #${parentIssue}.`);
  return 0;
};

const USAGE = `Usage:
  bun run scripts/stack-repair.ts capture --queue <path> --repo-root <abs> \\
      --child-issue <N> --parent-issue <M> [--parent-branch <b>] [--repo-slug <owner/repo>] [--apply]
  bun run scripts/stack-repair.ts repair  --queue <path> --repo-root <abs> \\
      --repo-slug <owner/repo> --base <branch> --parent-issue <M> [--child-issue <N> --apply]`;

export const main = (argv: string[]): number => {
  const [subcommand, ...rest] = argv;
  const flags = parseFlags(rest);
  try {
    if (subcommand === 'capture') return capture(flags);
    if (subcommand === 'repair') return repair(flags);
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
