import { spawnSync } from 'child_process';
import type { ForgeType } from './forge-adapter/types.ts';

export type ForgeDetectionResult = {
  forge: ForgeType;
  host: string | null;
  source: 'config' | 'origin';
};

const FORGE_TYPES: ForgeType[] = ['github', 'gitea', 'gitlab'];

export function isForgeType(value: string): value is ForgeType {
  return (FORGE_TYPES as string[]).includes(value);
}

/** Infer forge type from a git remote URL (ADR-027 / #682). */
export function detectForgeFromOrigin(url: string): ForgeType | null {
  const lower = url.toLowerCase();
  if (lower.includes('github.com') || lower.includes('github.enterprise')) return 'github';
  if (lower.includes('gitlab.com') || /gitlab[.\/]/.test(lower)) return 'gitlab';
  // Gitea: common self-hosted patterns — conservative heuristic
  if (lower.includes('/gitea/') || lower.includes('gitea.')) return 'gitea';
  return null;
}

export function readOriginUrl(repoRoot: string): string | null {
  const result = spawnSync('git', ['-C', repoRoot, 'remote', 'get-url', 'origin'], {
    encoding: 'utf-8',
  });
  if (result.status !== 0) return null;
  return result.stdout.trim() || null;
}

export type ResolveForgeInput = {
  configForge?: string;
  originUrl?: string | null;
};

export type ResolveForgeSuccess = ForgeDetectionResult & { ok: true };
export type ResolveForgeFailure = { ok: false; detail: string };
export type ResolveForgeOutcome = ResolveForgeSuccess | ResolveForgeFailure;

/**
 * Resolve forge type per ADR-027: explicit config wins; else infer from origin;
 * mismatch between config and origin is fatal.
 */
export function resolveForgeType(input: ResolveForgeInput): ResolveForgeOutcome {
  const detected = input.originUrl ? detectForgeFromOrigin(input.originUrl) : null;
  const configured = input.configForge;

  if (configured) {
    if (!isForgeType(configured)) {
      return { ok: false, detail: `invalid forge "${configured}" — expected github, gitea, or gitlab` };
    }
    if (detected && detected !== configured) {
      return {
        ok: false,
        detail: `forge mismatch: config says "${configured}" but origin suggests "${detected}" (${input.originUrl})`,
      };
    }
    return {
      ok: true,
      forge: configured,
      host: hostFromOrigin(input.originUrl),
      source: 'config',
    };
  }

  if (!detected) {
    return {
      ok: false,
      detail: input.originUrl
        ? `could not detect forge type from origin URL: ${input.originUrl}`
        : 'no origin remote and no forge in config — set config.json forge explicitly',
    };
  }

  return {
    ok: true,
    forge: detected,
    host: hostFromOrigin(input.originUrl),
    source: 'origin',
  };
}

function hostFromOrigin(url: string | null | undefined): string | null {
  if (!url) return null;
  try {
    if (url.startsWith('git@')) {
      const hostPart = url.split(':')[0]?.replace('git@', '');
      return hostPart ?? null;
    }
    return new URL(url).host;
  } catch {
    return null;
  }
}

export function resolveForgeForRepo(
  repoRoot: string,
  configForge?: string,
): ResolveForgeOutcome {
  return resolveForgeType({
    configForge,
    originUrl: readOriginUrl(repoRoot),
  });
}
