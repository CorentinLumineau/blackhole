#!/usr/bin/env bun
import * as fs from 'fs';
import * as path from 'path';
import { readJsonFile } from './lib/fs.ts';
import { mergeReadinessForReviewPromotion } from './lib/merge-gate/review-artifact.ts';

function usage(): never {
  console.error(
    'Usage: bun run scripts/check-review-artifact.ts --config <.blackhole/config.json> --issue <N> --title <title> --manifest <.blackhole/staged/N/manifest.json> --diff-file <paths.txt>',
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
  if (!args.config || !args.issue || !args.title || !args.manifest || !args['diff-file']) usage();
  return {
    configPath: args.config,
    issueNumber: Number(args.issue),
    issueTitle: args.title,
    manifestPath: args.manifest,
    diffFile: args['diff-file'],
  };
}

function main(): void {
  const parsed = parseArgs(process.argv);
  const config = readJsonFile(parsed.configPath) as { docs_governance?: { enabled?: boolean; write_governance?: boolean } };
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
    manifestPath: path.resolve(parsed.manifestPath),
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
