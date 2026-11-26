import * as fs from 'fs';
import * as path from 'path';
import { parseFlags, unknownFlagKeys } from './lib/argv-flags.ts';
import { DISPATCHED_STATUSES, readClaimLabels, releaseClaimLabels, type ClaimReleaseReport } from './lib/claim-release.ts';
import { adapterForCampaign } from './lib/forge-adapter/for-campaign.ts';
import type { ForgeAdapter } from './lib/forge-adapter/types.ts';
import { readJsonFile } from './lib/fs.ts';

// Usage: bun run scripts/release-claims.ts [--campaign-dir <dir>]
// Releases the contract claim labels (`claim_labels` in config.json, e.g. ["in-progress:claude"]) from
// every dispatched queue issue (status in-flight, merged or closed) that has no open PR in flight, and
// prints one JSON line `{released, kept, failed}`. With no `claim_labels` it prints empty sets and
// touches no forge. Exit 0 on success, 2 on bad usage, 1 when any release failed (the report still
// prints, `failed` lists them) or the forge could not be read (message on stderr).
const USAGE = 'usage: release-claims.ts [--campaign-dir <dir>]';

export class UsageError extends Error {}

type Config = { repo?: string; forge?: string; claim_labels?: unknown };

/** Runs one release pass and returns the report. `adapter` replaces the configured forge's, for a test. */
export async function runReleaseClaims(argv: string[], opts: { adapter?: ForgeAdapter } = {}): Promise<ClaimReleaseReport> {
  const flags = parseFlags(argv);
  const unknown = unknownFlagKeys(flags, ['campaign-dir']);
  if (unknown.length) throw new UsageError(`unknown flag(s): ${unknown.map((k) => `--${k}`).join(', ')}`);
  if (flags['campaign-dir'] === true) throw new UsageError('--campaign-dir needs a value');
  const campaignDir = path.resolve(process.cwd(), typeof flags['campaign-dir'] === 'string' ? flags['campaign-dir'] : '.blackhole');
  const configPath = path.join(campaignDir, 'config.json');
  const config = fs.existsSync(configPath) ? (readJsonFile(configPath, configPath) as Config) : {};
  const labels = readClaimLabels(config);
  if (labels.length === 0) return { released: [], kept: [], failed: [] };

  const queuePath = path.join(campaignDir, 'queue.json');
  const queue = fs.existsSync(queuePath) ? (readJsonFile(queuePath, queuePath) as { issues?: Record<string, { status?: unknown } | null> }) : {};
  const issues = Object.entries(queue.issues ?? {})
    .filter(([, entry]) => DISPATCHED_STATUSES.includes(String(entry?.status)))
    .map(([key]) => Number(key))
    .filter((n) => Number.isInteger(n) && n > 0);

  if (!config.repo && !opts.adapter) throw new Error(`${configPath} has no "repo": the forge cannot be read.`);
  const adapter = opts.adapter ?? adapterForCampaign(campaignDir, { repo: config.repo as string, forge: config.forge });
  return releaseClaimLabels(adapter, issues, labels);
}

/** 1 when any claim release failed, so the caller sees a partial pass. */
export const reportExitCode = (report: ClaimReleaseReport): number => (report.failed.length > 0 ? 1 : 0);

const main = async (): Promise<void> => {
  try {
    const report = await runReleaseClaims(process.argv.slice(2));
    console.log(JSON.stringify(report));
    process.exitCode = reportExitCode(report);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (error instanceof UsageError) {
      console.error(`release-claims: ${message}\n${USAGE}`);
      process.exit(2);
    }
    console.error(`release-claims: ${message}`);
    process.exit(1);
  }
};

if (import.meta.main) await main();
