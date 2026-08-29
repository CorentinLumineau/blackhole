export type {
  ForgeAdapter,
  ForgeAdapterConfig,
  ForgeAuthStatus,
  ForgeCheck,
  ForgeIssue,
  ForgePr,
  ForgeType,
  IssueCreateParams,
  IssueEditParams,
  IssueListFilter,
  PrCreateParams,
} from './types.ts';

export { runGh, runGhJson, runGhText, runGhApiJson, runGhApiText } from './cli.ts';
export { GitHubForgeAdapter, createGitHubAdapter } from './github.ts';
export { GiteaForgeAdapter, createGiteaAdapter } from './gitea.ts';
export { runTea, runTeaJson, runTeaText } from './tea-cli.ts';

import { createGiteaAdapter } from './gitea.ts';
import { createGitHubAdapter } from './github.ts';
import type { ForgeAdapter, ForgeAdapterConfig } from './types.ts';

export function createForgeAdapter(config: ForgeAdapterConfig): ForgeAdapter {
  const forge = config.forge ?? 'github';
  if (forge === 'github') return createGitHubAdapter(config.repo);
  if (forge === 'gitea') return createGiteaAdapter(config.repo);
  throw new Error(`forge adapter backend "${forge}" not implemented yet (#681 for gitlab)`);
}
