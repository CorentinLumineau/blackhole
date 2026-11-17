import * as fs from 'fs';
import * as path from 'path';
import { parseFlags, unknownFlagKeys } from './lib/argv-flags.ts';
import { readJsonFile } from './lib/fs.ts';
import type { Host } from './lib/run-context.ts';
import { resolveHost, usageSourceFor } from './lib/usage-source.ts';

// Usage: bun run scripts/usage.ts [--usage <file>] [--cache <path>] [--host claude|cursor]
//        [--config <path>] [--now <epoch s>]
// Prints one normalized usage reading as a single JSON line (usage-source.ts § UsageReport):
// plan, windows[] (five_hour, seven_day, per-model weekly), extra_usage, source, provider,
// read_at, reason. `--usage` is a FILE PATH here (usage-budget.ts --usage takes inline JSON): the
// agent writes the host's usage tool output there. Provider order: that file, the statusline
// rate-limit cache, the probe-written cache; the first usable reading wins. Exit 0 on every
// reading, including source `none` (a one-line reason also goes to stderr); exit 2 on bad usage,
// an unreadable or malformed `--usage` file, or an invalid config.
const USAGE = 'usage: usage.ts [--usage <file>] [--cache <path>] [--host claude|cursor] [--config <path>] [--now <epoch s>]';
const fail = (message: string): never => {
  console.error(`usage: ${message}\n${USAGE}`);
  process.exit(2);
};

const main = (): void => {
  const flags = parseFlags(process.argv.slice(2));
  const unknown = unknownFlagKeys(flags, ['usage', 'cache', 'host', 'config', 'now']);
  if (unknown.length) fail(`unknown flag(s): ${unknown.map((k) => `--${k}`).join(', ')}`);
  const now = flags.now === undefined ? Math.floor(Date.now() / 1000) : Number(flags.now);
  if (typeof flags.now === 'boolean' || !Number.isInteger(now) || now < 0) fail('--now must be a non-negative integer');
  if (flags.host !== undefined && flags.host !== 'claude' && flags.host !== 'cursor') fail('--host must be claude or cursor');
  for (const key of ['usage', 'cache', 'config'] as const) if (flags[key] === true) fail(`--${key} needs a value`);

  const configPath = typeof flags.config === 'string' ? flags.config : '.blackhole/config.json';
  const host: Host = (flags.host as Host | undefined) ?? resolveHost(path.dirname(configPath), process.env);
  try {
    const config = fs.existsSync(configPath) ? (readJsonFile(configPath, configPath) as Record<string, unknown>) : {};
    const source = usageSourceFor(host, config, {
      cachePath: typeof flags.cache === 'string' ? flags.cache : undefined,
      usageFile: typeof flags.usage === 'string' ? flags.usage : undefined,
    });
    const report = source.report(now);
    if (report.source === 'none') console.error(`usage: ${report.reason}`);
    console.log(JSON.stringify(report));
  } catch (error) {
    // A broken --usage hand-off (UsageFileError) and an invalid config are both usage errors.
    fail(error instanceof Error ? error.message : String(error));
  }
};

if (import.meta.main) main();
