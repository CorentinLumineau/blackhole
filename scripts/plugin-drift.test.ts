import { describe, expect, test } from 'bun:test';
import * as fs from 'fs';
import * as path from 'path';
import { spawnSync } from 'child_process';
import { computePluginDrift } from './lib/plugin-drift.ts';
import {
  computeSignal,
  writePluginDriftSignalAtomic,
  createRealGitResolver,
  readRepoHeadSha,
  hashForSource,
  type PluginDriftSignal,
} from './plugin-drift-signal.ts';
import type { HookSource } from './lib/hook-sources.ts';
import type { OrderingResult } from './lib/hook-source-ordering.ts';
import { makeTempDir } from './lib/fs.ts';
import { withTempGitRepo, runGit } from './lib/test-fixtures.ts';

// Issue #800 (ADR-030) — plugin-drift.ts's computePluginDrift is the pure detector behind the
// advisory session-start signal (mechanism 2 of the composite fix): the installed Claude Code
// plugin cache is version-keyed, not content-addressed, so three merged hook security fixes
// (#761/#774/#777) shipped inert while both the installed and repo copies reported the identical
// version string. Test B below reproduces that exact incident shape (matching version, diverging
// content) — the meta-point of this whole issue: a signal that only ever compared version
// strings would pass every one of these fixtures except B, silently missing the one case that
// actually happened.

const withFixtureDirs = (fn: (installedDir: string, repoDir: string) => void): void => {
  const installedDir = makeTempDir('plugin-drift-installed');
  const repoDir = makeTempDir('plugin-drift-repo');
  try {
    fn(installedDir, repoDir);
  } finally {
    fs.rmSync(installedDir, { recursive: true, force: true });
    fs.rmSync(repoDir, { recursive: true, force: true });
  }
};

const write = (dir: string, relPath: string, content: string): void => {
  const abs = path.join(dir, relPath);
  fs.mkdirSync(path.dirname(abs), { recursive: true });
  fs.writeFileSync(abs, content);
};

const baseSource = (): HookSource => ({
  layer: 1,
  label: 'test source',
  origin_kind: 'repo-build',
  resolved_path: null,
  present: true,
  path_kind: 'absent',
  version: null,
  commit_sha: null,
});

describe('computePluginDrift', () => {
  // Test A — no installed cache directory at all. If the function defaulted
  // `hooks_hash_match` to `true` on absence, this is the exact false-confidence failure mode
  // the signal exists to prevent.
  test('absent installed cache yields installed_present: false, hooks_hash_match: null', () => {
    withFixtureDirs((installedDir, repoDir) => {
      write(repoDir, 'hooks.json', '{"hooks":{}}');
      const missingInstalledDir = path.join(installedDir, 'does-not-exist');
      const result = computePluginDrift(missingInstalledDir, repoDir);
      expect(result).toEqual({ installed_present: false, hooks_hash_match: null });
    });
  });

  // Test B (the meta-point, explicit — Task 3 Test D) — identical "version" framing (both
  // fixtures represent the same resolved version directory) but genuinely diverging file
  // content. This is the actual shape of the #800 incident: every documented refresh path
  // (a version-string comparison) would report a match here. A hash function that only
  // compared version strings — the pre-existing broken behavior — would fail this test.
  test('identical version but diverging file content yields hooks_hash_match: false', () => {
    withFixtureDirs((installedDir, repoDir) => {
      write(installedDir, 'utils/worktree-removal-guard.js', 'module.exports = () => "stale-pre-774-behavior";');
      write(repoDir, 'utils/worktree-removal-guard.js', 'module.exports = () => "patched-post-774-behavior";');
      const result = computePluginDrift(installedDir, repoDir);
      expect(result.installed_present).toBe(true);
      expect(result.hooks_hash_match).toBe(false);
    });
  });

  // Test C — byte-identical trees. Guards against a hash function that always reports
  // mismatch (fail-loud overcorrection masking a real green state).
  test('byte-identical installed and repo trees yield hooks_hash_match: true', () => {
    withFixtureDirs((installedDir, repoDir) => {
      write(installedDir, 'hooks.json', '{"hooks":{}}');
      write(installedDir, 'utils/worktree-removal-guard.js', 'module.exports = () => true;');
      write(repoDir, 'hooks.json', '{"hooks":{}}');
      write(repoDir, 'utils/worktree-removal-guard.js', 'module.exports = () => true;');
      const result = computePluginDrift(installedDir, repoDir);
      expect(result).toEqual({ installed_present: true, hooks_hash_match: true });
    });
  });

  test('a file relocated to a different relative path is a mismatch, not a false match', () => {
    withFixtureDirs((installedDir, repoDir) => {
      write(installedDir, 'utils/guard.js', 'same content');
      write(repoDir, 'guard.js', 'same content');
      const result = computePluginDrift(installedDir, repoDir);
      expect(result.hooks_hash_match).toBe(false);
    });
  });
});

// Issue #912 (ADR-044) — `computeSignal` now composes enumerated sources + their ordering
// verdict + per-source content hashes into schema v2, rather than hashing two bare directories
// directly. A minimal single-source fixture exercises the composition and the derived
// `installed_present`/`hooks_hash_match` roll-up without re-testing enumeration or ordering
// themselves (covered in `hook-sources.test.ts`).
describe('computeSignal', () => {
  const repoBuildSource: HookSource = {
    layer: 1,
    label: 'repo build',
    origin_kind: 'repo-build',
    resolved_path: '/repo/.claude/hooks',
    present: true,
    path_kind: 'directory',
    version: null,
    commit_sha: 'a'.repeat(40),
  };
  const cacheSource: HookSource = {
    layer: 2,
    label: 'plugin cache',
    origin_kind: 'plugin-cache',
    resolved_path: '/cache/hooks',
    present: true,
    path_kind: 'directory',
    version: '0.21.0',
    commit_sha: 'a'.repeat(40),
  };
  const identicalOrdering: OrderingResult = {
    ordering_available: true,
    unavailable_reason: null,
    sources: [
      { layer: 1, label: 'repo build', outcome: 'strict', relation_to_origin_main: 'identical', hook_commits_behind: 0 },
      { layer: 2, label: 'plugin cache', outcome: 'strict', relation_to_origin_main: 'identical', hook_commits_behind: 0 },
    ],
    veto_pairs: [],
  };

  test('composes sources + ordering + content hashes into schema v2 with a matching roll-up', () => {
    const signal = computeSignal(
      [repoBuildSource, cacheSource],
      identicalOrdering,
      ['samehash', 'samehash'],
      new Date('2026-09-03T00:00:00.000Z'),
    );
    expect(signal.version).toBe(2);
    expect(signal.refreshed_at).toBe('2026-09-03T00:00:00.000Z');
    expect(signal.installed_present).toBe(true);
    expect(signal.hooks_hash_match).toBe(true);
    expect(signal.sources).toHaveLength(2);
    expect(signal.sources[1]).toMatchObject({ content_hash: 'samehash', outcome: 'strict', relation_to_origin_main: 'identical' });
    expect(signal.veto_pairs).toEqual([]);
  });

  test('a content hash mismatch flips hooks_hash_match to false even when present', () => {
    const signal = computeSignal([repoBuildSource, cacheSource], identicalOrdering, ['hashA', 'hashB']);
    expect(signal.installed_present).toBe(true);
    expect(signal.hooks_hash_match).toBe(false);
  });

  test('no present plugin-cache source yields installed_present: false, hooks_hash_match: null', () => {
    const absentCache: HookSource = { ...cacheSource, present: false, path_kind: 'absent' };
    const ordering: OrderingResult = {
      ordering_available: true,
      unavailable_reason: null,
      sources: [
        { layer: 1, label: 'repo build', outcome: 'strict', relation_to_origin_main: 'identical', hook_commits_behind: 0 },
        { layer: 2, label: 'plugin cache', outcome: 'no-baseline', relation_to_origin_main: null, hook_commits_behind: null },
      ],
      veto_pairs: [],
    };
    const signal = computeSignal([repoBuildSource, absentCache], ordering, ['samehash', null]);
    expect(signal.installed_present).toBe(false);
    expect(signal.hooks_hash_match).toBeNull();
  });
});

describe('writePluginDriftSignalAtomic', () => {
  test('writes .blackhole/plugin-drift.json atomically', () => {
    const campaignDir = makeTempDir('plugin-drift-campaign');
    try {
      const signal: PluginDriftSignal = {
        version: 2,
        refreshed_at: '2026-09-03T00:00:00.000Z',
        installed_present: false,
        hooks_hash_match: null,
        sources: [],
        ordering_available: true,
        ordering_unavailable_reason: null,
        veto_pairs: [],
      };
      writePluginDriftSignalAtomic(campaignDir, signal);
      const target = path.join(campaignDir, 'plugin-drift.json');
      expect(fs.existsSync(target)).toBe(true);
      expect(JSON.parse(fs.readFileSync(target, 'utf-8'))).toEqual(signal);
      expect(fs.existsSync(`${target}.tmp`)).toBe(false);
    } finally {
      fs.rmSync(campaignDir, { recursive: true, force: true });
    }
  });
});

// Issue #912 (ADR-044) — per-source content hashing. A single-file source (source 3's shape:
// one script inside a directory of unrelated files) must never be walked as a directory.
describe('hashForSource', () => {
  test('absent source yields null', () => {
    expect(hashForSource({ ...baseSource(), present: false, path_kind: 'absent' })).toBeNull();
  });

  test('directory-kind source is hashed via hashDirectory', () => {
    const dir = makeTempDir('plugin-drift-signal-hash-dir-');
    try {
      fs.writeFileSync(path.join(dir, 'a.js'), 'content');
      const hash = hashForSource({ ...baseSource(), resolved_path: dir, path_kind: 'directory' });
      expect(hash).not.toBeNull();
      expect(hash).toHaveLength(64);
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  test('file-kind source is hashed by its own content, not as a directory', () => {
    const dir = makeTempDir('plugin-drift-signal-hash-file-');
    try {
      const filePath = path.join(dir, 'claude-hook.sh');
      fs.writeFileSync(filePath, 'echo hi');
      const hash = hashForSource({ ...baseSource(), resolved_path: filePath, path_kind: 'file' });
      expect(hash).not.toBeNull();
      expect(hash).toHaveLength(64);
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  test('file-kind source whose path no longer exists yields null', () => {
    expect(hashForSource({ ...baseSource(), resolved_path: '/does/not/exist.sh', path_kind: 'file' })).toBeNull();
  });
});

// Issue #912 (ADR-044) — the CLI's real-git wiring. Exercised against a real temp repo (V-INT-02,
// same `withTempGitRepo`/`runGit` idiom `hooks-validate-bash.test.ts` established) rather than
// mocked, since these functions' entire job is shelling out to git correctly.
describe('readRepoHeadSha', () => {
  test('returns the checked-out commit sha', async () => {
    await withTempGitRepo('plugin-drift-signal-head-', async (repo) => {
      runGit(repo, ['commit', '--allow-empty', '--quiet', '-m', 'init']);
      const expected = spawnSync('git', ['-C', repo, 'rev-parse', 'HEAD'], { encoding: 'utf-8' }).stdout.trim();
      expect(readRepoHeadSha(repo)).toBe(expected);
    });
  });

  test('returns null outside a git repository', () => {
    const dir = makeTempDir('plugin-drift-signal-not-a-repo');
    try {
      expect(readRepoHeadSha(dir)).toBeNull();
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });
});

describe('createRealGitResolver', () => {
  test('isVerifiedBlackholeClone is true only for a remote matching CorentinLumineau/blackhole', async () => {
    await withTempGitRepo('plugin-drift-signal-clone-', async (repo) => {
      const bareRemote = makeTempDir('plugin-drift-signal-clone-origin-');
      try {
        spawnSync('git', ['init', '--quiet', '--bare', bareRemote]);
        runGit(repo, ['remote', 'add', 'origin', bareRemote]);
        expect(createRealGitResolver(repo).isVerifiedBlackholeClone()).toBe(false);

        runGit(repo, ['remote', 'set-url', 'origin', 'https://github.com/CorentinLumineau/blackhole.git']);
        expect(createRealGitResolver(repo).isVerifiedBlackholeClone()).toBe(true);
      } finally {
        fs.rmSync(bareRemote, { recursive: true, force: true });
      }
    });
  });

  test('originMainSha, shaResolves, isAncestor and hookCommitsBehindOriginMain resolve against a real repo', async () => {
    await withTempGitRepo('plugin-drift-signal-resolver-', async (repo) => {
      runGit(repo, ['commit', '--allow-empty', '--quiet', '-m', 'init']);
      const rootSha = spawnSync('git', ['-C', repo, 'rev-parse', 'HEAD'], { encoding: 'utf-8' }).stdout.trim();
      fs.mkdirSync(path.join(repo, '.claude', 'hooks'), { recursive: true });
      fs.writeFileSync(path.join(repo, '.claude', 'hooks', 'a.js'), 'one');
      runGit(repo, ['add', '.claude/hooks/a.js']);
      runGit(repo, ['commit', '--quiet', '-m', 'hook change']);
      // Simulate `origin/main` without a real remote — a local branch of that name resolves the
      // same `git rev-parse origin/main` call the resolver makes.
      runGit(repo, ['branch', 'origin/main']);

      const resolver = createRealGitResolver(repo);
      const originMain = resolver.originMainSha();
      expect(originMain).not.toBeNull();
      expect(resolver.shaResolves(rootSha)).toBe(true);
      expect(resolver.shaResolves('0'.repeat(40))).toBe(false);
      expect(resolver.isAncestor(rootSha, originMain as string)).toBe(true);
      expect(resolver.hookCommitsBehindOriginMain(rootSha)).toBe(1);
    });
  });
});
