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

  test('#620: without assigned worktree env, main-clone writes remain allowed (fail-open baseline)', async () => {
    await withLinkedWorktree('blackhole-hook-620-', async (mainRepo, worktree) => {
      const target = path.join(mainRepo, 'src', 'main-only.ts');
      const payload = { tool_name: 'Write', tool_input: { file_path: target, content: 'x' }, cwd: worktree };
      const result = await runPreToolUseHook(SCRIPT, payload, mainRepo);

      expect(result.exitCode).toBe(0);
      expect(result.stdout.trim()).toBe('');
      expect(readHookEvents(mainRepo)).toEqual([]);
    });
  });

  test('#620: garbage assigned worktree env falls open to all-roots containment', async () => {
    await withLinkedWorktree('blackhole-hook-620-', async (mainRepo, worktree) => {
      const target = path.join(mainRepo, 'src', 'main-only.ts');
      const payload = { tool_name: 'Write', tool_input: { file_path: target, content: 'x' }, cwd: worktree };
      const garbage = path.join(fs.realpathSync(os.tmpdir()), `blackhole-620-garbage-${process.pid}`);
      const result = await runPreToolUseHook(
        SCRIPT,
        payload,
        mainRepo,
        PRETOOLUSE_HOOKS_DIR,
        undefined,
        garbage,
      );

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
        expect(readHookEvents(mainRepo)[0]).toMatchObject({ tier: 'block', pattern_id: 'outside-worktree' });
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
