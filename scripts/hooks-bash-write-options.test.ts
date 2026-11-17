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

describe('validate-bash-command.js — #1184 option writers only at the command position', () => {
  test('#1184: `sudo sort -o <outside>` is denied (prefix word skipped)', async () => {
    await withLinkedWorktree('blackhole-hook-1184-', async (mainRepo, worktree) => {
      const result = await run(`sudo sort -o ${path.join(mainRepo, 'out.txt')} a.txt`, worktree);

      expect(result.exitCode).toBe(2);
      expect(readHookEvents(mainRepo)[0]).toMatchObject({ tier: 'block', pattern_id: 'bash-outside-assigned-worktree' });
    });
  });

  test('#1184: `grep uniq a.txt <outside>` reads only and stays allowed (uniq is an argument here)', async () => {
    await withLinkedWorktree('blackhole-hook-1184-', async (mainRepo, worktree) => {
      const result = await run(`grep uniq a.txt ${path.join(mainRepo, 'ref.txt')}`, worktree);

      expect(result.exitCode).toBe(0);
      expect(readHookEvents(mainRepo)).toEqual([]);
    });
  });
});
