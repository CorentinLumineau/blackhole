import * as fs from 'fs';
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
  CLAUDE_DISTRIBUTION_CITED_AGENT_DIR,
  CLAUDE_DISTRIBUTION_CITED_VCODES,
  root,
} from './build/paths.ts';
import { finalizeClaudePluginBundle } from './build/claude-plugin-runtime.ts';
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

/** Minimum wall time of `runs` calls after one warm-up call: the minimum damps scheduler noise, so a
 * timing budget measures the code, not a busy CI runner. Shared by every hook timing test. */
export const minMs = (run: () => unknown, runs = 3, now: () => number = () => performance.now()): number => {
  run();
  let best = Infinity;
  for (let i = 0; i < runs; i += 1) {
    const start = now();
    run();
    best = Math.min(best, now() - start);
  }
  return best;
};

/** Asserts `run` scales linearly: times it at size `n` and `n * factor` in one process (minimum of
 * `runs` each, back to back) and fails when the large run costs `maxRatio` times the small one or
 * more. A ratio cancels a uniform slowdown from a busy runner, which an absolute millisecond budget
 * cannot; the 1 ms denominator floor keeps a sub-millisecond small run from dividing by timer noise,
 * and a failing pair is re-measured once so a single load spike cannot fail a linear parser. With
 * the defaults a linear evaluator measures about 4 and a quadratic one about 16. The limit is 12,
 * not the geometric mean 8: a linear parser measured 9-10 on a shared CI runner, where the larger
 * input pays extra GC and cache cost. A larger factor is not an alternative, since it pushes the
 * big input past the 5 s per-test timeout; a call whose depth is bounded by PATH_MAX uses factor 3
 * with limit 6 (linear about 3, quadratic about 9). Inputs are built before timing starts. `now`
 * replaces the real clock so a test can drive the measured times and exercise the limit, the floor
 * and the retry deterministically. */
export const expectLinearTime = <T>(options: {
  build: (size: number) => T;
  run: (input: T) => unknown;
  n: number;
  factor?: number;
  runs?: number;
  maxRatio?: number;
  now?: () => number;
}): void => {
  const { build, run, n, factor = 4, runs = 5, maxRatio = 12, now } = options;
  const small = build(n);
  const large = build(n * factor);
  const measure = () => {
    const tSmall = minMs(() => run(small), runs, now);
    const tLarge = minMs(() => run(large), runs, now);
    return { tSmall, tLarge, ratio: tLarge / Math.max(tSmall, 1) };
  };
  const first = measure();
  if (first.ratio < maxRatio) return;
  const second = measure();
  if (second.ratio < maxRatio) return;
  throw new Error(
    `not linear: size ${n} -> ${n * factor} grew ${first.tSmall.toFixed(2)} ms -> ${first.tLarge.toFixed(2)} ms (ratio ${first.ratio.toFixed(1)}), ` +
      `retry ${second.tSmall.toFixed(2)} ms -> ${second.tLarge.toFixed(2)} ms (ratio ${second.ratio.toFixed(1)}); limit ${maxRatio}`,
  );
};

/** Runs a git setup/action step and throws immediately on failure — `result.error` first
 * (spawn-itself failure, e.g. `git` not on PATH), then a non-zero exit `status` (git ran but
 * reported a failure) — so a silently swallowed git failure can no longer leave a fixture
 * proceeding against a repo that isn't in the state the caller believes (#756/#747: a masked
 * `git commit` failure surfaced only as an unrelated downstream `fs.realpathSync` ENOENT).
 * Named, signature and message shape reused so one `runGit` exists (V-INT-01/V-INT-02); `encoding: 'utf-8'` makes `stderr` a plain string. */
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
 * withTempDir above because that one's `finally` fires before an async `fn` settles.
 *
 * The repo-local identity below is pinned rather than left to ambient global git config
 * (#881): a temp dir under the OS tmp root inherits no repo-local `user.email`/`user.name`, so
 * without this any `git commit` a caller (or a helper built on this one, e.g.
 * `withLinkedWorktree`) makes into it fails with "Author identity unknown" on a machine with no
 * global identity configured — silently dropping coverage for every test built on this fixture.
 * Literal values reused from `stack-repair.test.ts`'s own temp-repo identity pin (V-INT-02). */
export const withTempGitRepo = async <T>(
  prefix: string,
  fn: (dir: string) => Promise<T>,
): Promise<T> => {
  const dir = fs.realpathSync(makeTempDir(prefix));
  try {
    runGit(dir, ['init', '--quiet']);
    // Appended rather than set via two `git config` subprocesses: this is the same file, and the
    // same repo-local scope, that `git config` would write — so it stays visible to git processes
    // the fixture does not own, including the hook under test resolving identity in this repo.
    // The fixture is instantiated 189 times across the suite and every spawn is paid on a
    // contended runner; two spawns became one file write (31.0ms -> 13.1ms per use, measured).
    fs.appendFileSync(
      path.join(dir, '.git', 'config'),
      '[user]\n\temail = campaign@example.invalid\n\tname = campaign\n',
    );
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
 * (`.worktrees/wt-N`). Pass `parentDir` to place it elsewhere — under a caller-supplied
 * `scratchpad_dir`, or outside the main clone the way a campaign's `/tmp/campaign/wt-N` is
 * (#1226) — for tests exercising the containment root set directly. */
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
 * to push it to — for tests that need to distinguish a
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

export const populateClaudeFixtureTree = (destRoot: string): void => {
  compileGeminiTree(
    destRoot,
    CLAUDE_DISTRIBUTION_CITED_AGENT_DIR,
    CLAUDE_DISTRIBUTION_CITED_VCODES,
    { includeAgents: true, target: 'claude' },
  );
  finalizeClaudePluginBundle(destRoot);
  const pluginDir = path.join(destRoot, '.claude-plugin');
  fs.mkdirSync(pluginDir, { recursive: true });
  fs.writeFileSync(
    path.join(pluginDir, 'plugin.json'),
    JSON.stringify(buildClaudePluginManifest('1.0.0'), null, 2),
    'utf-8',
  );
};

