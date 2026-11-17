import { describe, expect, test } from 'bun:test';
import * as path from 'path';
import { minMs, PRETOOLUSE_HOOKS_DIR, readHookEvents, runPreToolUseHook, withLinkedWorktree } from './lib/test-fixtures.ts';

// Issue #1183: three write shapes the bash write-target guard missed — a redirect split by a
// backslash-newline continuation, sed's own `w`/`W` commands and `s///w` flag, and interpreter
// one-liners (`node -e`, `bun -e`, `perl -e`, `ruby -e`, `python -c`) whose script writes files.

const SCRIPT = 'validate-bash-command.js';

const payloadAt = (command: string, cwd: string) => ({
  tool_name: 'Bash',
  tool_input: { command },
  tool_use_id: 'toolu_1183_bash',
  cwd,
});

const run = (command: string, worktree: string) =>
  runPreToolUseHook(SCRIPT, payloadAt(command, worktree), worktree, PRETOOLUSE_HOOKS_DIR, undefined, worktree);

const guard = () => require(path.join(PRETOOLUSE_HOOKS_DIR, 'utils', 'bash-write-target-guard.js'));

/** Each builder receives an absolute target path and returns a command writing to it. */
const CONTINUATION_FORMS: Array<[string, (t: string) => string]> = [
  ['`cat x >\\<nl><target>`', (t) => `cat x >\\\n${t}`],
  ["`cat x >\\<nl>'<target>'` (quoted target)", (t) => `cat x >\\\n'${t}'`],
  ['`cat x >\\<nl>"<target>"` (double-quoted target)', (t) => `cat x >\\\n"${t}"`],
  ['`echo hi \\<nl>> <target>` (continuation before the operator)', (t) => `echo hi \\\n> ${t}`],
  ['`tee \\<nl><target>` (continuation inside a command)', (t) => `echo hi | tee \\\n${t}`],
  ['`cat <<EOF >\\<nl><target>` (continuation on a heredoc operator line)', (t) => `cat <<EOF >\\\n${t}\nbody\nEOF`],
  ['a comment line ending in `\\` followed by a continued redirect', (t) => `# note \\\necho hi >\\\n${t}`],
];

const SED_FORMS: Array<[string, (t: string) => string]> = [
  ["`sed -n 's/a/b/w <target>' f`", (t) => `sed -n 's/a/b/w ${t}' f`],
  ['`sed s/a/b/w<target> f` (unquoted, no space)', (t) => `sed s/a/b/w${t} f`],
  ["`sed '1w <target>' f`", (t) => `sed '1w ${t}' f`],
  ["`sed -n -e 'w <target>' f`", (t) => `sed -n -e 'w ${t}' f`],
  ["`sed '/x/W <target>' f`", (t) => `sed '/x/W ${t}' f`],
  ["`sed --expression='$w <target>' f`", (t) => `sed --expression='$w ${t}' f`],
  ["`sed -ne 's|a|b|gw <target>' f` (cluster, custom delimiter, flags)", (t) => `sed -ne 's|a|b|gw ${t}' f`],
  ["`sed -e p -e '1,3w <target>' f` (second -e)", (t) => `sed -e p -e '1,3w ${t}' f`],
  ["`sed -n '/a/{w <target>\\n}' f` (inside a block)", (t) => `sed -n '/a/{\nw ${t}\n}' f`],
  ['`sed -ni s/a/b/ <target>` (in-place inside a short cluster)', (t) => `sed -ni s/a/b/ ${t}`],
];

describe('bash-write-target-guard.js — backslash-newline redirects (#1183)', () => {
  for (const [label, build] of CONTINUATION_FORMS) {
    test(`#1183: ${label} outside the assigned worktree is denied`, async () => {
      await withLinkedWorktree('blackhole-hook-1183-', async (mainRepo, worktree) => {
        const result = await run(build(path.join(mainRepo, 'out.txt')), worktree);

        expect(result.exitCode).toBe(2);
        const events = readHookEvents(mainRepo);
        expect(events).toHaveLength(1);
        expect(events[0]).toMatchObject({ tier: 'block', pattern_id: 'bash-outside-assigned-worktree' });
      });
    });

    test(`#1183: ${label} inside the assigned worktree is allowed silently`, async () => {
      await withLinkedWorktree('blackhole-hook-1183-', async (mainRepo, worktree) => {
        const result = await run(build(path.join(worktree, 'out.txt')), worktree);

        expect(result.exitCode).toBe(0);
        expect(readHookEvents(mainRepo)).toEqual([]);
      });
    });
  }

  test('#1183: a quoted heredoc body line ending in `\\` still terminates, so a later redirect is seen', async () => {
    await withLinkedWorktree('blackhole-hook-1183-', async (mainRepo, worktree) => {
      const out = path.join(mainRepo, 'out.txt');
      const verdict = guard().evaluateBashWriteTargets(`cat <<'EOF'\nfoo\\\nEOF\necho hi >\\\n${out}`, worktree);
      expect(verdict).toMatchObject({ tier: 'block', pattern_id: 'bash-outside-assigned-worktree' });
    });
  });

  test('#1183: `\\<nl>` inside single quotes is literal, so a quoted `>` stays quoted text', async () => {
    await withLinkedWorktree('blackhole-hook-1183-', async (_mainRepo, worktree) => {
      // Joined inside the quotes, `'>/etc/x'` would read as a redirect and warn.
      expect(guard().evaluateBashWriteTargets("cat '>\\\n/etc/x' f", worktree)).toBeNull();
    });
  });

  test('#1183: an escaped backslash before a newline is not a continuation', async () => {
    await withLinkedWorktree('blackhole-hook-1183-', async (mainRepo, worktree) => {
      // `a\\` ends the echo; the next line is its own `sed -i` on an outside file. Read as a
      // continuation, `sed` would be glued onto `a\` and the write lost.
      const verdict = guard().evaluateBashWriteTargets(`echo a\\\\\nsed -i s/a/b/ ${path.join(mainRepo, 'x')}`, worktree);
      expect(verdict).toMatchObject({ tier: 'block', pattern_id: 'bash-outside-assigned-worktree' });
    });
  });
});

describe('bash-write-target-guard.js — sed w/W commands and the s///w flag (#1183)', () => {
  for (const [label, build] of SED_FORMS) {
    test(`#1183: ${label} outside the assigned worktree is denied`, async () => {
      await withLinkedWorktree('blackhole-hook-1183-', async (mainRepo, worktree) => {
        const result = await run(build(path.join(mainRepo, 'out.txt')), worktree);

        expect(result.exitCode).toBe(2);
        expect(readHookEvents(mainRepo)[0]).toMatchObject({ tier: 'block', pattern_id: 'bash-outside-assigned-worktree' });
      });
    });

    test(`#1183: ${label} inside the assigned worktree is allowed silently`, async () => {
      await withLinkedWorktree('blackhole-hook-1183-', async (mainRepo, worktree) => {
        const result = await run(build(path.join(worktree, 'out.txt')), worktree);

        expect(result.exitCode).toBe(0);
        expect(readHookEvents(mainRepo)).toEqual([]);
      });
    });
  }

  test("#1183: `sed 's/a/b/w $OUT' f` (dynamic file name) warns", async () => {
    await withLinkedWorktree('blackhole-hook-1183-', async (_mainRepo, worktree) => {
      expect(guard().evaluateBashWriteTargets("sed 's/a/b/w $OUT' f", worktree)).toMatchObject({
        tier: 'warn',
        pattern_id: 'bash-write-target-unresolvable',
      });
    });
  });

  test("#1183: `sed '1e date' f` (sed runs a command) warns", async () => {
    await withLinkedWorktree('blackhole-hook-1183-', async (_mainRepo, worktree) => {
      expect(guard().evaluateBashWriteTargets("sed '1e date' f", worktree)).toMatchObject({ tier: 'warn' });
    });
  });

  // Scripts that only read, print or substitute; `w` inside a regex, a replacement, an `a`/`i`/`c`
  // text or a label is not a write command.
  for (const command of [
    "sed -n 's/a/b/p' f",
    "sed 's/w \\/etc\\/x/y/' f",
    "sed 's/a/w \\/etc\\/x/g' f",
    "sed '/w \\/etc/d' f",
    "sed 'a w /etc/x' f",
    "sed -e ':w' -e 'bw' f",
    "sed -n '1~2p;$=' f",
    "sed -n 'w /dev/stdout' f",
    "sed 'y/w/x/' f",
    'grep sed f.txt',
  ]) {
    test(`#1183: \`${command}\` stays allowed with no verdict`, async () => {
      await withLinkedWorktree('blackhole-hook-1183-', async (_mainRepo, worktree) => {
        expect(guard().evaluateBashWriteTargets(command, worktree)).toBeNull();
      });
    });
  }
});

describe('bash-write-target-guard.js — interpreter one-liners that write (#1183)', () => {
  const WRITING_ONE_LINERS = [
    `node -e "require('fs').writeFileSync('/etc/x', 'y')"`,
    `node --eval "require('fs').appendFileSync('/etc/x', 'y')"`,
    `node -pe "require('fs').unlinkSync('/etc/x')"`,
    `bun -e "await Bun.write('/etc/x', 'y')"`,
    `bun --print "require('child_process').execSync('touch /etc/x')"`,
    `perl -e 'open(my $f, ">", "/etc/x")'`,
    `perl -le 'unlink "/etc/x"'`,
    `perl -pi -e 's/a/b/' /etc/x`,
    `ruby -e 'File.write("/etc/x", "y")'`,
    'ruby -e \'`touch /etc/x`\'',
    `ruby -i -pe 'sub(/a/, "b")' /etc/x`,
    `python3 -c "open('/etc/x','w').write('y')"`,
    `python -c "import shutil; shutil.copy('a', '/etc/x')"`,
    `python3.12 -Bc "import os; os.remove('/etc/x')"`,
    `sudo node -e "require('fs').rmSync('/etc/x')"`,
    `env python3 -c "print(1)"`,
  ];
  for (const command of WRITING_ONE_LINERS) {
    test(`#1183: \`${command}\` warns`, async () => {
      await withLinkedWorktree('blackhole-hook-1183-', async (mainRepo, worktree) => {
        const result = await run(command, worktree);

        expect(result.exitCode).toBe(0);
        expect(readHookEvents(mainRepo)[0]).toMatchObject({ tier: 'warn', pattern_id: 'bash-write-target-unresolvable' });
      });
    });
  }

  for (const command of [
    `node -e "console.log(require('./package.json').version)"`,
    'node -p "process.versions.node"',
    "node -e 'console.log(`v${process.version}`)'",
    `bun -e "console.log(JSON.parse(await Bun.file('a.json').text()).name)"`,
    "perl -ne 'print if /x/' f",
    "ruby -e 'puts 1 + 1'",
    'node scripts/build.js',
    'bun run build',
  ]) {
    test(`#1183: read-only \`${command}\` stays allowed with no verdict`, async () => {
      await withLinkedWorktree('blackhole-hook-1183-', async (_mainRepo, worktree) => {
        expect(guard().evaluateBashWriteTargets(command, worktree)).toBeNull();
      });
    });
  }
});

describe('bash-write-target-guard.js — #1183 parsers stay linear', () => {
  // Inputs just under the 32 KiB command-size cap that validate-bash-command.js enforces first.
  const CAP = 32 * 1024 - 64;
  const LARGE_INPUTS: Array<[string, string]> = [
    ['backslash-newline continuations', `echo ${'a \\\n'.repeat(CAP / 4)}> out.txt`],
    ['a long sed script of substitutions', `sed '${'s/a/b/;'.repeat(CAP / 7)}' f`],
    ['a sed script of unterminated escapes', `sed 's/${'\\\\'.repeat(CAP / 2)}' f`],
    ['a long sed address chain', `sed -n '${'/a/,/b/{'.repeat(CAP / 8)}' f`],
    ['a long node -e script', `node -e "${'x=1;'.repeat(CAP / 4)}"`],
    ['many interpreter words', 'node '.repeat(CAP / 5)],
  ];
  for (const [label, command] of LARGE_INPUTS) {
    test(`#1183: ${label} (${command.length} chars) is evaluated within 250 ms`, async () => {
      await withLinkedWorktree('blackhole-hook-1183-', async (_mainRepo, worktree) => {
        const { evaluateBashWriteTargets } = guard();
        expect(minMs(() => evaluateBashWriteTargets(command, worktree))).toBeLessThan(250);
      });
    });
  }
});

// Review of #1230 (#1183): script sources, unclean script words, and every parser branch.
describe('bash-write-target-guard.js — #1183 review: sed script sources and script words', () => {
  const verdictFor = async (build: (out: string) => string) => {
    let verdict: unknown = undefined;
    await withLinkedWorktree('blackhole-hook-1183-', async (mainRepo, worktree) => {
      verdict = guard().evaluateBashWriteTargets(build(path.join(mainRepo, 'out')), worktree);
    });
    return verdict;
  };

  for (const build of [
    (o: string) => `sed -i -f fix.sed ${o}`,
    (o: string) => `sed -f s.sed -i ${o}`,
    (o: string) => `sed --file=fix.sed -i ${o}`,
    (o: string) => `sed -i --file fix.sed ${o}`,
    (o: string) => `sed -nf fix.sed -i ${o}`,
  ]) {
    test(`#1183: \`${build('<outside>')}\` keeps the operand a file and is denied`, async () => {
      expect(await verdictFor(build)).toMatchObject({ tier: 'block', pattern_id: 'bash-outside-assigned-worktree' });
    });
  }

  for (const build of [
    (o: string) => `sed -n $'/a/{\nw ${o}\n}' f`,
    (o: string) => `sed -n 's/a/b/w ${o}'<f`,
    (o: string) => `sed -n 's/a/b/'w' ${o}' f`,
    (o: string) => `sed -n 's/a/b/w '${o} f`,
    (o: string) => `sed -n s/a/b/w\\ ${o} f`,
    (o: string) => `sed "s/a/b/$X" ${o}`,
  ]) {
    test(`#1183: unclean script word \`${build('<outside>')}\` warns or blocks, never allows`, async () => {
      expect(await verdictFor(build)).toMatchObject({ tier: expect.stringMatching(/^(warn|block)$/) });
    });
  }

  test("#1183: `sed 'b a;w <outside>' f` (a label ends at `;`) is denied", async () => {
    expect(await verdictFor((o) => `sed 'b a;w ${o}' f`)).toMatchObject({ tier: 'block' });
  });

  test("#1183: `sed 's/a/b/e' f` (the s///e flag) warns", async () => {
    expect(await verdictFor(() => "sed 's/a/b/e' f")).toMatchObject({ tier: 'warn', pattern_id: 'bash-write-target-unresolvable' });
  });

  test('#1183: an escaped newline continues `a` text, so a `w` on the next line is text', async () => {
    expect(await verdictFor((o) => `sed 'a foo\\\nw ${o}' f`)).toBeNull();
  });
});

describe('bash-write-target-guard.js — #1183 review: interpreter calls, words and false positives', () => {
  const verdict = async (command: string) => {
    let result: unknown = undefined;
    await withLinkedWorktree('blackhole-hook-1183-', async (_mainRepo, worktree) => {
      result = guard().evaluateBashWriteTargets(command, worktree);
    });
    return result;
  };

  for (const command of [
    "bun -e 'await Bun.$`touch x`'",
    'bun -e "await Bun.\\$\\`touch x\\`"',
    "ruby -e 'puts %x(touch x)'",
    "perl -e 'print qx(touch x)'",
    "ruby -e 'File.delete(\"x\")'",
    "ruby -e 'File.new(\"x\", \"w\")'",
    "perl -e 'sysopen(F, \"x\", 1)'",
    "perl -e 'link \"a\", \"x\"'",
    "perl -e 'dbmopen(%h, \"x\", 0644)'",
    "node -e \"require('fs').linkSync('a', 'x')\"",
    "node -e \"require('fs').mkdtempSync('x')\"",
    "\\node -e \"require('fs').writeFileSync('x', '')\"",
    "'node' -e \"require('fs').writeFileSync('x', '')\"",
    "nodejs -e \"require('fs').writeFileSync('x', '')\"",
    "node22 -e \"require('fs').writeFileSync('x', '')\"",
    'py -c "print(1)"',
    'pypy3 -c "print(1)"',
  ]) {
    test(`#1183: \`${command}\` warns`, async () => {
      expect(await verdict(command)).toMatchObject({ tier: 'warn', pattern_id: 'bash-write-target-unresolvable' });
    });
  }

  for (const command of [
    "node -e 'process.stdout.write(\"hi\")'",
    "node -e 'console.log(process.execPath)'",
    "node -e 'console.log(/a(b)/.exec(\"ab\"))'",
    "perl -ne 'print if /openssl/' f",
    "node -e 'console.log(\"overwrite\")'",
    'git grep -n perl -i',
    'grep -e ruby -i f.txt',
  ]) {
    test(`#1183: read-only \`${command}\` stays allowed with no verdict`, async () => {
      expect(await verdict(command)).toBeNull();
    });
  }
});
