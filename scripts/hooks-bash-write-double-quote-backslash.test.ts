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

// A quote or backslash that is part of a directory name must not be read as shell syntax a second
// time: the name `a"b` is a symlink to the main clone, and bash writes through it. The decoded path
// goes on to containment, so a name holding a quote that resolves outside the worktree is denied.
describe('bash-write-target-guard.js — quotes inside a literal path (#1308)', () => {
  const evaluate = (command: string, cwd: string) =>
    utils('bash-write-target-guard.js').evaluateBashWriteTargets(command, cwd);

  test('a double-quoted path through a symlink named a"b into the main clone is denied', async () => {
    await withLinkedWorktree('blackhole-hook-1308-', async (mainRepo, worktree) => {
      fs.symlinkSync(mainRepo, `${worktree}/a"b`);
      const command = `echo x > "${worktree}/a\\"b/p\\q"`;
      expect(evaluate(command, worktree)).toMatchObject(BLOCK);
    });
  });

  for (const [label, spelled] of [
    ['w"t', 'w\\"t'],
    ["w't", "w't"],
    ["w\\'t (kept backslash before a quote)", "w\\'t"],
  ] as const) {
    test(`a sibling directory named ${label} is outside the worktree and is denied`, async () => {
      await withLinkedWorktree('blackhole-hook-1308-', async (_mainRepo, worktree) => {
        const command = `echo x > "${path.dirname(worktree)}/${spelled}/a\\b"`;
        expect(evaluate(command, worktree)).toMatchObject(BLOCK);
      });
    });
  }

  for (const [label, build] of [
    ["sed -n 'w <P>/\\wt'", (w: string) => `sed -n 'w ${sibling(w)}' f`],
    ["sed 's/h/H/w <P>/\\wt'", (w: string) => `sed 's/h/H/w ${sibling(w)}' f`],
    ["sed -n 'W <P>/\\wt'", (w: string) => `sed -n 'W ${sibling(w)}' f`],
  ] as const) {
    test(`${label} writes outside the worktree and is denied`, async () => {
      await withLinkedWorktree('blackhole-hook-1308-', async (_mainRepo, worktree) => {
        expect(evaluate(build(worktree), worktree)).toMatchObject(BLOCK);
      });
    });
  }

  test('a quote-and-backslash target outside the worktree stays denied (was denied before #1308)', async () => {
    await withLinkedWorktree('blackhole-hook-1308-', async (mainRepo, worktree) => {
      expect(evaluate(`echo x > "${mainRepo}/a\\"b\\c"`, worktree)).toMatchObject(BLOCK);
    });
  });

  // Every writer decodes a quoted word once, then checks containment, so an escaped quote in a
  // name outside the worktree is denied for each of them.
  for (const [label, build] of [
    ['sed -i', (t: string) => `sed -i s/a/b/ "${t}"`],
    ['sort -o', (t: string) => `sort -o "${t}" a`],
    ['sort --output', (t: string) => `sort --output="${t}" a`],
    ['uniq', (t: string) => `uniq a "${t}"`],
    ['git -C', (t: string) => `git -C "${t}" format-patch -1`],
    ['git format-patch --output-directory', (t: string) => `git format-patch --output-directory "${t}" -1`],
    ['yq -i', (t: string) => `yq -i .a=1 "${t}"`],
    ['dd of=', (t: string) => `dd if=a of="${t}"`],
    ['dd "of=…"', (t: string) => `dd if=a "of=${t}"`],
    ['tee', (t: string) => `echo x | tee "${t}"`],
  ] as const) {
    test(`${label} to a quote-and-backslash name outside the worktree is denied`, async () => {
      await withLinkedWorktree('blackhole-hook-1308-', async (mainRepo, worktree) => {
        expect(evaluate(build(`${mainRepo}/a\\"b\\c`), worktree)).toMatchObject(BLOCK);
      });
    });
  }

  test('a backslash path spelled through a symlink to the worktree is allowed with cwd at the real worktree', async () => {
    await withLinkedWorktree('blackhole-hook-1308-', async (_mainRepo, worktree) => {
      const link = `${worktree}-link`;
      fs.symlinkSync(worktree, link);
      try {
        expect(evaluate(`echo x > "${link}/a\\b"`, worktree)).toBeNull();
      } finally {
        fs.rmSync(link, { force: true });
      }
    });
  });

  test('BLACKHOLE_ASSIGNED_WORKTREE naming an unregistered directory does not widen containment', async () => {
    await withLinkedWorktree('blackhole-hook-1308-', async (_mainRepo, worktree) => {
      const other = fs.mkdtempSync(path.join(path.dirname(worktree), 'unregistered-'));
      const saved = process.env.BLACKHOLE_ASSIGNED_WORKTREE;
      process.env.BLACKHOLE_ASSIGNED_WORKTREE = other;
      try {
        expect(evaluate(`echo x > "${other}/x\\y"`, worktree)).toMatchObject(BLOCK);
      } finally {
        if (saved === undefined) delete process.env.BLACKHOLE_ASSIGNED_WORKTREE;
        else process.env.BLACKHOLE_ASSIGNED_WORKTREE = saved;
        fs.rmSync(other, { recursive: true, force: true });
      }
    });
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
