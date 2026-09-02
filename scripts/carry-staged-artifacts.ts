#!/usr/bin/env bun
import { carryManifest, loadManifest } from './lib/carry-staged-artifacts.ts';

// Issue #715 (R-10) — CLI entrypoint for the ADR-021 D2 carry-step mechanization. Invoked from
// `implementer.md` § Carry Staged Artifacts before opening the PR; see that section for the
// gate/invocation contract this wraps.
function usage(): never {
  console.error('Usage: bun run scripts/carry-staged-artifacts.ts --manifest <path> --repo-root <path>');
  process.exit(2);
}

function parseArgs(argv: string[]): { manifestPath: string; repoRoot: string } {
  const args: Record<string, string> = {};
  for (let i = 2; i < argv.length; i += 2) {
    const key = argv[i];
    const value = argv[i + 1];
    if (!key?.startsWith('--') || value === undefined) usage();
    args[key.slice(2)] = value;
  }
  if (!args.manifest || !args['repo-root']) usage();
  return { manifestPath: args.manifest!, repoRoot: args['repo-root']! };
}

function main(): void {
  const { manifestPath, repoRoot } = parseArgs(process.argv);

  let manifest: ReturnType<typeof loadManifest>;
  try {
    manifest = loadManifest(manifestPath);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.error(`carry-staged-artifacts: ${message}`);
    process.exit(1);
  }

  if (manifest === null) {
    process.stdout.write('[]\n');
    return;
  }

  const outcome = carryManifest(manifest, repoRoot);
  for (const skipped of outcome.skippedEntries) {
    console.error(`carry-staged-artifacts: skipped entries[${skipped.index}]: ${skipped.reason}`);
  }
  process.stdout.write(`${JSON.stringify(outcome.carriedPaths)}\n`);
}

if (import.meta.main) {
  main();
}
