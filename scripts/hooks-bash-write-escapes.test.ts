import { describe, expect, test } from 'bun:test';
import * as path from 'path';
import { PRETOOLUSE_HOOKS_DIR, readHookEvents, runPreToolUseHook, withLinkedWorktree } from './lib/test-fixtures.ts';

// Issue #1243: the shell removes backslashes and quotes before a command sees its words, so
// `> \/etc/x`, `'sed' -i`, `sed '-i'` and `\cp` write exactly where the plain spelling does. The
// guard must read each word the way the shell will, or warn when it cannot.

const SCRIPT = 'validate-bash-command.js';

const run = (command: string, worktree: string) =>
  runPreToolUseHook(
    SCRIPT,
    { tool_name: 'Bash', tool_input: { command }, tool_use_id: 'toolu_1243_bash', cwd: worktree },
    worktree,
    PRETOOLUSE_HOOKS_DIR,
    undefined,
    worktree,
  );

const guard = () => require(path.join(PRETOOLUSE_HOOKS_DIR, 'utils', 'bash-write-target-guard.js'));

/** Verdict for `build(<main clone>, <worktree>)` evaluated from inside the worktree. */
const verdict = async (build: (main: string, wt: string) => string) => {
  let result: unknown = undefined;
  await withLinkedWorktree('blackhole-hook-1243-', async (mainRepo, worktree) => {
    result = guard().evaluateBashWriteTargets(build(mainRepo, worktree), worktree);
  });
  return result;
};

const BLOCK = { tier: 'block', pattern_id: 'bash-outside-assigned-worktree' };
const WARN = { tier: 'warn', pattern_id: 'bash-write-target-unresolvable' };

/** Each builder receives the main clone path and returns a command that writes into it. */
const ESCAPED_TARGETS: Array<[string, (m: string) => string]> = [
  ['`echo x > \\/etc/x`', () => 'echo x > \\/etc/x'],
  ['`echo x > \\<main>/x`', (m) => `echo x > \\${m}/x`],
  ['`tee \\<main>/x`', (m) => `echo x | tee \\${m}/x`],
  ['`cp a \\<main>/x`', (m) => `cp a \\${m}/x`],
  ['`sed -i s/a/b/ \\<main>/x`', (m) => `sed -i s/a/b/ \\${m}/x`],
  ['`git format-patch -o \\<main> -1`', (m) => `git format-patch -o \\${m} -1`],
  ['`git -C \\<main> format-patch -1`', (m) => `git -C \\${m} format-patch -1`],
  ['`echo x > <main>/a\\b` (escape inside the path)', (m) => `echo x > ${m}/a\\b`],
];

const ESCAPED_WORDS: Array<[string, (m: string) => string]> = [
  ["`sed '-i' 's/a/b/' <main>/x`", (m) => `sed '-i' 's/a/b/' ${m}/x`],
  ['`sed "-i" -f s.sed <main>/x`', (m) => `sed "-i" -f s.sed ${m}/x`],
  ['`sed \\-i s/a/b/ <main>/x`', (m) => `sed \\-i s/a/b/ ${m}/x`],
  ["`'sed' -i s/a/b/ <main>/x`", (m) => `'sed' -i s/a/b/ ${m}/x`],
  ['`\\sed -i s/a/b/ <main>/x`', (m) => `\\sed -i s/a/b/ ${m}/x`],
  ['`"/usr/bin/sed" -i s/a/b/ <main>/x`', (m) => `"/usr/bin/sed" -i s/a/b/ ${m}/x`],
  ["`'tee' <main>/x`", (m) => `echo x | 'tee' ${m}/x`],
  ['`\\cp a <main>/x`', (m) => `\\cp a ${m}/x`],
  ["`cp '-t' <main> a`", (m) => `cp '-t' ${m} a`],
  ["`sort '-o' <main>/x a`", (m) => `sort '-o' ${m}/x a`],
];

describe('bash-write-target-guard.js — backslash-escaped and quoted words (#1243)', () => {
  test('#1243: `echo x > \\<main>/x` is denied through the full hook', async () => {
    await withLinkedWorktree('blackhole-hook-1243-', async (mainRepo, worktree) => {
      const result = await run(`echo x > \\${mainRepo}/x`, worktree);

      expect(result.exitCode).toBe(2);
      expect(readHookEvents(mainRepo)[0]).toMatchObject(BLOCK);
    });
  });

  for (const [label, build] of [...ESCAPED_TARGETS, ...ESCAPED_WORDS]) {
    test(`#1243: ${label} is denied`, async () => {
      expect(await verdict(build)).toMatchObject(BLOCK);
    });
  }

  for (const [label, build] of [
    ['`echo x > \\$HOME/x` (an escaped `$` names a literal, unreadable directory)', () => 'echo x > \\$HOME/x'],
    ["`echo x > $'\\x2fetc'/x` (ANSI-C quoting)", () => "echo x > $'\\x2fetc'/x"],
  ] as const) {
    test(`#1243: ${label} warns`, async () => {
      expect(await verdict(build)).toMatchObject(WARN);
    });
  }

  for (const [label, build] of [
    ['`echo x > \\<wt>/f`', (_m: string, w: string) => `echo x > \\${w}/f`],
    ["`'sed' -i s/a/b/ <wt>/f`", (_m: string, w: string) => `'sed' -i s/a/b/ ${w}/f`],
    ["`sed '-n' 's/a/b/p' <main>/x` (read-only, no -i)", (m: string) => `sed '-n' 's/a/b/p' ${m}/x`],
    ["`grep -e '-i' <main>/x` (a quoted -i that is a pattern)", (m: string) => `grep -e '-i' ${m}/x`],
    ['`echo x > f\\ g` (escaped space)', () => 'echo x > f\\ g'],
    ['`grep -r foo .`', () => 'grep -r foo .'],
    ['`git grep x`', () => 'git grep x'],
  ] as const) {
    test(`#1243: ${label} stays allowed with no verdict`, async () => {
      expect(await verdict(build)).toBeNull();
    });
  }
});
