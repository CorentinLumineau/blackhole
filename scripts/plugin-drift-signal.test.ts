import { describe, expect, test } from 'bun:test';
import * as fs from 'fs';
import * as path from 'path';
import { rewriteScriptInvocations } from './lib/build/claude-plugin-runtime.ts';
import { populateClaudeFixtureTree, withTempDir } from './lib/test-fixtures.ts';

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
});
