import * as fs from 'fs';
import * as path from 'path';
import { parseFlags, unknownFlagKeys } from './lib/argv-flags.ts';
import { applyClaimLabels, readClaimLabels, type ClaimApplyReport } from './lib/claim-release.ts';
import { adapterForCampaign } from './lib/forge-adapter/for-campaign.ts';
import type { ForgeAdapter } from './lib/forge-adapter/types.ts';
import { readJsonFile } from './lib/fs.ts';

// Usage: bun run scripts/claim-labels.ts --issue <N> [--campaign-dir <dir>]
// Claims issue N on the forge with the contract claim labels (`claim_labels` in config.json, e.g.
// ["in-progress:claude"]) at implementer dispatch, the mirror of release-claims.ts, and prints one
// JSON line `{claimed, failed}`. With no `claim_labels` it prints empty sets and touches no forge.
// Exit 0 on success, 2 on bad usage, 1 when a label could not be added (the report still prints,
// `failed` lists them) or the config could not be read (message on stderr). Callers treat exit 1 as
// a warning: a claim never blocks dispatch.
const USAGE = 'usage: claim-labels.ts --issue <N> [--campaign-dir <dir>]';

export class UsageError extends Error {}

type Config = { repo?: string; forge?: string; claim_labels?: unknown };

/** Runs one claim and returns the report. `adapter` replaces the configured forge's, for a test. */
export async function runClaimLabels(argv: string[], opts: { adapter?: ForgeAdapter } = {}): Promise<ClaimApplyReport> {
  const flags = parseFlags(argv);
  const unknown = unknownFlagKeys(flags, ['issue', 'campaign-dir']);
  if (unknown.length) throw new UsageError(`unknown flag(s): ${unknown.map((k) => `--${k}`).join(', ')}`);
  if (flags['campaign-dir'] === true) throw new UsageError('--campaign-dir needs a value');
  const issue = typeof flags.issue === 'string' && /^[1-9]\d*$/.test(flags.issue) ? Number(flags.issue) : 0;
  if (!issue) throw new UsageError('--issue needs a positive issue number');
  const campaignDir = path.resolve(process.cwd(), typeof flags['campaign-dir'] === 'string' ? flags['campaign-dir'] : '.blackhole');
  const configPath = path.join(campaignDir, 'config.json');
  const config = fs.existsSync(configPath) ? (readJsonFile(configPath, configPath) as Config) : {};
  const labels = readClaimLabels(config);
  if (labels.length === 0) return { claimed: [], failed: [] };

  if (!config.repo && !opts.adapter) throw new Error(`${configPath} has no "repo": the forge cannot be written.`);
  const adapter = opts.adapter ?? adapterForCampaign(campaignDir, { repo: config.repo as string, forge: config.forge });
  return applyClaimLabels(adapter, issue, labels);
}

/** 1 when any claim failed, so the caller sees a partial pass. */
export const claimExitCode = (report: ClaimApplyReport): number => (report.failed.length > 0 ? 1 : 0);

const main = async (): Promise<void> => {
  try {
    const report = await runClaimLabels(process.argv.slice(2));
    console.log(JSON.stringify(report));
    for (const f of report.failed) console.error(`claim-labels: could not add ${f.label} to #${f.issue}: ${f.error}`);
    process.exitCode = claimExitCode(report);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (error instanceof UsageError) {
      console.error(`claim-labels: ${message}\n${USAGE}`);
      process.exit(2);
    }
    console.error(`claim-labels: ${message}`);
    process.exit(1);
  }
};

if (import.meta.main) await main();
