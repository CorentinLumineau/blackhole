import { describe, expect, test } from 'bun:test';
import * as fs from 'fs';
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

  // Every write-target finder reads a double-quoted word the way the shell does.
  for (const [label, build] of [
    ['sed -i', (_m: string, w: string) => `sed -i s/a/b/ "${sibling(w)}"`],
    ['sort -o', (_m: string, w: string) => `sort -o "${sibling(w)}" a`],
    ['sort --output', (_m: string, w: string) => `sort --output="${sibling(w)}" a`],
    ['uniq', (_m: string, w: string) => `uniq a "${sibling(w)}"`],
    ['git format-patch --output-directory', (_m: string, w: string) => `git format-patch --output-directory "${sibling(w)}" -1`],
    ['git -C base', (_m: string, w: string) => `git -C "${sibling(w)}" format-patch -1`],
    ['yq -i', (_m: string, w: string) => `yq -i .a=1 "${sibling(w)}"`],
    ['dd of=', (_m: string, w: string) => `dd if=a of="${sibling(w)}"`],
    ['dd "of=…"', (_m: string, w: string) => `dd if=a "of=${sibling(w)}"`],
    ['truncate', (_m: string, w: string) => `truncate -s 0 "${sibling(w)}"`],
    ['rsync', (_m: string, w: string) => `rsync a "${sibling(w)}"`],
    ['install -d', (_m: string, w: string) => `install -d "${sibling(w)}"`],
  ] as const) {
    test(`${label} to "<worktree parent>/\\<worktree name>" is denied`, async () => {
      expect(await verdict(build)).toMatchObject(BLOCK);
    });
  }

  // A backslash in a `-c` setting value counts as shell-rewritten, so the directory is never
  // resolved: the verdict is the unresolvable warning, never a silent allow.
  test('git -c format.outputDirectory with a backslash is unresolvable (warn)', async () => {
    const build = (_m: string, w: string) => `git -c "format.outputDirectory=${sibling(w)}" format-patch -1`;
    expect(await verdict(build)).toMatchObject(WARN);
  });

  test('a double-quoted backslash path under a symlinked worktree spelling is allowed', async () => {
    await withLinkedWorktree('blackhole-hook-1308-', async (_mainRepo, worktree) => {
      const link = `${worktree}-link`;
      fs.symlinkSync(worktree, link);
      try {
        for (const target of [`${link}/a\\b`, `${link}/ab`]) {
          const result = utils('bash-write-target-guard.js').evaluateBashWriteTargets(`echo x > "${target}"`, link);
          expect(result).toBeNull();
        }
      } finally {
        fs.rmSync(link, { force: true });
      }
    });
  });

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
