#!/usr/bin/env bun
import * as fs from 'fs';
import * as path from 'path';
import { loadManifest } from './lib/carry-staged-artifacts.ts';
import { parseFlags, unknownFlagKeys } from './lib/argv-flags.ts';
import { readJsonFile } from './lib/fs.ts';
import { checkRouteArtifacts, dispatchGaps, latestRoute, promisedRoutes } from './lib/route-artifacts.ts';

// Issue #1278 (V-AUTO-03) — route-artifact gate. `--phase dispatch` (before spawning an
// implementer) asserts every route the issue's route promised has a staged manifest entry;
// `--phase pr` additionally asserts each staged `new_file` target is in the PR's changed files.
// `--campaign-dir` is the absolute `.blackhole` directory. Exit 0 pass or skipped, 1 gap, 2 usage.
// A consumer-repo caller pins Bun's `--cwd` to the plugin root, as for carry-staged-artifacts.ts.
const usage = (): never => {
  console.error(
    'Usage: bun run --cwd <plugin root> scripts/route-artifacts.ts --issue <N> --campaign-dir <abs .blackhole> --phase dispatch|pr [--diff-file <path>]',
  );
  return process.exit(2);
};

const flags = parseFlags(process.argv.slice(2));
if (unknownFlagKeys(flags, ['issue', 'campaign-dir', 'phase', 'diff-file']).length > 0) usage();
const issue = Number(flags.issue);
const campaignDir = flags['campaign-dir'];
const phase = flags.phase;
const diffFile = flags['diff-file'];
if (!Number.isInteger(issue) || issue <= 0 || typeof campaignDir !== 'string') usage();
if (phase !== 'dispatch' && phase !== 'pr') usage();
if (phase === 'pr' && typeof diffFile !== 'string') usage();

const readIfPresent = (name: string): any => {
  const file = path.join(campaignDir as string, name);
  return fs.existsSync(file) ? readJsonFile(file, file) : null;
};

try {
  // Gate per `config-template.md` § `docs_governance`: an absent block is inert.
  const docs = readIfPresent('config.json')?.docs_governance;
  if (docs?.enabled !== true || docs?.write_governance === false) {
    console.log('route-artifacts: skipped (docs governance is off)');
    process.exit(0);
  }

  const route = latestRoute(readIfPresent('findings-ledger.json'), readIfPresent('queue.json'), issue);
  if (route === null) {
    console.error(`route-artifacts: no route recorded for issue #${issue} (V-AUTO-03)`);
    process.exit(1);
  }

  const manifest = loadManifest(path.join(campaignDir as string, 'staged', String(issue), 'manifest.json'));
  const gaps = dispatchGaps(promisedRoutes(route), manifest).map((r) => `route "${r}" has no staged manifest entry`);
  if (phase === 'pr') {
    const diff = fs.readFileSync(diffFile as string, 'utf-8').split('\n');
    gaps.push(...checkRouteArtifacts(manifest, diff).map((t) => `staged target ${t} is not in the PR diff`));
  }
  if (gaps.length > 0) {
    console.error(`route-artifacts: issue #${issue} (V-AUTO-03):\n  ${gaps.join('\n  ')}`);
    process.exit(1);
  }
  console.log(`route-artifacts: issue #${issue} ${phase} ok`);
} catch (error) {
  console.error(`route-artifacts: ${error instanceof Error ? error.message : String(error)}`);
  process.exit(1);
}
