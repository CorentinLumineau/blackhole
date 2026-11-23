import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { parseFlags, requireFlag } from './lib/argv-flags.ts';
import { createForgeAdapter } from './lib/forge-adapter/index.ts';
import type { ForgeType } from './lib/forge-adapter/types.ts';
import { readJsonFile } from './lib/fs.ts';
import { adapterSnapshotIo, buildOpenPrSnapshot, PR_REF_PREFIX, type OpenPrSnapshot } from './lib/open-pr-snapshot.ts';
import { recheckStack, snapshotParentFiles } from './lib/stack-lifecycle.ts';
import { childBranchFor } from './lib/stack-merge.ts';
import { verifiedPrMergeTree } from './lib/stack-overlap.ts';
import { pickStackParent, planTouchPaths, withPlanTouchPaths, type StackCandidate } from './lib/stack-parent.ts';

// CLI for queue-dag.md Step 3b and Step 0.4. Both modes read the same bounded open-PR snapshot
// (one fetch of the open PRs' heads, no per-PR API call).
//   --issue <N>  dispatch pick: prints the stack parent for one queue issue as JSON (`null` when none).
//   --pr <N>     re-check of an open campaign PR: prints the restack decision as JSON; exit 3 when
//                the snapshot could not be read in full, because "could not look" is not "no overlap".
// --repo-slug <owner/repo> and --repo-root <abs> locate the forge and the checkout; --forge defaults to github.
// --plans-dir <abs> (default: `plans/` beside the queue file): in --issue mode, an issue whose
// `issue-<N>.md` (else `<N>.md`) plan declares Touch-Paths is matched on those paths, not its queue touch_paths;
// a plan `package_root` frontmatter joins sub-package-relative paths to that root.
//   --plan-touch-paths <N>  prints that plan's effective Touch-Paths as JSON (`null` when none), the
//                           value phase-plan.md writes into the queue entry's touch_paths.
const flags = parseFlags(process.argv.slice(2));
const queuePath = requireFlag(flags, 'queue');
const queue = readJsonFile(queuePath, queuePath) as { issues?: Record<string, StackCandidate> };
const issues = queue.issues ?? {};

// --parent-files: JSON {"<parent issue>": ["changed/file", ...]}, replaces the snapshot read;
// --default-touch-paths: JSON array; default: `default_touch_paths` of the config.json beside the queue.
const jsonFlag = (name: string): unknown => {
  const v = flags[name];
  return typeof v === 'string' ? JSON.parse(v) : undefined;
};

const defaultTouchPaths = (): string[] | undefined => {
  const explicit = jsonFlag('default-touch-paths') as string[] | undefined;
  if (explicit !== undefined) return explicit;
  const configPath = path.join(path.dirname(queuePath), 'config.json');
  if (!existsSync(configPath)) return undefined;
  const value = (readJsonFile(configPath, configPath) as { default_touch_paths?: unknown }).default_touch_paths;
  return Array.isArray(value) ? (value as string[]) : undefined;
};

const plansDir = typeof flags['plans-dir'] === 'string' ? flags['plans-dir'] : path.join(path.dirname(queuePath), 'plans');
const readPlan = (n: number): string | null => {
  const file = [`issue-${n}.md`, `${n}.md`].map((name) => path.join(plansDir, name)).find((f) => existsSync(f));
  return file === undefined ? null : readFileSync(file, 'utf8');
};

const repoRoot = path.resolve(typeof flags['repo-root'] === 'string' ? flags['repo-root'] : process.cwd());

const readSnapshot = async (): Promise<OpenPrSnapshot> => {
  const forge = (typeof flags.forge === 'string' ? flags.forge : 'github') as ForgeType;
  const adapter = createForgeAdapter({ repo: requireFlag(flags, 'repo-slug'), forge });
  return buildOpenPrSnapshot(adapterSnapshotIo(adapter, repoRoot, path.join(repoRoot, '.blackhole', 'pr-files-cache.json')));
};

const recheck = async (pr: number): Promise<number> => {
  const snapshot = await readSnapshot();
  const owned = new Set(Object.keys(issues).map((id) => childBranchFor(Number(id))));
  const decision = recheckStack(pr, snapshot, {
    isOwned: (branch) => owned.has(branch),
    conflicts: (me, other) =>
      verifiedPrMergeTree(
        (args) => {
          const r = Bun.spawnSync(['git', ...args], { cwd: repoRoot });
          return { code: r.exitCode ?? 1, stdout: r.stdout.toString(), stderr: r.stderr.toString() };
        },
        PR_REF_PREFIX,
        me,
        other,
      ),
  });
  console.log(JSON.stringify(decision));
  return decision.action === 'unknown' ? 3 : 0;
};

const dispatch = async (issue: number): Promise<number> => {
  let parentFiles = jsonFlag('parent-files') as Record<string, string[]> | undefined;
  if (parentFiles === undefined && flags['repo-slug'] !== undefined) {
    parentFiles = snapshotParentFiles(issues, await readSnapshot());
  }
  const planned = withPlanTouchPaths(issues, readPlan);
  // No snapshot and no --parent-files: every open PR's files are unknown, so declared touch_paths decide.
  console.log(
    JSON.stringify(pickStackParent(planned, issue, { parentFiles: parentFiles ?? {}, defaultTouchPaths: defaultTouchPaths() })),
  );
  return 0;
};

const printPlanTouchPaths = (issue: number): number => {
  const plan = readPlan(issue);
  const paths = plan === null ? [] : planTouchPaths(plan);
  console.log(JSON.stringify(paths.length ? paths : null));
  return 0;
};

const pr = flags.pr;
const planIssue = flags['plan-touch-paths'];
process.exit(
  typeof pr === 'string'
    ? await recheck(Number(pr))
    : typeof planIssue === 'string'
      ? printPlanTouchPaths(Number(planIssue))
      : await dispatch(Number(requireFlag(flags, 'issue'))),
);
