import * as path from 'path';
import { isForgeType, resolveForgeForRepo } from '../forge-detection.ts';
import { createForgeAdapter } from './index.ts';
import type { ForgeAdapter } from './types.ts';

/** The adapter of a campaign's forge: detected from the repo's remote, else `config.forge`, else GitHub. */
export function adapterForCampaign(campaignDir: string, config: { repo: string; forge?: string }): ForgeAdapter {
  const resolved = resolveForgeForRepo(path.dirname(path.resolve(campaignDir)), config.forge);
  const forge = resolved.ok ? resolved.forge : config.forge && isForgeType(config.forge) ? config.forge : 'github';
  return createForgeAdapter({ repo: config.repo, forge });
}
