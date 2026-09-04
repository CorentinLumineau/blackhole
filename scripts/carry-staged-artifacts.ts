#!/usr/bin/env bun
import { carryManifest, loadManifest } from './lib/carry-staged-artifacts.ts';

// Issue #715 (R-10) — CLI entrypoint for the ADR-021 D2 carry-step mechanization. Invoked from
// `implementer.md` § Carry Staged Artifacts before opening the PR; see that section for the
// gate/invocation contract this wraps.
// Issue #798: the caller MUST also pass Bun's own `--cwd <abs repo-root>` flag (before the
// script path, matching `--repo-root`) — this pins *module resolution* (this script's own
// `./lib/...` imports) to the same tree `--repo-root` operates on, which no CLI argument here
// can do on its own.
function usage(): never {
  console.error(
    'Usage: bun run --cwd <abs repo-root> scripts/carry-staged-artifacts.ts --manifest <path> --repo-root <path> [--staging-root <path>]',
  );
  process.exit(2);
}

function parseArgs(argv: string[]): { manifestPath: string; repoRoot: string; stagingRoot?: string } {
  const args: Record<string, string> = {};
  for (let i = 2; i < argv.length; i += 2) {
    const key = argv[i];
    const value = argv[i + 1];
    if (!key?.startsWith('--') || value === undefined) usage();
    args[key.slice(2)] = value;
  }
  if (!args.manifest || !args['repo-root']) usage();
  return { manifestPath: args.manifest!, repoRoot: args['repo-root']!, stagingRoot: args['staging-root'] };
}

function main(): void {
  const { manifestPath, repoRoot, stagingRoot } = parseArgs(process.argv);

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

  let outcome: ReturnType<typeof carryManifest>;
  try {
    outcome = carryManifest(manifest, repoRoot, { stagingRoot });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.error(`carry-staged-artifacts: ${message}`);
    process.exit(1);
  }

  for (const skipped of outcome.skippedEntries) {
    console.error(`carry-staged-artifacts: skipped entries[${skipped.index}]: ${skipped.reason}`);
  }
  process.stdout.write(`${JSON.stringify(outcome.carriedPaths)}\n`);

  // A manifest that resolves and has entries but carries literally nothing (every entry
  // failed validation) is indistinguishable on stdout alone from "nothing staged" — exit 1 so
  // the caller (`implementer.md` § Carry Staged Artifacts) cannot silently read it as success.
  // A *partial* skip alongside a partial carry (the line-99 test's precedent, issue #715) is
  // still progress and stays exit 0.
  if (outcome.skippedEntries.length > 0 && outcome.carriedPaths.length === 0) {
    process.exit(1);
  }
}

if (import.meta.main) {
  main();
}
