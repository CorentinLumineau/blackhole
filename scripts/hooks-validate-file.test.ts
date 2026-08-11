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
  writeCampaignConfig,
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

  // #510/F-00088: `allWorktreeRoots` used to trust every worktree `git worktree list --porcelain`
  // reported unconditionally — `git worktree add` is ungated (no bash-pattern blocks it), so one
  // such call from inside a legitimate worktree permanently widened the Write/Edit containment
  // allow-list to an arbitrary directory. Orchestrator-reproduced: a worktree registered under an
  // unrelated parent dir (neither nested under the main clone nor under a configured
  // `scratchpad_dir`) must now be excluded from the root set, so a Write into it is denied. This
  // is the missing deny-side test F-00089 flagged — the pre-fix behavior allowed this exact case.
  test('#510: a worktree registered outside the main clone and outside scratchpad_dir is denied', async () => {
    const evilParent = path.join(fs.realpathSync(os.tmpdir()), `blackhole-510-evil-${process.pid}-${Date.now()}`);
    try {
      await withLinkedWorktree(
        'blackhole-hook-510-',
        async (mainRepo, evilWorktree) => {
          const target = path.join(evilWorktree, 'pwned.ts');
          const payload = { tool_name: 'Write', tool_input: { file_path: target, content: 'x' }, cwd: evilWorktree };
          const result = await runPreToolUseHook(SCRIPT, payload, evilWorktree);

          expect(result.exitCode).toBe(2);
          expect(permissionDecision(result.stdout)).toBe('deny');
          expect(permissionReason(result.stdout)).toMatch(/outside/i);
          expect(readHookEvents(mainRepo)[0]).toMatchObject({ tier: 'block', pattern_id: 'outside-worktree' });
        },
        () => evilParent,
      );
    } finally {
      fs.rmSync(evilParent, { recursive: true, force: true });
    }
  });

  // #510 property 2: a worktree nested under the campaign's configured `scratchpad_dir` (the
  // documented location for worker worktrees, e.g. `/tmp/blackhole-campaign/wt-42`) is accepted,
  // not just worktrees nested under the main clone. The hook process is spawned from `mainRepo`
  // while the payload names the scratchpad worktree as `cwd` — proving `scratchpad_dir` is read
  // via `mainCloneRoot(payload.cwd)`, not the hook process's own `process.cwd()` (property 7).
  test('#510: a worktree nested under configured scratchpad_dir is accepted', async () => {
    const scratchpad = path.join(fs.realpathSync(os.tmpdir()), `blackhole-510-scratch-${process.pid}-${Date.now()}`);
    try {
      await withLinkedWorktree(
        'blackhole-hook-510-',
        async (mainRepo, worktree) => {
          const target = path.join(worktree, 'src', 'foo.ts');
          const payload = { tool_name: 'Write', tool_input: { file_path: target, content: 'x' }, cwd: worktree };
          const result = await runPreToolUseHook(SCRIPT, payload, mainRepo);

          expect(result.exitCode).toBe(0);
          expect(result.stdout.trim()).toBe('');
          expect(readHookEvents(mainRepo)).toEqual([]);
        },
        (mainRepo) => {
          writeCampaignConfig(mainRepo, { scratchpad_dir: scratchpad });
          return scratchpad;
        },
      );
    } finally {
      fs.rmSync(scratchpad, { recursive: true, force: true });
    }
  });

  // #510 property 6: the scratchpad_dir value is realpath'd through the same resolution as every
  // other containment comparison — a symlinked scratchpad_dir must still accept a worktree
  // created under its real target, not just under the literal symlink path.
  test('#510: a symlinked scratchpad_dir is resolved through realpath before comparison', async () => {
    const realScratchpad = path.join(
      fs.realpathSync(os.tmpdir()),
      `blackhole-510-scratch-real-${process.pid}-${Date.now()}`,
    );
    const scratchpadLink = path.join(
      fs.realpathSync(os.tmpdir()),
      `blackhole-510-scratch-link-${process.pid}-${Date.now()}`,
    );
    fs.mkdirSync(realScratchpad, { recursive: true });
    fs.symlinkSync(realScratchpad, scratchpadLink);
    try {
      await withLinkedWorktree(
        'blackhole-hook-510-',
        async (mainRepo, worktree) => {
          const target = path.join(worktree, 'src', 'foo.ts');
          const payload = { tool_name: 'Write', tool_input: { file_path: target, content: 'x' }, cwd: worktree };
          const result = await runPreToolUseHook(SCRIPT, payload, worktree);

          expect(result.exitCode).toBe(0);
          expect(result.stdout.trim()).toBe('');
        },
        (mainRepo) => {
          // Config names the symlink; the worktree is created under the real target directory
          // git resolves and reports — the two must still be recognized as the same root.
          writeCampaignConfig(mainRepo, { scratchpad_dir: scratchpadLink });
          return realScratchpad;
        },
      );
    } finally {
      fs.rmSync(scratchpadLink, { force: true });
      fs.rmSync(realScratchpad, { recursive: true, force: true });
    }
  });

  // #510 property 4: a malformed .blackhole/config.json must fall back to main-clone-only
  // containment, never fall open to trusting an unparseable value's worktree anyway.
  test('#510: malformed .blackhole/config.json falls back to main-clone-only (fail closed)', async () => {
    const scratchpad = path.join(fs.realpathSync(os.tmpdir()), `blackhole-510-scratch-${process.pid}-${Date.now()}`);
    try {
      await withLinkedWorktree(
        'blackhole-hook-510-',
        async (mainRepo, worktree) => {
          fs.mkdirSync(path.join(mainRepo, '.blackhole'), { recursive: true });
          fs.writeFileSync(path.join(mainRepo, '.blackhole', 'config.json'), '{ not json');

          const target = path.join(worktree, 'src', 'foo.ts');
          const payload = { tool_name: 'Write', tool_input: { file_path: target, content: 'x' }, cwd: worktree };
          const result = await runPreToolUseHook(SCRIPT, payload, worktree);

          expect(result.exitCode).toBe(2);
          expect(permissionReason(result.stdout)).toMatch(/outside/i);
        },
        () => scratchpad,
      );
    } finally {
      fs.rmSync(scratchpad, { recursive: true, force: true });
    }
  });

  // #510 property 4: a config.json that parses fine but carries no scratchpad_dir key must also
  // fall back to main-clone-only, not silently trust the worktree anyway.
  test('#510: .blackhole/config.json without scratchpad_dir falls back to main-clone-only', async () => {
    const scratchpad = path.join(fs.realpathSync(os.tmpdir()), `blackhole-510-scratch-${process.pid}-${Date.now()}`);
    try {
      await withLinkedWorktree(
        'blackhole-hook-510-',
        async (mainRepo, worktree) => {
          writeCampaignConfig(mainRepo, { repo: 'owner/name' });

          const target = path.join(worktree, 'src', 'foo.ts');
          const payload = { tool_name: 'Write', tool_input: { file_path: target, content: 'x' }, cwd: worktree };
          const result = await runPreToolUseHook(SCRIPT, payload, worktree);

          expect(result.exitCode).toBe(2);
          expect(permissionReason(result.stdout)).toMatch(/outside/i);
        },
        () => scratchpad,
      );
    } finally {
      fs.rmSync(scratchpad, { recursive: true, force: true });
    }
  });

  // #510 property 5: a bare system temp dir as scratchpad_dir would accept a worktree created
  // almost anywhere under it — exactly the F-00088 hole reopened through config instead of
  // through an ungated `git worktree add`. Must be rejected, falling back to main-clone-only.
  test('#510: an overly-broad scratchpad_dir ("/tmp") is rejected, falling back to main-clone-only', async () => {
    await withLinkedWorktree(
      'blackhole-hook-510-',
      async (mainRepo, worktree) => {
        const target = path.join(worktree, 'src', 'foo.ts');
        const payload = { tool_name: 'Write', tool_input: { file_path: target, content: 'x' }, cwd: worktree };
        const result = await runPreToolUseHook(SCRIPT, payload, worktree);

        expect(result.exitCode).toBe(2);
        expect(permissionReason(result.stdout)).toMatch(/outside/i);
      },
      (mainRepo) => {
        writeCampaignConfig(mainRepo, { scratchpad_dir: fs.realpathSync(os.tmpdir()) });
        return fs.realpathSync(os.tmpdir());
      },
    );
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

  // #512: outside a git context, `allWorktreeRoots` has nothing to resolve, so the check falls
  // back to bounding writes to the payload's own cwd subtree rather than skipping containment
  // outright (the pre-#512 fail-open). The pattern-based system-path checks never depended on git
  // and must still fire first, unaffected by the fallback.
  test('#512: outside a git repo the system-path block still applies (no regression)', async () => {
    const nonRepo = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'blackhole-hook-nogit-')));
    try {
      const blocked = await runPreToolUseHook(SCRIPT, writePayload('/etc/passwd'), nonRepo);
      expect(blocked.exitCode).toBe(2);
      expect(permissionReason(blocked.stdout)).toMatch(/system/i);
    } finally {
      fs.rmSync(nonRepo, { recursive: true, force: true });
    }
  });

  // #512: outside a git context, a write inside the payload cwd's own subtree is the routine case
  // (an agent working within its own session directory) and must not be denied just because
  // containment could not be resolved from git.
  test('#512: outside a git repo, a write inside the payload cwd subtree is bounded-allowed', async () => {
    const nonRepo = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'blackhole-hook-nogit-')));
    try {
      const ordinary = await runPreToolUseHook(
        SCRIPT,
        writePayload(path.join(nonRepo, 'nested', 'foo.ts')),
        nonRepo,
      );
      expect(ordinary.exitCode).toBe(0);
      expect(ordinary.stdout.trim()).toBe('');
      expect(ordinary.stderr).toMatch(/bounded fallback to cwd subtree/i);
      expect(readHookEvents(nonRepo)).toEqual([]);
    } finally {
      fs.rmSync(nonRepo, { recursive: true, force: true });
    }
  });

  // #512: the residual gap this issue closes — outside a git context, a target that matches no
  // denylist pattern but resolves outside the payload's own cwd subtree must now be denied rather
  // than accepted as "anywhere on disk".
  test('#512: outside a git repo, a write outside the payload cwd subtree is denied', async () => {
    const nonRepo = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'blackhole-hook-nogit-')));
    const outside = path.join(fs.realpathSync(os.tmpdir()), `blackhole-512-outside-${process.pid}.ts`);
    try {
      const result = await runPreToolUseHook(SCRIPT, writePayload(outside), nonRepo);

      expect(result.exitCode).toBe(2);
      expect(permissionDecision(result.stdout)).toBe('deny');
      expect(permissionReason(result.stdout)).toMatch(/cwd/i);
      expect(result.stderr).toMatch(/cwd/i);
      // No git context means no destination dir to persist the event under — the deny still
      // fires, but recording is a best-effort side channel that has nowhere to write (mirrors
      // hook-event-log.js's recordEvent behavior for any other git-context-less denial).
      expect(readHookEvents(nonRepo)).toEqual([]);
    } finally {
      fs.rmSync(nonRepo, { recursive: true, force: true });
    }
  });

  // #512: a Write target that is itself a symlink escaping the payload cwd subtree, with no git
  // context, must also be denied — the leaf-resolution fix from F-00048 applies to the cwd
  // fallback bound exactly as it does to the worktree-root bound.
  test('#512: outside a git repo, a symlinked write target escaping the cwd subtree is denied', async () => {
    const nonRepo = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'blackhole-hook-nogit-')));
    const outsideTarget = path.join(fs.realpathSync(os.tmpdir()), `blackhole-512-symlink-target-${process.pid}.txt`);
    fs.writeFileSync(outsideTarget, 'outside content');
    const leaf = path.join(nonRepo, 'notes.txt');
    fs.symlinkSync(outsideTarget, leaf);
    try {
      const result = await runPreToolUseHook(SCRIPT, writePayload(leaf), nonRepo);

      expect(result.exitCode).toBe(2);
      expect(permissionReason(result.stdout)).toMatch(/cwd/i);
    } finally {
      fs.rmSync(outsideTarget, { force: true });
      fs.rmSync(nonRepo, { recursive: true, force: true });
    }
  });

  // #512 follow-up: the cwd fallback bound is only as narrow as `cwd` itself. A session whose
  // cwd resolves to a bare temp root is no narrower than accepting everything — the same hole
  // #510/F-00088 closed for `scratchpad_dir`, reusing `isAcceptableScratchpadDir` rather than a
  // second breadth check. Must be refused, not silently trusted as a containment root.
  test('#512: outside a git repo, a cwd resolving to a bare temp root is too broad to trust as a fallback bound', async () => {
    const bareTmp = fs.realpathSync(os.tmpdir());
    const target = path.join(bareTmp, `blackhole-512-broad-${process.pid}.ts`);

    const result = await runPreToolUseHook(SCRIPT, writePayload(target), bareTmp);

    expect(result.exitCode).toBe(2);
    expect(permissionDecision(result.stdout)).toBe('deny');
    expect(permissionReason(result.stdout)).toMatch(/too broad/i);
  });
});

// Uncaught-exception fail-open regression (#580): a non-string `file_path` reaches
// `hook-event-log.js`'s `resolveExistingAncestor` (line 96, `path.resolve(p)`, reached via
// `isUnderRoot`←`isInsideAnyRoot` from the worktree-containment check at main() line 101) and
// throws a `TypeError` outside every existing try/catch. Before this fix, that fell through to
// bun's default exit 1 — the wrapper's (claude-native-settings.ts) fail-OPEN condition,
// converting what should be a refusal into a silent allow of the V-SEC-11 gate. Every non-string
// shape is exercised, not just the investigation note's `number` repro
// (.blackhole/plans/issue-580-investigation.md), to prove the fix closes the defect class rather
// than one type.
describe('validate-file-changes.js — uncaught validator crash fails closed, not open (#580)', () => {
  const NON_STRING_FILE_PATH: unknown[] = [12345, ['a'], {}, true];

  for (const filePath of NON_STRING_FILE_PATH) {
    test(`a non-string file_path (${JSON.stringify(filePath)}) reaching the worktree-containment check fails closed, not open`, async () => {
      await withTempGitRepo('blackhole-hook-580-', async (repo) => {
        const payload = { tool_name: 'Write', tool_input: { file_path: filePath, content: 'x' } };
        const result = await runPreToolUseHook(SCRIPT, payload, repo);

        expect(result.exitCode).toBe(2);
        expect(permissionDecision(result.stdout)).toBe('deny');

        const events = readHookEvents(repo);
        expect(events).toHaveLength(1);
        expect(events[0]).toMatchObject({
          hook: 'validate-file-changes',
          tool: 'Write',
          decision: 'deny',
          tier: 'block',
          pattern_id: 'uncaught-validator-error',
        });
      });
    });
  }
});
