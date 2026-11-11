import path from 'node:path';
import { parseFlags, requireFlag } from './lib/argv-flags.ts';
import { createForgeAdapter } from './lib/forge-adapter/index.ts';
import type { ForgeType } from './lib/forge-adapter/types.ts';
import { readJsonFile } from './lib/fs.ts';
import { adapterSnapshotIo, buildOpenPrSnapshot, PR_REF_PREFIX, type OpenPrSnapshot } from './lib/open-pr-snapshot.ts';
import { recheckStack, snapshotParentFiles } from './lib/stack-lifecycle.ts';
import { childBranchFor } from './lib/stack-merge.ts';
import { mergeTreeVerdict } from './lib/stack-overlap.ts';
import { pickStackParent, type StackCandidate } from './lib/stack-parent.ts';

// CLI for queue-dag.md Step 3b and Step 0.4. Both modes read the same bounded open-PR snapshot
// (one fetch of the open PRs' heads, no per-PR API call).
//   --issue <N>  dispatch pick: prints the stack parent for one queue issue as JSON (`null` when none).
//   --pr <N>     re-check of an open campaign PR: prints the restack decision as JSON; exit 3 when
//                the snapshot could not be read in full, because "could not look" is not "no overlap".
// --repo-slug <owner/repo> and --repo-root <abs> locate the forge and the checkout; --forge defaults to github.
const flags = parseFlags(process.argv.slice(2));
const queuePath = requireFlag(flags, 'queue');
const queue = readJsonFile(queuePath, queuePath) as { issues?: Record<string, StackCandidate> };
const issues = queue.issues ?? {};

// --parent-files: JSON {"<parent issue>": ["changed/file", ...]}, replaces the snapshot read;
// --default-touch-paths: JSON array, the config `default_touch_paths`.
const jsonFlag = (name: string): unknown => {
  const v = flags[name];
  return typeof v === 'string' ? JSON.parse(v) : undefined;
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
      mergeTreeVerdict(
        (args) => {
          const r = Bun.spawnSync(['git', ...args], { cwd: repoRoot });
          return { code: r.exitCode ?? 1, stdout: r.stdout.toString(), stderr: r.stderr.toString() };
        },
        `${PR_REF_PREFIX}${me.number}`,
        `${PR_REF_PREFIX}${other.number}`,
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
  // No snapshot and no --parent-files: every open PR's files are unknown, so declared touch_paths decide.
  console.log(
    JSON.stringify(pickStackParent(issues, issue, { parentFiles: parentFiles ?? {}, defaultTouchPaths: jsonFlag('default-touch-paths') as string[] | undefined })),
  );
  return 0;
};

const pr = flags.pr;
process.exit(typeof pr === 'string' ? await recheck(Number(pr)) : await dispatch(Number(requireFlag(flags, 'issue'))));
