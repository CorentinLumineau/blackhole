import * as path from 'path';
import { root } from './build/paths.ts';

// Issue #969, Task 5 — `extractCommandPath` and the candidate-row filter below used to be
// private to this file; they now live in `templates/hooks/pretooluse/utils/installed-plugin-
// rows.js` (the shipped CommonJS tree) and are `require()`d from there, mirroring the existing
// `require(path.join(PRETOOLUSE_HOOKS_DIR, 'utils', '<file>.js'))` CJS/ESM interop precedent
// already used in `scripts/hooks-validate-bash.test.ts`/`hooks-validate-file.test.ts`. Canonical
// home is the shipped tree, not here, because only the scripts/lib -> templates/hooks import
// direction is safe (this dev-time module always runs from inside a full repo checkout; the
// reverse direction — a shipped hook reaching into scripts/lib/, which does not exist inside an
// installed plugin cache — is not). One implementation, dual-consumed by this file and
// `sibling-plugin-guard.js`'s health leg, not two independently-drifting regexes (V-INT-02).
const { selectCandidateInstalledPluginRows, extractCommandPath } = require(
  path.join(root, 'templates', 'hooks', 'pretooluse', 'utils', 'installed-plugin-rows.js'),
);

// Issue #912 (ADR-044) — enumeration half of the widened plugin-drift signal. Claude Code
// composes PreToolUse hooks from every enabled source and merges them deny-wins with no
// override, but `plugin-drift-signal.ts` used to build exactly one guessed installed-cache path
// from the repo's *own* version and report `installed_present: false` when that one path didn't
// exist — even while a different, stale cache copy was actively vetoing calls. This module
// answers "what is registered" (four settings layers plus the plugin-install manifest); it never
// compares content or asserts an ordering (`hook-source-ordering.ts` does that) and never shells
// to git (the CLI wrapper supplies `repoHeadSha`) — same injected-fs/paths testability idiom
// `plugin-drift.ts`'s `computePluginDrift` already uses (DIP).

export type OriginKind = 'repo-build' | 'plugin-cache' | 'foreign';
export type PathKind = 'directory' | 'file' | 'absent';

export type HookSource = {
  layer: 1 | 2 | 3 | 4;
  label: string;
  origin_kind: OriginKind;
  resolved_path: string | null;
  present: boolean;
  path_kind: PathKind;
  version: string | null;
  commit_sha: string | null;
};

type InstalledPluginRow = {
  scope?: unknown;
  projectPath?: unknown;
  installPath?: unknown;
  version?: unknown;
  gitCommitSha?: unknown;
};

type InstalledPluginsFile = { plugins?: Record<string, InstalledPluginRow[]> };

type PreToolUseHookCommand = { command?: unknown };
type PreToolUseEntry = { matcher?: unknown; hooks?: PreToolUseHookCommand[] };
type SettingsFile = { hooks?: { PreToolUse?: PreToolUseEntry[] } };

export type HookSourceInputs = {
  /** Repo root, used to match `installed_plugins.json` rows' `projectPath` (assumption A-1). */
  repoRoot: string;
  /** Layer 1's resolved directory: `<repoRoot>/.claude/hooks`. */
  repoHooksDir: string;
  /** The checked-out commit — injected because this module never shells to git. */
  repoHeadSha: string | null;
  /** `<repoRoot>/.claude/settings.json`. */
  projectSettingsPath: string;
  /** `<repoRoot>/.claude/settings.local.json`. */
  projectSettingsLocalPath: string;
  /** `~/.claude/settings.json`. */
  userSettingsPath: string;
  /** `~/.claude/plugins/installed_plugins.json`. */
  installedPluginsPath: string;
  /** e.g. `blackhole@blackhole-marketplace` — the key `installed_plugins.json` rows live under. */
  pluginKey: string;
  /** Returns file content, or `null` when the path is absent/unreadable — never throws. */
  readFile: (p: string) => string | null;
  isDirectory: (p: string) => boolean;
  isFile: (p: string) => boolean;
};

const readJson = <T>(readFile: (p: string) => string | null, p: string): T | null => {
  const raw = readFile(p);
  if (raw === null) return null;
  try {
    return JSON.parse(raw) as T;
  } catch {
    return null;
  }
};

// Layer 1 — project `.claude/settings.json`'s PreToolUse wiring resolves to the repo's own build
// output at the checked-out commit by fixed convention ($CLAUDE_PROJECT_DIR/.claude/hooks); its
// identity comes from the filesystem + injected HEAD sha, not from parsing hook command text.
function enumerateRepoBuildSource(inputs: HookSourceInputs): HookSource {
  const registered = inputs.readFile(inputs.projectSettingsPath) !== null;
  const isDir = inputs.isDirectory(inputs.repoHooksDir);
  return {
    layer: 1,
    label: 'project .claude/settings.json -> repo build output',
    origin_kind: 'repo-build',
    resolved_path: inputs.repoHooksDir,
    present: registered && isDir,
    path_kind: isDir ? 'directory' : 'absent',
    version: null,
    commit_sha: inputs.repoHeadSha,
  };
}

// Layer 2 — every `installed_plugins.json` row that COULD apply to this project: the user-scope
// row (always a candidate) and any project-scope row whose `projectPath` matches this repo root.
// Assumption A-1 (project-scope-overrides-user-scope) is reconstructed from observed data, never
// read from a specification (ADR-044 § Assumption Audit) — this function never adjudicates it;
// every candidate is reported, none picked.
function enumeratePluginCacheSources(inputs: HookSourceInputs): HookSource[] {
  const file = readJson<InstalledPluginsFile>(inputs.readFile, inputs.installedPluginsPath);
  const rows = file?.plugins?.[inputs.pluginKey] ?? [];
  const candidates: InstalledPluginRow[] = selectCandidateInstalledPluginRows(rows, inputs.repoRoot);

  if (candidates.length === 0) {
    return [
      {
        layer: 2,
        label: `enabledPlugins -> ${inputs.pluginKey} (no candidate install row)`,
        origin_kind: 'plugin-cache',
        resolved_path: null,
        present: false,
        path_kind: 'absent',
        version: null,
        commit_sha: null,
      },
    ];
  }

  return candidates.map((row) => {
    const installPath = typeof row.installPath === 'string' ? row.installPath : null;
    const resolvedPath = installPath ? path.join(installPath, 'hooks') : null;
    const isDir = resolvedPath !== null && inputs.isDirectory(resolvedPath);
    return {
      layer: 2,
      label: `enabledPlugins (${String(row.scope ?? 'unknown')} scope) -> ${inputs.pluginKey}`,
      origin_kind: 'plugin-cache',
      resolved_path: resolvedPath,
      present: isDir,
      path_kind: resolvedPath === null ? 'absent' : isDir ? 'directory' : 'absent',
      version: typeof row.version === 'string' ? row.version : null,
      commit_sha: typeof row.gitCommitSha === 'string' ? row.gitCommitSha : null,
    };
  });
}

// Layers 3 (user `~/.claude/settings.json`) and 4 (`.claude/settings.local.json`) are read
// identically: every `hooks.PreToolUse` entry found is a registered foreign source. Neither
// layer is blackhole's own convention-controlled surface, so this scan does not attempt to
// distinguish "this happens to reference our own repo" from genuinely third-party automation —
// disclosure, not deeper detection, is this scan's answer to what it cannot parse (A-5).
function enumerateSettingsFileSources(
  layer: 3 | 4,
  label: string,
  settingsPath: string,
  inputs: HookSourceInputs,
): HookSource[] {
  const file = readJson<SettingsFile>(inputs.readFile, settingsPath);
  if (file === null) {
    return [
      {
        layer,
        label: `${label} (absent)`,
        origin_kind: 'foreign',
        resolved_path: null,
        present: false,
        path_kind: 'absent',
        version: null,
        commit_sha: null,
      },
    ];
  }

  const entries = file.hooks?.PreToolUse ?? [];
  const sources: HookSource[] = [];
  for (const entry of entries) {
    for (const h of entry.hooks ?? []) {
      const command = typeof h.command === 'string' ? h.command : '';
      const resolvedPath = extractCommandPath(command);
      const isFilePresent = resolvedPath !== null && inputs.isFile(resolvedPath);
      sources.push({
        layer,
        label: `${label} matcher "${String(entry.matcher ?? '?')}"`,
        origin_kind: 'foreign',
        resolved_path: resolvedPath,
        present: true,
        path_kind: resolvedPath === null ? 'absent' : isFilePresent ? 'file' : 'absent',
        version: null,
        commit_sha: null,
      });
    }
  }

  if (sources.length === 0) {
    return [
      {
        layer,
        label: `${label} (no PreToolUse entries)`,
        origin_kind: 'foreign',
        resolved_path: null,
        present: false,
        path_kind: 'absent',
        version: null,
        commit_sha: null,
      },
    ];
  }
  return sources;
}

/** Enumerates all four registered PreToolUse settings layers plus every candidate
 * `installed_plugins.json` row, classified by `origin_kind`. Never compares content, never
 * orders, never shells to git — see `hook-source-ordering.ts` for the comparison half. */
export function enumerateHookSources(inputs: HookSourceInputs): HookSource[] {
  return [
    enumerateRepoBuildSource(inputs),
    ...enumeratePluginCacheSources(inputs),
    ...enumerateSettingsFileSources(3, 'user ~/.claude/settings.json', inputs.userSettingsPath, inputs),
    ...enumerateSettingsFileSources(4, '.claude/settings.local.json', inputs.projectSettingsLocalPath, inputs),
  ];
}
