import { describe, expect, test } from 'bun:test';
import * as path from 'path';
import { spawnSync } from 'child_process';
import { enumerateHookSources, type HookSourceInputs } from './lib/hook-sources.ts';
import { orderHookSources, type GitResolver } from './lib/hook-source-ordering.ts';
import { withTempGitRepo, runGit } from './lib/test-fixtures.ts';
import * as fs from 'fs';

// Issue #912 (ADR-044) — the plugin-drift signal used to build exactly one guessed installed-
// cache path from the repo's own version and report `installed_present: false` when that one
// path didn't exist, even while a different, stale cache copy was actively vetoing calls the
// repo's own current code allows. These tests cover the two new pure modules that replace that
// guess: `hook-sources.ts` enumerates every registered PreToolUse source, and
// `hook-source-ordering.ts` asserts an ordering only where a resolvable commit SHA proves one.

// --- enumerateHookSources -----------------------------------------------------------------

const BLANK_INSTALLED_PLUGINS = JSON.stringify({ version: 2, plugins: {} });

const baseInputs = (overrides: Partial<HookSourceInputs> = {}): HookSourceInputs => {
  const files: Record<string, string> = {
    '/repo/.claude/settings.json': '{"hooks":{"PreToolUse":[]}}',
    '/home/.claude/plugins/installed_plugins.json': BLANK_INSTALLED_PLUGINS,
  };
  const dirs = new Set<string>();
  return {
    repoRoot: '/repo',
    repoHooksDir: '/repo/.claude/hooks',
    repoHeadSha: 'a'.repeat(40),
    projectSettingsPath: '/repo/.claude/settings.json',
    projectSettingsLocalPath: '/repo/.claude/settings.local.json',
    userSettingsPath: '/home/.claude/settings.json',
    installedPluginsPath: '/home/.claude/plugins/installed_plugins.json',
    pluginKey: 'blackhole@blackhole-marketplace',
    readFile: (p) => files[p] ?? null,
    isDirectory: (p) => dirs.has(p),
    isFile: () => false,
    ...overrides,
  };
};

describe('enumerateHookSources', () => {
  // AC1 (Task 1) — a fixture with all four layers returns 4 entries with correct origin_kind
  // classification.
  test('all four layers present returns 4 entries with correct origin_kind', () => {
    const files: Record<string, string> = {
      '/repo/.claude/settings.json': '{"hooks":{"PreToolUse":[{"matcher":"Bash","hooks":[{"command":"validate.js"}]}]}}',
      '/repo/.claude/settings.local.json': JSON.stringify({
        hooks: { PreToolUse: [{ matcher: 'Bash', hooks: [{ command: "'/repo/.claude/local-hook.sh'" }] }] },
      }),
      '/home/.claude/settings.json': JSON.stringify({
        hooks: { PreToolUse: [{ matcher: '*', hooks: [{ command: "/bin/sh '/home/.orca/agent-hooks/claude-hook.sh'" }] }] },
      }),
      '/home/.claude/plugins/installed_plugins.json': JSON.stringify({
        version: 2,
        plugins: {
          'blackhole@blackhole-marketplace': [
            {
              scope: 'user',
              installPath: '/home/.claude/plugins/cache/blackhole-marketplace/blackhole/0.19.0',
              version: '0.19.0',
              gitCommitSha: 'b'.repeat(40),
            },
          ],
        },
      }),
    };
    const dirs = new Set(['/repo/.claude/hooks', '/home/.claude/plugins/cache/blackhole-marketplace/blackhole/0.19.0/hooks']);
    const inputs = baseInputs({
      readFile: (p) => files[p] ?? null,
      isDirectory: (p) => dirs.has(p),
      isFile: (p) => p === '/repo/.claude/local-hook.sh' || p === '/home/.orca/agent-hooks/claude-hook.sh',
    });

    const sources = enumerateHookSources(inputs);
    expect(sources).toHaveLength(4);
    expect(sources.map((s) => s.layer)).toEqual([1, 2, 3, 4]);
    expect(sources.map((s) => s.origin_kind)).toEqual(['repo-build', 'plugin-cache', 'foreign', 'foreign']);

    expect(sources[0]).toMatchObject({ present: true, path_kind: 'directory', commit_sha: 'a'.repeat(40) });
    expect(sources[1]).toMatchObject({ present: true, version: '0.19.0', commit_sha: 'b'.repeat(40) });
    expect(sources[2]).toMatchObject({ present: true, path_kind: 'file', resolved_path: '/home/.orca/agent-hooks/claude-hook.sh' });
    expect(sources[3]).toMatchObject({ present: true, path_kind: 'file', resolved_path: '/repo/.claude/local-hook.sh' });
  });

  // AC1 (Task 1) — a fixture with two candidate install rows for one project returns BOTH with
  // no adjudication. Reproduces the live, corroborated case: a user-scope row alongside a
  // project-scope row whose projectPath matches this repo (assumption A-1, never adjudicated).
  test('two candidate install rows for one project are both reported, none adjudicated', () => {
    const inputs = baseInputs({
      readFile: (p) => {
        if (p === '/home/.claude/plugins/installed_plugins.json') {
          return JSON.stringify({
            version: 2,
            plugins: {
              'blackhole@blackhole-marketplace': [
                { scope: 'user', installPath: '/cache/0.19.0', version: '0.19.0', gitCommitSha: 'c'.repeat(40) },
                { scope: 'project', projectPath: '/repo', installPath: '/cache/0.20.0', version: '0.20.0', gitCommitSha: 'd'.repeat(40) },
                { scope: 'project', projectPath: '/some-other-repo', installPath: '/cache/0.21.0', version: '0.21.0', gitCommitSha: 'e'.repeat(40) },
              ],
            },
          });
        }
        return p === '/repo/.claude/settings.json' ? '{}' : null;
      },
    });

    const sources = enumerateHookSources(inputs);
    const cacheSources = sources.filter((s) => s.origin_kind === 'plugin-cache');
    expect(cacheSources).toHaveLength(2);
    expect(cacheSources.map((s) => s.version).sort()).toEqual(['0.19.0', '0.20.0']);
    // The row for a different project (`/some-other-repo`) is correctly excluded — but neither
    // of the two matching candidates is preferred over the other.
    expect(cacheSources.every((s) => s.version !== '0.21.0')).toBe(true);
  });

  test('no candidate install row at all yields one absent plugin-cache placeholder', () => {
    const sources = enumerateHookSources(baseInputs());
    const cacheSource = sources.find((s) => s.origin_kind === 'plugin-cache');
    expect(cacheSource).toMatchObject({ present: false, path_kind: 'absent', version: null, commit_sha: null });
  });

  test('the exact live bug: cache row present at a different version than the repo is still reported present', () => {
    // The current (pre-#912) code returns installed_present: false whenever the repo's OWN
    // version doesn't name an existing cache directory — this fixture uses mismatched versions
    // deliberately, matching Falsifiability fixture 1: a same-version fixture would pass under
    // the old broken code and prove nothing.
    const inputs = baseInputs({
      readFile: (p) => {
        if (p === '/home/.claude/plugins/installed_plugins.json') {
          return JSON.stringify({
            version: 2,
            plugins: {
              'blackhole@blackhole-marketplace': [
                { scope: 'user', installPath: '/cache/0.19.0', version: '0.19.0', gitCommitSha: 'f'.repeat(40) },
              ],
            },
          });
        }
        return p === '/repo/.claude/settings.json' ? '{}' : null;
      },
      isDirectory: (p) => p === '/cache/0.19.0/hooks',
    });
    const cacheSource = enumerateHookSources(inputs).find((s) => s.origin_kind === 'plugin-cache');
    expect(cacheSource).toMatchObject({ present: true, version: '0.19.0' });
  });

  test('absent settings.local.json (layer 4) reports present: false, path_kind: absent', () => {
    const layer4 = enumerateHookSources(baseInputs()).find((s) => s.layer === 4);
    expect(layer4).toMatchObject({ present: false, path_kind: 'absent', origin_kind: 'foreign' });
  });

  test('absent repo hooks directory (layer 1) reports present: false', () => {
    const layer1 = enumerateHookSources(baseInputs({ readFile: (p) => (p === '/repo/.claude/settings.json' ? '{}' : null) })).find(
      (s) => s.layer === 1,
    );
    expect(layer1).toMatchObject({ present: false, path_kind: 'absent' });
  });
});

// --- orderHookSources ----------------------------------------------------------------------

// A real-git-backed resolver, scoped to a temp fixture repo — mirrors the real-git-fixture
// precedent already established in `hooks-validate-bash.test.ts` (V-INT-02) rather than mocking
// `merge-base`/`rev-list` string parsing, since the module under test's entire job is to get
// that parsing right.
function makeGitResolver(repoDir: string, originMainRef: string, isClone = true): GitResolver {
  const git = (args: string[]) => spawnSync('git', ['-C', repoDir, ...args], { encoding: 'utf-8' });
  return {
    isVerifiedBlackholeClone: () => isClone,
    originMainSha: () => {
      const r = git(['rev-parse', originMainRef]);
      return r.status === 0 ? r.stdout.trim() : null;
    },
    shaResolves: (sha) => git(['cat-file', '-t', sha]).status === 0,
    isAncestor: (ancestor, descendant) => git(['merge-base', '--is-ancestor', ancestor, descendant]).status === 0,
    hookCommitsBehindOriginMain: (sha) => {
      const r = git(['rev-list', '--count', `${sha}..${originMainRef}`, '--', '.claude/hooks/']);
      return r.status === 0 ? parseInt(r.stdout.trim(), 10) : 0;
    },
  };
}

const hookSource = (layer: 1 | 2, overrides: Partial<ReturnType<typeof makeHookSourceFixture>> = {}) =>
  ({ ...makeHookSourceFixture(layer), ...overrides }) as ReturnType<typeof makeHookSourceFixture>;

function makeHookSourceFixture(layer: 1 | 2) {
  return {
    layer,
    label: layer === 1 ? 'repo build' : 'plugin cache',
    origin_kind: (layer === 1 ? 'repo-build' : 'plugin-cache') as 'repo-build' | 'plugin-cache',
    resolved_path: '/x',
    present: true,
    path_kind: 'directory' as const,
    version: layer === 1 ? null : '0.19.0',
    commit_sha: null as string | null,
  };
}

const writeFile = (repo: string, relPath: string, content: string): void => {
  const abs = path.join(repo, relPath);
  fs.mkdirSync(path.dirname(abs), { recursive: true });
  fs.writeFileSync(abs, content);
  runGit(repo, ['add', relPath]);
};

describe('orderHookSources', () => {
  // Falsifiability fixture 4 — source 1 (repo-build) cannot self-certify on content, only on
  // commit distance. Two hook-touching commits and one unrelated commit land between the
  // source's sha and origin/main; the unrelated commit must NOT be counted.
  test('fixture 4: a repo-build source behind origin/main is reported stale on commit distance', async () => {
    await withTempGitRepo('hook-order-fixture4-', async (repo) => {
      runGit(repo, ['commit', '--allow-empty', '--quiet', '-m', 'init']);
      const behindSha = spawnSync('git', ['-C', repo, 'rev-parse', 'HEAD'], { encoding: 'utf-8' }).stdout.trim();
      writeFile(repo, '.claude/hooks/a.js', 'one');
      runGit(repo, ['commit', '--quiet', '-m', 'hook change 1']);
      writeFile(repo, 'README.md', 'unrelated');
      runGit(repo, ['commit', '--quiet', '-m', 'unrelated change']);
      writeFile(repo, '.claude/hooks/b.js', 'two');
      runGit(repo, ['commit', '--quiet', '-m', 'hook change 2']);
      runGit(repo, ['branch', 'origin-main']); // stand-in ref for origin/main in this fixture

      const resolver = makeGitResolver(repo, 'origin-main');
      const source = hookSource(1, { commit_sha: behindSha });
      const result = orderHookSources([source], resolver);

      expect(result.ordering_available).toBe(true);
      expect(result.sources[0]).toMatchObject({ outcome: 'strict', relation_to_origin_main: 'older', hook_commits_behind: 2 });
    });
  });

  // Falsifiability fixture 2 — diverged, not older. Two commits off a common ancestor, neither
  // reachable from the other. A one-direction-only `--is-ancestor` implementation (checking only
  // `isAncestor(sha, originMain)` and defaulting anything false to a clean/identical read) would
  // misclassify this as clean; `relate()` here checks BOTH directions and must render `diverged`.
  test('fixture 2: two divergent commits render diverged, never a silent clean read', async () => {
    await withTempGitRepo('hook-order-fixture2-', async (repo) => {
      runGit(repo, ['commit', '--allow-empty', '--quiet', '-m', 'common ancestor']);
      runGit(repo, ['checkout', '--quiet', '-b', 'branch-a']);
      writeFile(repo, '.claude/hooks/a.js', 'a');
      runGit(repo, ['commit', '--quiet', '-m', 'branch a commit']);
      const shaA = spawnSync('git', ['-C', repo, 'rev-parse', 'HEAD'], { encoding: 'utf-8' }).stdout.trim();

      runGit(repo, ['checkout', '--quiet', 'main']);
      runGit(repo, ['checkout', '--quiet', '-b', 'branch-b']);
      writeFile(repo, '.claude/hooks/b.js', 'b');
      runGit(repo, ['commit', '--quiet', '-m', 'branch b commit']);
      // branch-b IS origin/main for this fixture — shaA is genuinely diverged from it.

      const resolver = makeGitResolver(repo, 'branch-b');
      const source = hookSource(2, { commit_sha: shaA });
      const result = orderHookSources([source], resolver);

      expect(result.sources[0].outcome).toBe('strict');
      expect(result.sources[0].relation_to_origin_main).toBe('diverged');
      expect(result.sources[0].hook_commits_behind).toBeNull();
      // A diverged single-source result never emits a veto_pairs entry — see the dedicated
      // "two strictly identical sources" and "a resolvable older/newer pair" tests below for
      // veto_pairs coverage; this fixture confirms the per-source outcome alone.
      expect(result.veto_pairs).toHaveLength(0);
    });
  });

  // Falsifiability fixture 3 — version differs, ordering unproven. A cache source's SHA does not
  // resolve in the object store at all (the majority consumer-repo topology, per finding A-1).
  // Must render outcome (2), never guess an ordering from version strings.
  test('fixture 3: an unresolvable commit sha renders version-differs-unproven, never a guess', async () => {
    await withTempGitRepo('hook-order-fixture3-', async (repo) => {
      runGit(repo, ['commit', '--allow-empty', '--quiet', '-m', 'init']);
      runGit(repo, ['branch', 'origin-main']);
      const resolver = makeGitResolver(repo, 'origin-main');
      const unresolvableSha = '0'.repeat(40);
      const source = hookSource(2, { commit_sha: unresolvableSha, version: '0.19.0' });
      const result = orderHookSources([source], resolver);
      expect(result.sources[0]).toMatchObject({
        outcome: 'version-differs-unproven',
        relation_to_origin_main: null,
        hook_commits_behind: null,
      });
    });
  });

  test('environment naming: not a verified blackhole clone renders ordering_available: false with a reason, never silence', async () => {
    await withTempGitRepo('hook-order-env-', async (repo) => {
      runGit(repo, ['commit', '--allow-empty', '--quiet', '-m', 'init']);
      const sha = spawnSync('git', ['-C', repo, 'rev-parse', 'HEAD'], { encoding: 'utf-8' }).stdout.trim();
      const resolver = makeGitResolver(repo, 'main', false);
      const result = orderHookSources([hookSource(1, { commit_sha: sha })], resolver);
      expect(result.ordering_available).toBe(false);
      expect(result.unavailable_reason).not.toBeNull();
      expect(result.sources[0].outcome).toBe('no-baseline');
    });
  });

  test('a foreign source is always no-baseline, in both the red and the green fixture', () => {
    const resolver = makeGitResolver('/irrelevant', 'main', true); // never invoked — present is false
    const foreign = { ...makeHookSourceFixture(2), origin_kind: 'foreign' as const, present: true, commit_sha: null, version: null };
    const result = orderHookSources([foreign], resolver);
    expect(result.sources[0].outcome).toBe('no-baseline');
  });

  test('an absent source is no-baseline, not version-differs', () => {
    const resolver = makeGitResolver('/irrelevant', 'main', true);
    const absent = { ...makeHookSourceFixture(2), present: false };
    const result = orderHookSources([absent], resolver);
    expect(result.sources[0].outcome).toBe('no-baseline');
  });

  // Live end-to-end shape: two resolvable sources at a strict, single-direction ordering must
  // produce exactly one veto_pairs entry naming the older source as able to override the newer
  // one, with the hook-touching commit count attached.
  test('a resolvable older/newer pair produces a veto_pairs entry naming the older source', async () => {
    await withTempGitRepo('hook-order-veto-', async (repo) => {
      runGit(repo, ['commit', '--allow-empty', '--quiet', '-m', 'init']);
      const olderSha = spawnSync('git', ['-C', repo, 'rev-parse', 'HEAD'], { encoding: 'utf-8' }).stdout.trim();
      writeFile(repo, '.claude/hooks/a.js', 'one');
      runGit(repo, ['commit', '--quiet', '-m', 'hook change']);
      const newerSha = spawnSync('git', ['-C', repo, 'rev-parse', 'HEAD'], { encoding: 'utf-8' }).stdout.trim();
      runGit(repo, ['branch', 'origin-main']);

      const resolver = makeGitResolver(repo, 'origin-main');
      const older = hookSource(2, { layer: 2, commit_sha: olderSha });
      const newer = hookSource(1, { layer: 1, commit_sha: newerSha });
      const result = orderHookSources([older, newer], resolver);

      expect(result.veto_pairs).toHaveLength(1);
      expect(result.veto_pairs[0]).toMatchObject({ older_layer: 2, newer_layer: 1, hook_commits_behind: 1 });
    });
  });

  test('two strictly identical sources never produce a veto_pairs entry', async () => {
    await withTempGitRepo('hook-order-identical-', async (repo) => {
      runGit(repo, ['commit', '--allow-empty', '--quiet', '-m', 'init']);
      const sha = spawnSync('git', ['-C', repo, 'rev-parse', 'HEAD'], { encoding: 'utf-8' }).stdout.trim();
      runGit(repo, ['branch', 'origin-main']);
      const resolver = makeGitResolver(repo, 'origin-main');
      const a = hookSource(1, { commit_sha: sha });
      const b = hookSource(2, { commit_sha: sha });
      const result = orderHookSources([a, b], resolver);
      expect(result.veto_pairs).toHaveLength(0);
      expect(result.sources.every((s) => s.relation_to_origin_main === 'identical')).toBe(true);
    });
  });
});
