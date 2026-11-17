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

  test('#1183: `\\<nl>` inside single quotes is literal and joins nothing', async () => {
    await withLinkedWorktree('blackhole-hook-1183-', async (_mainRepo, worktree) => {
      expect(guard().evaluateBashWriteTargets("grep 'a\\\nb' f.txt", worktree)).toBeNull();
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
