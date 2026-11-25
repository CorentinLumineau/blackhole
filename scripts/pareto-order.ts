import * as fs from 'fs';
import * as path from 'path';
import { parseFlags, unknownFlagKeys } from './lib/argv-flags.ts';
import type { QueueJson } from './lib/campaign-status/types.ts';
import { readJsonFile } from './lib/fs.ts';
import { selectBatch } from './lib/pareto-order.ts';

// Prints the next batch of ready issue numbers as a JSON array, in `queue-dag.md` Step 4-5 order
// (wave, stored Pareto priority, effort, oldest). Read-only: `queue.json` has a single writer.

const USAGE = 'Usage: bun run scripts/pareto-order.ts [--campaign-dir <dir>] [--limit <n>]';
const DEFAULT_LIMIT = 4;

function main(): void {
  const flags = parseFlags(process.argv.slice(2));
  const unknown = unknownFlagKeys(flags, ['campaign-dir', 'limit']);
  const limit = flags.limit === undefined ? DEFAULT_LIMIT : Number(flags.limit);
  if (unknown.length || !Number.isInteger(limit) || limit < 1) {
    console.error(`${unknown.length ? `Unknown flag(s): ${unknown.join(', ')}` : `Invalid --limit: ${String(flags.limit)}`}\n${USAGE}`);
    process.exit(2);
  }
  const dir = typeof flags['campaign-dir'] === 'string' ? flags['campaign-dir'] : '.blackhole';
  const queuePath = path.join(path.resolve(process.cwd(), dir), 'queue.json');
  if (!fs.existsSync(queuePath)) {
    console.error(`pareto-order: no queue at ${queuePath}`);
    process.exit(1);
  }
  const queue = readJsonFile(queuePath, queuePath) as QueueJson & { user_queue_order?: number[] };
  console.log(JSON.stringify(selectBatch(queue.issues ?? {}, limit, queue.user_queue_order ?? [])));
}

if (import.meta.main) main();
