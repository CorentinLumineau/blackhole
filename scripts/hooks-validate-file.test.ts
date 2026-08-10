import { describe, expect, test } from 'bun:test';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import {
  PRETOOLUSE_HOOKS_DIR,
  readHookEvents,
  runPreToolUseHook,
  withLinkedWorktree,
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

/** Structured stdout contract the PreToolUse harness reads (review round 1, F-00052):
 * `hookSpecificOutput.permissionDecision`, not a top-level `decision` field. Mirrored verbatim in
 * hooks-validate-bash.test.ts rather than hoisted to lib/test-fixtures.ts — both suites assert
 * against the same two-line shape, but that shared file is outside this fix round's Touch-Paths. */
const permissionDecision = (stdout: string): string | undefined =>
  JSON.parse(stdout).hookSpecificOutput?.permissionDecision;
const permissionReason = (stdout: string): string | undefined =>
  JSON.parse(stdout).hookSpecificOutput?.permissionDecisionReason;

describe('validate-file-changes.js', () => {
  test('block tier: writing to /etc/passwd is denied with exit 2, a stderr reason, and recorded', async () => {
    await withTempGitRepo('blackhole-hook-file-', async (repo) => {
      const result = await runPreToolUseHook(SCRIPT, writePayload('/etc/passwd'), repo);

      expect(result.exitCode).toBe(2);
      expect(permissionDecision(result.stdout)).toBe('deny');
      expect(permissionReason(result.stdout)).toMatch(/system/i);
      // Exit 2 feeds stderr (not stdout) back to the calling model (F-00052).
      expect(result.stderr).toMatch(/system/i);

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
      expect(permissionReason(result.stdout)).toMatch(/traversal/i);
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
      expect(permissionDecision(result.stdout)).toBe('deny');
      expect(permissionReason(result.stdout)).toMatch(/outside/i);

      expect(readHookEvents(repo)[0]).toMatchObject({
        tier: 'block',
        pattern_id: 'outside-worktree',
        decision: 'deny',
      });
    });
  });

  // F-00048 (review round 1): containment used to resolve only the target's *dirname*, so a
  // symlink at the leaf itself was never followed — `ln -s ~/.ssh/authorized_keys ./notes.txt`
  // then a Write to `notes.txt` passed every check. The leaf must be resolved too when it already
  // exists.
  test('block tier: a Write target that is itself a symlink escaping the worktree is denied', async () => {
    await withTempGitRepo('blackhole-hook-file-', async (repo) => {
      const outsideTarget = path.join(
        fs.realpathSync(os.tmpdir()),
        `blackhole-447-symlink-target-${process.pid}.txt`,
      );
      fs.writeFileSync(outsideTarget, 'outside content');
      const leaf = path.join(repo, 'notes.txt');
      fs.symlinkSync(outsideTarget, leaf);

      try {
        const result = await runPreToolUseHook(SCRIPT, writePayload(leaf), repo);

        expect(result.exitCode).toBe(2);
        expect(permissionDecision(result.stdout)).toBe('deny');
        expect(permissionReason(result.stdout)).toMatch(/outside/i);
        expect(readHookEvents(repo)[0]).toMatchObject({
          tier: 'block',
          pattern_id: 'outside-worktree',
        });
      } finally {
        fs.rmSync(outsideTarget, { force: true });
      }
    });
  });

  test('warn tier: writing `.env` inside the worktree is allowed but recorded', async () => {
    await withTempGitRepo('blackhole-hook-file-', async (repo) => {
      const result = await runPreToolUseHook(SCRIPT, writePayload(path.join(repo, '.env')), repo);

      expect(result.exitCode).toBe(0);
      expect(permissionDecision(result.stdout)).toBe('allow');
      const out = JSON.parse(result.stdout);
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

  // A symlink at the leaf resolving *inside* the worktree must still be allowed — the fix must not
  // turn every pre-existing symlinked file into a false-positive block.
  test('no match: a Write target that is a symlink resolving inside the worktree is allowed', async () => {
    await withTempGitRepo('blackhole-hook-file-', async (repo) => {
      const insideTarget = path.join(repo, 'real.ts');
      fs.writeFileSync(insideTarget, 'inside content');
      const leaf = path.join(repo, 'alias.ts');
      fs.symlinkSync(insideTarget, leaf);

      const result = await runPreToolUseHook(SCRIPT, writePayload(leaf), repo);

      expect(result.exitCode).toBe(0);
      expect(result.stdout.trim()).toBe('');
      expect(readHookEvents(repo)).toEqual([]);
    });
  });

  // #507: the hook process's own process.cwd() is wherever the harness happened to spawn it from
  // (typically the main clone, regardless of which worktree a worker is actually operating in),
  // so resolving containment from it treats every sibling worktree as "outside" and denies a
  // worker's own legitimate writes into its worktree (F-00087). The payload's `cwd` field names
  // the tool call's actual working directory; the fix widens containment to every worktree of
  // that repo family (`git worktree list`), not just the one the hook process happens to sit in.
  test('#507: a Write into a linked worktree is allowed when the payload cwd is the main clone', async () => {
    await withLinkedWorktree('blackhole-hook-507-', async (mainRepo, worktree) => {
      const target = path.join(worktree, 'src', 'foo.ts');
      const payload = { tool_name: 'Write', tool_input: { file_path: target, content: 'x' }, cwd: mainRepo };

      // Hook process spawned with cwd = mainRepo — reproduces the pre-fix bug exactly: the hook
      // process's own process.cwd() is the main clone, not the worktree the target lives in.
      const result = await runPreToolUseHook(SCRIPT, payload, mainRepo);

      expect(result.exitCode).toBe(0);
      expect(result.stdout.trim()).toBe('');
      expect(readHookEvents(mainRepo)).toEqual([]);
    });
  });

  // Regression guard for the widened check: a target outside BOTH the main clone and its linked
  // worktree must still be denied — the fix must not turn the boundary into "anything reachable".
  test('#507: a Write outside every worktree of the repo family is still denied', async () => {
    await withLinkedWorktree('blackhole-hook-507-', async (mainRepo) => {
      const outside = path.join(fs.realpathSync(os.tmpdir()), `blackhole-507-outside-${process.pid}.ts`);
      const payload = { tool_name: 'Write', tool_input: { file_path: outside, content: 'x' }, cwd: mainRepo };

      const result = await runPreToolUseHook(SCRIPT, payload, mainRepo);

      expect(result.exitCode).toBe(2);
      expect(permissionReason(result.stdout)).toMatch(/outside/i);
      expect(readHookEvents(mainRepo)[0]).toMatchObject({ tier: 'block', pattern_id: 'outside-worktree' });
    });
  });

  // #507 AC3: when the payload carries no `cwd` field at all (older harness versions, or a direct
  // manual invocation), the hook must fall back to the hook process's own process.cwd() rather
  // than crashing or silently skipping containment.
  test('#507: payload without a cwd field falls back to the hook process cwd', async () => {
    await withLinkedWorktree('blackhole-hook-507-', async (mainRepo, worktree) => {
      const target = path.join(worktree, 'src', 'foo.ts');
      const result = await runPreToolUseHook(SCRIPT, writePayload(target), worktree);

      expect(result.exitCode).toBe(0);
      expect(result.stdout.trim()).toBe('');
      expect(readHookEvents(mainRepo)).toEqual([]);
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
      expect(permissionReason(result.stdout)).toMatch(/pattern/i);
    });
  });

  // F-00051 (review round 1): a malformed stdin payload used to be swallowed into `{}`, which
  // reads as "no file_path" and allows silently. Bypasses runPreToolUseHook (which only ever
  // emits valid JSON) to put genuinely malformed text on stdin; not extracted to
  // lib/test-fixtures.ts because this fix round's Touch-Paths do not include that shared file.
  test('fails closed: malformed JSON on stdin denies the call', async () => {
    await withTempGitRepo('blackhole-hook-file-', async (repo) => {
      const proc = Bun.spawn({
        cmd: ['bun', 'run', path.join(PRETOOLUSE_HOOKS_DIR, SCRIPT)],
        stdin: new Blob(['{ this is not json']),
        stdout: 'pipe',
        stderr: 'pipe',
        cwd: repo,
      });
      const [exitCode, stdout, stderr] = await Promise.all([
        proc.exited,
        new Response(proc.stdout).text(),
        new Response(proc.stderr).text(),
      ]);

      expect(exitCode).toBe(2);
      expect(permissionDecision(stdout)).toBe('deny');
      expect(stderr).toMatch(/hook input/i);

      const events = readHookEvents(repo);
      expect(events).toHaveLength(1);
      expect(events[0]).toMatchObject({ tier: 'block', pattern_id: 'hook-input-parse-failure' });
    });
  });

  // Fail-open, per-check: outside a git context the worktree-containment sub-check cannot run,
  // but the pattern-based system-path checks do not depend on git and must still fire.
  test('fails open per-check: outside a git repo the system-path block still applies', async () => {
    const nonRepo = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'blackhole-hook-nogit-')));
    try {
      const blocked = await runPreToolUseHook(SCRIPT, writePayload('/etc/passwd'), nonRepo);
      expect(blocked.exitCode).toBe(2);
      expect(permissionReason(blocked.stdout)).toMatch(/system/i);

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
