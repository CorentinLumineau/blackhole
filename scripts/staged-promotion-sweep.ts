#!/usr/bin/env bun
import * as fs from 'fs';
import * as path from 'path';
import { spawnSync } from 'child_process';
import { parseFlags, unknownFlagKeys } from './lib/argv-flags.ts';
import { sweepStaged } from './lib/staged-promotion-sweep.ts';

// Read-only, advisory post-merge sweep of `.blackhole/staged/*` (V-AUTO-02, post-merge leg). It
// never writes queue.json or the ledger (single-writer invariant); the orchestrator applies rows.
// Invoke with Bun's own `--cwd <abs repo-root>` as for every script (#798).
const KNOWN_KEYS = ['campaign-dir', 'repo-root', 'ref', 'package-root'];

function usage(): never {
  console.error(
    'Usage: bun run --cwd <abs repo-root> scripts/staged-promotion-sweep.ts --campaign-dir <abs .blackhole> --repo-root <abs> [--ref origin/main] [--package-root <dir>]',
  );
  process.exit(2);
}

function main(): void {
  const flags = parseFlags(process.argv.slice(2));
  if (unknownFlagKeys(flags, KNOWN_KEYS).length > 0) usage();
  if (typeof flags['campaign-dir'] !== 'string' || typeof flags['repo-root'] !== 'string') usage();
  const campaignDir = flags['campaign-dir'] as string;
  const repoRoot = flags['repo-root'] as string;
  const ref = typeof flags.ref === 'string' ? flags.ref : 'origin/main';
  const packageRoot = typeof flags['package-root'] === 'string' ? flags['package-root'] : undefined;

  const stagedRoot = path.join(campaignDir, 'staged');
  const dirs = fs.existsSync(stagedRoot) ? fs.readdirSync(stagedRoot).filter((d) => /^\d+$/.test(d)) : [];
  const manifests = dirs.map((d) => {
    const file = path.join(stagedRoot, d, 'manifest.json');
    let manifest: unknown = null;
    try {
      manifest = JSON.parse(fs.readFileSync(file, 'utf8'));
    } catch {
      /* absent or unparseable: classified as manifest_unreadable */
    }
    return { issue: Number(d), manifest };
  });

  let queue: Record<string, { status?: string }> = {};
  try {
    queue = JSON.parse(fs.readFileSync(path.join(campaignDir, 'queue.json'), 'utf8')).issues ?? {};
  } catch {
    /* no queue: every issue is treated as open */
  }

  const targetExists = (target: string): boolean =>
    spawnSync('git', ['-C', repoRoot, 'cat-file', '-e', `${ref}:${target}`], { stdio: 'ignore' }).status === 0;
  const stagedPathExists = (staged: string): boolean => fs.existsSync(path.resolve(path.dirname(campaignDir), staged));

  const rows = sweepStaged({ manifests, queue, targetExists, stagedPathExists, packageRoot });
  process.stdout.write(`${JSON.stringify(rows)}\n`);
}

if (import.meta.main) {
  main();
}
