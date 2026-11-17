import * as fs from 'fs';
import * as path from 'path';
import { parseFlags, unknownFlagKeys } from './lib/argv-flags.ts';
import { adapterForCampaign } from './lib/forge-adapter/for-campaign.ts';
import type { ForgeAdapter } from './lib/forge-adapter/types.ts';
import { readJsonFile } from './lib/fs.ts';
import { LANE_NAME, readLaneConfig } from './lib/lane.ts';

// Usage: bun run scripts/claim.ts (--claim <N> | --release <N>) [--campaign-dir <dir>] [--lane <name>]
//        [--user <login>] [--lease-hours <h>] [--now <epoch ms>]
// Claims or releases one issue for the account's lane (ADR-053 C4) and prints one JSON line
// `{verdict, issue, lane, user?, held_by?}`. No lane (flag, then `catchup.lane`) prints `SKIP` and
// touches no forge: claims are off. Exit 0 on every verdict, 2 on bad usage, 1 on a forge failure
// (message on stderr): the orchestrator never dispatches an issue it could not claim.
const USAGE = 'usage: claim.ts (--claim <N> | --release <N>) [--campaign-dir <dir>] [--lane <name>] [--user <login>] [--lease-hours <h>] [--now <epoch ms>]';

export class UsageError extends Error {}

const issueNumber = (value: string | true | undefined, flag: string): number | null => {
  if (value === undefined) return null;
  const n = typeof value === 'string' && /^\d+$/.test(value) ? Number(value) : NaN;
  if (!Number.isInteger(n) || n <= 0) throw new UsageError(`--${flag} needs an issue number`);
  return n;
};

type Config = { repo?: string; forge?: string; catchup?: unknown };

/** Runs one claim or release and returns the line to print. `adapter` replaces the configured forge's, for a test. */
export async function runClaim(argv: string[], opts: { adapter?: ForgeAdapter } = {}): Promise<Record<string, unknown>> {
  const flags = parseFlags(argv);
  const unknown = unknownFlagKeys(flags, ['claim', 'release', 'campaign-dir', 'lane', 'user', 'lease-hours', 'now']);
  if (unknown.length) throw new UsageError(`unknown flag(s): ${unknown.map((k) => `--${k}`).join(', ')}`);
  const claim = issueNumber(flags.claim, 'claim');
  const release = issueNumber(flags.release, 'release');
  if ((claim === null) === (release === null)) throw new UsageError('give exactly one of --claim or --release');
  const issue = (claim ?? release) as number;
  for (const key of ['campaign-dir', 'lane', 'user', 'lease-hours', 'now'] as const) if (flags[key] === true) throw new UsageError(`--${key} needs a value`);

  const campaignDir = path.resolve(process.cwd(), typeof flags['campaign-dir'] === 'string' ? flags['campaign-dir'] : '.blackhole');
  const configPath = path.join(campaignDir, 'config.json');
  const config = fs.existsSync(configPath) ? (readJsonFile(configPath, configPath) as Config) : {};
  const fromConfig = readLaneConfig(config);
  if (typeof flags.lane === 'string' && !LANE_NAME.test(flags.lane)) throw new UsageError('--lane must match [a-z0-9][a-z0-9._-]*');
  const lane = typeof flags.lane === 'string' ? flags.lane : fromConfig.lane;
  if (lane === null) return { verdict: 'SKIP', reason: 'no lane configured' };

  const leaseHours = typeof flags['lease-hours'] === 'string' ? Number(flags['lease-hours']) : fromConfig.leaseHours;
  if (!(leaseHours > 0)) throw new UsageError('--lease-hours must be a number > 0');
  const now = typeof flags.now === 'string' ? Number(flags.now) : undefined;
  if (now !== undefined && !Number.isFinite(now)) throw new UsageError('--now must be epoch milliseconds');

  if (!config.repo && !opts.adapter) throw new Error(`${configPath} has no "repo": the forge cannot be read.`);
  const adapter = opts.adapter ?? adapterForCampaign(campaignDir, { repo: config.repo as string, forge: config.forge });
  if (release !== null) return { ...(await adapter.release(issue, lane)), issue, lane };
  const user = typeof flags.user === 'string' ? flags.user : await adapter.viewerLogin();
  return { ...(await adapter.claim(issue, lane, user, { leaseHours, now })), issue, lane, user };
}

const main = async (): Promise<void> => {
  try {
    console.log(JSON.stringify(await runClaim(process.argv.slice(2))));
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (error instanceof UsageError) {
      console.error(`claim: ${message}\n${USAGE}`);
      process.exit(2);
    }
    console.error(`claim: ${message}`);
    process.exit(1);
  }
};

if (import.meta.main) await main();
