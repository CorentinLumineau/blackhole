#!/usr/bin/env bun
import { parseFlags, requireFlag, unknownFlagKeys } from './lib/argv-flags.ts';
import { createForgeAdapter } from './lib/forge-adapter/index.ts';
import type { ForgeAdapter, ForgeType, PrUpdateBranchResult } from './lib/forge-adapter/types.ts';
import { isForgeType } from './lib/forge-detection.ts';

// Brings a behind-but-clean PR up to date with its base through the forge's own update endpoint
// (merge-conflict-protocol.md Step 0.5), so no worktree, local merge or rebase is needed. Prints the
// PrUpdateBranchResult as JSON. Exit 0 UPDATED, 1 CONFLICT/STALE-HEAD/FAILED, 2 usage, 3 UNSUPPORTED.

const USAGE =
  'Usage: bun run scripts/pr-update-branch.ts --repo-slug <owner/repo> --forge <github|gitea|gitlab> --pr <n> --expected-head-sha <sha>';
const FLAGS = ['repo-slug', 'forge', 'pr', 'expected-head-sha'];

export interface PrUpdateBranchDeps {
  adapterFor: (repo: string, forge: ForgeType) => ForgeAdapter;
  print: (line: string) => void;
  printErr?: (line: string) => void;
}

export const exitCodeFor = (verdict: PrUpdateBranchResult['verdict']): number =>
  verdict === 'UPDATED' ? 0 : verdict === 'UNSUPPORTED' ? 3 : 1;

export async function runPrUpdateBranch(argv: string[], deps: PrUpdateBranchDeps): Promise<number> {
  const fail = (): number => {
    (deps.printErr ?? console.error)(USAGE);
    return 2;
  };
  const flags = parseFlags(argv);
  if (unknownFlagKeys(flags, FLAGS).length) return fail();
  let pr: number;
  let sha: string;
  let repo: string;
  let forge: ForgeType;
  try {
    pr = Number(requireFlag(flags, 'pr'));
    sha = requireFlag(flags, 'expected-head-sha');
    repo = requireFlag(flags, 'repo-slug');
    const forgeFlag = typeof flags.forge === 'string' ? flags.forge : 'github';
    if (!isForgeType(forgeFlag)) return fail();
    forge = forgeFlag;
  } catch {
    return fail();
  }
  if (!Number.isInteger(pr) || pr <= 0) return fail();
  let result: PrUpdateBranchResult;
  try {
    result = await deps.adapterFor(repo, forge).prUpdateBranch(pr, sha);
  } catch (err) {
    result = { verdict: 'FAILED', detail: err instanceof Error ? err.message : String(err) };
  }
  deps.print(JSON.stringify(result));
  return exitCodeFor(result.verdict);
}

if (import.meta.main) {
  process.exitCode = await runPrUpdateBranch(process.argv.slice(2), {
    adapterFor: (repo, forge) => createForgeAdapter({ repo, forge }),
    print: (line) => console.log(line),
  });
}
