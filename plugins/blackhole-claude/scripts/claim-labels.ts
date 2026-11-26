import { parseFlags, unknownFlagKeys } from './lib/argv-flags.ts';
import { claimAdapter, loadClaimConfig, resolveCampaignDir, runClaimCli, UsageError } from './lib/claim-cli.ts';
import { applyClaimLabels, type ClaimApplyReport } from './lib/claim-release.ts';
import type { ForgeAdapter } from './lib/forge-adapter/types.ts';

// Usage: bun run scripts/claim-labels.ts --issue <N> [--campaign-dir <dir>]
// Claims issue N on the forge with the contract claim labels (`claim_labels` in config.json, e.g.
// ["in-progress:claude"]) at implementer dispatch, the mirror of release-claims.ts, and prints one
// JSON line `{claimed, failed}`. With no `claim_labels` it prints empty sets and touches no forge.
// Exit 0 on success, 2 on bad usage, 1 when a label could not be added (the report still prints,
// `failed` lists them) or the config could not be read (message on stderr). Callers treat exit 1 as
// a warning: a claim never blocks dispatch.
const USAGE = 'usage: claim-labels.ts --issue <N> [--campaign-dir <dir>]';

export { UsageError };

/** Runs one claim and returns the report. `adapter` replaces the configured forge's, for a test. */
export async function runClaimLabels(argv: string[], opts: { adapter?: ForgeAdapter } = {}): Promise<ClaimApplyReport> {
  const flags = parseFlags(argv);
  const unknown = unknownFlagKeys(flags, ['issue', 'campaign-dir']);
  if (unknown.length) throw new UsageError(`unknown flag(s): ${unknown.map((k) => `--${k}`).join(', ')}`);
  if (flags['campaign-dir'] === true) throw new UsageError('--campaign-dir needs a value');
  const issue = typeof flags.issue === 'string' && /^[1-9]\d*$/.test(flags.issue) ? Number(flags.issue) : 0;
  if (!issue) throw new UsageError('--issue needs a positive issue number');
  const campaignDir = resolveCampaignDir(flags['campaign-dir']);
  const { config, configPath, labels } = loadClaimConfig(campaignDir);
  if (labels.length === 0) return { claimed: [], failed: [] };

  const adapter = claimAdapter(campaignDir, config, configPath, 'written', opts.adapter);
  return applyClaimLabels(adapter, issue, labels);
}

/** 1 when any claim failed, so the caller sees a partial pass. */
export const claimExitCode = (report: ClaimApplyReport): number => (report.failed.length > 0 ? 1 : 0);

const main = (): Promise<void> =>
  runClaimCli('claim-labels', USAGE, async () => {
    const report = await runClaimLabels(process.argv.slice(2));
    console.log(JSON.stringify(report));
    for (const f of report.failed) console.error(`claim-labels: could not add ${f.label} to #${f.issue}: ${f.error}`);
    process.exitCode = claimExitCode(report);
  });

if (import.meta.main) await main();
