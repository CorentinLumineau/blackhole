import * as fs from 'fs';
import * as path from 'path';
import { parseFlags, unknownFlagKeys } from './lib/argv-flags.ts';
import { readCiCapacity, resolveCiCapacityConfig } from './lib/ci-capacity-reader.ts';
import { runGhApiRestJson } from './lib/forge-adapter/cli.ts';
import { isForgeType, resolveForgeForRepo } from './lib/forge-detection.ts';
import { readJsonFile } from './lib/fs.ts';

// Usage: bun run scripts/ci-capacity-read.ts [--config <path>]
// Prints the CI-capacity reading as one JSON line, `{"idle_runners":n,"busy_runners":n,"queued_jobs":n,"queue_allowance":n}`,
// ready for `usage-budget.ts --ci-capacity`. Prints nothing and exits 0 when `ci_capacity.enabled` is off, the
// forge is not GitHub (the only forge whose runner API is read here), or the forge could not be read: the reason
// goes to stderr and the worker count stays as the token budget set it. Exit 2 on bad flags or a malformed config.
const USAGE = 'usage: ci-capacity-read.ts [--config <path>]';
const fail = (message: string): never => {
  console.error(`ci-capacity-read: ${message}\n${USAGE}`);
  process.exit(2);
};

const flags = parseFlags(process.argv.slice(2));
const unknown = unknownFlagKeys(flags, ['config']);
if (unknown.length) fail(`unknown flag(s): ${unknown.map((k) => `--${k}`).join(', ')}`);
if (flags.config !== undefined && typeof flags.config !== 'string') fail('--config needs a path');
const configPath = typeof flags.config === 'string' ? flags.config : '.blackhole/config.json';

let raw: Record<string, unknown> = {};
let resolved;
try {
  if (fs.existsSync(configPath)) raw = readJsonFile(configPath, configPath) as Record<string, unknown>;
  resolved = resolveCiCapacityConfig(raw);
} catch (error) {
  fail(error instanceof Error ? error.message : String(error));
}
const config = resolved as ReturnType<typeof resolveCiCapacityConfig>;

if (!config.enabled) process.exit(0);
const repo = typeof raw.repo === 'string' ? raw.repo : '';
const configForge = typeof raw.forge === 'string' ? raw.forge : undefined;
const detected = resolveForgeForRepo(path.dirname(path.dirname(path.resolve(configPath))), configForge);
const forge = detected.ok ? detected.forge : configForge && isForgeType(configForge) ? configForge : 'github';
if (!repo) {
  console.error('ci-capacity-read: ci capacity unread, workers unchanged: config has no "repo"');
} else if (forge !== 'github') {
  console.error(`ci-capacity-read: ci capacity unread, workers unchanged: no runner reader for forge ${forge}`);
} else {
  const { capacity, warning } = readCiCapacity(repo, config, (endpoint) => runGhApiRestJson('GET', endpoint));
  if (warning) console.error(`ci-capacity-read: ${warning}`);
  if (capacity) console.log(JSON.stringify(capacity));
}
