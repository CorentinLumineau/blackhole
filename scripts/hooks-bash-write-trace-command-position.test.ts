import { describe, expect, test } from 'bun:test';
import * as path from 'path';
import { expectLinearTime, PRETOOLUSE_HOOKS_DIR, withLinkedWorktree } from './lib/test-fixtures.ts';

// A `GIT_TRACE*` assignment in a slot must resolve by the guard contract (T1 block, T2 warn) whatever
// the clause carries ahead of its command word: a redirect, a substitution, a glued case label. The
// allexport mention test (T2-8) reads the whole command, not the heredoc-masked view.

const BLOCK = { tier: 'block', pattern_id: 'bash-outside-assigned-worktree' };
const WARN = { tier: 'warn', pattern_id: 'bash-write-target-unresolvable' };

type Verdict = { tier: string; pattern_id: string } | null;

const verdictOf = async (build: (main: string, wt: string) => string): Promise<Verdict> => {
  let result: Verdict = null;
  await withLinkedWorktree('blackhole-trace-position-', async (main, wt) => {
    const { evaluateBashWriteTargets } = require(path.join(PRETOOLUSE_HOOKS_DIR, 'utils', 'bash-write-target-guard.js'));
    result = evaluateBashWriteTargets(build(main, wt), wt);
  });
  return result;
};

/** Command shapes with the trace assignment left as `T`; `T` is `"GIT_TRACE=<target>"`. */
const SHAPES: Array<[string, (t: string) => string]> = [
  ['control: env', (t) => `env ${t} git status`],
  ['redirect 2> before env', (t) => `2> ./log env ${t} git status`],
  ['redirect 2>| before env', (t) => `2>| ./log env ${t} git status`],
  ['redirect >| before env', (t) => `>| ./log env ${t} git status`],
  ['redirect {fd}> before env', (t) => `{fd}> ./log env ${t} git status`],
  ['redirect 2>&1 before env', (t) => `2>&1 env ${t} git status`],
  ['heredoc before env', (t) => `<<- EOF env ${t} git status\nbody\nEOF`],
  ['redirect < before env', (t) => `< /dev/null env ${t} git status`],
  ['redirect < before export', (t) => `< /dev/null export ${t}; git status`],
  ['assignment then redirect', (t) => `FOO=1 2> ./log env ${t} git status`],
  ['sudo then redirect', (t) => `sudo 2> ./log env ${t} git status`],
  ['env -i then redirect', (t) => `env -i 2> ./log ${t} git status`],
  ['env operand then redirect', (t) => `env "A=1" 2> ./log ${t} git status`],
  ['substitution before env', (t) => `$(echo a b) env ${t} git status`],
  ['substitution then redirect', (t) => `$(true) 2> ./log env ${t} git status`],
  ['backtick before env', (t) => `\`true\` env ${t} git status`],
  ['glued case label', (t) => `case x in a)env ${t} git status;; esac`],
  ['glued case label before export', (t) => `case x in *)export ${t};; esac`],
  ['glued alternation label', (t) => `case x in a|b)env ${t} git status;; esac`],
  ['double-quoted glued case label', (t) => `case x in "a")env ${t} git status;; esac`],
  ['single-quoted glued case label', (t) => `case x in 'a')env ${t} git status;; esac`],
  ['escaped-space glued case label', (t) => `case x in a\\ b)env ${t} git status;; esac`],
  ['quoted alternation glued label', (t) => `case x in ("a"|b)env ${t} git status;; esac`],
  ['parameter expansion before env', (t) => `X=; $X env ${t} git status`],
  ['braced expansion before env', (t) => `X=; \${X} env ${t} git status`],
  ['positional expansion before env', (t) => `$@ env ${t} git status`],
  ['spaced case label (control)', (t) => `case x in a) env ${t} git status;; esac`],
  ['split case word', (t) => `case \${x:-a b} in a) env ${t} git status;; esac`],
  ['split case word, glued label', (t) => `case \${x:-a b} in a)env ${t} git status;; esac`],
  ['quoted case word, glued label', (t) => `case "$x" in a)env ${t} git status;; esac`],
];

describe('GIT_TRACE position before the command word (T1)', () => {
  for (const [label, build] of SHAPES) {
    test(`#1342: ${label} with a target outside the worktree blocks`, async () => {
      expect(await verdictOf((main) => build(`"GIT_TRACE=${main}/x"`))).toMatchObject(BLOCK);
    });
    test(`#1342: ${label} with a target inside the worktree stays allowed`, async () => {
      expect(await verdictOf((_main, wt) => build(`"GIT_TRACE=${wt}/x"`))).toBeNull();
    });
    test(`#1342: ${label} with a non-file value stays allowed`, async () => {
      expect(await verdictOf(() => build('"GIT_TRACE=2"'))).toBeNull();
      expect(await verdictOf(() => build('GIT_TRACE=1'))).toBeNull();
    });
  }

  test('#1342: a bare trace name declared behind a redirect or case label warns', async () => {
    expect(await verdictOf(() => '< /dev/null export GIT_TRACE; git status')).toMatchObject(WARN);
    expect(await verdictOf(() => 'case x in a)export GIT_TRACE;; esac')).toMatchObject(WARN);
  });

  test('#1342: a redirect with no env or export stays allowed', async () => {
    expect(await verdictOf(() => '2> ./log git status')).toBeNull();
    expect(await verdictOf(() => '$(date) echo hi')).toBeNull();
  });
});

describe('allexport mention reads the whole command (T2-8)', () => {
  test('#1342: set -a with the trace name only in a heredoc body warns', async () => {
    expect(await verdictOf(() => 'set -a; cat <<EOF\nx\nGIT_TRACE\nEOF')).toMatchObject(WARN);
  });
  test('#1342: set -a with the trace name only in a comment warns', async () => {
    expect(await verdictOf(() => 'set -a; true # GIT_TRACE')).toMatchObject(WARN);
  });
  test('#1342: set -a with the trace name only in a printed argument warns', async () => {
    expect(await verdictOf(() => 'set -a; echo "GIT_TRACE"')).toMatchObject(WARN);
  });
  test('#1342: set -a with no trace mention stays allowed', async () => {
    expect(await verdictOf(() => 'set -a; source .env; npm test')).toBeNull();
    expect(await verdictOf(() => 'set -a; cat <<EOF\nhello\nEOF')).toBeNull();
  });
});

describe('command-position scan cost', () => {
  test('#1342: a long run of leading redirects and substitutions scales linearly', async () => {
    await withLinkedWorktree('blackhole-trace-linear-', async (main, wt) => {
      const { evaluateBashWriteTargets } = require(path.join(PRETOOLUSE_HOOKS_DIR, 'utils', 'bash-write-target-guard.js'));
      expectLinearTime({
        build: (k) => `${'2> ./log $(true) '.repeat(k)}env "GIT_TRACE=${main}/x" git status`,
        run: (command) => evaluateBashWriteTargets(command, wt),
        n: 100,
      });
    });
  });
});
