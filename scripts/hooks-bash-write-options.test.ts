import { describe, expect, test } from 'bun:test';
import * as path from 'path';
import { PRETOOLUSE_HOOKS_DIR, readHookEvents, runPreToolUseHook, withLinkedWorktree } from './lib/test-fixtures.ts';

// Issue #1184: commands that look read-only but carry a file-writing option (`sort -o`, `uniq`'s
// second positional, `git diff|log|show --output`, `yq -i`) must resolve that option's target
// through the same assigned-worktree containment a `>` redirect gets, and a literal script piped
// into a shell (`echo '…' | sh`) must at least warn. Kept apart from hooks-validate-bash.test.ts
// so parallel hook PRs appending there do not conflict at its end.

const SCRIPT = 'validate-bash-command.js';

const payloadAt = (command: string, cwd: string) => ({
  tool_name: 'Bash',
  tool_input: { command },
  tool_use_id: 'toolu_1184_bash',
  cwd,
});

const run = (command: string, worktree: string) =>
  runPreToolUseHook(SCRIPT, payloadAt(command, worktree), worktree, PRETOOLUSE_HOOKS_DIR, undefined, worktree);

/** Each builder receives an absolute target path and returns a command writing to it. */
const WRITE_OPTION_FORMS: Array<[string, (target: string) => string]> = [
  ['sort -o <target>', (t) => `sort -o ${t} a.txt`],
  ['sort -o<target> (attached)', (t) => `sort -o${t} a.txt`],
  ['sort -ro <target> (cluster)', (t) => `sort -ro ${t} a.txt`],
  ['sort --output=<target>', (t) => `sort --output=${t} a.txt`],
  ['sort --output <target>', (t) => `sort --output ${t} a.txt`],
  ["sort a -o '<target>' (option after operand, quoted)", (t) => `sort a.txt -o '${t}'`],
  ['uniq <in> <target>', (t) => `uniq a.txt ${t}`],
  ['uniq -f 1 <in> <target> (option value skipped)', (t) => `uniq -f 1 a.txt ${t}`],
  ['git diff --output=<target>', (t) => `git diff --output=${t}`],
  ['git log -p --output=<target>', (t) => `git log -p --output=${t}`],
  ['git show --output <target>', (t) => `git show --output ${t} HEAD`],
  ['git -C <dir> diff --output=<target>', (t) => `git -C . diff --output=${t}`],
  ['yq -i <expr> <target>', (t) => `yq -i '.a = 1' ${t}`],
  ['yq --inplace <expr> <target>', (t) => `yq --inplace '.a = 1' ${t}`],
];

describe('validate-bash-command.js — file-writing options of read-only-looking commands (#1184)', () => {
  for (const [label, build] of WRITE_OPTION_FORMS) {
    test(`#1184: ${label} outside the assigned worktree is denied`, async () => {
      await withLinkedWorktree('blackhole-hook-1184-', async (mainRepo, worktree) => {
        const result = await run(build(path.join(mainRepo, 'out.txt')), worktree);

        expect(result.exitCode).toBe(2);
        const events = readHookEvents(mainRepo);
        expect(events).toHaveLength(1);
        expect(events[0]).toMatchObject({ tier: 'block', pattern_id: 'bash-outside-assigned-worktree' });
      });
    });

    test(`#1184: ${label} inside the assigned worktree is allowed silently`, async () => {
      await withLinkedWorktree('blackhole-hook-1184-', async (mainRepo, worktree) => {
        const result = await run(build(path.join(worktree, 'out.txt')), worktree);

        expect(result.exitCode).toBe(0);
        expect(result.stdout.trim()).toBe('');
        expect(readHookEvents(mainRepo)).toEqual([]);
      });
    });
  }

  // Read-only invocations of the same commands must not start warning or blocking.
  for (const command of [
    'sort -k2 -t, a.txt',
    'sort -T /tmp a.txt',
    'uniq a.txt',
    'uniq -c -',
    'git diff --stat',
    'git log --oneline -5',
    "yq '.a' /etc/config.yaml",
  ]) {
    test(`#1184: read-only \`${command}\` stays allowed with no event`, async () => {
      await withLinkedWorktree('blackhole-hook-1184-', async (mainRepo, worktree) => {
        const result = await run(command, worktree);

        expect(result.exitCode).toBe(0);
        expect(result.stdout.trim()).toBe('');
        expect(readHookEvents(mainRepo)).toEqual([]);
      });
    });
  }

  for (const command of [
    "echo 'echo x > /etc/x' | sh",
    "printf 'rm a\\n' | bash",
    "cat <<'EOF' | /bin/bash -s\necho x > /etc/x\nEOF",
  ]) {
    test(`#1184: a script piped into a shell (\`${command.split('\n')[0]}\`) warns and records`, async () => {
      await withLinkedWorktree('blackhole-hook-1184-', async (mainRepo, worktree) => {
        const result = await run(command, worktree);

        expect(result.exitCode).toBe(0);
        const events = readHookEvents(mainRepo);
        expect(events).toHaveLength(1);
        expect(events[0]).toMatchObject({ tier: 'warn', pattern_id: 'bash-write-target-unresolvable' });
      });
    });
  }

  for (const command of ['git status || sh', 'cat a.txt | bash script.sh']) {
    test(`#1184: \`${command}\` is not a piped-script shell and stays allowed with no event`, async () => {
      await withLinkedWorktree('blackhole-hook-1184-', async (mainRepo, worktree) => {
        const result = await run(command, worktree);

        expect(result.exitCode).toBe(0);
        expect(readHookEvents(mainRepo)).toEqual([]);
      });
    });
  }
});

describe('validate-bash-command.js — #1184 option writers behind wrapper words', () => {
  test('#1184: `sudo sort -o <outside>` is denied (prefix word skipped)', async () => {
    await withLinkedWorktree('blackhole-hook-1184-', async (mainRepo, worktree) => {
      const result = await run(`sudo sort -o ${path.join(mainRepo, 'out.txt')} a.txt`, worktree);

      expect(result.exitCode).toBe(2);
      expect(readHookEvents(mainRepo)[0]).toMatchObject({ tier: 'block', pattern_id: 'bash-outside-assigned-worktree' });
    });
  });

  // Review of #1208: the command word is found anywhere in the clause, like tee/sed/cp, so a
  // wrapper with its own value (`nice -n 5`, `timeout 5`) can never hide it. The accepted cost is
  // fail-closed over-tightening: `grep uniq a.txt <outside>` is read as a uniq write and denied.
  for (const build of [
    (t: string) => `nice -n 5 sort -o ${t} a.txt`,
    (t: string) => `timeout 5 sort -o ${t} a.txt`,
    (t: string) => `env X=1 sort -o ${t} a.txt`,
    (t: string) => `grep uniq a.txt ${t}`,
  ]) {
    test(`#1184: \`${build('<outside>')}\` is denied (command word found past any wrapper)`, async () => {
      await withLinkedWorktree('blackhole-hook-1184-', async (mainRepo, worktree) => {
        const result = await run(build(path.join(mainRepo, 'out.txt')), worktree);

        expect(result.exitCode).toBe(2);
        expect(readHookEvents(mainRepo)[0]).toMatchObject({ tier: 'block', pattern_id: 'bash-outside-assigned-worktree' });
      });
    });
  }
});

describe('validate-bash-command.js — #1184 review: git -C and long-option abbreviation', () => {
  test('#1184: `git -C <outside> diff --output=rel.patch` is denied (relative output resolves under -C)', async () => {
    await withLinkedWorktree('blackhole-hook-1184-', async (mainRepo, worktree) => {
      const result = await run(`git -C ${mainRepo} diff --output=rel.patch`, worktree);

      expect(result.exitCode).toBe(2);
      expect(readHookEvents(mainRepo)[0]).toMatchObject({ tier: 'block', pattern_id: 'bash-outside-assigned-worktree' });
    });
  });

  test('#1184: chained `git -C <outside-parent> -C <name> log --output=x` is denied (each -C relative to the last)', async () => {
    await withLinkedWorktree('blackhole-hook-1184-', async (mainRepo, worktree) => {
      const result = await run(`git -C ${path.dirname(mainRepo)} -C ${path.basename(mainRepo)} log --output=x`, worktree);

      expect(result.exitCode).toBe(2);
      expect(readHookEvents(mainRepo)[0]).toMatchObject({ tier: 'block', pattern_id: 'bash-outside-assigned-worktree' });
    });
  });

  test('#1184: `git -C <worktree-subdir> diff --output=rel.patch` stays allowed', async () => {
    await withLinkedWorktree('blackhole-hook-1184-', async (mainRepo, worktree) => {
      const result = await run(`git -C ${worktree} -C sub diff --output=rel.patch`, worktree);

      expect(result.exitCode).toBe(0);
      expect(readHookEvents(mainRepo)).toEqual([]);
    });
  });

  for (const build of [
    (t: string) => `sort --out=${t} a.txt`,
    (t: string) => `sort --outp ${t} a.txt`,
    (t: string) => `sort --o=${t} a.txt`,
    (t: string) => `git diff --outpu=${t}`,
    (t: string) => `uniq --skip-f 1 a.txt ${t}`,
  ]) {
    test(`#1184: abbreviated long option \`${build('<outside>')}\` is denied`, async () => {
      await withLinkedWorktree('blackhole-hook-1184-', async (mainRepo, worktree) => {
        const result = await run(build(path.join(mainRepo, 'out.txt')), worktree);

        expect(result.exitCode).toBe(2);
        expect(readHookEvents(mainRepo)[0]).toMatchObject({ tier: 'block', pattern_id: 'bash-outside-assigned-worktree' });
      });
    });
  }
});

/** Smallest wall time of `runs` calls — the least noisy estimate on a shared host. */
const minOfRuns = (runs: number, fn: () => void): number => {
  let best = Infinity;
  for (let i = 0; i < runs; i++) {
    const start = performance.now();
    fn();
    best = Math.min(best, performance.now() - start);
  }
  return best;
};

describe('bash-write-target-guard.js — #1184 review: linear-time option scan', () => {
  test('#1184: an 80k-character `-iii…` yq flag is evaluated in linear time', async () => {
    await withLinkedWorktree('blackhole-hook-1184-', async (_mainRepo, worktree) => {
      const { evaluateBashWriteTargets } = require(path.join(PRETOOLUSE_HOOKS_DIR, 'utils', 'bash-write-target-guard.js'));
      const command = `yq -${'i'.repeat(80_000)}! a.yaml`;
      // The quadratic regex took ~2.5 s on this input; a linear scan is a few milliseconds.
      expect(minOfRuns(3, () => evaluateBashWriteTargets(command, worktree))).toBeLessThan(250);
    });
  });
});
