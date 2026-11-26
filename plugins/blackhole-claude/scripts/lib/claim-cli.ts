import * as fs from 'fs';
import * as path from 'path';
import { readClaimLabels } from './claim-release.ts';
import { adapterForCampaign } from './forge-adapter/for-campaign.ts';
import type { ForgeAdapter } from './forge-adapter/types.ts';
import { readJsonFile } from './fs.ts';

// The CLI preamble shared by scripts/claim-labels.ts and scripts/release-claims.ts: the usage error,
// the campaign config, the forge adapter and the exit-code wrapper.

export class UsageError extends Error {}

export type ClaimConfig = { repo?: string; forge?: string; claim_labels?: unknown };

/** The `--campaign-dir` flag value (default `.blackhole`) resolved to an absolute path. */
export const resolveCampaignDir = (flag: string | boolean | undefined): string =>
  path.resolve(process.cwd(), typeof flag === 'string' ? flag : '.blackhole');

/** `config.json` of the campaign dir (empty when absent) and its validated `claim_labels`. */
export function loadClaimConfig(campaignDir: string): { config: ClaimConfig; configPath: string; labels: string[] } {
  const configPath = path.join(campaignDir, 'config.json');
  const config = fs.existsSync(configPath) ? (readJsonFile(configPath, configPath) as ClaimConfig) : {};
  return { config, configPath, labels: readClaimLabels(config) };
}

/** `override` (a test's adapter) or the configured forge's adapter; throws when the config names no repo. */
export function claimAdapter(campaignDir: string, config: ClaimConfig, configPath: string, verb: 'read' | 'written', override?: ForgeAdapter): ForgeAdapter {
  if (override) return override;
  if (!config.repo) throw new Error(`${configPath} has no "repo": the forge cannot be ${verb}.`);
  return adapterForCampaign(campaignDir, { repo: config.repo, forge: config.forge });
}

/** Runs `body` as a CLI: a UsageError prints `usage` and exits 2, any other error exits 1. */
export async function runClaimCli(name: string, usage: string, body: () => Promise<void>): Promise<void> {
  try {
    await body();
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (error instanceof UsageError) {
      console.error(`${name}: ${message}\n${usage}`);
      process.exit(2);
    }
    console.error(`${name}: ${message}`);
    process.exit(1);
  }
}
