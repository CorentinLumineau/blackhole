import { describe, expect, test } from 'bun:test';
import * as fs from 'fs';
import * as path from 'path';
import { computePluginDrift } from './lib/plugin-drift.ts';
import { computeSignal, writePluginDriftSignalAtomic, type PluginDriftSignal } from './plugin-drift-signal.ts';
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

describe('computeSignal', () => {
  test('composes computePluginDrift with signal envelope fields', () => {
    withFixtureDirs((installedDir, repoDir) => {
      write(installedDir, 'hooks.json', 'same');
      write(repoDir, 'hooks.json', 'same');
      const signal = computeSignal(installedDir, repoDir, '0.21.0', new Date('2026-09-03T00:00:00.000Z'));
      expect(signal).toEqual({
        version: 1,
        refreshed_at: '2026-09-03T00:00:00.000Z',
        installed_version: '0.21.0',
        installed_present: true,
        hooks_hash_match: true,
      });
    });
  });
});

describe('writePluginDriftSignalAtomic', () => {
  test('writes .blackhole/plugin-drift.json atomically', () => {
    const campaignDir = makeTempDir('plugin-drift-campaign');
    try {
      const signal: PluginDriftSignal = {
        version: 1,
        refreshed_at: '2026-09-03T00:00:00.000Z',
        installed_version: '0.21.0',
        installed_present: false,
        hooks_hash_match: null,
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
