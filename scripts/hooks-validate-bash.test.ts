import { describe, expect, test } from 'bun:test';
import * as fs from 'fs';
import * as path from 'path';
import {
  PRETOOLUSE_HOOKS_DIR,
  readHookEvents,
  runPreToolUseHook,
  withTempGitRepo,
} from './lib/test-fixtures.ts';

// Behavioral contract for the Bash PreToolUse gate (#447). One representative command per tier,
// exercised through the real script so the pattern data, the decision protocol, and the durable
// event record are all covered end to end.

const SCRIPT = 'validate-bash-command.js';

const bashPayload = (command: string) => ({
  tool_name: 'Bash',
  tool_input: { command },
  tool_use_id: 'toolu_447_bash',
});

describe('validate-bash-command.js', () => {
  test('block tier: `rm -rf /` is denied with exit 2 and a durable block event', async () => {
    await withTempGitRepo('blackhole-hook-bash-', async (repo) => {
      const result = await runPreToolUseHook(SCRIPT, bashPayload('rm -rf /'), repo);

      expect(result.exitCode).toBe(2);
      const out = JSON.parse(result.stdout);
      expect(out.decision).toBe('deny');
      expect(out.reason).toMatch(/root filesystem/i);

      const events = readHookEvents(repo);
      expect(events).toHaveLength(1);
      expect(events[0]).toMatchObject({
        hook: 'validate-bash-command',
        tool: 'Bash',
        decision: 'deny',
        tier: 'block',
        pattern_id: 'rm-rf-root',
        worktree: repo,
      });
      expect(events[0].detail).toContain('rm -rf /');
    });
  });

  test('warn tier: `git push --force` is allowed with exit 0 but still recorded', async () => {
    await withTempGitRepo('blackhole-hook-bash-', async (repo) => {
      const result = await runPreToolUseHook(
        SCRIPT,
        bashPayload('git push --force origin main'),
        repo,
      );

      expect(result.exitCode).toBe(0);
      const out = JSON.parse(result.stdout);
      expect(out.decision).toBeUndefined();
      expect(out.systemMessage).toMatch(/force/i);

      const events = readHookEvents(repo);
      expect(events).toHaveLength(1);
      expect(events[0]).toMatchObject({
        tool: 'Bash',
        decision: 'allow',
        tier: 'warn',
        pattern_id: 'git-push-force',
      });
    });
  });

  test('no match: a benign `ls -la` is allowed silently and records nothing', async () => {
    await withTempGitRepo('blackhole-hook-bash-', async (repo) => {
      const result = await runPreToolUseHook(SCRIPT, bashPayload('ls -la src'), repo);

      expect(result.exitCode).toBe(0);
      expect(result.stdout.trim()).toBe('');
      expect(readHookEvents(repo)).toEqual([]);
    });
  });

  // The fail-closed stop condition is the load-bearing safety argument for shipping pattern data
  // as JSON: a hook that cannot read its patterns cannot tell safe from dangerous, so it must
  // refuse rather than wave the call through.
  test('fails closed: an unparseable bash-patterns.json denies even a benign command', async () => {
    await withTempGitRepo('blackhole-hook-bash-', async (repo) => {
      const corruptHooks = path.join(repo, 'corrupt-hooks');
      fs.cpSync(PRETOOLUSE_HOOKS_DIR, corruptHooks, { recursive: true });
      fs.writeFileSync(path.join(corruptHooks, 'patterns', 'bash-patterns.json'), '{ not json');

      const result = await runPreToolUseHook(
        SCRIPT,
        bashPayload('ls -la src'),
        repo,
        corruptHooks,
      );

      expect(result.exitCode).toBe(2);
      const out = JSON.parse(result.stdout);
      expect(out.decision).toBe('deny');
      expect(out.reason).toMatch(/pattern/i);
    });
  });

  test('an empty command is allowed silently — nothing to match against', async () => {
    await withTempGitRepo('blackhole-hook-bash-', async (repo) => {
      const result = await runPreToolUseHook(SCRIPT, bashPayload(''), repo);
      expect(result.exitCode).toBe(0);
      expect(readHookEvents(repo)).toEqual([]);
    });
  });
});
