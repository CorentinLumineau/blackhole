import { runGh, runGhApi } from './forge-adapter/cli.ts';
import { runGlab } from './forge-adapter/glab-cli.ts';
import { runTea } from './forge-adapter/tea-cli.ts';
import type { ForgeType } from './forge-adapter/types.ts';

/** `channel` (GitHub only): `gh` when the CLI is logged in, `rest` when only `gh api` works (ADR-048). */
export type ForgeAuthCheck = { ok: boolean; detail?: string; host?: string | null; channel?: 'gh' | 'rest' };

/** Synchronous forge auth probe for doctor.ts (wraps adapter CLI modules). */
export function checkForgeAuthSync(forge: ForgeType): ForgeAuthCheck {
  if (forge === 'github') {
    const result = runGh(['auth', 'status']);
    if (result.error?.code === 'ENOENT') {
      return { ok: false, detail: 'GitHub CLI not found — install gh and run `gh auth login`' };
    }
    if (result.status !== 0) {
      // Scripts only need REST (`gh api`), which a token reaches even when `gh auth status` fails.
      if (runGhApi('GET', 'rate_limit').status === 0) {
        return { ok: true, host: 'github.com', channel: 'rest', detail: 'REST only: gh porcelain (GraphQL) commands unavailable' };
      }
      return {
        ok: false,
        detail: result.stderr.trim() || result.stdout.trim() || 'gh auth status failed',
      };
    }
    return { ok: true, host: result.stdout.includes('github.com') ? 'github.com' : null, channel: 'gh' };
  }

  if (forge === 'gitea') {
    const result = runTea(['logins']);
    if (result.error?.code === 'ENOENT') {
      return { ok: false, detail: 'Gitea CLI (tea) not found — install tea and run `tea login add`' };
    }
    if (result.status !== 0 || !result.stdout.trim()) {
      return {
        ok: false,
        detail: result.stderr.trim() || 'no tea login configured — run `tea login add`',
      };
    }
    return { ok: true };
  }

  const result = runGlab(['auth', 'status']);
  if (result.error?.code === 'ENOENT') {
    return { ok: false, detail: 'GitLab CLI (glab) not found — install glab and run `glab auth login`' };
  }
  if (result.status !== 0) {
    return {
      ok: false,
      detail: result.stderr.trim() || result.stdout.trim() || 'glab auth status failed',
    };
  }
  const hostMatch = result.stdout.match(/GitLab:\s*(\S+)/);
  return { ok: true, host: hostMatch?.[1] ?? null };
}
