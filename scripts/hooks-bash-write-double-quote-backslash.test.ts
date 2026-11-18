import { describe, expect, test } from 'bun:test';
import * as path from 'path';
import { PRETOOLUSE_HOOKS_DIR, runPreToolUseHook, withLinkedWorktree } from './lib/test-fixtures.ts';

// Inside double quotes the shell drops a backslash only before `$`, a backtick, `"`, `\` or a
// newline; before any other character the backslash stays in the word. The guard must read a quoted
// target the same way, or `> "<main>/.worktrees/\wt"` resolves to a different path than it writes.

const utils = (name: string) => require(path.join(PRETOOLUSE_HOOKS_DIR, 'utils', name));
const normalize = (word: string) => utils('worktree-removal-guard.js').normalizeShellWord(word);

const verdict = async (build: (main: string, wt: string) => string) => {
  let result: unknown = undefined;
  await withLinkedWorktree('blackhole-hook-1308-', async (mainRepo, worktree) => {
    result = utils('bash-write-target-guard.js').evaluateBashWriteTargets(build(mainRepo, worktree), worktree);
  });
  return result;
};

/** `<worktree parent>/\<worktree name>`: with the backslash dropped it is the assigned worktree
 * itself (allowed), with it kept it is a sibling directory outside it. */
const sibling = (w: string) => `${path.dirname(w)}/\\${path.basename(w)}`;

const BLOCK = { tier: 'block', pattern_id: 'bash-outside-assigned-worktree' };
const WARN = { tier: 'warn', pattern_id: 'bash-write-target-unresolvable' };

describe('normalizeShellWord — backslash inside double quotes', () => {
  for (const [word, text] of [
    ['"a\\b"', 'a\\b'],
    ['"a\\$b"', 'a$b'],
    ['"a\\"b"', 'a"b'],
    ['"a\\\\b"', 'a\\b'],
    ['"a\\\nb"', 'ab'],
    ["'a\\b'", 'a\\b'],
    ['a\\b', 'ab'],
    ['"git"', 'git'],
    ['g""it', 'git'],
    ['\\git', 'git'],
  ] as const) {
    test(`${JSON.stringify(word)} -> ${JSON.stringify(text)}`, () => {
      expect(normalize(word)).toEqual({ text, dynamic: false });
    });
  }

  test('"$HOME" stays dynamic', () => {
    expect(normalize('"$HOME"').dynamic).toBe(true);
  });
});

describe('bash-write-target-guard.js — a kept backslash in a double-quoted target (#1308)', () => {
  for (const [label, build] of [
    ['redirect', (_m: string, w: string) => `echo x > "${sibling(w)}"`],
    ['tee', (_m: string, w: string) => `echo x | tee "${sibling(w)}"`],
    ['cp', (_m: string, w: string) => `cp a "${sibling(w)}"`],
    ['mv', (_m: string, w: string) => `mv a "${sibling(w)}"`],
  ] as const) {
    test(`${label} to "<worktree parent>/\\<worktree name>" is denied`, async () => {
      expect(await verdict(build)).toMatchObject(BLOCK);
    });
  }

  for (const [label, build] of [
    ['GIT_TRACE assignment', (m: string) => `GIT_TRACE="${m}/.worktrees/\\wt" git status`],
    ['export "GIT_TRACE=…"', (m: string) => `export "GIT_TRACE=${m}/.worktrees/\\wt"`],
  ] as const) {
    test(`${label} stays unresolvable (warn)`, async () => {
      expect(await verdict(build)).toMatchObject(WARN);
    });
  }

  for (const [label, build] of [
    ['unquoted `\\wt` drops the backslash, stays in the worktree', (_m: string, w: string) => `echo x > ${w}/\\wt`],
    ['quoted path inside the worktree', (_m: string, w: string) => `echo x > "${w}/ok"`],
  ] as const) {
    test(`${label} is allowed`, async () => {
      expect(await verdict(build)).toBeNull();
    });
  }

  test('quoted plain path in the main clone is denied', async () => {
    expect(await verdict((m) => `echo x > "${m}/x"`)).toMatchObject(BLOCK);
  });

  // Inside double quotes `\$` is a literal `$`, so bash writes `<main>/$x` in the main clone. The
  // guard treats any `$` in a target as dynamic and cannot resolve it, so the verdict is the
  // unresolvable warning, never a silent allow.
  test('"<main>/\\$x" is unresolvable (warn), not allowed', async () => {
    expect(await verdict((m) => `echo x > "${m}/\\$x"`)).toMatchObject(WARN);
  });
});

describe('worktree-removal-guard — a quoted removal still resolves', () => {
  test('rm -rf "<worktree>" with no backslash is still refused', async () => {
    await withLinkedWorktree('blackhole-hook-1308-', async (mainRepo, worktree) => {
      const result = await runPreToolUseHook(
        'validate-bash-command.js',
        { tool_name: 'Bash', tool_input: { command: `rm -rf "${worktree}"` }, tool_use_id: 'toolu_1308', cwd: mainRepo },
        mainRepo,
        PRETOOLUSE_HOOKS_DIR,
      );
      expect(result.exitCode).toBe(2);
    });
  });
});
