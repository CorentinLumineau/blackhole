import { describe, expect, test } from 'bun:test';
import * as fs from 'fs';
import * as path from 'path';
import { root } from './checks/check-utils.ts';
import { CLAUDE_NATIVE_ROOT } from './lib/build/paths.ts';
import { evaluateClaudeSettingsHooksWiring, runChecks } from './checks/claude-native-settings.check.ts';
import { withTempDir } from './lib/test-fixtures.ts';
import { runFullBuildOnce } from './lib/check-common.ts';

// Issue #472 — .claude/settings.json PreToolUse wiring. Mirrors scripts/verify.hooks.test.ts's
// runFullBuildOnce() pattern: assert the generated tree on disk, since `bun run build` output is
// git-tracked (.claude/hooks/, .claude/settings.json join .claude/agents, .claude/rules,
// .claude/skills as build-generated content this repo commits directly).

describe('.claude/settings.json wires PreToolUse for the copied validators', () => {
  test('post-build, both matchers are wired with $CLAUDE_PROJECT_DIR paths, no ${CLAUDE_PLUGIN_ROOT}', () => {
    const build = runFullBuildOnce();
    expect(build.ok).toBe(true);

    const settingsPath = path.join(root, CLAUDE_NATIVE_ROOT, 'settings.json');
    expect(fs.existsSync(settingsPath)).toBe(true);

    const parsed = JSON.parse(fs.readFileSync(settingsPath, 'utf-8'));
    const preToolUse = parsed.hooks.PreToolUse as { matcher: string; hooks: { command: string }[] }[];
    const matchers = preToolUse.map((e) => e.matcher);
    expect(matchers).toContain('Bash');
    expect(matchers).toContain('Write|Edit');

    for (const entry of preToolUse) {
      for (const h of entry.hooks) {
        expect(h.command).toContain('$CLAUDE_PROJECT_DIR');
        expect(h.command).not.toContain('${CLAUDE_PLUGIN_ROOT}');
      }
    }
  });

  test('.claude/hooks/ ships every file templates/hooks/pretooluse/ carries', () => {
    const build = runFullBuildOnce();
    expect(build.ok).toBe(true);

    const srcFiles = [
      'hooks.json',
      'validate-bash-command.js',
      'validate-file-changes.js',
      'patterns/bash-patterns.json',
      'patterns/file-patterns.json',
      'utils/hook-event-log.js',
      'utils/pattern-loader.js',
    ];
    for (const rel of srcFiles) {
      expect(fs.existsSync(path.join(root, CLAUDE_NATIVE_ROOT, 'hooks', rel))).toBe(true);
    }
  });

  // Task 3 AC — cleanBuildDirectories() wipes-and-recopies .claude/hooks/ on every build
  // (it is 100% template-generated), unlike .claude/settings.json which is read-modify-write
  // only. A stray file left in .claude/hooks/ from a prior build (or hand-edit) must not survive
  // a rebuild.
  test('a stray file inside .claude/hooks/ does not survive a rebuild', () => {
    const stray = path.join(root, CLAUDE_NATIVE_ROOT, 'hooks', 'stray-leftover-file.txt');
    fs.writeFileSync(stray, 'this should not survive a rebuild');
    expect(fs.existsSync(stray)).toBe(true);

    // Force a real, fresh build (not the memoized runFullBuildOnce()) so cleanBuildDirectories()
    // actually runs again against the stray file.
    const { spawnSync } = require('child_process') as typeof import('child_process');
    const build = spawnSync('bun', ['run', 'build'], { cwd: root, encoding: 'utf-8' });
    expect(build.status).toBe(0);

    expect(fs.existsSync(stray)).toBe(false);
  });
});

describe('claude-native-settings.check.ts evaluator', () => {
  test('a correctly built .claude/settings.json produces no errors', () => {
    runFullBuildOnce();
    expect(evaluateClaudeSettingsHooksWiring(path.join(root, CLAUDE_NATIVE_ROOT))).toEqual([]);
  });

  test('a settings.json missing the Bash matcher is reported, not silently tolerated', () => {
    withTempDir('blackhole-claude-settings-check-', (dir) => {
      const settingsPath = path.join(dir, 'settings.json');
      fs.writeFileSync(
        settingsPath,
        JSON.stringify({
          hooks: {
            PreToolUse: [
              {
                matcher: 'Write|Edit',
                hooks: [{ type: 'command', command: 'bun run "$CLAUDE_PROJECT_DIR/.claude/hooks/validate-file-changes.js"' }],
              },
            ],
          },
        }),
      );
      const errors = evaluateClaudeSettingsHooksWiring(dir);
      expect(errors.length).toBeGreaterThan(0);
      expect(errors.some((e) => e.includes('Bash'))).toBe(true);
    });
  });

  test('a settings.json with a ${CLAUDE_PLUGIN_ROOT} command is reported', () => {
    withTempDir('blackhole-claude-settings-check-', (dir) => {
      fs.writeFileSync(
        path.join(dir, 'settings.json'),
        JSON.stringify({
          hooks: {
            PreToolUse: [
              {
                matcher: 'Bash',
                hooks: [
                  {
                    type: 'command',
                    command: 'bun run ${CLAUDE_PLUGIN_ROOT}/hooks/validate-bash-command.js',
                  },
                ],
              },
              {
                matcher: 'Write|Edit',
                hooks: [
                  {
                    type: 'command',
                    command: 'bun run "$CLAUDE_PROJECT_DIR/.claude/hooks/validate-file-changes.js"',
                  },
                ],
              },
            ],
          },
        }),
      );
      const errors = evaluateClaudeSettingsHooksWiring(dir);
      expect(errors.some((e) => e.includes('CLAUDE_PLUGIN_ROOT'))).toBe(true);
    });
  });

  test('a missing settings.json is reported', () => {
    withTempDir('blackhole-claude-settings-check-', (dir) => {
      expect(evaluateClaudeSettingsHooksWiring(dir)).toEqual([`${dir}: missing settings.json`]);
    });
  });
});

describe('claude-native-settings runChecks() against the real build', () => {
  test('returns exactly one V-CLAUDESETTINGS-01 result, passing', () => {
    const results = runChecks();
    expect(results.map((r) => r.id)).toEqual(['V-CLAUDESETTINGS-01']);
    expect(results[0].detail ?? '').toBe('');
    expect(results[0].ok).toBe(true);
  });
});
