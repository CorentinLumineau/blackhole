import { describe, expect, test } from 'bun:test';
import * as fs from 'fs';
import * as path from 'path';
import { root } from './paths.ts';
import {
  PLUGIN_ROOT_NOTE,
  claudePluginRuntimeErrors,
  listRuntimeScriptEntrypoints,
  rewriteScriptInvocations,
  runtimeScriptClosure,
  withSessionStartExport,
} from './claude-plugin-runtime.ts';
import { populateClaudeFixtureTree, withTempDir } from '../test-fixtures.ts';

describe('listRuntimeScriptEntrypoints', () => {
  test('finds plain bun invocations and skips --cwd ones', () => {
    withTempDir('runtime-entry', (dir) => {
      fs.writeFileSync(
        path.join(dir, 'a.md'),
        'run `bun scripts/forge-scope.ts`, then `bun run scripts/lib/state-write-guard.ts --tmp x`, ' +
          'never `bun run --cwd <repo_root> scripts/plan-quality-gate.ts`.',
      );
      expect(listRuntimeScriptEntrypoints(dir)).toEqual(['scripts/forge-scope.ts', 'scripts/lib/state-write-guard.ts']);
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
  test('prefixes the plugin root and keeps --cwd forms as written', () => {
    const before = 'bun scripts/a.ts; bun run scripts/lib/b.ts; bun run --cwd "$X" scripts/c.ts';
    expect(rewriteScriptInvocations(before)).toBe(
      'bun "${BLACKHOLE_PLUGIN_ROOT:-.}"/scripts/a.ts; bun run "${BLACKHOLE_PLUGIN_ROOT:-.}"/scripts/lib/b.ts; ' +
        'bun run --cwd "$X" scripts/c.ts',
    );
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
