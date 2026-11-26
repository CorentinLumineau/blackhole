import { describe, expect, test } from 'bun:test';
import * as fs from 'fs';
import * as path from 'path';
import { withTempDir } from '../test-fixtures.ts';
import { stripBlackholeGuardHooks, stripBlackholeGuardHooksFrom } from './claude-native-settings.ts';

// ADR-065: the build removes the guard registrations earlier builds merged into
// `.claude/settings.json`. A bug here is data loss on the maintainer's own machine, so the contract
// is pinned from both sides: the retired entries go, everything else survives byte-for-byte.

const guard = (matcher: string, script: string) => ({
  matcher,
  hooks: [{ type: 'command', command: `stderr_tmp="$(mktemp)"\nbun run "$CLAUDE_PROJECT_DIR/.claude/hooks/${script}"`, timeout: 5 }],
});
const bashGuard = guard('Bash', 'validate-bash-command.js');
const fileGuard = guard('Write|Edit', 'validate-file-changes.js');
const foreign = { matcher: 'Bash', hooks: [{ type: 'command', command: 'echo maintainer-hook' }] };

const readSettings = (dir: string): Record<string, unknown> =>
  JSON.parse(fs.readFileSync(path.join(dir, 'settings.json'), 'utf-8'));

describe('stripBlackholeGuardHooksFrom — pure removal', () => {
  test('a file that carried only the two guards ends with no hooks key', () => {
    expect(stripBlackholeGuardHooksFrom({ hooks: { PreToolUse: [bashGuard, fileGuard] } })).toEqual({});
  });

  test('empty, null and undefined input stay empty', () => {
    expect(stripBlackholeGuardHooksFrom({})).toEqual({});
    expect(stripBlackholeGuardHooksFrom(null)).toEqual({});
    expect(stripBlackholeGuardHooksFrom(undefined)).toEqual({});
  });

  test('a non-object existing value is rejected rather than guessed at', () => {
    expect(() => stripBlackholeGuardHooksFrom([])).toThrow();
    expect(() => stripBlackholeGuardHooksFrom('x')).toThrow();
  });

  test('a foreign PreToolUse entry survives in place, even with the same matcher as a guard', () => {
    const out = stripBlackholeGuardHooksFrom({ hooks: { PreToolUse: [foreign, bashGuard, fileGuard] } }) as {
      hooks: { PreToolUse: unknown[] };
    };
    expect(out.hooks.PreToolUse).toEqual([foreign]);
  });

  test('unrelated top-level keys and other hook events pass through untouched', () => {
    const input = {
      permissions: { allow: ['Bash(git *)'] },
      env: { FOO: 'bar' },
      hooks: { Stop: [{ hooks: [{ type: 'command', command: 'echo stop' }] }], PreToolUse: [bashGuard] },
    };
    expect(stripBlackholeGuardHooksFrom(input)).toEqual({
      permissions: input.permissions,
      env: input.env,
      hooks: { Stop: input.hooks.Stop },
    });
  });

  test('running the removal twice is byte-identical the second time', () => {
    const once = stripBlackholeGuardHooksFrom({ a: 1, hooks: { PreToolUse: [foreign, bashGuard] } });
    expect(JSON.stringify(stripBlackholeGuardHooksFrom(once))).toBe(JSON.stringify(once));
  });

  test('a settings object with no hooks key is returned without adding one', () => {
    expect(stripBlackholeGuardHooksFrom({ env: { A: '1' } })).toEqual({ env: { A: '1' } });
  });
});

describe('stripBlackholeGuardHooks — file I/O contract', () => {
  test('an absent settings.json stays absent', () => {
    withTempDir('blackhole-claude-settings-', (dir) => {
      stripBlackholeGuardHooks(dir);
      expect(fs.existsSync(path.join(dir, 'settings.json'))).toBe(false);
    });
  });

  test('guards are removed from the file, unrelated keys survive, and no .tmp is left behind', () => {
    withTempDir('blackhole-claude-settings-', (dir) => {
      fs.writeFileSync(
        path.join(dir, 'settings.json'),
        JSON.stringify({ permissions: { allow: ['Bash(git *)'] }, hooks: { PreToolUse: [bashGuard, fileGuard] } }, null, 2),
      );
      stripBlackholeGuardHooks(dir);
      expect(readSettings(dir)).toEqual({ permissions: { allow: ['Bash(git *)'] } });
      expect(fs.existsSync(path.join(dir, 'settings.json.tmp'))).toBe(false);
    });
  });

  test('a malformed existing settings.json throws rather than being discarded', () => {
    withTempDir('blackhole-claude-settings-', (dir) => {
      fs.writeFileSync(path.join(dir, 'settings.json'), '{ not json');
      expect(() => stripBlackholeGuardHooks(dir)).toThrow();
    });
  });

  test('a zero-byte existing settings.json throws rather than being treated as empty', () => {
    withTempDir('blackhole-claude-settings-', (dir) => {
      fs.writeFileSync(path.join(dir, 'settings.json'), '');
      expect(() => stripBlackholeGuardHooks(dir)).toThrow();
    });
  });
});
