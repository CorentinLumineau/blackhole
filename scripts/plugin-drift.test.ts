import { describe, expect, test } from 'bun:test';
import * as fs from 'fs';
import * as path from 'path';
import { computePluginDrift } from './lib/plugin-drift.ts';
import { computeSignal, writePluginDriftSignalAtomic, type PluginDriftSignal } from './plugin-drift-signal.ts';
import type { HookSource } from './lib/hook-sources.ts';
import type { OrderingResult } from './lib/hook-source-ordering.ts';
import { makeTempDir } from './lib/fs.ts';

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
