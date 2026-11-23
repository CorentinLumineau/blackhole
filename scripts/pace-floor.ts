import * as fs from 'fs';
import * as path from 'path';
import { parseFlags, unknownFlagKeys } from './lib/argv-flags.ts';
import { readPacing, resolveCatchup } from './lib/catchup.ts';
import { readJsonFile } from './lib/fs.ts';
import type { Host } from './lib/run-context.ts';
import { resolveHost, usageSourceFor } from './lib/usage-source.ts';
import { USAGE_HISTORY_FILE } from './lib/usage-history.ts';

// Usage: bun run scripts/pace-floor.ts [--usage <file>] [--cache <path>] [--host claude|cursor]
//        [--config <path>] [--now <epoch s>]
// Prints the catchup pace floor (ADR-054 C1) as one JSON line: status (ok | unreadable | no-weekly),
// floor_pct (null unless ok), elapsed_h, target_pct, shortfall_pct, used_pct, resets_at, plan, source, reason.
// The reading comes from the same provider chain as usage.ts (`--usage` is a FILE PATH); the
// weekly target comes from the `catchup` config block. Exit 0 on every status, 2 on bad usage, a broken
// `--usage` file or an invalid config.
const USAGE = 'usage: pace-floor.ts [--usage <file>] [--cache <path>] [--host claude|cursor] [--config <path>] [--now <epoch s>]';
const fail = (message: string): never => {
  console.error(`pace-floor: ${message}\n${USAGE}`);
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
    const preset = resolveCatchup(config);
    const report = usageSourceFor(host, config, {
      cachePath: typeof flags.cache === 'string' ? flags.cache : undefined,
      usageFile: typeof flags.usage === 'string' ? flags.usage : undefined,
      historyPath: path.join(path.dirname(configPath), USAGE_HISTORY_FILE),
    }).report(now);
    const pacing = readPacing(report, preset, now);
    if (pacing.reason) console.error(`pace-floor: ${pacing.status}: ${pacing.reason}`);
    console.log(
      JSON.stringify({
        status: pacing.status,
        floor_pct: pacing.floor_pct,
        elapsed_h: pacing.elapsed_h,
        target_pct: pacing.target_pct,
        shortfall_pct: pacing.shortfall_pct,
        used_pct: pacing.used_pct,
        resets_at: pacing.resets_at,
        plan: pacing.plan,
        source: report.source,
        reason: pacing.reason,
      }),
    );
  } catch (error) {
    fail(error instanceof Error ? error.message : String(error));
  }
};

if (import.meta.main) main();
