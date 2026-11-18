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
  // A backslash-escaped space keeps the path in one word: the file is named `x y`.
  ['`cp a <main>/x\\ y`', (m) => `cp a ${m}/x\\ y`],
  ['`mv a <main>/x\\ y`', (m) => `mv a ${m}/x\\ y`],
  ['`install -m 644 a <main>/x\\ y`', (m) => `install -m 644 a ${m}/x\\ y`],
  ['`ln -s a <main>/x\\ y`', (m) => `ln -s a ${m}/x\\ y`],
  ['`rsync a <main>/x\\ y`', (m) => `rsync a ${m}/x\\ y`],
  ['`tee <main>/x\\ y`', (m) => `echo x | tee ${m}/x\\ y`],
  ['`echo x > <main>/x\\ y`', (m) => `echo x > ${m}/x\\ y`],
  ['`cp a <main>/x\\ y\\ z` (several escaped spaces)', (m) => `cp a ${m}/x\\ y\\ z`],
  ['`cp a <main>/x\\\ty` (escaped tab)', (m) => `cp a ${m}/x\\\ty`],
  // An escaped quote in ANSI-C `$'…'` does not end the span, so the `;` after it still splits.
  ["`echo $'\\''; cp a <main>/x`", (m) => `echo $'\\''; cp a ${m}/x`],
  ["`echo $'a\\'b'; cp a <main>/x`", (m) => `echo $'a\\'b'; cp a ${m}/x`],
  // An escaped backslash does not escape the `$` after it, so `$'…'` is still ANSI-C.
  ["`echo \\\\$'\\''; cp a <main>/x`", (m) => `echo \\\\$'\\''; cp a ${m}/x`],
  ["`echo \\$$'\\''; cp a <main>/x`", (m) => `echo \\$$'\\''; cp a ${m}/x`],
  ["`echo $$$'\\''; cp a <main>/x` (`$$` then `$'`)", (m) => `echo $$$'\\''; cp a ${m}/x`],
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

  // Review of the #1243 fix: quoted subcommands and option words, ANSI-C command words, and a
  // quoted command name that is only an argument (a grep pattern) and runs nothing.
  for (const [label, build] of [
    ["`git -C <main> 'format-patch' -1`", (m: string) => `git -C ${m} 'format-patch' -1`],
    ['`git -C <main> "format-patch" -1`', (m: string) => `git -C ${m} "format-patch" -1`],
    ['`git -C <main> format\\-patch -1`', (m: string) => `git -C ${m} format\\-patch -1`],
    ["`cd <main> && git 'format-patch' -1`", (m: string) => `cd ${m} && git 'format-patch' -1`],
    ["`git 'format-patch' -o <main> -1`", (m: string) => `git 'format-patch' -o ${m} -1`],
    ["`git '-C' <main> format-patch -1`", (m: string) => `git '-C' ${m} format-patch -1`],
    ["`git format-patch '-o' <main> -1`", (m: string) => `git format-patch '-o' ${m} -1`],
    ["`git diff '--output' <main>/x`", (m: string) => `git diff '--output' ${m}/x`],
    ["`dd 'of=<main>/x'`", (m: string) => `dd 'of=${m}/x'`],
    ["`$'sed' -i s/a/b/ <main>/x`", (m: string) => `$'sed' -i s/a/b/ ${m}/x`],
    ["`$'tee' <main>/x`", (m: string) => `echo x | $'tee' ${m}/x`],
    ["`$'cp' a <main>/x`", (m: string) => `$'cp' a ${m}/x`],
    ["`$'\\x63p' a <main>/x` (ANSI-C escape)", (m: string) => `$'\\x63p' a ${m}/x`],
    ["`$'\\143p' a <main>/x` (ANSI-C octal)", (m: string) => `$'\\143p' a ${m}/x`],
    ["`c''p a <main>/x`", (m: string) => `c''p a ${m}/x`],
    ['`"c"p a <main>/x`', (m: string) => `"c"p a ${m}/x`],
    ["`sudo 'cp' a <main>/x`", (m: string) => `sudo 'cp' a ${m}/x`],
    ["`sudo -u bob 'cp' a <main>/x`", (m: string) => `sudo -u bob 'cp' a ${m}/x`],
    ["`env X=1 'tee' <main>/x`", (m: string) => `echo x | env X=1 'tee' ${m}/x`],
    ["`timeout 5 'cp' a <main>/x`", (m: string) => `timeout 5 'cp' a ${m}/x`],
    ['`X=1 \\cp a <main>/x`', (m: string) => `X=1 \\cp a ${m}/x`],
    ['`flock /tmp/l cp a <main>/x` (a bare command word after an unknown wrapper)', (m: string) => `flock /tmp/l cp a ${m}/x`],
  ] as const) {
    test(`#1243: ${label} is denied`, async () => {
      expect(await verdict(build)).toMatchObject(BLOCK);
    });
  }

  for (const [label, build] of [
    ['`cp a x\\ y` writes inside the worktree', () => 'cp a x\\ y'],
    ["`echo $'it\\'s' > f` writes inside the worktree", () => "echo $'it\\'s' > f"],
    ["`echo $'\\'' > f` writes inside the worktree", () => "echo $'\\'' > f"],
    ["`echo $'\\''; echo done` has no write target", () => "echo $'\\''; echo done"],
    ["`echo \\$'\\''x' > f` (escaped `$`: plain quotes)", () => "echo \\$'\\''x' > f"],
    ["`echo $$'a' > f` (`$$` then a plain span)", () => "echo $$'a' > f"],
  ] as const) {
    test(`#1243: ${label} stays allowed`, async () => {
      expect(await verdict(build)).toBeNull();
    });
  }

  for (const [label, build] of [
    ['`grep -rn "tee" /usr/lib/node_modules`', () => 'grep -rn "tee" /usr/lib/node_modules'],
    ["`grep -n 'cp' /etc/hosts <main>/README.md`", (m: string) => `grep -n 'cp' /etc/hosts ${m}/README.md`],
    ['`git log --grep "tee" -- <main>`', (m: string) => `git log --grep "tee" -- ${m}`],
    ['`grep "uniq" a /etc/b`', () => 'grep "uniq" a /etc/b'],
    ['`rg "sed" <main>/src`', (m: string) => `rg "sed" ${m}/src`],
    ['`grep -rln "install" /usr/share/doc`', () => 'grep -rln "install" /usr/share/doc'],
    ["`echo 'mv' a /etc/b`", () => "echo 'mv' a /etc/b"],
    ['`git log --format="{x,y}"`', () => 'git log --format="{x,y}"'],
  ] as const) {
    test(`#1243: ${label} (a quoted command name as an argument) stays allowed`, async () => {
      expect(await verdict(build)).toBeNull();
    });
  }
});
