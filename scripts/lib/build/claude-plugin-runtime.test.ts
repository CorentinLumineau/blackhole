import { describe, expect, test } from 'bun:test';
import { spawnSync } from 'child_process';
import * as fs from 'fs';
import * as path from 'path';
import { root } from './paths.ts';
import {
  PLUGIN_ROOT_NOTE,
  SESSION_START_EXPORT_COMMAND,
  claudePluginRuntimeErrors,
  listRuntimeScriptEntrypoints,
  rewriteScriptInvocations,
  unrewrittenInvocationErrors,
  runtimeScriptClosure,
  withSessionStartExport,
} from './claude-plugin-runtime.ts';
import { populateClaudeFixtureTree, withTempDir } from '../test-fixtures.ts';

describe('listRuntimeScriptEntrypoints', () => {
  test('finds plain and --cwd-pinned bun invocations', () => {
    withTempDir('runtime-entry', (dir) => {
      fs.writeFileSync(
        path.join(dir, 'a.md'),
        'run `bun scripts/forge-scope.ts`, then `bun run scripts/lib/state-write-guard.ts --tmp x`, ' +
          'then `bun run --cwd <repo_root> scripts/plan-quality-gate.ts`.',
      );
      expect(listRuntimeScriptEntrypoints(dir)).toEqual([
        'scripts/forge-scope.ts',
        'scripts/lib/state-write-guard.ts',
        'scripts/plan-quality-gate.ts',
      ]);
    });
  });
});

describe('listRuntimeScriptEntrypoints (bash .sh form)', () => {
  test('finds bash scripts/x.sh calls and ignores bare citations and consumer-owned scripts', () => {
    withTempDir('runtime-entry-sh', (dir) => {
      fs.writeFileSync(
        path.join(dir, 'a.md'),
        'Run `bash scripts/detect-doc-schema.sh index documentation/INDEX.md`, then `bash scripts/detect-frontend.sh`. ' +
          'Cited only: `scripts/detect-monorepo.sh`. Consumer-owned: `./scripts/setup.sh`.',
      );
      expect(listRuntimeScriptEntrypoints(dir)).toEqual(['scripts/detect-doc-schema.sh', 'scripts/detect-frontend.sh']);
    });
  });
});

describe('runtimeScriptClosure', () => {
  test('ships a .sh entry as-is without an import scan, and still throws on a missing one', () => {
    expect(runtimeScriptClosure(['scripts/detect-doc-schema.sh'])).toEqual(['scripts/detect-doc-schema.sh']);
    expect(() => runtimeScriptClosure(['scripts/no-such-script.sh'])).toThrow(/does not exist/);
  });

  test('follows relative imports, including extensionless ones', () => {
    const closure = runtimeScriptClosure(['scripts/campaign-resume-signal.ts']);
    expect(closure).toContain('scripts/campaign-resume-signal.ts');
    // imported as './campaign-status' with no extension
    expect(closure).toContain('scripts/campaign-status.ts');
    expect(closure.every((rel) => fs.existsSync(path.join(root, rel)))).toBe(true);
  });

  test('throws on an invoked script that does not exist', () => {
    expect(() => runtimeScriptClosure(['scripts/no-such-script.ts'])).toThrow(/does not exist/);
  });
});

describe('rewriteScriptInvocations', () => {
  test('prefixes the plugin root on plain invocations', () => {
    const before = 'bun scripts/a.ts; bun run scripts/lib/b.ts';
    expect(rewriteScriptInvocations(before)).toBe(
      'bun "${BLACKHOLE_PLUGIN_ROOT:-.}"/scripts/a.ts; bun run "${BLACKHOLE_PLUGIN_ROOT:-.}"/scripts/lib/b.ts',
    );
  });

  test('keeps the --cwd pin on the operated tree and points the script at the plugin root', () => {
    for (const cwd of ['"$X"', '<abs repo-root>', '`<this worktree>`', '/abs/path', '"${BLACKHOLE_PLUGIN_ROOT:-vendor/blackhole}"']) {
      expect(rewriteScriptInvocations(`bun run --cwd ${cwd} scripts/c.ts --repo-root r`)).toBe(
        `bun run --cwd ${cwd} "\${BLACKHOLE_PLUGIN_ROOT:-.}"/scripts/c.ts --repo-root r`,
      );
    }
  });

  test('rewrites two invocations on one line independently', () => {
    expect(rewriteScriptInvocations('bun run --cwd <a> scripts/x.ts && bun run scripts/y.ts')).toBe(
      'bun run --cwd <a> "${BLACKHOLE_PLUGIN_ROOT:-.}"/scripts/x.ts && bun run "${BLACKHOLE_PLUGIN_ROOT:-.}"/scripts/y.ts',
    );
  });

  test('with the plugin root unset, the rewritten path still resolves under --cwd', () => {
    withTempDir('runtime-cwd', (dir) => {
      fs.mkdirSync(path.join(dir, 'scripts'));
      fs.writeFileSync(path.join(dir, 'scripts', 'here.ts'), 'console.log(process.cwd());');
      const cmd = rewriteScriptInvocations(`bun run --cwd ${dir} scripts/here.ts`);
      const env = { ...process.env };
      delete env.BLACKHOLE_PLUGIN_ROOT;
      const r = Bun.spawnSync(['bash', '-c', cmd], { env, stdout: 'pipe', stderr: 'pipe' });
      expect(r.exitCode).toBe(0);
      expect(fs.realpathSync(r.stdout.toString().trim())).toBe(fs.realpathSync(dir));
    });
  });

  test('rewrites a bash scripts/x.sh call to the plugin root, idempotently', () => {
    const rewritten = 'bash "${BLACKHOLE_PLUGIN_ROOT:-.}"/scripts/detect-doc-schema.sh index x';
    expect(rewriteScriptInvocations('bash scripts/detect-doc-schema.sh index x')).toBe(rewritten);
    expect(rewriteScriptInvocations(rewritten)).toBe(rewritten);
  });

  test('leaves a bare citation and a consumer-owned ./scripts/ call untouched', () => {
    const prose = 'see `scripts/detect-monorepo.sh`; run ./scripts/setup.sh';
    expect(rewriteScriptInvocations(prose)).toBe(prose);
  });

  test('is idempotent on an already rewritten invocation', () => {
    const once = rewriteScriptInvocations('bun run --cwd <r> scripts/c.ts; bun scripts/a.ts');
    expect(rewriteScriptInvocations(once)).toBe(once);
  });
});

describe('claudePluginRuntimeErrors (unrewritten invocations)', () => {
  test('flags a compiled markdown file that still invokes a repo-relative script', () => {
    withTempDir('runtime-errors', (dir) => {
      fs.mkdirSync(path.join(dir, 'hooks'), { recursive: true });
      fs.writeFileSync(path.join(dir, 'hooks', 'hooks.json'), '{"BLACKHOLE_PLUGIN_ROOT":1}');
      fs.writeFileSync(path.join(dir, 'x.md'), 'bun run --cwd <r> scripts/plan-quality-gate.ts');
      expect(unrewrittenInvocationErrors(dir)).toEqual(['Claude bundle: x.md:1 runs repo-relative scripts/plan-quality-gate.ts']);
      fs.writeFileSync(path.join(dir, 'x.md'), rewriteScriptInvocations('bun run --cwd <r> scripts/plan-quality-gate.ts'));
      expect(unrewrittenInvocationErrors(dir)).toEqual([]);
    });
  });
});

describe('unrewrittenInvocationErrors (bash .sh form)', () => {
  test('flags a repo-relative bash scripts/x.sh call, and is empty after the rewrite', () => {
    withTempDir('runtime-errors-sh', (dir) => {
      fs.writeFileSync(path.join(dir, 'x.md'), 'bash scripts/x.sh');
      expect(unrewrittenInvocationErrors(dir)).toEqual(['Claude bundle: x.md:1 runs repo-relative scripts/x.sh']);
      fs.writeFileSync(path.join(dir, 'x.md'), rewriteScriptInvocations('bash scripts/x.sh'));
      expect(unrewrittenInvocationErrors(dir)).toEqual([]);
    });
  });
});

describe('withSessionStartExport', () => {
  test('adds one SessionStart entry and keeps existing events', () => {
    const once = withSessionStartExport({ hooks: { PreToolUse: [{ matcher: 'Bash' }] } });
    const twice = withSessionStartExport(once);
    expect(twice.hooks.PreToolUse).toEqual([{ matcher: 'Bash' }]);
    expect(twice.hooks.SessionStart).toHaveLength(1);
  });
});

describe('finalized Claude bundle', () => {
  test('ships every runtime entry point, cites no repo-relative path, and exports the root', () => {
    withTempDir('runtime-bundle', (destRoot) => {
      populateClaudeFixtureTree(destRoot);
      expect(claudePluginRuntimeErrors(destRoot)).toEqual([]);
      const skill = fs.readFileSync(path.join(destRoot, 'skills', 'blackhole', 'SKILL.md'), 'utf-8');
      expect(skill).toContain(PLUGIN_ROOT_NOTE);
      const agent = fs.readFileSync(path.join(destRoot, 'agents', 'router.md'), 'utf-8');
      expect(agent).toContain('${CLAUDE_PLUGIN_ROOT}/rules/blackhole-vcodes.md');
    });
  });

  test('ships the detector shell scripts byte-identical and anchors the planner call, runnable from a consumer cwd', () => {
    withTempDir('runtime-bundle-sh', (destRoot) => {
      populateClaudeFixtureTree(destRoot);
      for (const name of ['detect-doc-schema.sh', 'detect-frontend.sh']) {
        const shipped = path.join(destRoot, 'scripts', name);
        expect(fs.readFileSync(shipped).equals(fs.readFileSync(path.join(root, 'scripts', name)))).toBe(true);
        expect(fs.statSync(shipped).mode & 0o111).not.toBe(0);
      }
      const planner = fs.readFileSync(path.join(destRoot, 'agents', 'planner.md'), 'utf-8');
      expect(planner).toContain('bash "${BLACKHOLE_PLUGIN_ROOT:-.}"/scripts/detect-doc-schema.sh index documentation/INDEX.md');
      expect(claudePluginRuntimeErrors(destRoot)).toEqual([]);

      withTempDir('runtime-consumer', (consumer) => {
        fs.mkdirSync(path.join(consumer, 'documentation'));
        fs.writeFileSync(
          path.join(consumer, 'documentation', 'INDEX.md'),
          '| path | summary | type | status | review_trigger |\n|------|---------|------|--------|----------------|\n',
        );
        const cmd = rewriteScriptInvocations('bash scripts/detect-doc-schema.sh index documentation/INDEX.md');
        const r = Bun.spawnSync(['bash', '-c', cmd], {
          cwd: consumer,
          env: { ...process.env, BLACKHOLE_PLUGIN_ROOT: destRoot },
          stdout: 'pipe',
          stderr: 'pipe',
        });
        expect(r.exitCode).toBe(0);
        expect(r.stdout.toString().trim()).toBe('schema=blackhole');
      });

      fs.rmSync(path.join(destRoot, 'scripts', 'detect-doc-schema.sh'));
      expect(claudePluginRuntimeErrors(destRoot).some((e) => e.includes('missing runtime script scripts/detect-doc-schema.sh'))).toBe(true);
    });
  });

  test('reports a missing script, a repo-relative citation, and a missing SessionStart export', () => {
    withTempDir('runtime-bundle', (destRoot) => {
      populateClaudeFixtureTree(destRoot);
      fs.rmSync(path.join(destRoot, 'scripts', 'forge-scope.ts'));
      fs.appendFileSync(path.join(destRoot, 'agents', 'router.md'), '\nsee plugins/blackhole-claude/rules/x.md\n');
      fs.writeFileSync(path.join(destRoot, 'hooks', 'hooks.json'), '{"hooks":{}}');
      const errors = claudePluginRuntimeErrors(destRoot);
      expect(errors.some((e) => e.includes('missing runtime script scripts/forge-scope.ts'))).toBe(true);
      expect(errors.some((e) => e.includes('agents/router.md cites repo-relative'))).toBe(true);
      expect(errors.some((e) => e.includes('SessionStart'))).toBe(true);
    });
  });
});

const hasDash = spawnSync('dash', ['-c', ':']).status === 0;
const SENTINEL = '/tmp/blackhole-hook-sentinel-never-created';
const HOOK_PATHS = [
  '/plain/path', '/with space/p', "/it's/p", '/d$ollar/p', '/back`tick`/p',
  '/new\nline/p', "/q'\\''q/p", `/cmd$(touch ${SENTINEL})/p`, '/fmt%s%n%d/p',
];

const runHook = (shell: string, dir: string, env: Record<string, string>, seed?: string) => {
  const envFile = path.join(dir, 'env.sh');
  if (seed !== undefined) fs.writeFileSync(envFile, seed);
  const useFile = env.CLAUDE_ENV_FILE !== '';
  const res = spawnSync(shell, ['-c', SESSION_START_EXPORT_COMMAND], {
    env: { PATH: process.env.PATH ?? '', ...(useFile ? { CLAUDE_ENV_FILE: envFile } : {}), ...env, CLAUDE_ENV_FILE: useFile ? envFile : '' },
    encoding: 'utf-8',
  });
  return { status: res.status, stderr: res.stderr, envFile: fs.existsSync(envFile) ? fs.readFileSync(envFile, 'utf-8') : null, file: envFile };
};

const sourced = (file: string): string =>
  spawnSync('bash', ['-c', 'set -e; . "$1"; printf %s "$BLACKHOLE_PLUGIN_ROOT"', 'x', file], { encoding: 'utf-8' }).stdout;

describe.each([['sh', true], ['dash', hasDash]] as const)('SESSION_START_EXPORT_COMMAND under %s', (shell, available) => {
  const t = available ? test : test.skip;
  for (const p of HOOK_PATHS) {
    t(`round-trips ${JSON.stringify(p)} byte-exactly`, () => {
      withTempDir('hook-rt', (dir) => {
        const r = runHook(shell, dir, { CLAUDE_PLUGIN_ROOT: p });
        expect(r.status).toBe(0);
        expect(r.stderr).toBe('');
        expect(sourced(r.file)).toBe(p);
        expect(fs.existsSync(SENTINEL)).toBe(false);
      });
    });
  }
  t('recovers from a poisoned newline-less prefix left by an older version', () => {
    withTempDir('hook-poison', (dir) => {
      const r = runHook(shell, dir, { CLAUDE_PLUGIN_ROOT: '/real/path' }, '# stale note');
      expect(sourced(r.file)).toBe('/real/path');
    });
  });
  t('a double run leaves two valid export lines', () => {
    withTempDir('hook-twice', (dir) => {
      runHook(shell, dir, { CLAUDE_PLUGIN_ROOT: '/real/path' });
      const r = runHook(shell, dir, { CLAUDE_PLUGIN_ROOT: '/real/path' });
      expect(sourced(r.file)).toBe('/real/path');
      expect((r.envFile ?? '').split('\n').filter((l) => l.startsWith('export BLACKHOLE_PLUGIN_ROOT=')).length).toBe(2);
    });
  });
  t('warns and writes nothing when CLAUDE_ENV_FILE is unset', () => {
    withTempDir('hook-noenv', (dir) => {
      const r = runHook(shell, dir, { CLAUDE_ENV_FILE: '', CLAUDE_PLUGIN_ROOT: '/real/path' });
      expect(r.status).toBe(0);
      expect(r.stderr).toContain('BLACKHOLE_PLUGIN_ROOT');
      expect(r.envFile).toBeNull();
    });
  });
  t('warns and writes nothing when CLAUDE_PLUGIN_ROOT is unset', () => {
    withTempDir('hook-noroot', (dir) => {
      const r = runHook(shell, dir, {});
      expect(r.status).toBe(0);
      expect(r.stderr).toContain('BLACKHOLE_PLUGIN_ROOT');
      expect(r.envFile).toBeNull();
    });
  });
  t('is silent and writes nothing when the variable is already pinned', () => {
    withTempDir('hook-pinned', (dir) => {
      const r = runHook(shell, dir, { CLAUDE_PLUGIN_ROOT: '/real/path', BLACKHOLE_PLUGIN_ROOT: '/pinned' });
      expect(r.status).toBe(0);
      expect(r.stderr).toBe('');
      expect(r.envFile).toBeNull();
    });
  });
});
