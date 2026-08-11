import { describe, expect, test } from 'bun:test';
import * as fs from 'fs';
import * as path from 'path';
import { withTempDir } from '../test-fixtures.ts';
import { computeMergedSettings, mergeClaudeSettingsHooks } from './claude-native-settings.ts';

// Issue #472 — the .claude/settings.json read-modify-write merge contract. This is the file this
// plan's highest-severity risk (Tampering/Elevation of Privilege) centers on: a bug here is data
// loss on the maintainer's own machine, not a test failure. See § Database/API Schema Changes in
// .blackhole/plans/issue-472.md for the full merge contract this test file pins.

const readSettings = (claudeRoot: string): Record<string, unknown> =>
  JSON.parse(fs.readFileSync(path.join(claudeRoot, 'settings.json'), 'utf-8'));

describe('computeMergedSettings — pure merge logic', () => {
  test('empty existing settings produces both blackhole PreToolUse matchers', () => {
    const merged = computeMergedSettings({}) as { hooks: { PreToolUse: { matcher: string }[] } };
    const matchers = merged.hooks.PreToolUse.map((e) => e.matcher);
    expect(matchers).toContain('Bash');
    expect(matchers).toContain('Write|Edit');
  });

  test('null/undefined existing settings are treated as empty, not thrown', () => {
    expect(() => computeMergedSettings(null)).not.toThrow();
    expect(() => computeMergedSettings(undefined)).not.toThrow();
  });

  test('a non-object existing value (array, string) is rejected rather than guessed at', () => {
    expect(() => computeMergedSettings([])).toThrow();
    expect(() => computeMergedSettings('not an object')).toThrow();
  });

  test('AC-4a — running the merge twice on identical input is byte-identical the second time', () => {
    const once = computeMergedSettings({});
    const twice = computeMergedSettings(once);
    expect(JSON.stringify(twice, null, 2)).toBe(JSON.stringify(once, null, 2));
  });

  test('AC-4b — an unrelated top-level key (permissions) survives the merge byte-for-byte', () => {
    const input = { permissions: { foo: 'bar' } };
    const merged = computeMergedSettings(input) as { permissions: unknown };
    expect(merged.permissions).toEqual({ foo: 'bar' });
  });

  test('AC-4c — a foreign PreToolUse entry survives untouched, position preserved', () => {
    const foreign = { matcher: 'Grep', hooks: [{ type: 'command', command: 'echo grep-hook' }] };
    const input = { hooks: { PreToolUse: [foreign] } };
    const merged = computeMergedSettings(input) as {
      hooks: { PreToolUse: { matcher: string }[] };
    };
    expect(merged.hooks.PreToolUse[0]).toEqual(foreign);
    // and the two blackhole matchers are appended after it, not replacing it
    const matchers = merged.hooks.PreToolUse.map((e) => e.matcher);
    expect(matchers).toEqual(['Grep', 'Bash', 'Write|Edit']);
  });

  test('re-running the merge replaces the blackhole entry in place (fingerprint match), not append', () => {
    const once = computeMergedSettings({}) as { hooks: { PreToolUse: unknown[] } };
    const twice = computeMergedSettings(once) as { hooks: { PreToolUse: unknown[] } };
    expect(twice.hooks.PreToolUse).toHaveLength(once.hooks.PreToolUse.length);
  });

  test('other hooks.* event types (e.g. Stop) pass through untouched', () => {
    const input = { hooks: { Stop: [{ matcher: '*', hooks: [] }] } };
    const merged = computeMergedSettings(input) as { hooks: { Stop: unknown } };
    expect(merged.hooks.Stop).toEqual(input.hooks.Stop);
  });

  test('every blackhole command references $CLAUDE_PROJECT_DIR, never ${CLAUDE_PLUGIN_ROOT}', () => {
    const merged = computeMergedSettings({}) as {
      hooks: { PreToolUse: { hooks: { command: string }[] }[] };
    };
    for (const entry of merged.hooks.PreToolUse) {
      for (const h of entry.hooks) {
        expect(h.command).toContain('$CLAUDE_PROJECT_DIR');
        expect(h.command).not.toContain('${CLAUDE_PLUGIN_ROOT}');
      }
    }
  });

  test('AC-4d contract — the command exits the stub code verbatim for 0/2, and 0 for anything else', () => {
    // Static assertion of the shell contract's shape, complementing the real subprocess
    // AC-4d/4e test below: the exit-code capture line must appear verbatim, since a naive
    // `command1 || fallback` would convert every legitimate deny (exit 2) into an allow.
    const merged = computeMergedSettings({}) as {
      hooks: { PreToolUse: { hooks: { command: string }[] }[] };
    };
    for (const entry of merged.hooks.PreToolUse) {
      const command = entry.hooks[0].command;
      expect(command).toContain('code=$?');
      expect(command).toContain('if [ "$code" = "0" ] || [ "$code" = "2" ]; then exit "$code"; fi');
    }
  });
});

describe('mergeClaudeSettingsHooks — file I/O contract', () => {
  test('case 1 — .claude/settings.json does not exist: writes a fresh file with both matchers', () => {
    withTempDir('blackhole-claude-settings-', (dir) => {
      mergeClaudeSettingsHooks(dir);
      const settings = readSettings(dir);
      const preToolUse = (settings.hooks as { PreToolUse: { matcher: string }[] }).PreToolUse;
      expect(preToolUse.map((e) => e.matcher)).toEqual(['Bash', 'Write|Edit']);
    });
  });

  test('case 2 — running the merge twice produces a byte-identical file (idempotency)', () => {
    withTempDir('blackhole-claude-settings-', (dir) => {
      mergeClaudeSettingsHooks(dir);
      const first = fs.readFileSync(path.join(dir, 'settings.json'), 'utf-8');
      mergeClaudeSettingsHooks(dir);
      const second = fs.readFileSync(path.join(dir, 'settings.json'), 'utf-8');
      expect(second).toBe(first);
    });
  });

  test('case 3 — an existing file with unrelated keys survives the merge byte-for-byte', () => {
    withTempDir('blackhole-claude-settings-', (dir) => {
      fs.mkdirSync(dir, { recursive: true });
      fs.writeFileSync(
        path.join(dir, 'settings.json'),
        JSON.stringify({ permissions: { allow: ['Bash(git *)'] }, env: { FOO: 'bar' } }, null, 2),
      );
      mergeClaudeSettingsHooks(dir);
      const settings = readSettings(dir);
      expect(settings.permissions).toEqual({ allow: ['Bash(git *)'] });
      expect(settings.env).toEqual({ FOO: 'bar' });
    });
  });

  test('writes atomically via tmp + rename — no .tmp file left behind on success', () => {
    withTempDir('blackhole-claude-settings-', (dir) => {
      mergeClaudeSettingsHooks(dir);
      expect(fs.existsSync(path.join(dir, 'settings.json.tmp'))).toBe(false);
      expect(fs.existsSync(path.join(dir, 'settings.json'))).toBe(true);
    });
  });

  test('a malformed existing settings.json throws rather than silently discarding it', () => {
    withTempDir('blackhole-claude-settings-', (dir) => {
      fs.mkdirSync(dir, { recursive: true });
      fs.writeFileSync(path.join(dir, 'settings.json'), '{ not json');
      expect(() => mergeClaudeSettingsHooks(dir)).toThrow();
    });
  });

  test('a zero-byte existing settings.json throws rather than being treated as empty', () => {
    withTempDir('blackhole-claude-settings-', (dir) => {
      fs.mkdirSync(dir, { recursive: true });
      fs.writeFileSync(path.join(dir, 'settings.json'), '');
      expect(() => mergeClaudeSettingsHooks(dir)).toThrow();
    });
  });
});

// AC-4d/4e — the ERROR-outcome contract, exercised through the real generated shell command
// (not just static string assertions above). A stub stands in for validate-bash-command.js and
// exits 0, 2, 1, 127 in turn; the wrapper's own exit code must equal the stub's for 0/2 (a
// legitimate allow/deny must never be swallowed) and must equal 0 for anything else (an infra
// hiccup degrades to allow rather than stalling the caller), recording exactly one hook-exec-error
// event for the two non-0/2 cases.

const bashCommand = (): string => {
  const merged = computeMergedSettings({}) as {
    hooks: { PreToolUse: { matcher: string; hooks: { command: string }[] }[] };
  };
  const entry = merged.hooks.PreToolUse.find((e) => e.matcher === 'Bash');
  if (!entry) throw new Error('test setup: no Bash matcher in computeMergedSettings({})');
  return entry.hooks[0].command;
};

const runWrapperWithStubExit = (
  projectDir: string,
  stubExitCode: number,
): { exitCode: number | null; stderr: string } => {
  const hooksDir = path.join(projectDir, '.claude', 'hooks');
  fs.mkdirSync(hooksDir, { recursive: true });
  fs.writeFileSync(
    path.join(hooksDir, 'validate-bash-command.js'),
    `process.exit(${stubExitCode});\n`,
  );
  const proc = Bun.spawnSync({
    cmd: ['bash', '-c', bashCommand()],
    env: { ...process.env, CLAUDE_PROJECT_DIR: projectDir },
    stdout: 'pipe',
    stderr: 'pipe',
  });
  return { exitCode: proc.exitCode, stderr: proc.stderr.toString() };
};

const hookEventFiles = (projectDir: string): Record<string, unknown>[] => {
  const dir = path.join(projectDir, '.blackhole', 'hook-events');
  if (!fs.existsSync(dir)) return [];
  return fs
    .readdirSync(dir)
    .map((f) => JSON.parse(fs.readFileSync(path.join(dir, f), 'utf-8')) as Record<string, unknown>);
};

describe('AC-4d/4e — exit-code discrimination through the real generated command', () => {
  test('stub exit 0 (allow): wrapper exits 0, no hook-exec-error record, no fail-open notice on stderr', () => {
    withTempDir('blackhole-claude-wrapper-', (dir) => {
      const { exitCode, stderr } = runWrapperWithStubExit(dir, 0);
      expect(exitCode).toBe(0);
      expect(hookEventFiles(dir)).toEqual([]);
      // The fail-open stderr notice belongs to the non-0/2 fallback branch only — a legitimate
      // allow must never print it (issue #580 § Execution Strategy stop condition).
      expect(stderr).not.toMatch(/fail-open/i);
    });
  });

  test('stub exit 2 (deliberate deny): wrapper exits 2 verbatim, no hook-exec-error record, no fail-open notice on stderr', () => {
    withTempDir('blackhole-claude-wrapper-', (dir) => {
      const { exitCode, stderr } = runWrapperWithStubExit(dir, 2);
      expect(exitCode).toBe(2);
      // A real deny is the validator's own decision, recorded by hook-event-log.js's
      // denyAndRecord inside the stub in production — the stub here is bare `process.exit(2)`,
      // so no event is expected from THIS wrapper layer; the wrapper's job is only to pass the
      // exit code through unmodified, which is the assertion above.
      expect(hookEventFiles(dir)).toEqual([]);
      expect(stderr).not.toMatch(/fail-open/i);
    });
  });

  test('stub exit 1 (crash before decision): wrapper degrades to allow (exit 0), one error record, fail-open notice on stderr', () => {
    withTempDir('blackhole-claude-wrapper-', (dir) => {
      const { exitCode, stderr } = runWrapperWithStubExit(dir, 1);
      expect(exitCode).toBe(0);
      const events = hookEventFiles(dir);
      expect(events).toHaveLength(1);
      expect(events[0]).toMatchObject({
        tier: 'error',
        decision: 'allow',
        pattern_id: 'hook-exec-failure',
        hook: 'validate-bash-command',
      });
      expect(stderr).toMatch(/fail-open/i);
    });
  });

  test('stub exit 127 (missing binary / bad path): wrapper degrades to allow (exit 0), one error record, fail-open notice on stderr', () => {
    withTempDir('blackhole-claude-wrapper-', (dir) => {
      const { exitCode, stderr } = runWrapperWithStubExit(dir, 127);
      expect(exitCode).toBe(0);
      const events = hookEventFiles(dir);
      expect(events).toHaveLength(1);
      expect(events[0]).toMatchObject({
        tier: 'error',
        decision: 'allow',
        pattern_id: 'hook-exec-failure',
        hook: 'validate-bash-command',
      });
      expect(stderr).toMatch(/fail-open/i);
    });
  });
});
