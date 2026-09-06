#!/usr/bin/env bun
import { spawnSync } from 'child_process';
import * as path from 'path';
import {
  assertPreMergeBase,
  verifyPostMergeLanding,
} from './lib/merge-gate/merge-base.ts';

function usage(): never {
  console.error(
    'Usage: bun run --cwd <abs repo-root> scripts/merge-base-guard.ts --mode pre-merge --base-ref <name> --target-branch <name> [--stacked-into <name>]\n' +
      '       bun run --cwd <abs repo-root> scripts/merge-base-guard.ts --mode post-merge --pr <N> --target-branch <name> --repo-root <abs repo-root> [--attempts <N>] [--interval-ms <N>]',
  );
  process.exit(2);
}

// Exit 3, distinct from 1: nothing was learned about the landing at all. A git call that fails
// says where the merge went no more than it says where it did not, so collapsing it into either
// verdict manufactures evidence — `merge-gate.md` § 8 promotes both of those to proof.
class VerificationUnavailable extends Error {}

function unavailable(reason: string): never {
  throw new VerificationUnavailable(reason);
}

// spawnSync reports a signal kill or an unspawnable binary as a null status, which is not 0 and
// so is refused here alongside an ordinary non-zero exit.
function requireOk(result: { status: number | null }, what: string): void {
  if (result.status !== 0) unavailable(`${what} failed (exit ${result.status ?? 'signal'})`);
}

function parseArgs(argv: string[]): Record<string, string> {
  const args: Record<string, string> = {};
  for (let i = 2; i < argv.length; i += 2) {
    const key = argv[i];
    const value = argv[i + 1];
    if (!key?.startsWith('--') || value === undefined) usage();
    args[key.slice(2)] = value;
  }
  return args;
}

const git = (repoRoot: string, args: string[]) =>
  spawnSync('git', ['-C', repoRoot, ...args], { encoding: 'utf-8' });

// Prefers the remote-tracking ref so a verification run reflects what the forge actually holds,
// and falls back to the local branch for repos with no configured remote. A branch that resolves
// neither way is reported, never treated as an empty log (which would read as a clean miss).
function resolveBranchRef(repoRoot: string, branch: string): string | null {
  for (const ref of [`origin/${branch}`, branch]) {
    if (git(repoRoot, ['rev-parse', '--verify', '--quiet', `${ref}^{commit}`]).status === 0) return ref;
  }
  return null;
}

function runPreMerge(args: Record<string, string>): void {
  if (!args['base-ref'] || !args['target-branch']) usage();
  const result = assertPreMergeBase({
    baseRefName: args['base-ref'],
    targetBranch: args['target-branch'],
    stackedInto: args['stacked-into'],
  });
  if (!result.ok) {
    console.error(`merge-base-guard: ${result.reason}`);
    process.exit(1);
  }
  console.log(`merge-base-guard: ok — base ${args['base-ref']}`);
}

function positiveInt(raw: string | undefined, fallback: number): number {
  if (raw === undefined) return fallback;
  const value = Number(raw);
  if (!Number.isInteger(value) || value < 1) usage();
  return value;
}

// Separates "the merge landed somewhere else" (exit 1) from "the check never ran" (exit 3);
// `verifyPostMergeLanding` deliberately knows nothing about subprocesses, so the classification
// happens here, at the only layer that spawns git.
function runVerification(
  opts: Parameters<typeof verifyPostMergeLanding>[0],
): ReturnType<typeof verifyPostMergeLanding> {
  try {
    return verifyPostMergeLanding(opts);
  } catch (error) {
    if (error instanceof VerificationUnavailable) {
      console.error(`merge-base-guard: verification could not run — ${error.message}`);
      process.exit(3);
    }
    throw error;
  }
}

function runPostMerge(args: Record<string, string>): void {
  const branch = args['target-branch'];
  const repoRoot = args['repo-root'];
  if (!args.pr || !branch || !repoRoot) usage();
  const prNumber = Number(args.pr);
  if (!Number.isInteger(prNumber) || prNumber < 1) usage();
  if (!path.isAbsolute(repoRoot)) usage();
  const maxAttempts = positiveInt(args.attempts, 3);
  const intervalMs = positiveInt(args['interval-ms'], 20_000);

  const result = runVerification({
    prNumber,
    targetBranch: branch,
    maxAttempts,
    intervalMs,
    readLog: () => {
      // Re-fetched every attempt: replication delay is the only reason a retry could change the
      // answer, so a run that never re-reads the remote would make the retry budget meaningless.
      // A fetch that fails ends the run here rather than spending the rest of the budget
      // re-reading a local ref nothing refreshed.
      requireOk(git(repoRoot, ['fetch', 'origin', branch]), `git fetch origin ${branch} in ${repoRoot}`);
      const ref = resolveBranchRef(repoRoot, branch);
      if (ref === null) unavailable(`branch ${branch} does not resolve in ${repoRoot}`);
      const log = git(repoRoot, ['log', ref, '-F', `--grep=#${prNumber}`, '--format=%H %s']);
      requireOk(log, `git log ${ref} in ${repoRoot}`);
      return log.stdout ?? '';
    },
    wait: (ms) => Bun.sleepSync(ms),
  });

  if (!result.ok) {
    console.error(`merge-base-guard: ${result.reason}`);
    process.exit(1);
  }
  console.log(`merge-base-guard: ok — PR #${prNumber} landed on ${branch} (attempt ${result.attempts})`);
}

function main(): void {
  const args = parseArgs(process.argv);
  if (args.mode === 'pre-merge') return runPreMerge(args);
  if (args.mode === 'post-merge') return runPostMerge(args);
  usage();
}

if (import.meta.main) {
  main();
}
