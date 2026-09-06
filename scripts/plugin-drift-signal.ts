import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { spawnSync } from 'child_process';
import { createHash } from 'crypto';
import { hashDirectory } from './lib/plugin-drift.ts';
import { enumerateHookSources, type HookSource } from './lib/hook-sources.ts';
import { orderHookSources, type GitResolver, type OrderingResult, type VetoPair, type OrderingOutcomeKind, type SourceRelation } from './lib/hook-source-ordering.ts';
import { readOriginUrl } from './lib/forge-detection.ts';
import { root } from './checks/check-utils.ts';
import { projectIdentity } from './project-identity.ts';

// Issue #912 (ADR-044) — widens the session-start advisory half of the plugin-cache drift
// detection (mechanism 2 of ADR-030's composite fix) from "does one guessed installed-cache path
// exist" to "what does every registered PreToolUse source actually resolve to, and where does a
// commit SHA prove one is provably older than another". The pre-#912 code built exactly one
// installed-cache path from the repo's OWN `package.json` version and reported
// `installed_present: false` when that guessed path didn't exist — even while a different, stale
// cache copy was actively vetoing calls the repo's own current code allows (the exact live
// reproduction this issue is named for). `installed_present`/`hooks_hash_match` are retained
// below as a derived roll-up so `renderPluginDriftWarning` keeps working unmodified.

const MARKETPLACE_NAME = 'blackhole-marketplace';
const BLACKHOLE_REMOTE_MARKER = 'corentinlumineau/blackhole';

export type PluginDriftSource = HookSource & {
  content_hash: string | null;
  outcome: OrderingOutcomeKind;
  relation_to_origin_main: SourceRelation | null;
  hook_commits_behind: number | null;
};

export type PluginDriftSignal = {
  version: 2;
  refreshed_at: string;
  /** Derived roll-up over `sources[]` — true when any candidate plugin-cache source is present. */
  installed_present: boolean;
  /** Derived roll-up — null when no plugin-cache source is present; otherwise true only when
   * EVERY present plugin-cache source's content hash matches the repo build's (any one mismatch
   * flips this to false) — the "prefer false positives" bias the design's binding constraints
   * require, not a per-candidate detail buried in `sources[]`. */
  hooks_hash_match: boolean | null;
  sources: PluginDriftSource[];
  ordering_available: boolean;
  ordering_unavailable_reason: string | null;
  veto_pairs: VetoPair[];
};

const hashForSource = (source: HookSource): string | null => {
  if (!source.present || source.resolved_path === null) return null;
  if (source.path_kind === 'directory') return hashDirectory(source.resolved_path);
  if (source.path_kind === 'file' && fs.existsSync(source.resolved_path)) {
    // A single file cannot be walked by hashDirectory's directory-relative-path convention —
    // hash its raw content instead (Adversarial Evaluation shared finding: a source-3-shaped
    // single file inside an unrelated directory must never be silently treated as a directory).
    return createHash('sha256').update(fs.readFileSync(source.resolved_path)).digest('hex');
  }
  return null;
};

/** Pure composition: merges enumerated sources, their ordering verdicts, and per-source content
 * hashes into the final signal shape, then derives the `installed_present`/`hooks_hash_match`
 * roll-up. Kept separate from `enumerateHookSources`/`orderHookSources` so each stays a
 * single-responsibility, independently testable pure function (SRP). */
export function computeSignal(
  sources: HookSource[],
  ordering: OrderingResult,
  contentHashes: (string | null)[],
  now: Date = new Date(),
): PluginDriftSignal {
  const merged: PluginDriftSource[] = sources.map((source, i) => ({
    ...source,
    content_hash: contentHashes[i] ?? null,
    outcome: ordering.sources[i]?.outcome ?? 'no-baseline',
    relation_to_origin_main: ordering.sources[i]?.relation_to_origin_main ?? null,
    hook_commits_behind: ordering.sources[i]?.hook_commits_behind ?? null,
  }));

  const repoBuild = merged.find((s) => s.layer === 1) ?? null;
  const presentCacheSources = merged.filter((s) => s.origin_kind === 'plugin-cache' && s.present);
  const installedPresent = presentCacheSources.length > 0;
  // null when nothing is present to compare, or the repo-build baseline itself is unavailable;
  // otherwise true only when EVERY present candidate matches (any one mismatch flips this to
  // false) — the "prefer false positives" bias the design's binding constraints require.
  let hooksHashMatch: boolean | null = null;
  if (installedPresent && repoBuild !== null && repoBuild.content_hash !== null) {
    hooksHashMatch = presentCacheSources.every((s) => s.content_hash !== null && s.content_hash === repoBuild.content_hash);
  }

  return {
    version: 2,
    refreshed_at: now.toISOString(),
    installed_present: installedPresent,
    hooks_hash_match: hooksHashMatch,
    sources: merged,
    ordering_available: ordering.ordering_available,
    ordering_unavailable_reason: ordering.unavailable_reason,
    veto_pairs: ordering.veto_pairs,
  };
}

// Same lightweight tmp+rename idiom as doc-health-signal.ts:writeDocHealthSignalAtomic —
// deliberately not the heavier state-write-guard.ts, since this file is fully recomputed from
// source every turn and never read as authoritative campaign state (`blackhole-state.md` §
// Write protocol scopes that guard to queue.json/findings-ledger.json only).
export const writePluginDriftSignalAtomic = (campaignDir: string, signal: PluginDriftSignal): void => {
  fs.mkdirSync(campaignDir, { recursive: true });
  const target = path.join(campaignDir, 'plugin-drift.json');
  const tmp = `${target}.tmp`;
  fs.writeFileSync(tmp, `${JSON.stringify(signal, null, 2)}\n`);
  fs.renameSync(tmp, target);
};

// Real git access for the CLI only — the pure ordering module (`hook-source-ordering.ts`) never
// shells to git itself; every fixture/test drives it through an injected resolver instead.
function createRealGitResolver(repoRoot: string): GitResolver {
  const git = (args: string[]) => spawnSync('git', ['-C', repoRoot, ...args], { encoding: 'utf-8' });
  return {
    isVerifiedBlackholeClone: () => {
      const url = readOriginUrl(repoRoot);
      return url !== null && url.toLowerCase().includes(BLACKHOLE_REMOTE_MARKER);
    },
    originMainSha: () => {
      const r = git(['rev-parse', 'origin/main']);
      return r.status === 0 ? r.stdout.trim() : null;
    },
    shaResolves: (sha) => git(['cat-file', '-t', sha]).status === 0,
    isAncestor: (ancestor, descendant) => git(['merge-base', '--is-ancestor', ancestor, descendant]).status === 0,
    hookCommitsBehindOriginMain: (sha) => {
      const r = git(['rev-list', '--count', `${sha}..origin/main`, '--', '.claude/hooks/', 'templates/hooks/']);
      return r.status === 0 ? parseInt(r.stdout.trim(), 10) : 0;
    },
  };
}

function readRepoHeadSha(repoRoot: string): string | null {
  const r = spawnSync('git', ['-C', repoRoot, 'rev-parse', 'HEAD'], { encoding: 'utf-8' });
  return r.status === 0 ? r.stdout.trim() : null;
}

function main(): void {
  const repoRoot = root;
  const resolver = createRealGitResolver(repoRoot);

  const sources = enumerateHookSources({
    repoRoot,
    repoHooksDir: path.join(repoRoot, '.claude', 'hooks'),
    repoHeadSha: readRepoHeadSha(repoRoot),
    projectSettingsPath: path.join(repoRoot, '.claude', 'settings.json'),
    projectSettingsLocalPath: path.join(repoRoot, '.claude', 'settings.local.json'),
    userSettingsPath: path.join(os.homedir(), '.claude', 'settings.json'),
    installedPluginsPath: path.join(os.homedir(), '.claude', 'plugins', 'installed_plugins.json'),
    pluginKey: `${projectIdentity.name}@${MARKETPLACE_NAME}`,
    readFile: (p) => {
      try {
        return fs.readFileSync(p, 'utf-8');
      } catch {
        return null;
      }
    },
    isDirectory: (p) => {
      try {
        return fs.statSync(p).isDirectory();
      } catch {
        return false;
      }
    },
    isFile: (p) => {
      try {
        return fs.statSync(p).isFile();
      } catch {
        return false;
      }
    },
  });

  const ordering = orderHookSources(sources, resolver);
  const contentHashes = sources.map(hashForSource);
  const signal = computeSignal(sources, ordering, contentHashes);

  writePluginDriftSignalAtomic(path.join(repoRoot, '.blackhole'), signal);
  console.log(
    `installed_present=${signal.installed_present} hooks_hash_match=${signal.hooks_hash_match} ` +
      `ordering_available=${signal.ordering_available} veto_pairs=${signal.veto_pairs.length}`,
  );
}

if (import.meta.main) {
  main();
}
