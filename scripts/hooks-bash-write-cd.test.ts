import { describe, expect, test } from 'bun:test';
import * as fs from 'fs';
import * as path from 'path';
import { expectLinearTime, PRETOOLUSE_HOOKS_DIR, readHookEvents, runPreToolUseHook, withLinkedWorktree } from './lib/test-fixtures.ts';

// Issue #1239: a `cd` earlier in the same command moves the directory a relative write target
// resolves against. `cd <main-clone> && git format-patch -1` and `cd <main-clone> && echo x > f`
// wrote into the main clone from a worktree with no verdict.

const SCRIPT = 'validate-bash-command.js';

const run = (command: string, worktree: string) =>
  runPreToolUseHook(
    SCRIPT,
    { tool_name: 'Bash', tool_input: { command }, tool_use_id: 'toolu_1239_bash', cwd: worktree },
    worktree,
    PRETOOLUSE_HOOKS_DIR,
    undefined,
    worktree,
  );

const guard = () => require(path.join(PRETOOLUSE_HOOKS_DIR, 'utils', 'bash-write-target-guard.js'));

/** Verdict for the command `build(mainRepo, worktree)` evaluated from inside the worktree. */
const verdict = async (build: (main: string, wt: string) => string) => {
  let result: unknown = undefined;
  await withLinkedWorktree('blackhole-hook-1239-', async (mainRepo, worktree) => {
    fs.mkdirSync(path.join(worktree, 'sub'), { recursive: true });
    result = guard().evaluateBashWriteTargets(build(mainRepo, worktree), worktree);
  });
  return result;
};

const BLOCK = { tier: 'block', pattern_id: 'bash-outside-assigned-worktree' };
const WARN = { tier: 'warn', pattern_id: 'bash-write-target-unresolvable' };

describe('bash-write-target-guard.js — a preceding cd moves relative write targets (#1239)', () => {
  for (const [label, build] of [
    ['`cd <main> && echo x > f` (full hook)', (m: string) => `cd ${m} && echo x > f`],
    ['`cd <main> && git format-patch -1` (full hook)', (m: string) => `cd ${m} && git format-patch -1`],
  ] as const) {
    test(`#1239: ${label} is denied`, async () => {
      await withLinkedWorktree('blackhole-hook-1239-', async (mainRepo, worktree) => {
        const result = await run(build(mainRepo), worktree);

        expect(result.exitCode).toBe(2);
        expect(readHookEvents(mainRepo)[0]).toMatchObject(BLOCK);
      });
    });
  }

  for (const [label, build] of [
    ['`cd <main>; tee f`', (m: string) => `echo x | (cd ${m}; tee f)`],
    ['`cd <main> && cp a b`', (m: string) => `cd ${m} && cp a b`],
    ['`cd <main> && sed -i s/a/b/ f`', (m: string) => `cd ${m} && sed -i s/a/b/ f`],
    ['`cd .. && echo x > f` (relative cd out of the worktree)', () => 'cd .. && echo x > f'],
    ['`cd sub && cd <main> && echo x > f` (the last cd wins)', (m: string) => `cd sub && cd ${m} && echo x > f`],
    ["`cd '<main>' && echo x > f` (quoted cd target)", (m: string) => `cd '${m}' && echo x > f`],
    ['`cd -P <main> && echo x > f` (cd option)', (m: string) => `cd -P ${m} && echo x > f`],
    // `env -C DIR` runs its command in DIR, so a relative target resolves there.
    ['`env -C <main> tee f`', (m: string) => `echo x | env -C ${m} tee f`],
    ['`env --chdir=<main> tee f`', (m: string) => `echo x | env --chdir=${m} tee f`],
    ['`env -C<main> cp a b`', (m: string) => `env -C${m} cp a b`],
    ["`env -u X -C '<main>' tee f`", (m: string) => `echo x | env -u X -C '${m}' tee f`],
    // `||`: either cd may be the one that ran, so both directories are checked.
    ['`cd <main> || cd <wt> && echo x > f`', (m: string, w: string) => `cd ${m} || cd ${w} && echo x > f`],
    ['`cd <wt> || cd <main> && echo x > f`', (m: string, w: string) => `cd ${w} || cd ${m} && echo x > f`],
    // A cd past the first word may be a wrapper's command: its directory is added.
    ['`command cd <main> && echo x > f`', (m: string) => `command cd ${m} && echo x > f`],
    ['`(cd <main> && echo x > f)` (inside a subshell)', (m: string) => `(cd ${m} && echo x > f)`],
    // `echo cd <wt>` only prints: a cd past the first word must never replace the real base.
    ['`cd <main> && echo cd <wt>; echo x > f`', (m: string, w: string) => `cd ${m} && echo cd ${w}; echo x > f`],
  ] as const) {
    test(`#1239: ${label} is denied`, async () => {
      expect(await verdict(build)).toMatchObject(BLOCK);
    });
  }

  for (const [label, build] of [
    ['`cd "$DIR" && echo x > f`', () => 'cd "$DIR" && echo x > f'],
    ['`cd - && echo x > f`', () => 'cd - && echo x > f'],
    ['`cd && echo x > f` (bare cd)', () => 'cd && echo x > f'],
    ['`cd ~/x && echo x > f`', () => 'cd ~/x && echo x > f'],
    ['`cd <wt> || cd "$D" && echo x > f`', (_m: string, w: string) => `cd ${w} || cd "$D" && echo x > f`],
    ['`command cd "$D" && echo x > f`', () => 'command cd "$D" && echo x > f'],
    // The real directory is unknown, so the earlier one is not checked as if it were certain.
    ['`cd <main> && cd "$D" && echo x > f`', (m: string) => `cd ${m} && cd "$D" && echo x > f`],
    // Each `||` doubles the candidates; past the cap the base is unknown.
    ['`cd a || cd b || … (6 cds) && echo x > f`', () => 'cd a || cd b || cd c || cd d || cd e || cd g && echo x > f'],
  ] as const) {
    test(`#1239: ${label} (dynamic cd, relative target) warns`, async () => {
      expect(await verdict(build)).toMatchObject(WARN);
    });
  }

  for (const [label, build] of [
    ['`cd sub && echo x > f`', () => 'cd sub && echo x > f'],
    ['`cd <wt>/sub && echo x > ../f`', (_m: string, w: string) => `cd ${w}/sub && echo x > ../f`],
    ['`cd <main> && cd <wt> && echo x > f` (the last cd wins)', (m: string, w: string) => `cd ${m} && cd ${w} && echo x > f`],
    ['`cd "$DIR" && echo x > <wt>/f` (absolute target)', (_m: string, w: string) => `cd "$DIR" && echo x > ${w}/f`],
    ['`(cd <main> && ls); echo x > f` (the subshell restores the directory)', (m: string) => `(cd ${m} && ls); echo x > f`],
    ['`cd <main> > f` (a redirect binds before cd runs)', (m: string) => `cd ${m} > f`],
    ['`cd /home/user/blackhole/.blackhole/.tmp/x && ls`', () => 'cd /home/user/blackhole/.blackhole/.tmp/x && ls'],
    ['`git commit -m "cd -" && echo x > f` (quoted text is not a cd)', () => 'git commit -m "cd -" && echo x > f'],
  ] as const) {
    test(`#1239: ${label} stays allowed with no verdict`, async () => {
      expect(await verdict(build)).toBeNull();
    });
  }

  // Review of the #1239 fix: a cd that may not run (after `&&`/`||`, inside a compound command or a
  // function, in a pipeline or in the background) must not replace the base for later clauses.
  for (const [label, build] of [
    ['`cd <main>; false && cd <wt>; echo x > f`', (m: string, w: string) => `cd ${m}; false && cd ${w}; echo x > f`],
    ['the same chain split by newlines', (m: string, w: string) => `cd ${m}\nfalse && cd ${w}\necho x > f`],
    ['`if false; then cd <wt>; fi`', (m: string, w: string) => `cd ${m}; if false; then cd ${w}; fi; echo x > f`],
    ['`if` over several lines', (m: string, w: string) => `cd ${m}\nif false\nthen\ncd ${w}\nfi\necho x > f`],
    ['a `while` body', (m: string, w: string) => `cd ${m}; while false; do cd ${w}; done; echo x > f`],
    ['a `for` body', (m: string, w: string) => `cd ${m}; for d in a; do cd ${w}; done; echo x > f`],
    ['a function body', (m: string, w: string) => `cd ${m}; f() { cd ${w}; }; echo x > f`],
    ['a function body over several lines', (m: string, w: string) => `cd ${m}\nf() {\ncd ${w}\n}\necho x > f`],
    ['`cd <wt> | cat` (a pipeline runs in a subshell)', (m: string, w: string) => `cd ${m}; cd ${w} | cat; echo x > f`],
    ['`… && true &` (the backgrounded list may have left the base where it was)', (m: string, w: string) => `cd ${m}; false && cd ${w} && true & echo x > f`],
    ['`cd <wt> &` (a background job runs in a subshell)', (m: string, w: string) => `cd ${m}; cd ${w} & echo x > f`],
    ['a case pattern `)` inside a subshell', (m: string) => `( cd ${m}\ncase y in y) echo x > f;; esac )`],
    ['a case pattern `)` on its own line inside a subshell', (m: string) => `( cd ${m}\ncase y in y)\necho x > f;; esac )`],
    ['a `cd` in a case arm on the `case` line', (m: string) => `case y in y) cd ${m};; esac; echo x > f`],
    ['a case arm after `case … in` on its own line', (m: string) => `cd ${m}\ncase y in\ny) echo x > f;;\nesac`],
    ['`pushd <main> && echo x > f`', (m: string) => `pushd ${m} && echo x > f`],
    ['`pushd <main> >/dev/null; echo x > f`', (m: string) => `pushd ${m} >/dev/null; echo x > f`],
  ] as const) {
    test(`#1239: ${label} is denied`, async () => {
      expect(await verdict(build)).toMatchObject(BLOCK);
    });
  }

  for (const [label, build] of [
    ['`CDPATH=<main>/.. cd <name> && echo x > f`', (m: string) => `CDPATH=${path.dirname(m)} cd ${path.basename(m)} && echo x > f`],
    ['`export CDPATH=/x; cd sub && echo x > f`', () => 'export CDPATH=/x; cd sub && echo x > f'],
    ['`pushd +1 && echo x > f`', () => 'pushd +1 && echo x > f'],
    ['`pushd <main> && popd && echo x > f`', (m: string) => `pushd ${m} && popd && echo x > f`],
  ] as const) {
    test(`#1239: ${label} warns`, async () => {
      expect(await verdict(build)).toMatchObject(WARN);
    });
  }

  for (const [label, build] of [
    ['`cd <main> | cat; echo x > f`', (m: string) => `cd ${m} | cat; echo x > f`],
    ['`cd <main> & echo x > f`', (m: string) => `cd ${m} & echo x > f`],
    ['`cd <wt>; false && cd sub; echo x > f`', (_m: string, w: string) => `cd ${w}; false && cd sub; echo x > f`],
    ['`CDPATH=/x cd ./sub && echo x > f` (CDPATH skips ./)', () => 'CDPATH=/x cd ./sub && echo x > f'],
    ['`if true; then echo x > f; fi`', () => 'if true; then echo x > f; fi'],
    ['`env -C <wt> tee f` stays inside the worktree', (_m: string, w: string) => `echo x | env -C ${w} tee f`],
    ['`env -C sub tee f` stays inside the worktree', () => 'echo x | env -C sub tee f'],
    ['a redirect is not moved by `env -C` of an earlier clause', (m: string) => `env -C ${m} true; echo x > f`],
    // A closed compound command no longer makes a later `cd` uncertain.
    ['`fi` closes the `if`', (m: string, w: string) => `cd ${m}; if true; then true; fi; cd ${w}; echo x > f`],
    ['`done` closes the loop', (m: string, w: string) => `cd ${m}; while false; do true; done; cd ${w}; echo x > f`],
    ['`}` closes the group', (m: string, w: string) => `cd ${m}; { true; }; cd ${w}; echo x > f`],
    ['`esac` closes the case, so a later subshell restores its base', (m: string) => `case y in y) true;; esac; (cd ${m}); echo x > f`],
    ['a `(` pattern inside a case is not a subshell', (m: string) => `( cd ${m}\ncase y in\n(y) true;;\nesac\n); echo x > f`],
    ['a `cd` receiving a pipe runs in a subshell', (m: string) => `true | cd ${m}; echo x > f`],
    ['a `cd` receiving `|&` runs in a subshell', (m: string) => `true |& cd ${m}; echo x > f`],
  ] as const) {
    test(`#1239: ${label} stays allowed with no verdict`, async () => {
      expect(await verdict(build)).toBeNull();
    });
  }

  // The trailing-paren scan was quadratic in a long run of spaces or `)` inside a clause.
  for (const [label, build, size] of [
    ['32 KiB of spaces mid-clause', (k: number) => `printf '%s' x${' '.repeat(k)}y > f`, 32_000],
    ['32 KiB of `)` mid-clause', (k: number) => `echo ${')'.repeat(k)}x`, 32_700],
  ] as const) {
    test(`#1239: ${label} is scanned in linear time`, async () => {
      await withLinkedWorktree('blackhole-hook-1239-', async (_mainRepo, worktree) => {
        const { evaluateBashWriteTargets } = guard();
        expectLinearTime({ build, run: (command) => evaluateBashWriteTargets(command, worktree), n: size / 4 });
      });
    });
  }
});
