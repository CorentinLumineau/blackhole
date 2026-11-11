#!/usr/bin/env bun
import path from 'node:path';
import { parseFlags, unknownFlagKeys } from './lib/argv-flags.ts';
import { createForgeAdapter } from './lib/forge-adapter/index.ts';
import type { ForgeType } from './lib/forge-adapter/types.ts';
import { readJsonFile } from './lib/fs.ts';
import { adapterSnapshotIo, buildOpenPrSnapshot, PR_REF_PREFIX, type OpenPrSnapshot } from './lib/open-pr-snapshot.ts';
import { olderOnly } from './lib/stack-lifecycle.ts';
import { mergeTreeVerdict, pickParent, type ConflictVerdict } from './lib/stack-overlap.ts';

// V-STACK-02 gate: a PR that would conflict with another open PR must be stacked on it. Exit codes
// follow merge-base-guard.ts: 0 proceed, 1 overlapping and not stacked, 2 usage, 3 could not check
// (an unreadable snapshot is never read as "no overlap").

export type GateResult = { exit: 0 | 1 | 3; message: string; parentBranch?: string };

type Conflicts = (me: { number: number; headSha: string }, other: { number: number; headSha: string }) => ConflictVerdict;

/** Only older open PRs count: a younger overlapping PR is the one that must stack on this one. */
export const evaluateStackGate = (pr: number, snapshot: OpenPrSnapshot, conflicts: Conflicts): GateResult => {
  if (snapshot.status !== 'ok') return { exit: 3, message: `stack-check: could not read the open PRs: ${snapshot.reason}` };
  const result = pickParent(pr, olderOnly(pr, snapshot), { conflicts: (a, b) => conflicts(a, b) });
  switch (result.kind) {
    case 'none':
      return { exit: 0, message: `stack-check: ok — PR #${pr} overlaps no open PR outside its own stack` };
    case 'unknown':
      return { exit: 3, message: `stack-check: could not decide for PR #${pr}: ${result.reason}` };
    case 'unstackable':
      return {
        exit: 0,
        message: `stack-check: exempt — PR #${pr} overlaps #${result.parent}, unstackable-parent:${result.reason}:#${result.parent}; hold the merge until #${result.parent} merges or closes`,
      };
    case 'defer':
      return {
        exit: 1,
        message: `V-STACK-02: PR #${pr} overlaps #${result.parent} but the stack depth cap is reached; wait for the chain under #${result.parent} to land`,
      };
    case 'stack': {
      const also = result.alsoOverlaps.length > 0 ? ` It also overlaps #${result.alsoOverlaps.join(', #')} in another chain.` : '';
      return {
        exit: 1,
        parentBranch: result.parentBranch,
        message: `V-STACK-02: PR #${pr} overlaps open PR #${result.parent} but is not stacked on it. Retarget it to ${result.parentBranch} and merge that branch in (no rebase, no force push).${also}`,
      };
    }
  }
};

const FORGES = ['github', 'gitea', 'gitlab'];
const KNOWN_KEYS = ['pr', 'open-prs', 'fix', 'repo-slug', 'repo-root', 'forge'];

const usage = (): never => {
  console.error(
    'Usage: bun run scripts/stack-check.ts --pr <N> [--fix] [--open-prs <snapshot.json>]\n' +
      '       bun run scripts/stack-check.ts --pr <N> --repo-slug <owner/repo> [--repo-root <abs>] [--forge github|gitea|gitlab]\n' +
      '--open-prs serves the mcp channel, where scripts cannot reach the forge: a shared file counts as the overlap.\n' +
      'Exit: 0 ok, 1 overlapping and not stacked, 2 usage, 3 could not check.',
  );
  return process.exit(2);
};

const readSnapshotFile = (file: string): OpenPrSnapshot | null => {
  try {
    const parsed = readJsonFile(file, file) as OpenPrSnapshot;
    if (!parsed) return null;
    if (parsed.status === 'ok') return Array.isArray(parsed.prs) ? parsed : null;
    return parsed.status === 'unknown' ? parsed : null;
  } catch {
    return null;
  }
};

const main = async (): Promise<number> => {
  const flags = parseFlags(process.argv.slice(2));
  if (unknownFlagKeys(flags, KNOWN_KEYS).length > 0) usage();
  const pr = typeof flags.pr === 'string' ? Number(flags.pr) : NaN;
  if (!Number.isInteger(pr) || pr < 1) usage();

  let snapshot: OpenPrSnapshot | null;
  let conflicts: Conflicts;
  if (typeof flags['open-prs'] === 'string') {
    snapshot = readSnapshotFile(flags['open-prs']);
    conflicts = () => 'conflict';
  } else {
    if (typeof flags['repo-slug'] !== 'string') usage();
    const repoRoot = path.resolve(typeof flags['repo-root'] === 'string' ? flags['repo-root'] : process.cwd());
    const forgeFlag = typeof flags.forge === 'string' ? flags.forge : 'github';
    if (!FORGES.includes(forgeFlag)) usage();
    const forge = forgeFlag as ForgeType;
    const adapter = createForgeAdapter({ repo: flags['repo-slug'] as string, forge });
    snapshot = await buildOpenPrSnapshot(adapterSnapshotIo(adapter, repoRoot, path.join(repoRoot, '.blackhole', 'pr-files-cache.json')));
    conflicts = (me, other) =>
      mergeTreeVerdict(
        (args) => {
          const r = Bun.spawnSync(['git', ...args], { cwd: repoRoot });
          return { code: r.exitCode ?? 1, stdout: r.stdout.toString(), stderr: r.stderr.toString() };
        },
        `${PR_REF_PREFIX}${me.number}`,
        `${PR_REF_PREFIX}${other.number}`,
      );
  }

  const result = snapshot
    ? evaluateStackGate(pr, snapshot, conflicts)
    : ({ exit: 3, message: `stack-check: ${flags['open-prs']} is not a readable open-PR snapshot` } as GateResult);
  (result.exit === 0 ? console.log : console.error)(result.message);
  if (result.exit === 1 && flags.fix === true) {
    const parentBranch = result.parentBranch ?? '<parent-branch>';
    console.error(
      `fix: bun run scripts/stack-repair.ts restack --queue .blackhole/queue.json --repo-slug <owner/repo> --repo-root <abs> --child-issue <issue of PR #${pr}> --parent-branch ${parentBranch} --apply`,
    );
  }
  return result.exit;
};

// An unexpected throw is "could not check" (3), never the "overlapping and not stacked" refusal (1).
const run = async (): Promise<number> => {
  try {
    return await main();
  } catch (err) {
    console.error(`stack-check: could not check: ${err instanceof Error ? err.message : String(err)}`);
    return 3;
  }
};

if (import.meta.main) process.exit(await run());
