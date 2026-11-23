import { describe, expect, test } from 'bun:test';
import * as fs from 'fs';
import * as path from 'path';
import { PLUGIN_ROOT_SHELL_EXPR, PLUGIN_ROOT_UNSET_MESSAGE, rewriteScriptInvocations } from './claude-plugin-runtime.ts';
import { withTempDir } from '../test-fixtures.ts';

describe('plugin root resolve chain (#1328)', () => {
  // Each resolve tier, run for real under every shell Claude Code may use. The working directory
  // holds a decoy scripts/here.sh: the retired `.` fallback ran it, so it must never run now.
  const runTier = (shell: string, cwd: string, vars: Record<string, string>) => {
    const env: Record<string, string | undefined> = { ...process.env };
    delete env.BLACKHOLE_PLUGIN_ROOT;
    delete env.CLAUDE_PLUGIN_ROOT;
    const r = Bun.spawnSync([shell, '-c', rewriteScriptInvocations('bash scripts/here.sh')], {
      cwd, env: { ...env, ...vars }, stdout: 'pipe', stderr: 'pipe',
    });
    return { code: r.exitCode, out: r.stdout.toString().trim(), err: r.stderr.toString() };
  };
  // Fixture trees: `cwd` is the shell's working directory, `blackhole` and `claude` are the two
  // plugin-root tiers, and `pinned` is a `--cwd` tree. Each holds its own scripts/here.{sh,ts}.
  const withRoots = (fn: (dirs: Record<'cwd' | 'blackhole' | 'claude' | 'pinned', string>) => void) =>
    withTempDir('runtime-tiers', (dir) => {
      const dirs = { cwd: '', blackhole: '', claude: '', pinned: '' };
      for (const name of Object.keys(dirs) as (keyof typeof dirs)[]) {
        dirs[name] = path.join(dir, name);
        fs.mkdirSync(path.join(dirs[name], 'scripts'), { recursive: true });
        fs.writeFileSync(path.join(dirs[name], 'scripts', 'here.sh'), `echo ${name}\n`);
        fs.writeFileSync(path.join(dirs[name], 'scripts', 'here.ts'), `console.log('${name}', process.cwd());\n`);
      }
      fn(dirs);
    });

  for (const shell of ['sh', 'dash', 'bash']) {
    test(`${shell}: BLACKHOLE_PLUGIN_ROOT wins, then CLAUDE_PLUGIN_ROOT, then a loud failure citing #1269`, () => {
      withRoots(({ cwd, blackhole, claude }) => {
        expect(runTier(shell, cwd, { BLACKHOLE_PLUGIN_ROOT: blackhole, CLAUDE_PLUGIN_ROOT: claude })).toMatchObject({ code: 0, out: 'blackhole' });
        expect(runTier(shell, cwd, { CLAUDE_PLUGIN_ROOT: claude })).toMatchObject({ code: 0, out: 'claude' });
        // An empty export (the #1269 failure shape) counts as unset.
        expect(runTier(shell, cwd, { BLACKHOLE_PLUGIN_ROOT: '', CLAUDE_PLUGIN_ROOT: claude })).toMatchObject({ code: 0, out: 'claude' });
        for (const vars of [{}, { BLACKHOLE_PLUGIN_ROOT: '', CLAUDE_PLUGIN_ROOT: '' }]) {
          const r = runTier(shell, cwd, vars);
          expect(r.code).not.toBe(0);
          expect(r.out).not.toBe('cwd');
          expect(r.err).toContain(PLUGIN_ROOT_UNSET_MESSAGE);
        }
      });
    });
  }

  test('a --cwd-pinned call runs the plugin copy with the pinned tree as its working directory', () => {
    withRoots(({ cwd, blackhole, pinned }) => {
      const cmd = rewriteScriptInvocations(`bun run --cwd ${pinned} scripts/here.ts`);
      const env: Record<string, string | undefined> = { ...process.env, BLACKHOLE_PLUGIN_ROOT: blackhole };
      delete env.CLAUDE_PLUGIN_ROOT;
      const r = Bun.spawnSync(['bash', '-c', cmd], { cwd, env, stdout: 'pipe', stderr: 'pipe' });
      expect(r.exitCode).toBe(0);
      const [ran, runCwd] = r.stdout.toString().trim().split(' ');
      expect(ran).toBe('blackhole');
      expect(fs.realpathSync(runCwd)).toBe(fs.realpathSync(pinned));
    });
  });

  test('the plugin root expression never falls back to the working directory', () => {
    expect(PLUGIN_ROOT_SHELL_EXPR).not.toContain(':-.');
    expect(PLUGIN_ROOT_UNSET_MESSAGE).toContain('#1269');
    expect(rewriteScriptInvocations('bun run --cwd <r> scripts/c.ts')).not.toContain(':-.}');
  });
});
