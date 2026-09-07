import { describe, expect, test } from 'bun:test';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import {
  populateClaudeFixtureTree,
  populateCodexFixtureTree,
  populateGeminiDistributionTree,
  runGit,
  withLinkedWorktree,
  withTempDir,
  writeInstalledPlugins,
} from './test-fixtures.ts';

describe('withTempDir', () => {
  test('removes the directory after the callback returns', () => {
    let capturedDir = '';
    withTempDir('test-fixtures-with-temp', (dir) => {
      capturedDir = dir;
      expect(fs.existsSync(dir)).toBe(true);
    });
    expect(fs.existsSync(capturedDir)).toBe(false);
  });
});

describe('populateGeminiDistributionTree', () => {
  test('populates plugin.json at the distribution root', () => {
    withTempDir('test-fixtures-gemini', (destRoot) => {
      populateGeminiDistributionTree(destRoot);
      const manifestPath = path.join(destRoot, 'plugin.json');
      expect(fs.existsSync(manifestPath)).toBe(true);
      const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf-8'));
      expect(manifest).toHaveProperty('name');
      expect(manifest).toHaveProperty('version');
    });
  });
});

describe('populateCodexFixtureTree', () => {
  test('populates .codex-plugin/plugin.json', () => {
    withTempDir('test-fixtures-codex', (destRoot) => {
      populateCodexFixtureTree(destRoot);
      const manifestPath = path.join(destRoot, '.codex-plugin', 'plugin.json');
      expect(fs.existsSync(manifestPath)).toBe(true);
      const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf-8'));
      expect(manifest).toHaveProperty('name');
    });
  });
});

describe('populateClaudeFixtureTree', () => {
  test('populates .claude-plugin/plugin.json and agents/', () => {
    withTempDir('test-fixtures-claude', (destRoot) => {
      populateClaudeFixtureTree(destRoot);
      expect(fs.existsSync(path.join(destRoot, '.claude-plugin', 'plugin.json'))).toBe(true);
      expect(fs.existsSync(path.join(destRoot, 'agents'))).toBe(true);
    });
  });
});

// Issue #969, Task 2 — `writeInstalledPlugins`'s pre-existing default mode is asserted
// byte-for-byte unchanged (constraint 3: a silent behavior change here would flip every
// existing #870 defer-test fixture from testing defer to testing stay-active without anyone
// noticing), and the new `{ healthy: true }` mode is asserted to produce a real, on-disk
// install that `isPluginHealthy` (added in a later task) can read as healthy.
describe('writeInstalledPlugins (#969)', () => {
  test('default (no opts) mode is unchanged: installPath is the literal /fake/path string, nothing written to disk', () => {
    withTempDir('test-fixtures-installed-plugins-default', (claudeHome) => {
      writeInstalledPlugins(claudeHome, ['mercure@some-marketplace']);
      const manifestPath = path.join(claudeHome, 'plugins', 'installed_plugins.json');
      const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf-8'));
      expect(manifest.plugins['mercure@some-marketplace'][0].installPath).toBe('/fake/path');
      expect(fs.existsSync('/fake/path')).toBe(false);
      expect(fs.existsSync(path.join(claudeHome, 'plugin-installs'))).toBe(false);
    });
  });

  test('{ healthy: true } mode writes a real installPath with a parseable hooks.json and a non-empty referenced script', () => {
    withTempDir('test-fixtures-installed-plugins-healthy', (claudeHome) => {
      writeInstalledPlugins(claudeHome, ['mercure@some-marketplace'], { healthy: true });
      const manifestPath = path.join(claudeHome, 'plugins', 'installed_plugins.json');
      const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf-8'));
      const installPath = manifest.plugins['mercure@some-marketplace'][0].installPath;
      expect(typeof installPath).toBe('string');
      expect(installPath).not.toBe('/fake/path');

      const hooksJsonPath = path.join(installPath, 'hooks', 'hooks.json');
      const hooksManifest = JSON.parse(fs.readFileSync(hooksJsonPath, 'utf-8'));
      const entries = hooksManifest.hooks.PreToolUse;
      expect(Array.isArray(entries)).toBe(true);
      expect(entries.length).toBeGreaterThan(0);

      const command: string = entries[0].hooks[0].command;
      const scriptPath = command.replace('${CLAUDE_PLUGIN_ROOT}', installPath).match(/(\S+\.js)$/)?.[1];
      expect(typeof scriptPath).toBe('string');
      const stat = fs.statSync(scriptPath as string);
      expect(stat.isFile()).toBe(true);
      expect(stat.size).toBeGreaterThan(0);
    });
  });
});

// #756/#747: every git call in this file's fixtures used to run unchecked — a failed `git
// commit`/`worktree add` left the fixture proceeding against a repo that wasn't in the state the
// test believed, and the real cause surfaced as an unrelated downstream failure instead of a git
// error. `runGit` closes that gap for setup/action calls.
describe('runGit', () => {
  test('throws naming the subcommand and captured stderr when cwd is not a git repository', () => {
    withTempDir('test-fixtures-rungit-norepo', (dir) => {
      expect(() => runGit(dir, ['commit', '--allow-empty', '-m', 'x'])).toThrow(
        /git commit.*not a git repository/s,
      );
    });
  });

  test('throws naming the subcommand and the spawn error when cwd does not exist on disk', () => {
    const missing = path.join(os.tmpdir(), `test-fixtures-rungit-missing-${Date.now()}`);
    expect(() => runGit(missing, ['status'])).toThrow(/git status.*ENOENT/s);
  });
});

// Discriminating mutation-check (#756 AC): a silent git failure inside a fixture must surface
// immediately as a git-attributed rejection, not cascade into an unrelated failure downstream.
//
// The plan's originally-designed trigger — sandbox `process.env` to strip git identity so
// `git commit` fails with "Author identity unknown" — proved non-deterministic on this Bun
// version: `spawnSync` without an explicit `env` option reads a startup-time environment
// snapshot, not the live (mutated) `process.env`, so the sandboxed `HOME` never reaches the
// subprocess and git resolves the real ambient identity every time (verified: the sandboxed
// commit always succeeds). Falls back to the Execution Strategy's named alternative instead: a
// cwd outside a git repo (status 128), applied to `withLinkedWorktree`'s `worktree add` call by
// deleting `.git` between its setup steps.
describe('withLinkedWorktree — silent git failure surfaces immediately (#756/#747)', () => {
  test('a worktree-add failure rejects immediately instead of cascading into a realpath ENOENT', async () => {
    let caught: unknown;
    try {
      await withLinkedWorktree(
        'test-fixtures-worktree-fail-',
        async () => {
          throw new Error('fn should never run — worktree add must reject first');
        },
        (mainRepo) => {
          fs.rmSync(path.join(mainRepo, '.git'), { recursive: true, force: true });
          return path.join(mainRepo, '.worktrees');
        },
      );
    } catch (e) {
      caught = e;
    }
    expect(caught).toBeInstanceOf(Error);
    expect((caught as Error).message).toMatch(/git worktree add.*not a git repository/s);
  });
});
