#!/usr/bin/env bun
import * as fs from 'fs';
import * as path from 'path';
import { readJsonFile } from './lib/fs.ts';
import { renderReviewMarkdown, type LedgerFile } from './lib/promote-review-artifact.ts';

// Consumer worktrees: run via plugin root, not consumer cwd —
//   bun run --cwd <plugin-root> scripts/promote-review-artifact.ts --ledger <consumer>/.blackhole/findings-ledger.json ...
// or: scripts/consumer-promote-review.sh (sets --cwd from vendor/blackhole or BLACKHOLE_PLUGIN_ROOT)
function usage(): never {
  console.error(
    'Usage: bun run --cwd <plugin-root> scripts/promote-review-artifact.ts --ledger <path> --issue <N> --title <title> --pr <P> --branch <name> --head <sha> [--out-dir <dir>]',
  );
  process.exit(2);
}

function parseArgs(argv: string[]) {
  const args: Record<string, string> = {};
  for (let i = 2; i < argv.length; i += 2) {
    const key = argv[i];
    const value = argv[i + 1];
    if (!key?.startsWith('--') || value === undefined) usage();
    args[key.slice(2)] = value;
  }
  if (!args.ledger || !args.issue || !args.title || !args.pr || !args.branch || !args.head) usage();
  return {
    ledgerPath: args.ledger,
    issueNumber: Number(args.issue),
    issueTitle: args.title,
    prNumber: Number(args.pr),
    branchName: args.branch,
    headSha: args.head,
    outDir: args['out-dir'],
  };
}

function main(): void {
  const parsed = parseArgs(process.argv);
  const ledger = readJsonFile(parsed.ledgerPath) as LedgerFile;
  const rendered = renderReviewMarkdown({
    issueNumber: parsed.issueNumber,
    issueTitle: parsed.issueTitle,
    prNumber: parsed.prNumber,
    branchName: parsed.branchName,
    headSha: parsed.headSha,
    ledger,
  });

  const payload = JSON.stringify(rendered, null, 2);
  if (parsed.outDir) {
    fs.mkdirSync(parsed.outDir, { recursive: true });
    fs.writeFileSync(path.join(parsed.outDir, 'review-artifact.json'), `${payload}\n`);
    fs.writeFileSync(path.join(parsed.outDir, 'review.md'), rendered.markdown);
    fs.writeFileSync(path.join(parsed.outDir, 'index-row.md'), `${rendered.indexRow}\n`);
  } else {
    process.stdout.write(`${payload}\n`);
  }
}

if (import.meta.main) {
  main();
}
