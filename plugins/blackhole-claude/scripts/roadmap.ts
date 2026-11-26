import * as fs from 'fs';
import * as path from 'path';
import { parseFlags, unknownFlagKeys } from './lib/argv-flags.ts';
import type { QueueJson } from './lib/campaign-status/types.ts';
import { readJsonFile } from './lib/fs.ts';
import { resolveRoadmapTarget, syncRoadmap, type RoadmapConfig } from './lib/roadmap/sync.ts';

// Regenerates the consumer roadmap from `queue.json` when `roadmap.path` is configured (no path, no
// work). Run it before the checkpoint commit so a changed ranking rides the checkpoint PR. Reads the
// queue and config, writes only the configured file, and prints one JSON line with what it did.

const USAGE = 'Usage: bun run scripts/roadmap.ts [--campaign-dir <dir>] [--repo-root <dir>] [--date <YYYY-MM-DD>]';

function main(): void {
  const flags = parseFlags(process.argv.slice(2));
  const unknown = unknownFlagKeys(flags, ['campaign-dir', 'repo-root', 'date']);
  const date = typeof flags.date === 'string' ? flags.date : new Date().toISOString().slice(0, 10);
  if (unknown.length || !/^\d{4}-\d{2}-\d{2}$/.test(date)) {
    console.error(`${unknown.length ? `Unknown flag(s): ${unknown.join(', ')}` : `Invalid --date: ${date}`}\n${USAGE}`);
    process.exit(2);
  }
  const repoRoot = path.resolve(typeof flags['repo-root'] === 'string' ? flags['repo-root'] : process.cwd());
  const dir = path.resolve(repoRoot, typeof flags['campaign-dir'] === 'string' ? flags['campaign-dir'] : '.blackhole');
  const queuePath = path.join(dir, 'queue.json');
  const configPath = path.join(dir, 'config.json');
  try {
    const config = fs.existsSync(configPath) ? (readJsonFile(configPath, configPath) as RoadmapConfig) : undefined;
    // No `roadmap.path` (or switched off) is a no-op before any queue read: a repo that never opted in needs no queue.
    const idle = 'skip' in resolveRoadmapTarget(config, repoRoot);
    if (!idle && !fs.existsSync(queuePath)) throw new Error(`no queue at ${queuePath}`);
    const queue = idle ? undefined : (readJsonFile(queuePath, queuePath) as QueueJson);
    console.log(JSON.stringify(syncRoadmap({ queue, config, repoRoot, date })));
  } catch (error) {
    console.error(`roadmap: ${error instanceof Error ? error.message : String(error)}`);
    process.exit(1);
  }
}

if (import.meta.main) main();
