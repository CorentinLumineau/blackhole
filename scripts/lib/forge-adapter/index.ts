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
export { GitLabForgeAdapter, createGitLabAdapter } from './gitlab.ts';
export { runTea, runTeaJson, runTeaText } from './tea-cli.ts';
export { runGlab, runGlabJson, runGlabText } from './glab-cli.ts';

import { createGiteaAdapter } from './gitea.ts';
import { createGitLabAdapter } from './gitlab.ts';
import { createGitHubAdapter } from './github.ts';
import type { ForgeAdapter, ForgeAdapterConfig } from './types.ts';

export function createForgeAdapter(config: ForgeAdapterConfig): ForgeAdapter {
  const forge = config.forge ?? 'github';
  if (forge === 'github') return createGitHubAdapter(config.repo);
  if (forge === 'gitea') return createGiteaAdapter(config.repo);
  if (forge === 'gitlab') return createGitLabAdapter(config.repo);
  throw new Error(`unsupported forge "${forge}"`);
}
