import { describe, expect, test } from 'bun:test';
import * as fs from 'fs';
import * as path from 'path';
import { PLUGIN_ROOT_SHELL_EXPR, PLUGIN_ROOT_UNSET_MESSAGE, rewriteScriptInvocations } from './claude-plugin-runtime.ts';
import { withTempDir } from '../test-fixtures.ts';

describe('plugin root resolve chain (#1328)', () => {
  // Each resolve tier, run for real under every shell Claude Code may use. The cwd holds a decoy
  // scripts/here.sh: the retired `.` fallback ran it, so it must never run now.
  const runTier = (shell: string, cwd: string, vars: Record<string, string>) => {
    const env: Record<string, string | undefined> = { ...process.env };
    delete env.BLACKHOLE_PLUGIN_ROOT;
    delete env.CLAUDE_PLUGIN_ROOT;
    const r = Bun.spawnSync([shell, '-c', rewriteScriptInvocations('bash scripts/here.sh')], {
      cwd, env: { ...env, ...vars }, stdout: 'pipe', stderr: 'pipe',
    });
    return { code: r.exitCode, out: r.stdout.toString().trim(), err: r.stderr.toString() };
  };
  const withRoots = (fn: (cwd: string, pinned: string, plugin: string) => void) =>
    withTempDir('runtime-tiers', (dir) => {
      for (const name of ['cwd', 'pinned', 'plugin']) {
        fs.mkdirSync(path.join(dir, name, 'scripts'), { recursive: true });
        fs.writeFileSync(path.join(dir, name, 'scripts', 'here.sh'), `echo ${name}\n`);
      }
      fn(path.join(dir, 'cwd'), path.join(dir, 'pinned'), path.join(dir, 'plugin'));
    });

  for (const shell of ['sh', 'dash', 'bash']) {
    test(`${shell}: BLACKHOLE_PLUGIN_ROOT wins, then CLAUDE_PLUGIN_ROOT, then a loud failure citing #1269`, () => {
      withRoots((cwd, pinned, plugin) => {
        expect(runTier(shell, cwd, { BLACKHOLE_PLUGIN_ROOT: pinned, CLAUDE_PLUGIN_ROOT: plugin })).toMatchObject({ code: 0, out: 'pinned' });
        expect(runTier(shell, cwd, { CLAUDE_PLUGIN_ROOT: plugin })).toMatchObject({ code: 0, out: 'plugin' });
        // An empty export (the #1269 failure shape) counts as unset.
        expect(runTier(shell, cwd, { BLACKHOLE_PLUGIN_ROOT: '', CLAUDE_PLUGIN_ROOT: plugin })).toMatchObject({ code: 0, out: 'plugin' });
        for (const vars of [{}, { BLACKHOLE_PLUGIN_ROOT: '', CLAUDE_PLUGIN_ROOT: '' }]) {
          const r = runTier(shell, cwd, vars);
          expect(r.code).not.toBe(0);
          expect(r.out).not.toBe('cwd');
          expect(r.err).toContain(PLUGIN_ROOT_UNSET_MESSAGE);
        }
      });
    });
  }

  test('the plugin root expression never falls back to the working directory', () => {
    expect(PLUGIN_ROOT_SHELL_EXPR).not.toContain(':-.');
    expect(PLUGIN_ROOT_UNSET_MESSAGE).toContain('#1269');
    expect(rewriteScriptInvocations('bun run --cwd <r> scripts/c.ts')).not.toContain(':-.}');
  });
});
