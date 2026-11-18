import * as fs from 'fs';
import * as path from 'path';
import { createHash } from 'crypto';
import { readJsonFile, walkFilesAbs } from './fs.ts';

// Issue #800 (ADR-030) — computePluginDrift: pure, path-injected drift detector between the
// installed Claude Code plugin cache copy of blackhole's hooks/ tree and the repo's own build
// target (`.claude/hooks/`). Exists because Claude Code's plugin cache is version-keyed, not
// content-addressed (`.blackhole/plans/issue-800-research.md`) — three merged hook security
// fixes (#761/#774/#777) shipped inert while the installed and repo copies reported the
// identical version string, so a version-string comparison alone cannot detect this class of
// drift. Paths are passed in rather than resolved here, so tests point both at fixture
// directories without touching the real `~/.claude/plugins/cache` (injected fs/paths per the
// plan's TDD requirement).

export type PluginDriftResult = {
  installed_present: boolean;
  hooks_hash_match: boolean | null;
};

// sha256 over the sorted (relative-path, content) pairs of every file under `dir` — order-
// independent of filesystem readdir ordering, and sensitive to both a file's content and its
// relative location (a rename/relocation is a mismatch, not a false match). Reuses
// `walkFilesAbs` (V-INT-02) rather than a second recursive-directory-walk implementation.
export const hashDirectory = (dir: string): string => {
  const hash = createHash('sha256');
  const relPaths = walkFilesAbs(dir)
    .map((abs) => path.relative(dir, abs).split(path.sep).join('/'))
    .sort();
  for (const relPath of relPaths) {
    hash.update(relPath);
    hash.update(fs.readFileSync(path.join(dir, relPath)));
  }
  return hash.digest('hex');
};

// `installedHooksDir` is the resolved, version-substituted installed cache path (e.g.
// `~/.claude/plugins/cache/blackhole-marketplace/blackhole/0.21.0/hooks`); `repoHooksDir` is
// the repo's own build target (`.claude/hooks/`). An absent installed directory is a distinct,
// first-class outcome (`installed_present: false`, `hooks_hash_match: null`) — never silently
// defaulted to a match, which is exactly the false-confidence failure mode this signal exists
// to prevent.
export const computePluginDrift = (installedHooksDir: string, repoHooksDir: string): PluginDriftResult => {
  if (!fs.existsSync(installedHooksDir)) {
    return { installed_present: false, hooks_hash_match: null };
  }
  return {
    installed_present: true,
    hooks_hash_match: hashDirectory(installedHooksDir) === hashDirectory(repoHooksDir),
  };
};

export const PLUGIN_MARKETPLACE = 'blackhole-marketplace';

export type InstalledPluginRow = {
  scope?: unknown;
  projectPath?: unknown;
  installPath?: unknown;
  version?: unknown;
  gitCommitSha?: unknown;
};

/**
 * Every row `installed_plugins.json` holds under `pluginKey`; `[]` when the file is absent,
 * unreadable or malformed, or the key is missing. The one reader of those rows for this repo's
 * scripts (candidate filtering stays in `selectCandidateInstalledPluginRows`).
 */
export const readInstalledPluginRows = (
  readFile: (p: string) => string | null,
  installedPluginsPath: string,
  pluginKey: string,
): InstalledPluginRow[] => {
  const raw = readFile(installedPluginsPath);
  if (raw === null) return [];
  try {
    const rows = (JSON.parse(raw) as { plugins?: Record<string, unknown> } | null)?.plugins?.[pluginKey];
    return Array.isArray(rows) ? (rows as InstalledPluginRow[]) : [];
  } catch {
    return [];
  }
};

export type VersionTriple = [number, number, number];

/** The leading `N.N.N` of a version string; anything else (a commit hash, a number) is `null`. */
export const parseVersion = (v: unknown): VersionTriple | null => {
  const match = typeof v === 'string' ? /^(\d+)\.(\d+)\.(\d+)/.exec(v) : null;
  return match ? [Number(match[1]), Number(match[2]), Number(match[3])] : null;
};

/** Negative when `a` is older than `b`, positive when newer, 0 when equal. Both must parse. */
export const compareVersions = (a: string, b: string): number => {
  const [x, y] = [parseVersion(a), parseVersion(b)];
  if (!x || !y) throw new Error(`cannot compare versions: ${a} / ${b}`);
  return x[0] - y[0] || x[1] - y[1] || x[2] - y[2];
};

export type VersionCandidate = { version: string; source: string };

export type PluginVersionCheck = {
  running: string | null;
  newest: string | null;
  newest_source: string | null;
  behind: boolean;
};

/** Pure: is `running` older than the newest parseable candidate? Unknown or unparseable running is never behind. */
export const checkPluginVersion = (running: string | null, candidates: VersionCandidate[]): PluginVersionCheck => {
  const valid = candidates.filter((c) => parseVersion(c.version) !== null);
  const newest = valid.reduce<VersionCandidate | null>((best, c) => (best === null || compareVersions(c.version, best.version) > 0 ? c : best), null);
  const behind = newest !== null && parseVersion(running) !== null && compareVersions(running as string, newest.version) < 0;
  return { running, newest: newest?.version ?? null, newest_source: newest?.source ?? null, behind };
};

/** One advisory line (no newline), or `null` when the running plugin is not behind. */
export const pluginVersionWarning = (check: PluginVersionCheck): string | null =>
  check.behind
    ? `blackhole ${check.running} is running but ${check.newest} is installed (${check.newest_source}); ` +
      `update the project-scope plugin pin or run /plugin update blackhole@${PLUGIN_MARKETPLACE}, then restart`
    : null;

/** Directory names under the marketplace cache that parse as versions. */
export const listCachedVersions = (cacheDir: string, listDir: (p: string) => string[]): string[] =>
  listDir(cacheDir).filter((name) => parseVersion(name) !== null);

const readFileOrNull = (p: string): string | null => {
  try {
    return fs.readFileSync(p, 'utf-8');
  } catch {
    return null;
  }
};

const listDirOrEmpty = (p: string): string[] => {
  try {
    return fs.readdirSync(p, { withFileTypes: true }).filter((d) => d.isDirectory()).map((d) => d.name);
  } catch {
    return [];
  }
};

/** The real-fs shell: every `~/.claude` installed row and cached version directory feeds `checkPluginVersion`. */
export const readPluginVersionCheck = ({ running, homeDir, pluginName }: { running: string | null; homeDir: string; pluginName: string }): PluginVersionCheck => {
  const pluginsDir = path.join(homeDir, '.claude', 'plugins');
  const rows = readInstalledPluginRows(readFileOrNull, path.join(pluginsDir, 'installed_plugins.json'), `${pluginName}@${PLUGIN_MARKETPLACE}`);
  const cached = listCachedVersions(path.join(pluginsDir, 'cache', PLUGIN_MARKETPLACE, pluginName), listDirOrEmpty);
  return checkPluginVersion(running, [
    ...rows.flatMap((r) => (typeof r.version === 'string' ? [{ version: r.version, source: 'installed_plugins.json' }] : [])),
    ...cached.map((version) => ({ version, source: 'plugin cache' })),
  ]);
};

/** The plugin's own version: its `.claude-plugin/plugin.json`, else its `package.json`; null when neither reads. */
export const readPluginVersion = (pluginRoot: string): string | null => {
  for (const file of [path.join(pluginRoot, '.claude-plugin', 'plugin.json'), path.join(pluginRoot, 'package.json')]) {
    try {
      const version = (readJsonFile(file, file) as { version?: unknown }).version;
      if (typeof version === 'string' && version) return version;
    } catch {
      // Try the next file.
    }
  }
  return null;
};
