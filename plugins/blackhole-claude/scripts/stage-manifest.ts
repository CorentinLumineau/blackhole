#!/usr/bin/env bun
import { parseFlags, requireFlag, unknownFlagKeys } from './lib/argv-flags.ts';
import { appendManifestEntry } from './lib/stage-manifest.ts';

// Sole writer of `.blackhole/staged/<issue>/manifest.json` (blackhole-state.md § Staging):
// atomic `.tmp` + rename, entry validated first. Exit 0 written, 1 refused (reason on stderr,
// live manifest untouched), 2 malformed usage. Invoke as
// `bun run --cwd <abs repo-root> scripts/stage-manifest.ts append --manifest <abs path> --issue <N> --entry-json '<json>'`.
function usage(): never {
  console.error("Usage: bun run --cwd <abs repo-root> scripts/stage-manifest.ts append --manifest <path> --issue <N> --entry-json '<json>'");
  process.exit(2);
}

function main(): void {
  const [command, ...rest] = process.argv.slice(2);
  if (command !== 'append') usage();
  const flags = parseFlags(rest);
  if (unknownFlagKeys(flags, ['manifest', 'issue', 'entry-json']).length > 0) usage();
  let manifestPath: string;
  let issueRaw: string;
  let entryRaw: string;
  try {
    manifestPath = requireFlag(flags, 'manifest');
    issueRaw = requireFlag(flags, 'issue');
    entryRaw = requireFlag(flags, 'entry-json');
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
