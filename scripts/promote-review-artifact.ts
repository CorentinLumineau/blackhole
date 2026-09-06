#!/usr/bin/env bun
import * as fs from 'fs';
import * as path from 'path';
import { readJsonFile } from './lib/fs.ts';
import { renderReviewMarkdown, type LedgerFile } from './lib/promote-review-artifact.ts';
import { parseFlags } from './lib/argv-flags.ts';

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
  const args = parseFlags(argv.slice(2));
  if (
    typeof args.ledger !== 'string' ||
    typeof args.issue !== 'string' ||
    typeof args.title !== 'string' ||
    typeof args.pr !== 'string' ||
    typeof args.branch !== 'string' ||
    typeof args.head !== 'string'
  )
    usage();
  return {
    ledgerPath: args.ledger as string,
    issueNumber: Number(args.issue),
    issueTitle: args.title as string,
    prNumber: Number(args.pr),
    branchName: args.branch as string,
    headSha: args.head as string,
    outDir: typeof args['out-dir'] === 'string' ? args['out-dir'] : undefined,
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
