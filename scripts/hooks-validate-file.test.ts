import { describe, expect, test } from 'bun:test';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import {
  PRETOOLUSE_HOOKS_DIR,
  readHookEvents,
  runPreToolUseHook,
  withTempGitRepo,
} from './lib/test-fixtures.ts';

// Behavioral contract for the Write|Edit PreToolUse gate (#447). Covers the three block classes
// (system path, path traversal, outside-worktree) plus the sensitive-filename warn tier, which is
// deliberately NOT a block: a coarse filename regex has real false-positive risk, and stalling an
// unattended worker on `.env.example` is worse than recording the write and letting it proceed.

const SCRIPT = 'validate-file-changes.js';

const writePayload = (filePath: string, toolName = 'Write') => ({
  tool_name: toolName,
  tool_input: { file_path: filePath, content: 'x' },
  tool_use_id: 'toolu_447_file',
});

describe('validate-file-changes.js', () => {
  test('block tier: writing to /etc/passwd is denied with exit 2 and recorded', async () => {
    await withTempGitRepo('blackhole-hook-file-', async (repo) => {
      const result = await runPreToolUseHook(SCRIPT, writePayload('/etc/passwd'), repo);

      expect(result.exitCode).toBe(2);
      const out = JSON.parse(result.stdout);
      expect(out.decision).toBe('deny');
      expect(out.reason).toMatch(/system/i);

      const events = readHookEvents(repo);
      expect(events).toHaveLength(1);
      expect(events[0]).toMatchObject({
        hook: 'validate-file-changes',
        tool: 'Write',
        decision: 'deny',
        tier: 'block',
        pattern_id: 'etc',
        worktree: repo,
      });
    });
  });

  test('block tier: a `../` path traversal is denied before any other check', async () => {
    await withTempGitRepo('blackhole-hook-file-', async (repo) => {
      const result = await runPreToolUseHook(SCRIPT, writePayload('src/../../escape.ts'), repo);

      expect(result.exitCode).toBe(2);
      expect(JSON.parse(result.stdout).reason).toMatch(/traversal/i);
      expect(readHookEvents(repo)[0]).toMatchObject({
        tier: 'block',
        pattern_id: 'dotdot-slash',
      });
    });
  });

  test('block tier: an absolute path outside the worktree root is denied', async () => {
    await withTempGitRepo('blackhole-hook-file-', async (repo) => {
      const outside = path.join(fs.realpathSync(os.tmpdir()), `blackhole-447-outside-${process.pid}.ts`);
      const result = await runPreToolUseHook(SCRIPT, writePayload(outside), repo);

      expect(result.exitCode).toBe(2);
      const out = JSON.parse(result.stdout);
      expect(out.decision).toBe('deny');
      expect(out.reason).toMatch(/outside/i);

      expect(readHookEvents(repo)[0]).toMatchObject({
        tier: 'block',
        pattern_id: 'outside-worktree',
        decision: 'deny',
      });
    });
  });

  test('warn tier: writing `.env` inside the worktree is allowed but recorded', async () => {
    await withTempGitRepo('blackhole-hook-file-', async (repo) => {
      const result = await runPreToolUseHook(SCRIPT, writePayload(path.join(repo, '.env')), repo);

      expect(result.exitCode).toBe(0);
      const out = JSON.parse(result.stdout);
      expect(out.decision).toBeUndefined();
      expect(out.systemMessage).toMatch(/\.env/);

      const events = readHookEvents(repo);
      expect(events).toHaveLength(1);
      expect(events[0]).toMatchObject({
        decision: 'allow',
        tier: 'warn',
        pattern_id: 'env',
      });
    });
  });

  test('no match: an ordinary source file inside the worktree is allowed silently', async () => {
    await withTempGitRepo('blackhole-hook-file-', async (repo) => {
      const result = await runPreToolUseHook(
        SCRIPT,
        writePayload(path.join(repo, 'src', 'foo.ts'), 'Edit'),
        repo,
      );

      expect(result.exitCode).toBe(0);
      expect(result.stdout.trim()).toBe('');
      expect(readHookEvents(repo)).toEqual([]);
    });
  });

  test('fails closed: an unparseable file-patterns.json denies even an ordinary write', async () => {
    await withTempGitRepo('blackhole-hook-file-', async (repo) => {
      const corruptHooks = path.join(repo, 'corrupt-hooks');
      fs.cpSync(PRETOOLUSE_HOOKS_DIR, corruptHooks, { recursive: true });
      fs.writeFileSync(path.join(corruptHooks, 'patterns', 'file-patterns.json'), '{ not json');

      const result = await runPreToolUseHook(
        SCRIPT,
        writePayload(path.join(repo, 'src', 'foo.ts')),
        repo,
        corruptHooks,
      );

      expect(result.exitCode).toBe(2);
      expect(JSON.parse(result.stdout).reason).toMatch(/pattern/i);
    });
  });

  // Fail-open, per-check: outside a git context the worktree-containment sub-check cannot run,
  // but the pattern-based system-path checks do not depend on git and must still fire.
  test('fails open per-check: outside a git repo the system-path block still applies', async () => {
    const nonRepo = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'blackhole-hook-nogit-')));
    try {
      const blocked = await runPreToolUseHook(SCRIPT, writePayload('/etc/passwd'), nonRepo);
      expect(blocked.exitCode).toBe(2);
      expect(JSON.parse(blocked.stdout).reason).toMatch(/system/i);

      // ...and an ordinary write is NOT denied just because containment was unresolvable.
      const ordinary = await runPreToolUseHook(
        SCRIPT,
        writePayload(path.join(nonRepo, 'foo.ts')),
        nonRepo,
      );
      expect(ordinary.exitCode).toBe(0);
      expect(ordinary.stderr).toMatch(/worktree/i);
    } finally {
      fs.rmSync(nonRepo, { recursive: true, force: true });
    }
  });
});
