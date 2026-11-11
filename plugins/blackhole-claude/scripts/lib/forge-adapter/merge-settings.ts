import { runGhApiRestJson } from './cli.ts';
import { runTeaApiJson } from './tea-cli.ts';
import type { ForgeType, RepoMergeSettings } from './types.ts';

/**
 * The repository's allowed merge methods, read through the forge's own REST channel (`gh api` or
 * `tea api`; Gitea names the switches `allow_merge_commits` and `allow_rebase`). Null when the
 * read fails or the forge has no reader: unreadable is never read as "allows nothing".
 */
export const readRepoMergeSettings = (forge: ForgeType, repo: string): RepoMergeSettings | null => {
  try {
    if (forge === 'github') return runGhApiRestJson<RepoMergeSettings>('GET', `repos/${repo}`);
    if (forge === 'gitea') return runTeaApiJson<RepoMergeSettings>('GET', `repos/${repo.split('/').slice(-2).join('/')}`).data;
  } catch {
    return null;
  }
  return null;
};
