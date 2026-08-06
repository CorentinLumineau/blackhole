import * as fs from 'fs';
import * as path from 'path';
import { spawnSync } from 'child_process';
import {
  buildClaudePluginManifest,
  buildCodexMarketplace,
  buildCodexPluginManifest,
  buildGeminiPluginManifest,
} from './build/manifests.ts';
import { compileCodexTree, compileGeminiTree, writeGeminiManifest } from './build/trees.ts';
import { root } from './build/paths.ts';
import { makeTempDir } from './fs.ts';

// ADR-007 R6 — shared bun:test fixture kit for distribution-tree population and temp-dir lifecycle.
// Delegates to lib/build compile/manifest functions; never reimplements makeTempDir (V-INT-02).

export const withTempDir = <T>(prefix: string, fn: (dir: string) => T): T => {
  const dir = makeTempDir(prefix);
  try {
    return fn(dir);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
};

export type GeminiDistributionTreeOptions = {
  includeAgents?: boolean;
  target?: 'gemini' | 'claude';
  pluginSubdir?: string;
  vcodesSubpath?: string;
};

export const populateGeminiDistributionTree = (
  destRoot: string,
  opts: GeminiDistributionTreeOptions = {},
): void => {
  const {
    includeAgents = false,
    target = 'gemini',
    pluginSubdir = 'plugins/blackhole',
    vcodesSubpath = 'plugins/blackhole/rules/blackhole-vcodes.md',
  } = opts;
  compileGeminiTree(destRoot, pluginSubdir, vcodesSubpath, { includeAgents, target });
  writeGeminiManifest(path.join(destRoot, 'plugin.json'), buildGeminiPluginManifest('1.0.0'));
};

export const populateCodexFixtureTree = (destRoot: string): void => {
  compileCodexTree(
    destRoot,
    'codex-skills',
    'codex-skills/blackhole/references/blackhole-vcodes.md',
  );
  const pluginDir = path.join(destRoot, '.codex-plugin');
  fs.mkdirSync(pluginDir, { recursive: true });
  fs.writeFileSync(
    path.join(pluginDir, 'plugin.json'),
    JSON.stringify(buildCodexPluginManifest('1.0.0'), null, 2),
    'utf-8',
  );
  fs.writeFileSync(
    path.join(destRoot, 'codex-marketplace.json'),
    JSON.stringify(buildCodexMarketplace(), null, 2),
    'utf-8',
  );
};

// PreToolUse hook fixture kit (#447). The two validators under templates/hooks/pretooluse/ ship
// verbatim (no src/ compile pass), so their behavioral suites exercise the real script through a
// subprocess with hook-shaped stdin — the idiom already established by validate-worker-json's
// --hook tests. Both suites share this one spawn/temp-repo path rather than duplicating it.

export const PRETOOLUSE_HOOKS_DIR = path.join(root, 'templates', 'hooks', 'pretooluse');

export type HookRunResult = { exitCode: number; stdout: string; stderr: string };

/** Runs a PreToolUse hook script with `payload` on stdin. `hooksDir` is overridable so a suite can
 * point at a corrupted copy of the tree and exercise the fail-closed pattern-load path. */
export const runPreToolUseHook = async (
  script: string,
  payload: unknown,
  cwd: string,
  hooksDir: string = PRETOOLUSE_HOOKS_DIR,
): Promise<HookRunResult> => {
  const proc = Bun.spawn({
    cmd: ['bun', 'run', path.join(hooksDir, script)],
    stdin: new Blob([JSON.stringify(payload)]),
    stdout: 'pipe',
    stderr: 'pipe',
    cwd,
  });
  const [exitCode, stdout, stderr] = await Promise.all([
    proc.exited,
    new Response(proc.stdout).text(),
    new Response(proc.stderr).text(),
  ]);
  return { exitCode, stdout, stderr };
};

/** Async temp-dir lifecycle over a real git repo. The hook event logger resolves its output
 * directory through `git rev-parse`, so an un-initialized temp dir would exercise only the
 * fail-open path and never the durable-record contract. The path is realpath'd because git
 * reports resolved paths, and the suites compare worktree containment against it. Separate from
 * withTempDir above because that one's `finally` fires before an async `fn` settles. */
export const withTempGitRepo = async <T>(
  prefix: string,
  fn: (dir: string) => Promise<T>,
): Promise<T> => {
  const dir = fs.realpathSync(makeTempDir(prefix));
  try {
    spawnSync('git', ['init', '--quiet'], { cwd: dir });
    return await fn(dir);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
};

export const readHookEvents = (repoRoot: string): Record<string, unknown>[] => {
  const dir = path.join(repoRoot, '.blackhole', 'hook-events');
  if (!fs.existsSync(dir)) return [];
  return fs
    .readdirSync(dir)
    .map((f) => JSON.parse(fs.readFileSync(path.join(dir, f), 'utf-8')) as Record<string, unknown>);
};

export const populateClaudeFixtureTree = (destRoot: string): void => {
  compileGeminiTree(
    destRoot,
    'plugins/blackhole-claude',
    'plugins/blackhole-claude/rules/blackhole-vcodes.md',
    { includeAgents: true, target: 'claude' },
  );
  const pluginDir = path.join(destRoot, '.claude-plugin');
  fs.mkdirSync(pluginDir, { recursive: true });
  fs.writeFileSync(
    path.join(pluginDir, 'plugin.json'),
    JSON.stringify(buildClaudePluginManifest('1.0.0'), null, 2),
    'utf-8',
  );
};
