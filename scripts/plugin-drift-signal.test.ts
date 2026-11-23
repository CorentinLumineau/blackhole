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
        expect(r.exitCode).toBe(0);
        expect(r.stdout.toString()).toContain('installed_present=');
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
  test('uses --repo-root when given, resolved to an absolute path', () => {
    expect(resolveRepoRoot(['--repo-root', '/srv/campaign'], '/plugin')).toBe('/srv/campaign');
    expect(resolveRepoRoot(['--repo-root', 'rel'], '/plugin')).toBe(path.resolve('rel'));
  });

  test('falls back to the script repo when the flag is absent', () => {
    expect(resolveRepoRoot([], '/plugin')).toBe('/plugin');
  });

  test('refuses a bare --repo-root with no path', () => {
    expect(() => resolveRepoRoot(['--repo-root'], '/plugin')).toThrow('--repo-root needs a path');
  });
});
