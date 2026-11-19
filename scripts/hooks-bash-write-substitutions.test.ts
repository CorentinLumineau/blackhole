import { describe, expect, test } from 'bun:test';
import * as path from 'path';
import { minMs, PRETOOLUSE_HOOKS_DIR, readHookEvents, REBINDING_ROWS, runPreToolUseHook, withLinkedWorktree } from './lib/test-fixtures.ts';

// Issue #1252: the commands inside `$(…)`, backticks, `<(…)` and `>(…)` run, so the guard scans
// each substitution body as its own clause set — nested bodies included — in linear time.

const SCRIPT = 'validate-bash-command.js';

const run = (command: string, worktree: string) =>
  runPreToolUseHook(
    SCRIPT,
    { tool_name: 'Bash', tool_input: { command }, tool_use_id: 'toolu_1252_bash', cwd: worktree },
    worktree,
    PRETOOLUSE_HOOKS_DIR,
    undefined,
    worktree,
  );

const guard = () => require(path.join(PRETOOLUSE_HOOKS_DIR, 'utils', 'bash-write-target-guard.js'));

/** Verdict for `build(<dir>, <main clone>, <worktree>)` evaluated from inside the worktree. */
const verdictAt = async (build: (dir: string) => string, pick: 'main' | 'wt') => {
  let result: unknown = undefined;
  await withLinkedWorktree('blackhole-hook-1252-', async (mainRepo, worktree) => {
    result = guard().evaluateBashWriteTargets(build(pick === 'main' ? mainRepo : worktree), worktree);
  });
  return result;
};

const BLOCK = { tier: 'block', pattern_id: 'bash-outside-assigned-worktree' };
const WARN = { tier: 'warn', pattern_id: 'bash-write-target-unresolvable' };

/** Each builder receives a directory and returns a command whose substitution writes into it. */
const FORMS: Array<[string, (d: string) => string]> = [
  ['`$(…)` in double quotes (issue example)', (d) => `echo "$(sed -i s/a/b/ ${d}/x)"`],
  ['bare `$(…)`', (d) => `echo $(cp a ${d}/x)`],
  ['backticks', (d) => `echo \`cp a ${d}/x\``],
  ['`<(…)` (issue example)', (d) => `cat <(cp a ${d}/x)`],
  ['`>(…)` (issue example)', (d) => `diff a >(tee ${d}/x)`],
  ['nested `$( $(…) )`', (d) => `echo $(echo $(echo hi > ${d}/x))`],
  ['nested backticks', (d) => `echo \`echo \\\`cp a ${d}/x\\\`\``],
  ['`<(…)` inside `$(…)`', (d) => `echo "$(cat <(tee ${d}/x))"`],
  ['`$(…)` inside `>(…)`', (d) => `diff a >(echo $(cp a ${d}/x))`],
  // The shell removes a backslash-newline before it reads the opener, so `$\<newline>(` is `$(`.
  ['`$\\<newline>(…)` (line continuation)', (d) => `echo $\\\n(cp a ${d}/x)`],
  ['`$\\<newline>(…)` in double quotes', (d) => `echo "$\\\n(cp a ${d}/x)"`],
  ['`<\\<newline>(…)`', (d) => `cat <\\\n(cp a ${d}/x)`],
  ['`>\\<newline>(…)`', (d) => `diff a >\\\n(tee ${d}/x)`],
  ['several continuations before the paren', (d) => `echo $\\\n\\\n\\\n(cp a ${d}/x)`],
  ['a continuation inside a nested `$(…)`', (d) => `echo $(echo $\\\n(cp a ${d}/x))`],
];

describe('bash-write-target-guard.js — writes inside command and process substitutions (#1252)', () => {
  test('#1252: `echo "$(sed -i s/a/b/ <main>/x)"` is denied through the full hook', async () => {
    await withLinkedWorktree('blackhole-hook-1252-', async (mainRepo, worktree) => {
      const result = await run(`echo "$(sed -i s/a/b/ ${mainRepo}/x)"`, worktree);

      expect(result.exitCode).toBe(2);
      expect(readHookEvents(mainRepo)[0]).toMatchObject(BLOCK);
    });
  });

  for (const [label, build] of FORMS) {
    test(`#1252: ${label} writing into the main clone is denied`, async () => {
      expect(await verdictAt(build, 'main')).toMatchObject(BLOCK);
    });
    test(`#1252: ${label} writing into the worktree stays allowed`, async () => {
      expect(await verdictAt(build, 'wt')).toBeNull();
    });
  }

  test('#1252: a line continuation that does not open a substitution stays allowed', async () => {
    expect(await verdictAt(() => 'echo $\\\nHOME', 'wt')).toBeNull();
    expect(await verdictAt(() => "echo '$\\\n(cp a /etc/x)'", 'wt')).toBeNull();
  });

  // The outer target is the substitution's output, which is not known statically.
  test('#1252: a write inside `$(…)` that names an outer redirect target is denied, and warns when in-root', async () => {
    const build = (d: string) => `echo x > "$(echo hi > ${d}/x; echo f)"`;
    expect(await verdictAt(build, 'main')).toMatchObject(BLOCK);
    expect(await verdictAt(build, 'wt')).toMatchObject(WARN);
  });

  test('#1252: a `cd` before the substitution moves its base', async () => {
    expect(await verdictAt((m) => `cd ${m} && echo "$(echo hi > f)"`, 'main')).toMatchObject(BLOCK);
  });

  for (const [label, build] of [
    ['a `)` inside quotes does not close the body', (m: string) => `echo $(echo ")"; cp a ${m}/x)`],
    ['a subshell inside the body does not close it', (m: string) => `echo $( (true); cp a ${m}/x )`],
    ["an apostrophe inside double quotes is not a quote", (m: string) => `echo "it's $(cp a ${m}/x)"`],
    ['an unclosed substitution is still scanned as written', (m: string) => `x=$(echo; echo hi > ${m}/x`],
    ['a `#` inside a word is not a comment', (m: string) => `echo a#$(cp a ${m}/x)`],
    ['a comment ends at its newline', (m: string) => `ls # x\necho $(cp a ${m}/x)`],
  ] as const) {
    test(`#1252: ${label} (denied)`, async () => {
      expect(await verdictAt(build, 'main')).toMatchObject(BLOCK);
    });
  }

  test('#1252: a placeholder-shaped string in the command is not a body', async () => {
    expect(await verdictAt(() => 'echo "$\u000199\u0001"', 'main')).toBeNull();
  });

  for (const [label, build] of [
    ['`x=$(git -c alias.d=\'!touch <main>/x\' d)` (issue example)', (m: string) => `x=$(git -c alias.d='!touch ${m}/x' d)`],
    ['`echo $(echo hi > $D/x)`', () => 'echo $(echo hi > $D/x)'],
    ['`cat <(python3 -c pass)`', () => 'cat <(python3 -c pass)'],
    ['`diff a >(cat > `pwd`/x)`', () => 'diff a >(cat > `pwd`/x)'],
  ] as const) {
    test(`#1252: ${label} warns`, async () => {
      expect(await verdictAt(build, 'main')).toMatchObject(WARN);
    });
  }

  for (const [label, build] of [
    ['a single-quoted `$(…)` is text', (m: string) => `echo '$(cp a ${m}/x)'`],
    ['a `$(…)` in a comment', (m: string) => `ls # $(cp a ${m}/x)`],
    ['a `$(…)` in a quoted heredoc body', (m: string) => `cat <<'EOF'\n$(cp a ${m}/x)\nEOF`],
    ['an escaped `\\$(…)`', (m: string) => `echo \\$\\(cp a ${m}/x\\)`],
    ['a `cd` inside `$(…)` does not move the outer base', (m: string) => `x=$(cd ${m} && pwd); echo hi > f`],
    ['arithmetic `$((…))`', () => 'echo $((1+2))'],
    ['`echo $(date)`', () => 'echo $(date)'],
    ['`diff <(ls a) <(ls b)`', () => 'diff <(ls a) <(ls b)'],
    ['`echo "$(git rev-parse HEAD)" > out.txt`', () => 'echo "$(git rev-parse HEAD)" > out.txt'],
    ['`x=`date`; echo $x`', () => 'x=`date`; echo $x'],
    ['`>(…)` inside double quotes is text', (m: string) => `echo "a >(tee ${m}/x)"`],
    ['escaped backticks are text', (m: string) => `echo \\\`cp a ${m}/x\\\``],
    ['a `cd` after a subshell inside `$(…)` stays inside it', (m: string) => `echo $( (true); cd ${m} ); echo hi > f`],
  ] as const) {
    test(`#1252: ${label} stays allowed`, async () => {
      expect(await verdictAt(build, 'main')).toBeNull();
    });
  }

  // A quadratic rescan of nested bodies took seconds at this size; a linear one is well under.
  for (const [label, build] of [
    ['nested `$(`', (m: string) => `echo ${'$('.repeat(10_900)}echo hi > ${m}/x${')'.repeat(10_900)}`],
    ['sequential `$(…)`', (m: string) => `echo ${'$(true) '.repeat(3_950)}$(echo hi > ${m}/x)`],
    ['sequential `<(…)`', (m: string) => `cat ${'<(true) '.repeat(3_950)}<(echo hi > ${m}/x)`],
    ['nested `"$(`', (m: string) => `echo ${'"$('.repeat(6_200)}echo hi > ${m}/x${')"'.repeat(6_200)}`],
  ] as const) {
    test(`#1252: ${label} at the 32 KiB cap is scanned in linear time and still denied`, async () => {
      await withLinkedWorktree('blackhole-hook-1252-', async (mainRepo, worktree) => {
        const command = build(mainRepo);
        expect(command.length).toBeLessThanOrEqual(32 * 1024);
        expect(command.length).toBeGreaterThan(30 * 1024);
        const { evaluateBashWriteTargets } = guard();
        expect(evaluateBashWriteTargets(command, worktree)).toMatchObject(BLOCK);
        expect(minMs(() => evaluateBashWriteTargets(command, worktree))).toBeLessThan(250);
      });
    });
  }
});

// A substitution body runs in the outer shell, so a rebinding statement anywhere in the command
// (outside the body included) keeps quote-masking off for every body: the verdict is decided once
// for the whole command.
describe('bash-write-target-guard.js — substitution bodies share the whole command’s masking gate (#1252)', () => {
  const PAYLOAD = 'cat > <main>/x ; true';
  const rows = () => REBINDING_ROWS(PAYLOAD);
  const verdictOf = (build: (main: string) => string) => verdictAt((m) => build(m).replaceAll('<main>', m), 'main');

  // The whole of the command is wrapped, so the rebinding sits inside the body.
  const WRAPS: Array<[string, (row: string) => string]> = [
    ['`$(…)`', (r) => `echo $(${r})`],
    ['backticks', (r) => `echo \`${r}\``],
    ['`"$(…)"`', (r) => `echo "$(${r})"`],
    ['`<(…)`', (r) => `cat <(${r})`],
  ];

  test('#1252: the rebinding rows number 30', () => {
    expect(rows()).toHaveLength(30);
  });

  for (const [label, wrap] of WRAPS) {
    for (const [i, row] of rows().entries()) {
      test(`#1252: rebinding row ${i + 1} wrapped in ${label} is denied: ${JSON.stringify(row)}`, async () => {
        expect(await verdictOf(() => wrap(row))).toMatchObject(BLOCK);
      });
    }
  }

  // The rebinding stays outside the substitution that runs the filter.
  const OUTER: Array<[string, (cmd: string, t: string) => string]> = [
    ['`$(…)`', (cmd, t) => `echo $(${cmd} '${t}')`],
    ['`"$(…)"`', (cmd, t) => `echo "$(${cmd} '${t}')"`],
    ['backticks', (cmd, t) => `echo \`${cmd} '${t}'\``],
    ['`<(…)`', (cmd, t) => `cat <(${cmd} '${t}')`],
  ];
  for (const [label, inner] of OUTER) {
    for (const [i, row] of rows().entries()) {
      const outer = row.replace(/(grep|rg) '[^']*'$/, (_, cmd) => inner(cmd, PAYLOAD));
      test(`#1252: rebinding row ${i + 1} outside ${label} is denied: ${JSON.stringify(outer)}`, async () => {
        expect(outer).not.toBe(row);
        expect(await verdictOf(() => outer)).toMatchObject(BLOCK);
      });
    }
  }

  for (const build of [
    () => "unset PATH; echo $(grep 'echo hi > <main>/x ; true')",
    () => "PATH=.; echo \"$(grep 'echo hi > <main>/x ; true')\"",
    () => "BASH_CMDS[grep]=./g; cat <(grep 'echo hi > <main>/x ; true')",
    () => "grep() { eval \"$1\"; }; echo $(grep 'echo hi > <main>/x ; true')",
    () => "echo $(unset PATH; grep 'echo hi > <main>/x ; true')",
    () => 'echo $(cd <main> && echo hi > f)',
  ]) {
    test(`#1252: \`${build()}\` is denied`, async () => {
      expect(await verdictOf(build)).toMatchObject(BLOCK);
    });
  }

  // Masking still applies where the whole command is passive (`echo` is not on the passive list).
  for (const command of ["cat $(grep 'a>b' f)", 'cat "$(grep \'a>b\' f)"', "cat <(grep 'a>b' f)", "cat `grep 'a>b' f`"]) {
    test(`#1252: \`${command}\` (every clause passive) stays allowed`, async () => {
      expect(await verdictOf(() => command)).toBeNull();
    });
  }
});
