import { describe, expect, test } from 'bun:test';
import * as fs from 'fs';
import * as path from 'path';
import { root } from './paths.ts';
import {
  PLUGIN_ROOT_NOTE,
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

describe('runtimeScriptClosure', () => {
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
