#!/usr/bin/env bun
import * as fs from 'fs';
import * as path from 'path';
import { readJsonFile } from './lib/fs.ts';
import { mergeReadinessForReviewPromotion } from './lib/merge-gate/review-artifact.ts';
import type { LedgerFile } from './lib/promote-review-artifact.ts';

function usage(): never {
  console.error(
    'Usage: bun run --cwd <abs repo root> scripts/check-review-artifact.ts --config <abs .blackhole/config.json> --issue <N> --title <title> --ledger <abs findings-ledger.json> --pr <P> --branch <branch> --head <sha> --repo-root <abs repo root> --diff-file <abs paths.txt>',
  );
  process.exit(2);
}

const REQUIRED_KEYS = ['config', 'issue', 'title', 'ledger', 'pr', 'branch', 'head', 'repo-root', 'diff-file'];
// Every path-shaped flag must be absolute (issue #806 AC4) — sidesteps the cwd-relative
// *argument*-resolution hazard class documented for #798 rather than sequencing behind it.
// #798 also requires every caller to pass Bun's own `--cwd <abs repo root>` flag (before the
// script path, matching `--repo-root`) — that pins *module resolution* (this script's own
// `./lib/...` imports) to the same tree, which no CLI argument here can do on its own.
const ABSOLUTE_PATH_KEYS = ['config', 'ledger', 'repo-root', 'diff-file'];

function parseArgs(argv: string[]) {
  const args: Record<string, string> = {};
  for (let i = 2; i < argv.length; i += 2) {
    const key = argv[i];
    const value = argv[i + 1];
    if (!key?.startsWith('--') || value === undefined) usage();
    args[key.slice(2)] = value;
  }
  for (const key of REQUIRED_KEYS) {
    if (!args[key]) usage();
  }
  for (const key of ABSOLUTE_PATH_KEYS) {
    if (!path.isAbsolute(args[key]!)) usage();
  }
  return {
    configPath: args.config!,
    issueNumber: Number(args.issue),
    issueTitle: args.title!,
    ledgerPath: args.ledger!,
    prNumber: Number(args.pr),
    branchName: args.branch!,
    headSha: args.head!,
    repoRoot: args['repo-root']!,
    diffFile: args['diff-file']!,
  };
}

function main(): void {
  const parsed = parseArgs(process.argv);
  const config = readJsonFile(parsed.configPath, parsed.configPath) as {
    docs_governance?: { enabled?: boolean; write_governance?: boolean };
  };
  const ledger = readJsonFile(parsed.ledgerPath, parsed.ledgerPath) as LedgerFile;
  const prDiffPaths = fs
    .readFileSync(parsed.diffFile, 'utf-8')
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean);

  const result = mergeReadinessForReviewPromotion({
    issueTitle: parsed.issueTitle,
    issueNumber: parsed.issueNumber,
    prDiffPaths,
    config: config.docs_governance,
    prNumber: parsed.prNumber,
    branchName: parsed.branchName,
    headSha: parsed.headSha,
    ledger,
    repoRoot: parsed.repoRoot,
  });

  if (!result.ok) {
    for (const reason of result.reasons) {
      console.error(`check-review-artifact: ${reason}`);
    }
    process.exit(1);
  }

  console.log('check-review-artifact: ok');
}

if (import.meta.main) {
  main();
}
