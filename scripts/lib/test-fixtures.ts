import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { spawnSync } from 'child_process';
import {
  buildClaudePluginManifest,
  buildCodexMarketplace,
  buildCodexPluginManifest,
  buildGeminiPluginManifest,
  buildAgentPluginsManifest,
} from './build/manifests.ts';
import { compileCodexTree, compileGeminiTree, writeGeminiManifest } from './build/trees.ts';
import { compileAgentPluginsSkillTree } from './build/targets.ts';
import {
  AGENT_PLUGINS_DISTRIBUTION_AGENT_DIR,
  AGENT_PLUGINS_DISTRIBUTION_VCODES,
} from './build/paths.ts';
import { root } from './build/paths.ts';
import { makeTempDir } from './fs.ts';

// ADR-007 R6 — shared bun:test fixture kit: distribution-tree population, temp-dir lifecycle, and
// (since #447) the PreToolUse hook subprocess harness. Delegates to lib/build compile/manifest
// functions; never reimplements makeTempDir (V-INT-02).

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


export const populateAgentPluginsTree = (destRoot: string): void => {
  compileAgentPluginsSkillTree(
    destRoot,
    AGENT_PLUGINS_DISTRIBUTION_AGENT_DIR,
    AGENT_PLUGINS_DISTRIBUTION_VCODES,
  );
  writeGeminiManifest(
    path.join(destRoot, 'plugin.json'),
    buildAgentPluginsManifest('1.0.0'),
  );
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
 * point at a corrupted copy of the tree and exercise the fail-closed pattern-load path.
 * `eventDir`, when passed, is threaded through as `BLACKHOLE_HOOK_EVENT_DIR` so a suite can pin
 * the durable-record sink explicitly instead of relying on `cwd`'s git resolution (#604) —
 * omitted, the spawn's env is built exactly as before, so none of the existing call sites change
 * behavior. `assignedWorktree`, when passed, is threaded as `BLACKHOLE_ASSIGNED_WORKTREE` (#620). */
export const runPreToolUseHook = async (
  script: string,
  payload: unknown,
  cwd: string,
  hooksDir: string = PRETOOLUSE_HOOKS_DIR,
  eventDir?: string,
  assignedWorktree?: string,
): Promise<HookRunResult> => {
  const extraEnv: Record<string, string> = {};
  if (eventDir) extraEnv.BLACKHOLE_HOOK_EVENT_DIR = eventDir;
  if (assignedWorktree) extraEnv.BLACKHOLE_ASSIGNED_WORKTREE = assignedWorktree;
  const proc = Bun.spawn({
    cmd: ['bun', 'run', path.join(hooksDir, script)],
    stdin: new Blob([JSON.stringify(payload)]),
    stdout: 'pipe',
    stderr: 'pipe',
    cwd,
    ...(Object.keys(extraEnv).length > 0 ? { env: { ...process.env, ...extraEnv } } : {}),
  });
  const [exitCode, stdout, stderr] = await Promise.all([
    proc.exited,
    new Response(proc.stdout).text(),
    new Response(proc.stderr).text(),
  ]);
  return { exitCode, stdout, stderr };
};

/** Runs a git setup/action step and throws immediately on failure — `result.error` first
 * (spawn-itself failure, e.g. `git` not on PATH), then a non-zero exit `status` (git ran but
 * reported a failure) — so a silently swallowed git failure can no longer leave a fixture
 * proceeding against a repo that isn't in the state the caller believes (#756/#747: a masked
 * `git commit` failure surfaced only as an unrelated downstream `fs.realpathSync` ENOENT).
 * Named, signature and message shape reused verbatim from `hooks-validate-bash.test.ts`'s own
 * `runGit` (V-INT-01/V-INT-02); `encoding: 'utf-8'` makes `stderr` a plain string. */
export const runGit = (cwd: string, args: string[]): void => {
  const result = spawnSync('git', args, { cwd, encoding: 'utf-8' });
  if (result.error) {
    throw new Error(`git ${args.join(' ')} failed in ${cwd}: ${result.error.message}`);
  }
  if (result.status !== 0) {
    throw new Error(`git ${args.join(' ')} failed in ${cwd}: ${result.stderr}`);
  }
};

// Cleanup calls run inside a `finally` block, where an in-flight test failure may already be
// propagating — throwing here would replace that real failure with a cleanup error instead of
// surfacing it, so this warns instead of using `runGit`.
const warnGitCleanup = (cwd: string, args: string[]): void => {
  const result = spawnSync('git', args, { cwd, encoding: 'utf-8' });
  if (result.error || result.status !== 0) {
    console.error(`git ${args.join(' ')} cleanup failed in ${cwd}: ${result.error?.message ?? result.stderr}`);
  }
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
    runGit(dir, ['init', '--quiet']);
    return await fn(dir);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
};

/** Same lifecycle as withTempGitRepo, but also creates a linked worktree off an initial empty
 * commit (`git worktree add` needs a valid commit-ish to check out) and hands both paths to `fn`.
 * Exists for #507's cross-worktree containment coverage: the fix under test is that a target
 * inside the linked worktree is in-bounds even when the hook's own resolution cwd is the main
 * clone, so the fixture needs a real second worktree sharing the same `.git`, not just a second
 * temp dir.
 *
 * The worktree nests under `<mainRepo>/.worktrees/` by default — this repo's own convention
 * (`.worktrees/wt-N`) and one of the two roots `allWorktreeRoots` accepts by construction
 * (#510/F-00088: only worktrees nested under the main clone or under a configured
 * `scratchpad_dir` are trusted, never every registered worktree unconditionally). Pass
 * `parentDir` to place the worktree elsewhere — under a caller-supplied `scratchpad_dir`, or
 * fully outside both accepted roots — for tests exercising that boundary directly. */
export const withLinkedWorktree = async <T>(
  prefix: string,
  fn: (mainRepo: string, worktree: string) => Promise<T>,
  parentDir?: (mainRepo: string) => string,
): Promise<T> =>
  withTempGitRepo(prefix, async (mainRepo) => {
    runGit(mainRepo, ['commit', '--allow-empty', '--quiet', '-m', 'init']);
    const parent = parentDir ? parentDir(mainRepo) : path.join(mainRepo, '.worktrees');
    fs.mkdirSync(parent, { recursive: true });
    const worktree = path.join(parent, `${prefix}wt-${process.pid}-${Date.now()}`);
    runGit(mainRepo, ['worktree', 'add', '--detach', '--quiet', worktree]);
    try {
      return await fn(mainRepo, fs.realpathSync(worktree));
    } finally {
      warnGitCleanup(mainRepo, ['worktree', 'remove', '--force', worktree]);
      fs.rmSync(worktree, { recursive: true, force: true });
    }
  });

/** Same lifecycle as `withLinkedWorktree`, but the linked worktree checks out a real `branch`
 * (not detached HEAD) created with `--no-track`, and `mainRepo` carries a bare `origin` remote
 * to push it to — built for the worktree-removal guard (#532), which needs to distinguish a
 * worktree whose branch has been pushed from one that has not. `fn` receives
 * `(mainRepo, worktree, push)`, where `push()` pushes the worktree's current HEAD to `origin` via
 * an explicit refspec (never `-u`) — mirroring this campaign's own `--no-track` worktree
 * convention (#516), the exact case the guard's `@{u}`-less fallback exists for. */
export const withRemoteTrackedWorktree = async <T>(
  prefix: string,
  branch: string,
  fn: (mainRepo: string, worktree: string, push: () => void) => Promise<T>,
): Promise<T> =>
  withTempGitRepo(prefix, async (mainRepo) => {
    runGit(mainRepo, ['commit', '--allow-empty', '--quiet', '-m', 'init']);

    const bareRemote = makeTempDir(`${prefix}origin-`);
    runGit(bareRemote, ['init', '--quiet', '--bare', bareRemote]);
    runGit(mainRepo, ['remote', 'add', 'origin', bareRemote]);
    runGit(mainRepo, ['push', '--quiet', 'origin', 'HEAD:refs/heads/main']);

    const parent = path.join(mainRepo, '.worktrees');
    fs.mkdirSync(parent, { recursive: true });
    const worktree = path.join(parent, `${prefix}wt-${process.pid}-${Date.now()}`);
    runGit(mainRepo, ['worktree', 'add', '--no-track', '--quiet', '-b', branch, worktree, 'HEAD']);
    const push = (): void => {
      runGit(worktree, ['push', '--quiet', 'origin', `HEAD:refs/heads/${branch}`]);
    };

    try {
      return await fn(mainRepo, fs.realpathSync(worktree), push);
    } finally {
      warnGitCleanup(mainRepo, ['worktree', 'remove', '--force', worktree]);
      fs.rmSync(worktree, { recursive: true, force: true });
      fs.rmSync(bareRemote, { recursive: true, force: true });
    }
  });

/** Writes `<mainRepo>/.blackhole/config.json`. `allWorktreeRoots` reads this file to widen
 * accepted worktree roots to a configured `scratchpad_dir` (#510/F-00088) — tests exercising that
 * boundary write a minimal config through this one helper rather than hand-rolling the file shape
 * at each call site. */
export const writeCampaignConfig = (mainRepo: string, config: Record<string, unknown>): void => {
  const dir = path.join(mainRepo, '.blackhole');
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, 'config.json'), JSON.stringify(config, null, 2), 'utf-8');
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
