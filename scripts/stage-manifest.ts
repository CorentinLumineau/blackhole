#!/usr/bin/env bun
import * as fs from 'fs';
import { parseFlags, requireFlag, unknownFlagKeys } from './lib/argv-flags.ts';
import { appendManifestEntry } from './lib/stage-manifest.ts';

// CLI over appendManifestEntry (scripts/lib/stage-manifest.ts). Exit 0 written, 1 refused, 2 usage.
function usage(): never {
  console.error("Usage: bun run --cwd <abs repo-root> scripts/stage-manifest.ts append --manifest <path> --issue <N> (--entry-json '<json>' | --entry-file <path>)");
  process.exit(2);
}

function main(): void {
  const [command, ...rest] = process.argv.slice(2);
  if (command !== 'append') usage();
  const flags = parseFlags(rest);
  if (unknownFlagKeys(flags, ['manifest', 'issue', 'entry-json', 'entry-file']).length > 0) usage();
  let manifestPath: string;
  let issueRaw: string;
  let entryRaw: string;
  try {
    manifestPath = requireFlag(flags, 'manifest');
    issueRaw = requireFlag(flags, 'issue');
    if (('entry-json' in flags) === ('entry-file' in flags)) usage();
    entryRaw = 'entry-json' in flags ? requireFlag(flags, 'entry-json') : fs.readFileSync(requireFlag(flags, 'entry-file'), 'utf-8');
  } catch {
    usage();
  }
  const issue = Number(issueRaw);
  if (!Number.isInteger(issue) || issue <= 0) usage();

  try {
    appendManifestEntry(manifestPath, issue, JSON.parse(entryRaw));
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.error(`stage-manifest: ${message.includes(manifestPath) ? message : `${manifestPath}: ${message}`}`);
    process.exit(1);
  }
}

main();
