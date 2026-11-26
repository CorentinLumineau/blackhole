import * as fs from 'fs';
import * as path from 'path';
import { parseFlags, unknownFlagKeys } from './lib/argv-flags.ts';
import { claimAdapter, loadClaimConfig, resolveCampaignDir, runClaimCli, UsageError } from './lib/claim-cli.ts';
import { DISPATCHED_STATUSES, releaseClaimLabels, type ClaimReleaseReport } from './lib/claim-release.ts';
import type { ForgeAdapter } from './lib/forge-adapter/types.ts';
import { readJsonFile } from './lib/fs.ts';

// Usage: bun run scripts/release-claims.ts [--campaign-dir <dir>] [--issues <n,n,...>]
// Releases the contract claim labels (`claim_labels` in config.json, e.g. ["in-progress:claude"]) from
// every dispatched queue issue (status in-flight, merged or closed) that has no open PR in flight, plus
// every issue named by `--issues` (the issues a stop just reset to ready or blocked, whatever their queue status), and
// prints one JSON line `{released, kept, failed}`. With no `claim_labels` it prints empty sets and
// touches no forge. Exit 0 on success, 2 on bad usage, 1 when any release failed (the report still
// prints, `failed` lists them) or the forge could not be read (message on stderr).
const USAGE = 'usage: release-claims.ts [--campaign-dir <dir>] [--issues <n,n,...>]';

export { UsageError };

const ISSUE_LIST = /^[1-9]\d*(,[1-9]\d*)*$/;

/** Parses `--issues`: a comma list of positive integers, or none. */
const parseIssues = (value: string | boolean | undefined): number[] => {
  if (value === undefined) return [];
  if (typeof value !== 'string' || !ISSUE_LIST.test(value)) throw new UsageError('--issues needs a comma list of positive issue numbers');
  return value.split(',').map(Number);
};

/** Runs one release pass and returns the report. `adapter` replaces the configured forge's, for a test. */
export async function runReleaseClaims(argv: string[], opts: { adapter?: ForgeAdapter } = {}): Promise<ClaimReleaseReport> {
  const flags = parseFlags(argv);
  const unknown = unknownFlagKeys(flags, ['campaign-dir', 'issues']);
  if (unknown.length) throw new UsageError(`unknown flag(s): ${unknown.map((k) => `--${k}`).join(', ')}`);
  if (flags['campaign-dir'] === true) throw new UsageError('--campaign-dir needs a value');
  const named = parseIssues(flags.issues);
  const campaignDir = resolveCampaignDir(flags['campaign-dir']);
  const { config, configPath, labels } = loadClaimConfig(campaignDir);
  if (labels.length === 0) return { released: [], kept: [], failed: [] };

  const queuePath = path.join(campaignDir, 'queue.json');
  const queue = fs.existsSync(queuePath) ? (readJsonFile(queuePath, queuePath) as { issues?: Record<string, { status?: unknown } | null> }) : {};
  const dispatched = Object.entries(queue.issues ?? {})
    .filter(([, entry]) => DISPATCHED_STATUSES.includes(String(entry?.status)))
    .map(([key]) => Number(key))
    .filter((n) => Number.isInteger(n) && n > 0);
  const issues = [...new Set([...dispatched, ...named])];

  const adapter = claimAdapter(campaignDir, config, configPath, 'read', opts.adapter);
  return releaseClaimLabels(adapter, issues, labels);
}

/** 1 when any claim release failed, so the caller sees a partial pass. */
export const reportExitCode = (report: ClaimReleaseReport): number => (report.failed.length > 0 ? 1 : 0);

const main = (): Promise<void> =>
  runClaimCli('release-claims', USAGE, async () => {
    const report = await runReleaseClaims(process.argv.slice(2));
    console.log(JSON.stringify(report));
    process.exitCode = reportExitCode(report);
  });

if (import.meta.main) await main();
