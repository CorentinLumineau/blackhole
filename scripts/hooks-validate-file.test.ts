import { describe, expect, test } from 'bun:test';
import { spawnSync } from 'child_process';
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
  writeInstalledPlugins,
} from './lib/test-fixtures.ts';

// Behavioral contract for the Write|Edit PreToolUse gate. Covers the three block classes
// (system path, path traversal, outside-worktree) plus the sensitive-filename warn tier, which is
// deliberately NOT a block: a coarse filename regex has real false-positive risk, and stalling an
// unattended worker on `.env.example` is worse than recording the write and letting it proceed.

const SCRIPT = 'validate-file-changes.js';

const writePayload = (filePath: string, toolName = 'Write') => ({
  tool_name: toolName,
  tool_input: { file_path: filePath, content: 'x' },
  tool_use_id: 'toolu_447_file',
});

/** Structured stdout contract the PreToolUse harness reads:
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
      // Exit 2 feeds stderr (not stdout) back to the calling model.
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

  test('agent_id/agent_type on the stdin payload are recorded verbatim (#907, log-only)', async () => {
    await withTempGitRepo('blackhole-hook-file-', async (repo) => {
      const result = await runPreToolUseHook(
        SCRIPT,
        { ...writePayload('/etc/passwd'), agent_id: 'a4b8b1b8c8ec516e1', agent_type: 'general-purpose' },
        repo,
      );

      // Decision path is untouched by the new fields — same deny as the plain payload above.
      expect(result.exitCode).toBe(2);
      expect(permissionDecision(result.stdout)).toBe('deny');

      const events = readHookEvents(repo);
      expect(events).toHaveLength(1);
      expect(events[0]).toMatchObject({
        agent_id: 'a4b8b1b8c8ec516e1',
        agent_type: 'general-purpose',
      });
    });
  });

  test('agent_id/agent_type are recorded as null, not omitted, when absent from the payload (#907)', async () => {
    await withTempGitRepo('blackhole-hook-file-', async (repo) => {
      const result = await runPreToolUseHook(SCRIPT, writePayload('/etc/passwd'), repo);

      expect(result.exitCode).toBe(2);
      const events = readHookEvents(repo);
      expect(events).toHaveLength(1);
      expect(events[0]).toHaveProperty('agent_id', null);
      expect(events[0]).toHaveProperty('agent_type', null);
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

  // Containment used to resolve only the target's *dirname*, so a
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

  // The hook process's own process.cwd() is wherever the harness happened to spawn it from
  // (typically the main clone, regardless of which worktree a worker is actually operating in),
  // so resolving containment from it treats every sibling worktree as "outside" and denies a
  // worker's own legitimate writes into its worktree. The payload's `cwd` field names
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

  // When the payload carries no `cwd` field at all (older harness versions, or a direct
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

  // `allWorktreeRoots` used to trust every worktree `git worktree list --porcelain`
  // reported unconditionally — `git worktree add` is ungated (no bash-pattern blocks it), so one
  // such call from inside a legitimate worktree permanently widened the Write/Edit containment
  // allow-list to an arbitrary directory. Orchestrator-reproduced: a worktree registered under an
  // unrelated parent dir (neither nested under the main clone nor under a configured
  // `scratchpad_dir`) must still be excluded from the root set for a session that is NOT
  // operating from that worktree's own cwd.
  //
  // Split for #729 (was a single test asserting denial with `cwd: evilWorktree`): #729
  // intentionally widens containment to always trust a session's own cwd worktree, so the old
  // single test would now pass for the wrong reason (cwd-trust, not the main-clone/scratchpad
  // nesting filter this test exists to guard). This half keeps `cwd` as the MAIN clone — a
  // session sitting elsewhere — to isolate #510's actual invariant; the companion allow-case
  // below covers the cwd-is-its-own-worktree path #729 adds.
  test('#510: a worktree registered outside the main clone/scratchpad_dir is denied to a session not sitting in it', async () => {
    const evilParent = path.join(fs.realpathSync(os.tmpdir()), `blackhole-510-evil-${process.pid}-${Date.now()}`);
    try {
      await withLinkedWorktree(
        'blackhole-hook-510-',
        async (mainRepo, evilWorktree) => {
          const target = path.join(evilWorktree, 'pwned.ts');
          const payload = { tool_name: 'Write', tool_input: { file_path: target, content: 'x' }, cwd: mainRepo };
          const result = await runPreToolUseHook(SCRIPT, payload, mainRepo);

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

  // #729: the counterpart allow-case split out of the #510 test above — a session sitting IN its
  // own worktree (even one registered outside the main clone and outside scratchpad_dir) must be
  // able to Write/Edit within that same worktree. This is the fix's primary case: cwd's own
  // resolved git toplevel is now always unioned into `allWorktreeRoots`, regardless of the
  // main-clone/scratchpad_dir nesting filter.
  test('#729: a session can Write/Edit inside its own cwd worktree even when that worktree is registered outside the main clone/scratchpad_dir', async () => {
    const ownParent = path.join(fs.realpathSync(os.tmpdir()), `blackhole-729-own-${process.pid}-${Date.now()}`);
    try {
      await withLinkedWorktree(
        'blackhole-hook-729-',
        async (mainRepo, ownWorktree) => {
          const target = path.join(ownWorktree, 'notes.ts');
          const payload = { tool_name: 'Write', tool_input: { file_path: target, content: 'x' }, cwd: ownWorktree };
          const result = await runPreToolUseHook(SCRIPT, payload, ownWorktree);

          expect(result.exitCode).toBe(0);
          expect(result.stdout.trim()).toBe('');
        },
        () => ownParent,
      );
    } finally {
      fs.rmSync(ownParent, { recursive: true, force: true });
    }
  });

  // property 2: a worktree nested under the campaign's configured `scratchpad_dir` (the
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

  // property 6: the scratchpad_dir value is realpath'd through the same resolution as every
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

  // property 4: a malformed .blackhole/config.json must fall back to main-clone-only
  // containment, never fall open to trusting an unparseable value's worktree anyway. `cwd` is
  // deliberately the MAIN clone, not the worktree under test — #729 now always trusts a
  // session's own cwd worktree unconditionally (see the split #510/#729 pair above), so proving
  // this config-fallback invariant requires a session sitting somewhere else, not the worktree
  // whose reachability the (malformed/absent/overly-broad) `scratchpad_dir` is supposed to gate.
  test('#510: malformed .blackhole/config.json falls back to main-clone-only (fail closed)', async () => {
    const scratchpad = path.join(fs.realpathSync(os.tmpdir()), `blackhole-510-scratch-${process.pid}-${Date.now()}`);
    try {
      await withLinkedWorktree(
        'blackhole-hook-510-',
        async (mainRepo, worktree) => {
          fs.mkdirSync(path.join(mainRepo, '.blackhole'), { recursive: true });
          fs.writeFileSync(path.join(mainRepo, '.blackhole', 'config.json'), '{ not json');

          const target = path.join(worktree, 'src', 'foo.ts');
          const payload = { tool_name: 'Write', tool_input: { file_path: target, content: 'x' }, cwd: mainRepo };
          const result = await runPreToolUseHook(SCRIPT, payload, mainRepo);

          expect(result.exitCode).toBe(2);
          expect(permissionReason(result.stdout)).toMatch(/outside/i);
        },
        () => scratchpad,
      );
    } finally {
      fs.rmSync(scratchpad, { recursive: true, force: true });
    }
  });

  // property 4: a config.json that parses fine but carries no scratchpad_dir key must also
  // fall back to main-clone-only, not silently trust the worktree anyway. `cwd` is the main
  // clone — see the note on the preceding test for why.
  test('#510: .blackhole/config.json without scratchpad_dir falls back to main-clone-only', async () => {
    const scratchpad = path.join(fs.realpathSync(os.tmpdir()), `blackhole-510-scratch-${process.pid}-${Date.now()}`);
    try {
      await withLinkedWorktree(
        'blackhole-hook-510-',
        async (mainRepo, worktree) => {
          writeCampaignConfig(mainRepo, { repo: 'owner/name' });

          const target = path.join(worktree, 'src', 'foo.ts');
          const payload = { tool_name: 'Write', tool_input: { file_path: target, content: 'x' }, cwd: mainRepo };
          const result = await runPreToolUseHook(SCRIPT, payload, mainRepo);

          expect(result.exitCode).toBe(2);
          expect(permissionReason(result.stdout)).toMatch(/outside/i);
        },
        () => scratchpad,
      );
    } finally {
      fs.rmSync(scratchpad, { recursive: true, force: true });
    }
  });

  // property 5: a bare system temp dir as scratchpad_dir would accept a worktree created
  // almost anywhere under it — the same failure reopened through config instead of
  // through an ungated `git worktree add`. Must be rejected, falling back to main-clone-only.
  // `cwd` is the main clone — see the note two tests above for why.
  test('#510: an overly-broad scratchpad_dir ("/tmp") is rejected, falling back to main-clone-only', async () => {
    await withLinkedWorktree(
      'blackhole-hook-510-',
      async (mainRepo, worktree) => {
        const target = path.join(worktree, 'src', 'foo.ts');
        const payload = { tool_name: 'Write', tool_input: { file_path: target, content: 'x' }, cwd: mainRepo };
        const result = await runPreToolUseHook(SCRIPT, payload, mainRepo);

        expect(result.exitCode).toBe(2);
        expect(permissionReason(result.stdout)).toMatch(/outside/i);
      },
      (mainRepo) => {
        writeCampaignConfig(mainRepo, { scratchpad_dir: fs.realpathSync(os.tmpdir()) });
        return fs.realpathSync(os.tmpdir());
      },
    );
  });

  // BARE_TEMP_DIRS is built with path.resolve() (no symlink resolution), so a bare temp
  // root reached only through a symlinked ancestor evades classification — the same defect that
  // makes os.tmpdir() (/var/folders/... on darwin, realpath /private/var/folders/...) slip past
  // the check on macOS. Reproduced portably here via a fresh symlink whose target is the
  // worker's own realpath'd temp root, so the failure is observable on Linux CI too. `cwd` is
  // the main clone — see the note three tests above for why.
  test('#714: a scratchpad_dir reaching a bare temp root only through a symlinked ancestor is rejected', async () => {
    const tmpRoot = fs.realpathSync(os.tmpdir());
    const symlinkedAlias = path.join(tmpRoot, `blackhole-714-alias-${process.pid}-${Date.now()}`);
    fs.symlinkSync(tmpRoot, symlinkedAlias, 'dir');
    try {
      await withLinkedWorktree(
        'blackhole-hook-714-',
        async (mainRepo, worktree) => {
          const target = path.join(worktree, 'src', 'foo.ts');
          const payload = { tool_name: 'Write', tool_input: { file_path: target, content: 'x' }, cwd: mainRepo };
          const result = await runPreToolUseHook(SCRIPT, payload, mainRepo);

          expect(result.exitCode).toBe(2);
          expect(permissionReason(result.stdout)).toMatch(/outside/i);
        },
        (mainRepo) => {
          writeCampaignConfig(mainRepo, { scratchpad_dir: symlinkedAlias });
          return symlinkedAlias;
        },
      );
    } finally {
      fs.rmSync(symlinkedAlias, { force: true });
    }
  });

  // A Write target placed directly at the campaign's configured `scratchpad_dir` — a probe
  // script, a shared coordination file, anything not inside one specific worktree subdirectory —
  // must be accepted: the directory as a whole already passed the same `isAcceptableScratchpadDir`
  // breadth check that makes its nested worktrees trustworthy, so admitting it is no broader than
  // the nested-worktree trust already granted. `cwd` is deliberately the MAIN clone, so an allow
  // here can only come from scratchpad-root trust, never from the cwd-worktree trust above.
  test('#839: a Write directly at the configured scratchpad_dir root is accepted', async () => {
    const scratchpad = path.join(fs.realpathSync(os.tmpdir()), `blackhole-839-scratch-${process.pid}-${Date.now()}`);
    try {
      await withLinkedWorktree(
        'blackhole-hook-839-',
        async (mainRepo) => {
          const target = path.join(scratchpad, 'probe.sh');
          const payload = { tool_name: 'Write', tool_input: { file_path: target, content: 'x' }, cwd: mainRepo };
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

  // The negative control for the case above: trusting the scratchpad root must not degrade into
  // trusting its neighbourhood. A sibling directory of the configured scratchpad stays denied.
  test('#839: with scratchpad_dir configured, a Write under an unrelated directory is still denied', async () => {
    const scratchpad = path.join(fs.realpathSync(os.tmpdir()), `blackhole-839-scratch-${process.pid}-${Date.now()}`);
    const unrelated = path.join(fs.realpathSync(os.tmpdir()), `blackhole-839-unrelated-${process.pid}-${Date.now()}`);
    fs.mkdirSync(unrelated, { recursive: true });
    try {
      await withLinkedWorktree(
        'blackhole-hook-839-',
        async (mainRepo) => {
          const target = path.join(unrelated, 'probe.sh');
          const payload = { tool_name: 'Write', tool_input: { file_path: target, content: 'x' }, cwd: mainRepo };
          const result = await runPreToolUseHook(SCRIPT, payload, mainRepo);

          expect(result.exitCode).toBe(2);
          expect(permissionDecision(result.stdout)).toBe('deny');
          expect(permissionReason(result.stdout)).toMatch(/outside/i);
          expect(readHookEvents(mainRepo)[0]).toMatchObject({ tier: 'block', pattern_id: 'outside-worktree' });
        },
        (mainRepo) => {
          writeCampaignConfig(mainRepo, { scratchpad_dir: scratchpad });
          return scratchpad;
        },
      );
    } finally {
      fs.rmSync(unrelated, { recursive: true, force: true });
      fs.rmSync(scratchpad, { recursive: true, force: true });
    }
  });

  // Behavioral guard for `isExistingDirectory` (see its docstring for why a never-created
  // scratchpad directory would otherwise be trusted as its parent): a configured value that does
  // not exist on disk must not be admitted, however narrow the breadth check finds it.
  test('#839: a configured scratchpad_dir that does not exist on disk is not admitted as a containment root', async () => {
    const parent = path.join(fs.realpathSync(os.tmpdir()), `blackhole-839-ghost-${process.pid}-${Date.now()}`);
    fs.mkdirSync(parent, { recursive: true });
    const neverCreated = path.join(parent, 'scratch');
    try {
      await withLinkedWorktree(
        'blackhole-hook-839-',
        async (mainRepo) => {
          const target = path.join(parent, 'sibling.ts');
          const payload = { tool_name: 'Write', tool_input: { file_path: target, content: 'x' }, cwd: mainRepo };
          const result = await runPreToolUseHook(SCRIPT, payload, mainRepo);

          expect(result.exitCode).toBe(2);
          expect(permissionDecision(result.stdout)).toBe('deny');
          expect(permissionReason(result.stdout)).toMatch(/outside/i);
        },
        (mainRepo) => {
          writeCampaignConfig(mainRepo, { scratchpad_dir: neverCreated });
          return path.join(mainRepo, '.worktrees');
        },
      );
    } finally {
      fs.rmSync(parent, { recursive: true, force: true });
    }
  });

  // Same existence requirement on the env-override leg, which is admitted as a root the same way
  // — one predicate, both legs, so neither can drift into trusting a parent it never named.
  test('#839: BLACKHOLE_SCRATCHPAD_DIR pointing at a directory that does not exist is not admitted as a containment root', async () => {
    const parent = path.join(fs.realpathSync(os.tmpdir()), `blackhole-839-env-ghost-${process.pid}-${Date.now()}`);
    fs.mkdirSync(parent, { recursive: true });
    const neverCreated = path.join(parent, 'scratch');
    try {
      await withLinkedWorktree('blackhole-hook-839-', async (mainRepo, worktree) => {
        const target = path.join(parent, 'sibling.ts');
        const payload = { tool_name: 'Write', tool_input: { file_path: target, content: 'x' }, cwd: worktree };
        const result = await runPreToolUseHook(
          SCRIPT,
          payload,
          worktree,
          PRETOOLUSE_HOOKS_DIR,
          undefined,
          undefined,
          neverCreated,
        );

        expect(result.exitCode).toBe(2);
        expect(permissionDecision(result.stdout)).toBe('deny');
        expect(permissionReason(result.stdout)).toMatch(/outside/i);
      });
    } finally {
      fs.rmSync(parent, { recursive: true, force: true });
    }
  });

  /** Runs `fn` with `process.env.HOME` pointed at `home`, restoring it unconditionally.
   * `isAcceptableScratchpadDir` compares against $HOME, and the two symlink cases below need a
   * home directory the fixture controls rather than the real one, whose own path may already be
   * denied by an unrelated system-path pattern. `runPreToolUseHook` forwards `process.env` to the
   * subprocess only when it is given an override to merge in; with no override the spawn inherits
   * the real environ, which does not carry a mutation made to `process.env` — so both cases below
   * pass one (the config leg pins the event sink it would have resolved to anyway). */
  const withHome = async <T>(home: string, fn: () => Promise<T>): Promise<T> => {
    const previous = process.env.HOME;
    process.env.HOME = home;
    try {
      return await fn();
    } finally {
      if (previous === undefined) delete process.env.HOME;
      else process.env.HOME = previous;
    }
  };

  // A scratchpad value whose breadth is invisible until its symlinks are followed: the literal
  // path is a narrow-looking directory under the temp root, but it resolves to $HOME. Containment
  // compares resolved paths (`isUnderRoot`), so a breadth check reading only the literal value
  // admits a root that trusts the whole home subtree — the two must judge the same directory.
  test('#839: a scratchpad_dir symlinked to $HOME is not admitted as a containment root', async () => {
    const stamp = `${process.pid}-${Date.now()}`;
    const fakeHome = path.join(fs.realpathSync(os.tmpdir()), `blackhole-839-home-${stamp}`);
    const scratchpadLink = path.join(fs.realpathSync(os.tmpdir()), `blackhole-839-home-link-${stamp}`);
    fs.mkdirSync(fakeHome, { recursive: true });
    fs.symlinkSync(fakeHome, scratchpadLink);
    try {
      await withHome(fakeHome, () =>
        withLinkedWorktree(
          'blackhole-hook-839-',
          async (mainRepo) => {
            const target = path.join(fakeHome, '.ssh', 'authorized_keys');
            const payload = { tool_name: 'Write', tool_input: { file_path: target, content: 'x' }, cwd: mainRepo };
            const result = await runPreToolUseHook(
              SCRIPT,
              payload,
              mainRepo,
              PRETOOLUSE_HOOKS_DIR,
              path.join(mainRepo, '.blackhole', 'hook-events'),
            );

            expect(result.exitCode).toBe(2);
            expect(permissionDecision(result.stdout)).toBe('deny');
            expect(permissionReason(result.stdout)).toMatch(/outside/i);
            expect(readHookEvents(mainRepo)[0]).toMatchObject({ tier: 'block', pattern_id: 'outside-worktree' });
          },
          (mainRepo) => {
            writeCampaignConfig(mainRepo, { scratchpad_dir: scratchpadLink });
            return path.join(mainRepo, '.worktrees');
          },
        ),
      );
    } finally {
      fs.rmSync(scratchpadLink, { force: true });
      fs.rmSync(fakeHome, { recursive: true, force: true });
    }
  });

  // Same symlinked-breadth case on the env-override leg, which reaches the same predicate — one
  // breadth check, both legs, so neither can be widened by a value the other would reject.
  //
  // #907: cwd is inside a linked worktree here, so the new cwd-derived tier now evaluates first;
  // it sees `BLACKHOLE_SCRATCHPAD_DIR` declared-but-invalid (symlinked to $HOME) and defers
  // (returns null) rather than silently dropping it, so the same `allWorktreeRoots` breadth
  // check as before does the denying — deny outcome and pattern_id both unchanged.
  test('#839: BLACKHOLE_SCRATCHPAD_DIR symlinked to $HOME is not admitted as a containment root', async () => {
    const stamp = `${process.pid}-${Date.now()}`;
    const fakeHome = path.join(fs.realpathSync(os.tmpdir()), `blackhole-839-env-home-${stamp}`);
    const scratchpadLink = path.join(fs.realpathSync(os.tmpdir()), `blackhole-839-env-home-link-${stamp}`);
    fs.mkdirSync(fakeHome, { recursive: true });
    fs.symlinkSync(fakeHome, scratchpadLink);
    try {
      await withHome(fakeHome, () =>
        withLinkedWorktree('blackhole-hook-839-', async (mainRepo, worktree) => {
          const target = path.join(fakeHome, '.ssh', 'authorized_keys');
          const payload = { tool_name: 'Write', tool_input: { file_path: target, content: 'x' }, cwd: worktree };
          const result = await runPreToolUseHook(
            SCRIPT,
            payload,
            worktree,
            PRETOOLUSE_HOOKS_DIR,
            undefined,
            undefined,
            scratchpadLink,
          );

          expect(result.exitCode).toBe(2);
          expect(permissionDecision(result.stdout)).toBe('deny');
          expect(permissionReason(result.stdout)).toMatch(/outside/i);
          expect(readHookEvents(mainRepo)[0]).toMatchObject({ tier: 'block', pattern_id: 'outside-worktree' });
        }),
      );
    } finally {
      fs.rmSync(scratchpadLink, { force: true });
      fs.rmSync(fakeHome, { recursive: true, force: true });
    }
  });

  // When BLACKHOLE_ASSIGNED_WORKTREE is set to a registered family worktree, containment
  // narrows to that single root — writes inside it are allowed, writes to the main clone or a
  // sibling worktree are denied with outside-assigned-worktree. Unset or invalid env → fail-open
  // to today's all-roots containment (no regression for orchestrator / non-campaign sessions).
  test('#620: assigned worktree env allows writes inside the assigned root only', async () => {
    await withLinkedWorktree('blackhole-hook-620-', async (mainRepo, worktree) => {
      const inside = path.join(worktree, 'src', 'foo.ts');
      const payload = { tool_name: 'Write', tool_input: { file_path: inside, content: 'x' }, cwd: worktree };
      const result = await runPreToolUseHook(SCRIPT, payload, worktree, PRETOOLUSE_HOOKS_DIR, undefined, worktree);

      expect(result.exitCode).toBe(0);
      expect(result.stdout.trim()).toBe('');
      expect(readHookEvents(mainRepo)).toEqual([]);
    });
  });

  test('#620: assigned worktree env denies a write to the main clone', async () => {
    await withLinkedWorktree('blackhole-hook-620-', async (mainRepo, worktree) => {
      const target = path.join(mainRepo, 'src', 'main-only.ts');
      const payload = { tool_name: 'Write', tool_input: { file_path: target, content: 'x' }, cwd: worktree };
      const result = await runPreToolUseHook(SCRIPT, payload, worktree, PRETOOLUSE_HOOKS_DIR, undefined, worktree);

      expect(result.exitCode).toBe(2);
      expect(permissionReason(result.stdout)).toMatch(/assigned worktree/i);
      expect(readHookEvents(mainRepo)[0]).toMatchObject({
        tier: 'block',
        pattern_id: 'outside-assigned-worktree',
      });
    });
  });

  test('#620: assigned worktree env denies a write to a sibling worktree', async () => {
    await withLinkedWorktree('blackhole-hook-620-', async (mainRepo, worktree1) => {
      const siblingParent = path.join(mainRepo, '.worktrees');
      const worktree2 = path.join(siblingParent, `blackhole-hook-620-sibling-${process.pid}`);
      spawnSync('git', ['worktree', 'add', '--detach', '--quiet', worktree2], { cwd: mainRepo });
      const sibling = fs.realpathSync(worktree2);
      try {
        const target = path.join(sibling, 'sibling.ts');
        const payload = { tool_name: 'Write', tool_input: { file_path: target, content: 'x' }, cwd: worktree1 };
        const result = await runPreToolUseHook(
          SCRIPT,
          payload,
          worktree1,
          PRETOOLUSE_HOOKS_DIR,
          undefined,
          worktree1,
        );

        expect(result.exitCode).toBe(2);
        expect(readHookEvents(mainRepo)[0]).toMatchObject({
          tier: 'block',
          pattern_id: 'outside-assigned-worktree',
        });
      } finally {
        spawnSync('git', ['worktree', 'remove', '--force', worktree2], { cwd: mainRepo });
        fs.rmSync(worktree2, { recursive: true, force: true });
      }
    });
  });

  // #907 (TDD red-before-green — Task 1): a worker's hook subprocess resolves `cwd` inside its
  // own linked worktree with no `BLACKHOLE_ASSIGNED_WORKTREE` declared at all — exactly Pattern
  // C's shape, since the native `Agent`/`Workflow` tool never exports that env var to a spawned
  // worker (`orchestrator-dispatch.md`). Before the cwd-derived tier existed this fell open to
  // `allWorktreeRoots(cwd)`, which lists the main clone as a trusted family member, so the write
  // succeeded — the confirmed incident this issue closes. Superseded here what was previously
  // named "fail-open baseline": that baseline was the bug, not a contract to preserve. Verified
  // failing against `plan_base_commit` (write allowed, no denial) before the Task 3 fix landed —
  // captured verbatim in the PR body per `V-UNFALSIFIABLE-01`.
  test('#907: cwd-derived containment denies a main-clone write when cwd is inside a linked worktree, env unset', async () => {
    await withLinkedWorktree('blackhole-hook-907-', async (mainRepo, worktree) => {
      const target = path.join(mainRepo, 'src', 'main-only.ts');
      const payload = { tool_name: 'Write', tool_input: { file_path: target, content: 'x' }, cwd: worktree };
      const result = await runPreToolUseHook(SCRIPT, payload, worktree);

      expect(result.exitCode).toBe(2);
      expect(permissionDecision(result.stdout)).toBe('deny');
      expect(permissionReason(result.stdout)).toMatch(/assigned worktree/i);
      expect(readHookEvents(mainRepo)[0]).toMatchObject({
        tier: 'block',
        pattern_id: 'outside-assigned-worktree',
      });
    });
  });

  // #907: an invalid/garbage BLACKHOLE_ASSIGNED_WORKTREE value must not grant *more* access than
  // no declaration at all — both fall through to the same cwd-derived tier above, so a stale or
  // mistyped declaration narrows exactly like the unset case rather than reopening the bug this
  // issue closes.
  test('#907: cwd-derived containment denies a main-clone write when the assigned worktree env is garbage', async () => {
    await withLinkedWorktree('blackhole-hook-907-', async (mainRepo, worktree) => {
      const target = path.join(mainRepo, 'src', 'main-only.ts');
      const payload = { tool_name: 'Write', tool_input: { file_path: target, content: 'x' }, cwd: worktree };
      const garbage = path.join(fs.realpathSync(os.tmpdir()), `blackhole-907-garbage-${process.pid}`);
      const result = await runPreToolUseHook(SCRIPT, payload, worktree, PRETOOLUSE_HOOKS_DIR, undefined, garbage);

      expect(result.exitCode).toBe(2);
      expect(permissionDecision(result.stdout)).toBe('deny');
      expect(readHookEvents(mainRepo)[0]).toMatchObject({
        tier: 'block',
        pattern_id: 'outside-assigned-worktree',
      });
    });
  });

  // #907 regression (Task 5, Critic A's finding): the new cwd-derived tier must never fire when
  // `cwd` resolves to the main clone itself — the orchestrator's/`planner`'s/`investigator`'s/
  // `hunter`'s legitimate case. Behavior stays byte-identical to today's `allWorktreeRoots(cwd)`
  // fallback: a write anywhere else in the registered family (a sibling worktree here) is still
  // allowed.
  test('#907: cwd resolving to the main clone itself is unaffected by the new cwd-derived tier (allow case)', async () => {
    await withLinkedWorktree('blackhole-hook-907-', async (mainRepo, worktree) => {
      const target = path.join(worktree, 'src', 'foo.ts');
      const payload = { tool_name: 'Write', tool_input: { file_path: target, content: 'x' }, cwd: mainRepo };
      const result = await runPreToolUseHook(SCRIPT, payload, mainRepo);

      expect(result.exitCode).toBe(0);
      expect(result.stdout.trim()).toBe('');
      expect(readHookEvents(mainRepo)).toEqual([]);
    });
  });

  // #907 regression (Task 5, discriminating case): the allow-case test above cannot by itself
  // distinguish "the cwd-derived tier correctly declined to narrow" from "it narrowed to
  // `mainRepo` and got lucky because the target happened to be nested under it too" — both
  // produce the same allow outcome when nothing configured is outside `mainRepo`. Denying a
  // target genuinely outside the whole registered family isolates the distinction instead: a
  // narrowing bug would return `mainRepo` as a non-null assigned root (reclassifying the deny as
  // `outside-assigned-worktree`), while the correct null return here still falls through to
  // `allWorktreeRoots`'s `outside-worktree` classification, unchanged from before #907.
  test('#907: cwd resolving to the main clone itself is unaffected by the new cwd-derived tier (deny classification unchanged)', async () => {
    const elsewhere = path.join(fs.realpathSync(os.tmpdir()), `blackhole-907-elsewhere-${process.pid}-${Date.now()}`);
    fs.mkdirSync(elsewhere, { recursive: true });
    try {
      await withLinkedWorktree('blackhole-hook-907-', async (mainRepo) => {
        const target = path.join(elsewhere, 'pwned.ts');
        const payload = { tool_name: 'Write', tool_input: { file_path: target, content: 'x' }, cwd: mainRepo };
        const result = await runPreToolUseHook(SCRIPT, payload, mainRepo);

        expect(result.exitCode).toBe(2);
        expect(permissionDecision(result.stdout)).toBe('deny');
        expect(readHookEvents(mainRepo)[0]).toMatchObject({ tier: 'block', pattern_id: 'outside-worktree' });
      });
    } finally {
      fs.rmSync(elsewhere, { recursive: true, force: true });
    }
  });

  // #907 regression (Task 4): the cwd-derived tier must never drop the validated scratchpad-root
  // inclusion #510/#729 already guarantee for `allWorktreeRoots` — a worker whose own worktree is
  // nested under a validated `scratchpad_dir` can still write to that scratchpad root itself (a
  // shared coordination file placed directly at it, not nested under any one worktree).
  test('#907: cwd-derived tier preserves scratchpad-root access when cwd is inside a scratchpad-nested worktree', async () => {
    const scratchpad = path.join(fs.realpathSync(os.tmpdir()), `blackhole-907-scratch-${process.pid}-${Date.now()}`);
    try {
      await withLinkedWorktree(
        'blackhole-hook-907-',
        async (mainRepo, worktree) => {
          const target = path.join(scratchpad, 'shared-coordination.json');
          const payload = { tool_name: 'Write', tool_input: { file_path: target, content: 'x' }, cwd: worktree };
          const result = await runPreToolUseHook(SCRIPT, payload, worktree);

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

  // A malformed stdin payload used to be swallowed into `{}`, which
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

  // Outside a git context, `allWorktreeRoots` has nothing to resolve, so the check falls
  // back to bounding writes to the payload's own cwd subtree rather than skipping containment
  // outright. The pattern-based system-path checks never depended on git
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

  // Outside a git context, a write inside the payload cwd's own subtree is the routine case
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

  // Outside a git context, a target that matches no
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

  // A Write target that is itself a symlink escaping the payload cwd subtree, with no git
  // context, must also be denied — the same leaf-resolution handling applies to the cwd
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

  // The cwd fallback bound is only as narrow as `cwd` itself. A session whose
  // cwd resolves to a bare temp root is no narrower than accepting everything — the same
  // breadth check already applied to `scratchpad_dir`, reusing `isAcceptableScratchpadDir`
  // rather than a second breadth check. Must be refused, not silently trusted as a
  // containment root.
  test('#512: outside a git repo, a cwd resolving to a bare temp root is too broad to trust as a fallback bound', async () => {
    const bareTmp = fs.realpathSync(os.tmpdir());
    const target = path.join(bareTmp, `blackhole-512-broad-${process.pid}.ts`);

    const result = await runPreToolUseHook(SCRIPT, writePayload(target), bareTmp);

    expect(result.exitCode).toBe(2);
    expect(permissionDecision(result.stdout)).toBe('deny');
    expect(permissionReason(result.stdout)).toMatch(/too broad/i);
  });

  // #729: BLACKHOLE_SCRATCHPAD_DIR is an opt-in override for the Claude Code harness's own
  // per-session scratchpad directory — never a git worktree, so it never appears in `git
  // worktree list` output at all and is admitted as an additional trusted root only when the env
  // var is explicitly set, validated through the same `isAcceptableScratchpadDir` breadth check
  // `scratchpad_dir` already uses (no second bespoke check, V-INT-02).
  test('#729: BLACKHOLE_SCRATCHPAD_DIR, when set and valid, admits a write to an unrelated scratchpad directory', async () => {
    const scratchpad = path.join(fs.realpathSync(os.tmpdir()), `blackhole-729-scratch-${process.pid}-${Date.now()}`);
    fs.mkdirSync(scratchpad, { recursive: true });
    try {
      await withLinkedWorktree('blackhole-hook-729-', async (mainRepo, worktree) => {
        const target = path.join(scratchpad, 'notes.md');
        const payload = { tool_name: 'Write', tool_input: { file_path: target, content: 'x' }, cwd: worktree };
        const result = await runPreToolUseHook(
          SCRIPT,
          payload,
          worktree,
          PRETOOLUSE_HOOKS_DIR,
          undefined,
          undefined,
          scratchpad,
        );

        expect(result.exitCode).toBe(0);
        expect(result.stdout.trim()).toBe('');
      });
    } finally {
      fs.rmSync(scratchpad, { recursive: true, force: true });
    }
  });

  // #729: absent the opt-in, the same harness-scratchpad-shaped target stays denied — no silent
  // full auto-detection of a `/tmp/claude-<uid>/...`-shaped path. Only an explicitly-set env var
  // widens containment; the shape alone never does.
  //
  // #907: cwd is inside a linked worktree here with no env var at all set, so the new cwd-derived
  // tier now narrows to the worktree itself (no scratchpad candidate present, nothing to defer
  // to) — the write is still denied, now classified `outside-assigned-worktree` rather than
  // `outside-worktree` since an assigned root is present. Deny outcome unchanged.
  test('#729: without BLACKHOLE_SCRATCHPAD_DIR set, an unrelated scratchpad-shaped directory is still denied', async () => {
    const scratchpad = path.join(fs.realpathSync(os.tmpdir()), `blackhole-729-scratch-${process.pid}-${Date.now()}`);
    fs.mkdirSync(scratchpad, { recursive: true });
    try {
      await withLinkedWorktree('blackhole-hook-729-', async (mainRepo, worktree) => {
        const target = path.join(scratchpad, 'notes.md');
        const payload = { tool_name: 'Write', tool_input: { file_path: target, content: 'x' }, cwd: worktree };
        const result = await runPreToolUseHook(SCRIPT, payload, worktree);

        expect(result.exitCode).toBe(2);
        expect(permissionDecision(result.stdout)).toBe('deny');
        expect(permissionReason(result.stdout)).toMatch(/outside/i);
        expect(readHookEvents(mainRepo)[0]).toMatchObject({ tier: 'block', pattern_id: 'outside-assigned-worktree' });
      });
    } finally {
      fs.rmSync(scratchpad, { recursive: true, force: true });
    }
  });
});

// Uncaught-exception fail-open regression: a non-string `file_path` reaches
// `hook-event-log.js`'s `resolveExistingAncestor` (line 96, `path.resolve(p)`, reached via
// `isUnderRoot`←`isInsideAnyRoot` from the worktree-containment check at main() line 101) and
// throws a `TypeError` outside every existing try/catch. An uncaught exception here falls
// through to bun's default exit 1 — the wrapper's (claude-native-settings.ts) fail-OPEN
// condition — converting what should be a refusal into a silent allow of the V-SEC-11 gate.
// Every non-string shape is exercised, not just one, to prove the fix closes the defect class
// rather than a single type.
describe('validate-file-changes.js — uncaught validator crash fails closed, not open (#580)', () => {
  const NON_STRING_FILE_PATH: unknown[] = [12345, ['a'], {}, true];

  for (const filePath of NON_STRING_FILE_PATH) {
    test(`a non-string file_path (${JSON.stringify(filePath)}) reaching the worktree-containment check fails closed, not open`, async () => {
      await withTempGitRepo('blackhole-hook-580-', async (repo) => {
        const payload = { tool_name: 'Write', tool_input: { file_path: filePath, content: 'x' } };
        const result = await runPreToolUseHook(SCRIPT, payload, repo);

        expect(result.exitCode).toBe(2);
        expect(permissionDecision(result.stdout)).toBe('deny');
        expect(permissionReason(result.stdout)).not.toMatch(/could not be loaded/i);
        expect(permissionReason(result.stdout)).toMatch(/threw while running/i);

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

// Issue #864: `allWorktreeRoots` used to map every git failure — "not a git repository" (the
// routine case a session outside any repo produces, covered by the #512 tests above) AND any
// other, anomalous failure (git binary missing, a corrupted `.git`, a permissions error) — onto
// the same `null` return, which the containment check reads as "no git context" and bounds the
// write to the payload's own cwd instead of denying it outright. That is the wrong bound for an
// anomalous failure: the check has no actual evidence the target is safe, only that git could not
// be asked. A first attempt at fixing this special-cased exit code 128 ("not a git repository"),
// but git's own `fatal()` bucket produces that identical exit code and message for BOTH "no
// repository at all" and "a repository is here but its `.git/HEAD` is missing, or `.git/config`
// is malformed, or a needed revision can't be resolved" — no exit code or message substring can
// tell those apart, because git itself never makes that distinction on this path. The actual fix
// checks a fact independent of the failing call instead: does a `.git` marker exist anywhere in
// `cwd`'s ancestor chain (`hasGitMarkerInAncestry`)? Absent → routine, fail open to the #512 cwd
// bound; present → git is broken over a repository that is really there, so the hook fails closed.
// The first test below simulates the "no `.git` at all" shape by making `git` itself unresolvable
// via `PATH`, which raises `ENOENT` (no exit code at all) — bypasses `runPreToolUseHook` (which
// does not expose a `PATH` override) the same way the malformed-stdin test above does. The two
// tests after it simulate "a `.git` IS there and git is genuinely broken" directly, by corrupting
// a real repo's `.git` state before invoking the hook normally.
describe('validate-file-changes.js — anomalous git failure fails closed, not open to cwd (#864)', () => {
  test('git missing from PATH inside a real repo denies the write instead of falling back to the cwd bound', async () => {
    await withTempGitRepo('blackhole-hook-864-', async (repo) => {
      // A target outside the repo's own subtree — under the #512 cwd-fallback bound (the wrong
      // outcome this fix removes) this exact target would be ALLOWED, since it resolves inside
      // `repo` when treated as "no git context, bound to cwd". The pre-fix behavior for this test
      // would therefore be exit 0 / no denial; the point of the assertion is that it must not be.
      const target = path.join(repo, 'nested', 'foo.ts');
      const bunOnlyPath = path.dirname(process.execPath);
      // Pins the event sink explicitly (bypassing `recordEvent`'s own `mainCloneRoot(cwd)` call)
      // so the recorded-event assertion below is not itself confounded by the same
      // git-unavailable condition this test exists to exercise — `recordEvent` already treats an
      // unresolvable main clone as "no git context, skip recording" (a separate, narrower
      // swallow than #864's, out of this fix's five named sites) rather than failing closed.
      const eventDir = path.join(repo, '.blackhole', 'hook-events');

      const proc = Bun.spawn({
        cmd: ['bun', 'run', path.join(PRETOOLUSE_HOOKS_DIR, SCRIPT)],
        stdin: new Blob([JSON.stringify(writePayload(target))]),
        stdout: 'pipe',
        stderr: 'pipe',
        cwd: repo,
        env: { ...process.env, PATH: bunOnlyPath, BLACKHOLE_HOOK_EVENT_DIR: eventDir },
      });
      const [exitCode, stdout, stderr] = await Promise.all([
        proc.exited,
        new Response(proc.stdout).text(),
        new Response(proc.stderr).text(),
      ]);

      expect(exitCode).toBe(2);
      expect(permissionDecision(stdout)).toBe('deny');
      expect(permissionReason(stdout)).toMatch(/worktree containment resolution/i);
      expect(stderr).toMatch(/ENOENT|not found/i);

      const events = readHookEvents(repo);
      expect(events).toHaveLength(1);
      expect(events[0]).toMatchObject({
        hook: 'validate-file-changes',
        tool: 'Write',
        decision: 'deny',
        tier: 'block',
        pattern_id: 'worktree-root-resolution-failure',
      });
    });
  });

  // The ENOENT case above is the one shape `error.status` can actually distinguish (no `.status`
  // at all, since `execFileSync` never spawned a git process). It is not the shape the finding
  // that reopened this issue was about: a REAL repository whose git-managed state has gone
  // corrupt fails with `git`'s generic exit 128 — the exact same exit code and message a routine
  // "no repository at all" cwd produces (`is_git_directory()` conflates "missing" and "unreadable"
  // HEAD on this path; see `hasGitMarkerInAncestry`'s docstring). These two cases are why the fix
  // no longer inspects the failing call's exit code at all — it checks a `.git` marker on disk
  // instead, which is present in both cases below and absent in none of the #512 routine cases.
  test('a real repo with .git/HEAD removed denies the write instead of falling back to the cwd bound', async () => {
    await withTempGitRepo('blackhole-hook-864-head-', async (repo) => {
      fs.rmSync(path.join(repo, '.git', 'HEAD'));

      const target = path.join(repo, 'nested', 'foo.ts');
      const eventDir = path.join(repo, '.blackhole', 'hook-events');
      const result = await runPreToolUseHook(SCRIPT, writePayload(target), repo, PRETOOLUSE_HOOKS_DIR, eventDir);

      expect(result.exitCode).toBe(2);
      expect(permissionDecision(result.stdout)).toBe('deny');
      expect(permissionReason(result.stdout)).toMatch(/worktree containment resolution/i);
      expect(result.stderr).toMatch(/git worktree list/i);

      const events = readHookEvents(repo);
      expect(events).toHaveLength(1);
      expect(events[0]).toMatchObject({
        hook: 'validate-file-changes',
        tool: 'Write',
        decision: 'deny',
        tier: 'block',
        pattern_id: 'worktree-root-resolution-failure',
      });
    });
  });

  test('a real repo with a malformed .git/config denies the write instead of falling back to the cwd bound', async () => {
    await withTempGitRepo('blackhole-hook-864-config-', async (repo) => {
      fs.appendFileSync(path.join(repo, '.git', 'config'), 'this is not a valid config line\n');

      const target = path.join(repo, 'nested', 'foo.ts');
      const eventDir = path.join(repo, '.blackhole', 'hook-events');
      const result = await runPreToolUseHook(SCRIPT, writePayload(target), repo, PRETOOLUSE_HOOKS_DIR, eventDir);

      expect(result.exitCode).toBe(2);
      expect(permissionDecision(result.stdout)).toBe('deny');
      expect(permissionReason(result.stdout)).toMatch(/worktree containment resolution/i);
      expect(result.stderr).toMatch(/git worktree list/i);

      const events = readHookEvents(repo);
      expect(events).toHaveLength(1);
      expect(events[0]).toMatchObject({
        hook: 'validate-file-changes',
        tool: 'Write',
        decision: 'deny',
        tier: 'block',
        pattern_id: 'worktree-root-resolution-failure',
      });
    });
  });
});

// `mainCloneRoot` (hook-event-log.js:79) used to map every git failure onto the same `null`
// return that `recordEvent` reads as "no git context, nothing to record" — collapsing the
// routine case (no repository here at all) into the anomalous one (a repository is here and git
// itself is broken), the same conflation `allWorktreeRoots` had before its own fix above. These
// are direct unit tests of `mainCloneRoot` itself, called in-process through a `require()` of the
// hook module (the module ships CommonJS, unbundled, and exports the function under test — no
// other suite needs a non-subprocess call into it yet), rather than through the subprocess
// harness the rest of this file uses: the discrimination under test is a return-vs-throw contract
// on one function, which a subprocess boundary can only observe indirectly through exit codes and
// stderr text — exactly the ambiguity `hasGitMarkerInAncestry`'s own docstring above says cannot
// be recovered from a failing git call. Reuses `hasGitMarkerInAncestry`
// (`allWorktreeRoots:263-272`), never re-derives the discrimination (V-INT-02).
describe('mainCloneRoot — routine absence vs. anomalous git failure (#889)', () => {
  const hookEventLog = require(path.join(PRETOOLUSE_HOOKS_DIR, 'utils', 'hook-event-log.js'));

  test('a real repo with .git/HEAD removed throws instead of returning null', async () => {
    await withTempGitRepo('blackhole-hook-889-head-', async (repo) => {
      fs.rmSync(path.join(repo, '.git', 'HEAD'));
      expect(() => hookEventLog.mainCloneRoot(repo)).toThrow();
    });
  });

  test('a directory with no .git anywhere in its ancestry returns null', async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'blackhole-hook-889-none-'));
    try {
      expect(hookEventLog.mainCloneRoot(dir)).toBeNull();
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  test('a healthy repo resolves its own root, and a linked worktree resolves the main clone, not itself', async () => {
    await withLinkedWorktree('blackhole-hook-889-healthy-', async (mainRepo, worktree) => {
      const realMain = fs.realpathSync(mainRepo);
      expect(hookEventLog.mainCloneRoot(mainRepo)).toBe(realMain);
      expect(hookEventLog.mainCloneRoot(worktree)).toBe(realMain);
    });
  });
});

// Issue #870 — sibling mercure defer/stay-active/fail-closed matrix, mirrored from
// hooks-validate-bash.test.ts for the Write|Edit validator. See that file's own describe block
// docstring for the full rationale; assertions here use the system-path block tier
// (`/etc/passwd`) as the "normal checks still run" probe in place of `rm -rf /`.
describe('validate-file-changes.js — sibling mercure defer (#870)', () => {
  test('defer: sibling mercure registered + no .blackhole/config.json → allow silently, one defer event', async () => {
    const claudeHome = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'blackhole-hook-870-home-')));
    try {
      writeInstalledPlugins(claudeHome, ['mercure@some-marketplace']);
      await withTempGitRepo('blackhole-hook-870-', async (repo) => {
        const result = await runPreToolUseHook(
          SCRIPT,
          writePayload('/etc/passwd'),
          repo,
          PRETOOLUSE_HOOKS_DIR,
          undefined,
          undefined,
          undefined,
          undefined,
          claudeHome,
        );

        expect(result.exitCode).toBe(0);
        expect(result.stdout.trim()).toBe('');

        const events = readHookEvents(repo);
        expect(events).toHaveLength(1);
        expect(events[0]).toMatchObject({
          hook: 'validate-file-changes',
          tool: 'Write',
          decision: 'allow',
          tier: 'defer',
          pattern_id: 'sibling-plugin-defer',
        });
      });
    } finally {
      fs.rmSync(claudeHome, { recursive: true, force: true });
    }
  });

  test('stay-active: sibling mercure registered but .blackhole/config.json present → normal checks still run', async () => {
    const claudeHome = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'blackhole-hook-870-home-')));
    try {
      writeInstalledPlugins(claudeHome, ['mercure@some-marketplace']);
      await withTempGitRepo('blackhole-hook-870-', async (repo) => {
        writeCampaignConfig(repo, { repo: 'owner/name' });
        const result = await runPreToolUseHook(
          SCRIPT,
          writePayload('/etc/passwd'),
          repo,
          PRETOOLUSE_HOOKS_DIR,
          undefined,
          undefined,
          undefined,
          undefined,
          claudeHome,
        );

        expect(result.exitCode).toBe(2);
        expect(permissionDecision(result.stdout)).toBe('deny');
        const events = readHookEvents(repo);
        expect(events).toHaveLength(1);
        expect(events[0]).toMatchObject({ tier: 'block', pattern_id: 'etc' });
      });
    } finally {
      fs.rmSync(claudeHome, { recursive: true, force: true });
    }
  });

  test('stay-active: no key whose @-split segment is mercure → normal checks still run', async () => {
    const claudeHome = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'blackhole-hook-870-home-')));
    try {
      writeInstalledPlugins(claudeHome, ['frontend-design@claude-plugins-official']);
      await withTempGitRepo('blackhole-hook-870-', async (repo) => {
        const result = await runPreToolUseHook(
          SCRIPT,
          writePayload('/etc/passwd'),
          repo,
          PRETOOLUSE_HOOKS_DIR,
          undefined,
          undefined,
          undefined,
          undefined,
          claudeHome,
        );

        expect(result.exitCode).toBe(2);
        expect(permissionDecision(result.stdout)).toBe('deny');
      });
    } finally {
      fs.rmSync(claudeHome, { recursive: true, force: true });
    }
  });

  test('stay-active (fail-closed): installed_plugins.json absent → normal checks still run', async () => {
    const claudeHome = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'blackhole-hook-870-home-')));
    try {
      await withTempGitRepo('blackhole-hook-870-', async (repo) => {
        const result = await runPreToolUseHook(
          SCRIPT,
          writePayload('/etc/passwd'),
          repo,
          PRETOOLUSE_HOOKS_DIR,
          undefined,
          undefined,
          undefined,
          undefined,
          claudeHome,
        );

        expect(result.exitCode).toBe(2);
        expect(permissionDecision(result.stdout)).toBe('deny');
      });
    } finally {
      fs.rmSync(claudeHome, { recursive: true, force: true });
    }
  });

  test('stay-active (fail-closed): installed_plugins.json present but malformed JSON → normal checks still run', async () => {
    const claudeHome = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'blackhole-hook-870-home-')));
    try {
      fs.mkdirSync(path.join(claudeHome, 'plugins'), { recursive: true });
      fs.writeFileSync(path.join(claudeHome, 'plugins', 'installed_plugins.json'), '{ not json', 'utf-8');
      await withTempGitRepo('blackhole-hook-870-', async (repo) => {
        const result = await runPreToolUseHook(
          SCRIPT,
          writePayload('/etc/passwd'),
          repo,
          PRETOOLUSE_HOOKS_DIR,
          undefined,
          undefined,
          undefined,
          undefined,
          claudeHome,
        );

        expect(result.exitCode).toBe(2);
        expect(permissionDecision(result.stdout)).toBe('deny');
      });
    } finally {
      fs.rmSync(claudeHome, { recursive: true, force: true });
    }
  });

  test('stay-active (fail-closed): no git context at all → normal checks still run', async () => {
    const claudeHome = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'blackhole-hook-870-home-')));
    const nonRepo = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'blackhole-hook-870-nogit-')));
    try {
      writeInstalledPlugins(claudeHome, ['mercure@some-marketplace']);
      const result = await runPreToolUseHook(
        SCRIPT,
        writePayload('/etc/passwd'),
        nonRepo,
        PRETOOLUSE_HOOKS_DIR,
        undefined,
        undefined,
        undefined,
        undefined,
        claudeHome,
      );

      expect(result.exitCode).toBe(2);
      expect(permissionDecision(result.stdout)).toBe('deny');
    } finally {
      fs.rmSync(claudeHome, { recursive: true, force: true });
      fs.rmSync(nonRepo, { recursive: true, force: true });
    }
  });

  test('negative control: a key like `notmercure@x` does not trigger the defer branch (precision, not substring match)', async () => {
    const claudeHome = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'blackhole-hook-870-home-')));
    try {
      writeInstalledPlugins(claudeHome, ['notmercure@x', 'mercure-fork@x']);
      await withTempGitRepo('blackhole-hook-870-', async (repo) => {
        const result = await runPreToolUseHook(
          SCRIPT,
          writePayload('/etc/passwd'),
          repo,
          PRETOOLUSE_HOOKS_DIR,
          undefined,
          undefined,
          undefined,
          undefined,
          claudeHome,
        );

        expect(result.exitCode).toBe(2);
        expect(permissionDecision(result.stdout)).toBe('deny');
      });
    } finally {
      fs.rmSync(claudeHome, { recursive: true, force: true });
    }
  });
});
