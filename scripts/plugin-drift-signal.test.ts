import { describe, expect, test } from 'bun:test';
import * as fs from 'fs';
import * as path from 'path';
import { rewriteScriptInvocations } from './lib/build/claude-plugin-runtime.ts';
import { populateClaudeFixtureTree, withTempDir } from './lib/test-fixtures.ts';
import { resolveRepoRoot } from './plugin-drift-signal.ts';

// The Claude plugin bundle ships plugin-drift-signal.ts as a runtime script, and copies the hooks
// tree to hooks/ rather than templates/hooks/pretooluse/. The script must run from that layout,
// the way a consumer's orchestrator invokes it, not only from a repo checkout.
describe('plugin-drift-signal.ts from a built Claude plugin tree', () => {
  test('runs from the installed layout, which ships hooks/ but no templates/hooks/', () => {
    withTempDir('drift-bundle', (destRoot) => {
      populateClaudeFixtureTree(destRoot);
      expect(fs.existsSync(path.join(destRoot, 'templates', 'hooks'))).toBe(false);
      withTempDir('drift-home', (home) => {
        const cmd = rewriteScriptInvocations('bun run scripts/plugin-drift-signal.ts');
        const r = Bun.spawnSync(['bash', '-c', cmd], {
          cwd: home,
          env: { ...process.env, HOME: home, BLACKHOLE_PLUGIN_ROOT: destRoot },
          stdout: 'pipe',
          stderr: 'pipe',
        });
        expect(r.stderr.toString()).not.toContain('Cannot find module');
        // Without --repo-root the only repo it could describe is the plugin folder itself, so it
        // refuses rather than writing a signal about the install (issue #1454).
        expect(r.exitCode).not.toBe(0);
        expect(r.stderr.toString()).toContain('pass --repo-root');
        expect(fs.existsSync(path.join(destRoot, '.blackhole'))).toBe(false);
      });
    });
  });

  // Issue #1454: on a consumer install the plugin root is the plugin cache folder, not the
  // campaign repo. `--repo-root` names the repo whose settings are read and whose `.blackhole/`
  // receives the signal.
  test('--repo-root writes the signal into the campaign repo, not the plugin folder', () => {
    withTempDir('drift-bundle', (destRoot) => {
      populateClaudeFixtureTree(destRoot);
      withTempDir('drift-consumer', (consumer) => {
        fs.mkdirSync(path.join(consumer, '.git'));
        withTempDir('drift-home', (home) => {
          const cmd = rewriteScriptInvocations(
            `bun run --cwd ${consumer} scripts/plugin-drift-signal.ts --repo-root ${consumer}`,
          );
          const r = Bun.spawnSync(['bash', '-c', cmd], {
            cwd: home,
            env: { ...process.env, HOME: home, BLACKHOLE_PLUGIN_ROOT: destRoot },
            stdout: 'pipe',
            stderr: 'pipe',
          });
          expect(r.stderr.toString()).toBe('');
          expect(r.exitCode).toBe(0);
          const signalPath = path.join(consumer, '.blackhole', 'plugin-drift.json');
          expect(fs.existsSync(signalPath)).toBe(true);
          expect(fs.existsSync(path.join(destRoot, '.blackhole', 'plugin-drift.json'))).toBe(false);
          const signal = JSON.parse(fs.readFileSync(signalPath, 'utf-8'));
          const project = signal.sources.find((s: { layer: number }) => s.layer === 1);
          expect(project.resolved_path).toBe(path.join(consumer, '.claude', 'hooks'));
        });
      });
    });
  });
});

describe('resolveRepoRoot', () => {
  const withRepo = (fn: (repo: string) => void) =>
    withTempDir('drift-repo', (repo) => {
      fs.mkdirSync(path.join(repo, '.git'));
      fn(repo);
    });
  const env = { home: '/home/someone', pluginRoot: undefined };

  test('uses --repo-root when it names an existing git repo', () => {
    withRepo((repo) => {
      expect(resolveRepoRoot(['--repo-root', repo], { ...env, fallback: '/plugin' })).toBe(repo);
    });
  });

  test('accepts a git worktree, whose .git is a file', () => {
    withTempDir('drift-wt', (repo) => {
      fs.writeFileSync(path.join(repo, '.git'), 'gitdir: /elsewhere\n');
      expect(resolveRepoRoot(['--repo-root', repo], { ...env, fallback: '/plugin' })).toBe(repo);
    });
  });

  test('refuses a --repo-root that does not exist, and creates nothing there', () => {
    withTempDir('drift-missing', (dir) => {
      const missing = path.join(dir, 'nope');
      expect(() => resolveRepoRoot(['--repo-root', missing], { ...env, fallback: '/plugin' })).toThrow(
        'is not an existing directory',
      );
      expect(fs.existsSync(missing)).toBe(false);
    });
  });

  test('refuses a --repo-root directory that is not a git repo', () => {
    withTempDir('drift-nogit', (dir) => {
      expect(() => resolveRepoRoot(['--repo-root', dir], { ...env, fallback: '/plugin' })).toThrow('has no .git');
    });
  });

  test('refuses a bare --repo-root with no path', () => {
    expect(() => resolveRepoRoot(['--repo-root'], { ...env, fallback: '/plugin' })).toThrow('--repo-root needs a path');
  });

  test('refuses the --repo-root=<path> form instead of silently ignoring it', () => {
    withRepo((repo) => {
      expect(() => resolveRepoRoot([`--repo-root=${repo}`], { ...env, fallback: repo })).toThrow(
        'unknown flag --repo-root=',
      );
    });
  });

  test('refuses any other unknown flag', () => {
    withRepo((repo) => {
      expect(() => resolveRepoRoot(['--repo', repo], { ...env, fallback: repo })).toThrow('unknown flag --repo');
    });
  });

  test('falls back to the script repo when the flag is absent and that repo is a checkout', () => {
    withRepo((repo) => {
      expect(resolveRepoRoot([], { ...env, fallback: repo })).toBe(repo);
    });
  });

  test('refuses the fallback when it sits under the plugin cache', () => {
    const fallback = path.join('/home/someone', '.claude', 'plugins', 'cache', 'mk', 'blackhole', '1.0.0');
    expect(() => resolveRepoRoot([], { ...env, fallback })).toThrow('pass --repo-root');
  });

  test('refuses the fallback when it is BLACKHOLE_PLUGIN_ROOT', () => {
    withRepo((repo) => {
      expect(() => resolveRepoRoot([], { ...env, pluginRoot: repo, fallback: repo })).toThrow('pass --repo-root');
    });
  });
});
