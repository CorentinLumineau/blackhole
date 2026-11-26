import { describe, expect, test } from 'bun:test';
import * as fs from 'fs';
import * as path from 'path';
import { root } from './checks/check-utils.ts';
import { CLAUDE_NATIVE_ROOT } from './lib/build/paths.ts';
import { evaluateClaudeSettingsHooksWiring } from './checks/claude-native-settings.check.ts';
import { withTempDir } from './lib/test-fixtures.ts';

// ADR-065 — `.claude/settings.json` carries no retired guard registration, and `.claude/hooks/` holds
// only the staging gate's pattern data.

const guardSettings = (script: string) =>
  JSON.stringify({
    hooks: { PreToolUse: [{ matcher: 'Bash', hooks: [{ type: 'command', command: `bun run "$CLAUDE_PROJECT_DIR/.claude/hooks/${script}"` }] }] },
  });

describe('evaluateClaudeSettingsHooksWiring', () => {
  test('a settings.json still wiring a retired validator is reported with its matcher', () => {
    withTempDir('blackhole-claude-settings-check-', (dir) => {
      fs.writeFileSync(path.join(dir, 'settings.json'), guardSettings('validate-bash-command.js'));
      const errors = evaluateClaudeSettingsHooksWiring(dir);
      expect(errors).toHaveLength(1);
      expect(errors[0]).toContain('"Bash"');
    });
  });

  test('a maintainer-owned PreToolUse entry is not reported', () => {
    withTempDir('blackhole-claude-settings-check-', (dir) => {
      fs.writeFileSync(path.join(dir, 'settings.json'), guardSettings('my-own-hook.js'));
      expect(evaluateClaudeSettingsHooksWiring(dir)).toEqual([]);
    });
  });

  test('an absent settings.json is clean; a malformed one is reported', () => {
    withTempDir('blackhole-claude-settings-check-', (dir) => {
      expect(evaluateClaudeSettingsHooksWiring(dir)).toEqual([]);
      fs.writeFileSync(path.join(dir, 'settings.json'), '{ nope');
      expect(evaluateClaudeSettingsHooksWiring(dir)[0]).toContain('invalid JSON');
    });
  });
});

describe('committed .claude/ target', () => {
  test('settings.json wires no retired guard and .claude/hooks/ carries no hooks.json or validator', () => {
    expect(evaluateClaudeSettingsHooksWiring(path.join(root, CLAUDE_NATIVE_ROOT))).toEqual([]);
    expect(fs.existsSync(path.join(root, CLAUDE_NATIVE_ROOT, 'hooks', 'hooks.json'))).toBe(false);
    expect(fs.existsSync(path.join(root, CLAUDE_NATIVE_ROOT, 'hooks', 'validate-bash-command.js'))).toBe(false);
  });
});
