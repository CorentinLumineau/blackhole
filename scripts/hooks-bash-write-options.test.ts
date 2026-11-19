import { describe, expect, test } from 'bun:test';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { expectLinearTime, PRETOOLUSE_HOOKS_DIR, readHookEvents, runPreToolUseHook, withLinkedWorktree } from './lib/test-fixtures.ts';

// Issue #1184: commands that look read-only but carry a file-writing option (`sort -o`, `uniq`'s
// second positional, `git diff|log|show --output`, `yq -i`) must resolve that option's target
// through the same assigned-worktree containment a `>` redirect gets, and a literal script piped
// into a shell (`echo '…' | sh`) must at least warn. Kept apart from hooks-validate-bash.test.ts
// so parallel hook PRs appending there do not conflict at its end.

const SCRIPT = 'validate-bash-command.js';

const payloadAt = (command: string, cwd: string) => ({
  tool_name: 'Bash',
  tool_input: { command },
  tool_use_id: 'toolu_1184_bash',
  cwd,
});

const run = (command: string, worktree: string) =>
  runPreToolUseHook(SCRIPT, payloadAt(command, worktree), worktree, PRETOOLUSE_HOOKS_DIR, undefined, worktree);

/** Each builder receives an absolute target path and returns a command writing to it. */
const WRITE_OPTION_FORMS: Array<[string, (target: string) => string]> = [
  ['sort -o <target>', (t) => `sort -o ${t} a.txt`],
  ['sort -o<target> (attached)', (t) => `sort -o${t} a.txt`],
  ['sort -ro <target> (cluster)', (t) => `sort -ro ${t} a.txt`],
  ['sort --output=<target>', (t) => `sort --output=${t} a.txt`],
  ['sort --output <target>', (t) => `sort --output ${t} a.txt`],
  ["sort a -o '<target>' (option after operand, quoted)", (t) => `sort a.txt -o '${t}'`],
  ['uniq <in> <target>', (t) => `uniq a.txt ${t}`],
  ['uniq -f 1 <in> <target> (option value skipped)', (t) => `uniq -f 1 a.txt ${t}`],
  ['git diff --output=<target>', (t) => `git diff --output=${t}`],
  ['git log -p --output=<target>', (t) => `git log -p --output=${t}`],
  ['git show --output <target>', (t) => `git show --output ${t} HEAD`],
  ['git -C <dir> diff --output=<target>', (t) => `git -C . diff --output=${t}`],
  ['yq -i <expr> <target>', (t) => `yq -i '.a = 1' ${t}`],
  ['yq --inplace <expr> <target>', (t) => `yq --inplace '.a = 1' ${t}`],
];

describe('validate-bash-command.js — file-writing options of read-only-looking commands (#1184)', () => {
  for (const [label, build] of WRITE_OPTION_FORMS) {
    test(`#1184: ${label} outside the assigned worktree is denied`, async () => {
      await withLinkedWorktree('blackhole-hook-1184-', async (mainRepo, worktree) => {
        const result = await run(build(path.join(mainRepo, 'out.txt')), worktree);

        expect(result.exitCode).toBe(2);
        const events = readHookEvents(mainRepo);
        expect(events).toHaveLength(1);
        expect(events[0]).toMatchObject({ tier: 'block', pattern_id: 'bash-outside-assigned-worktree' });
      });
    });

    test(`#1184: ${label} inside the assigned worktree is allowed silently`, async () => {
      await withLinkedWorktree('blackhole-hook-1184-', async (mainRepo, worktree) => {
        const result = await run(build(path.join(worktree, 'out.txt')), worktree);

        expect(result.exitCode).toBe(0);
        expect(result.stdout.trim()).toBe('');
        expect(readHookEvents(mainRepo)).toEqual([]);
      });
    });
  }

  // Read-only invocations of the same commands must not start warning or blocking.
  for (const command of [
    'sort -k2 -t, a.txt',
    'sort -T /tmp a.txt',
    'uniq a.txt',
    'uniq -c -',
    'git diff --stat',
    'git log --oneline -5',
    "yq '.a' /etc/config.yaml",
  ]) {
    test(`#1184: read-only \`${command}\` stays allowed with no event`, async () => {
      await withLinkedWorktree('blackhole-hook-1184-', async (mainRepo, worktree) => {
        const result = await run(command, worktree);

        expect(result.exitCode).toBe(0);
        expect(result.stdout.trim()).toBe('');
        expect(readHookEvents(mainRepo)).toEqual([]);
      });
    });
  }

  for (const command of [
    "echo 'echo x > /etc/x' | sh",
    "printf 'rm a\\n' | bash",
    "cat <<'EOF' | /bin/bash -s\necho x > /etc/x\nEOF",
  ]) {
    test(`#1184: a script piped into a shell (\`${command.split('\n')[0]}\`) warns and records`, async () => {
      await withLinkedWorktree('blackhole-hook-1184-', async (mainRepo, worktree) => {
        const result = await run(command, worktree);

        expect(result.exitCode).toBe(0);
        const events = readHookEvents(mainRepo);
        expect(events).toHaveLength(1);
        expect(events[0]).toMatchObject({ tier: 'warn', pattern_id: 'bash-write-target-unresolvable' });
      });
    });
  }

  for (const command of ['git status || sh', 'cat a.txt | bash script.sh']) {
    test(`#1184: \`${command}\` is not a piped-script shell and stays allowed with no event`, async () => {
      await withLinkedWorktree('blackhole-hook-1184-', async (mainRepo, worktree) => {
        const result = await run(command, worktree);

        expect(result.exitCode).toBe(0);
        expect(readHookEvents(mainRepo)).toEqual([]);
      });
    });
  }
});

describe('validate-bash-command.js — #1184 option writers behind wrapper words', () => {
  test('#1184: `sudo sort -o <outside>` is denied (prefix word skipped)', async () => {
    await withLinkedWorktree('blackhole-hook-1184-', async (mainRepo, worktree) => {
      const result = await run(`sudo sort -o ${path.join(mainRepo, 'out.txt')} a.txt`, worktree);

      expect(result.exitCode).toBe(2);
      expect(readHookEvents(mainRepo)[0]).toMatchObject({ tier: 'block', pattern_id: 'bash-outside-assigned-worktree' });
    });
  });

  // Review of #1208: the command word is found anywhere in the clause, like tee/sed/cp, so a
  // wrapper with its own value (`nice -n 5`, `timeout 5`) can never hide it. The accepted cost is
  // fail-closed over-tightening: `grep uniq a.txt <outside>` is read as a uniq write and denied.
  for (const build of [
    (t: string) => `nice -n 5 sort -o ${t} a.txt`,
    (t: string) => `timeout 5 sort -o ${t} a.txt`,
    (t: string) => `env X=1 sort -o ${t} a.txt`,
    (t: string) => `grep uniq a.txt ${t}`,
  ]) {
    test(`#1184: \`${build('<outside>')}\` is denied (command word found past any wrapper)`, async () => {
      await withLinkedWorktree('blackhole-hook-1184-', async (mainRepo, worktree) => {
        const result = await run(build(path.join(mainRepo, 'out.txt')), worktree);

        expect(result.exitCode).toBe(2);
        expect(readHookEvents(mainRepo)[0]).toMatchObject({ tier: 'block', pattern_id: 'bash-outside-assigned-worktree' });
      });
    });
  }
});

describe('validate-bash-command.js — #1184 review: git -C and long-option abbreviation', () => {
  test('#1184: `git -C <outside> diff --output=rel.patch` is denied (relative output resolves under -C)', async () => {
    await withLinkedWorktree('blackhole-hook-1184-', async (mainRepo, worktree) => {
      const result = await run(`git -C ${mainRepo} diff --output=rel.patch`, worktree);

      expect(result.exitCode).toBe(2);
      expect(readHookEvents(mainRepo)[0]).toMatchObject({ tier: 'block', pattern_id: 'bash-outside-assigned-worktree' });
    });
  });

  test('#1184: chained `git -C <outside-parent> -C <name> log --output=x` is denied (each -C relative to the last)', async () => {
    await withLinkedWorktree('blackhole-hook-1184-', async (mainRepo, worktree) => {
      const result = await run(`git -C ${path.dirname(mainRepo)} -C ${path.basename(mainRepo)} log --output=x`, worktree);

      expect(result.exitCode).toBe(2);
      expect(readHookEvents(mainRepo)[0]).toMatchObject({ tier: 'block', pattern_id: 'bash-outside-assigned-worktree' });
    });
  });

  test('#1184: `git -C <worktree-subdir> diff --output=rel.patch` stays allowed', async () => {
    await withLinkedWorktree('blackhole-hook-1184-', async (mainRepo, worktree) => {
      const result = await run(`git -C ${worktree} -C sub diff --output=rel.patch`, worktree);

      expect(result.exitCode).toBe(0);
      expect(readHookEvents(mainRepo)).toEqual([]);
    });
  });

  for (const build of [
    (t: string) => `sort --out=${t} a.txt`,
    (t: string) => `sort --outp ${t} a.txt`,
    (t: string) => `sort --o=${t} a.txt`,
    (t: string) => `git diff --outpu=${t}`,
    (t: string) => `uniq --skip-f 1 a.txt ${t}`,
  ]) {
    test(`#1184: abbreviated long option \`${build('<outside>')}\` is denied`, async () => {
      await withLinkedWorktree('blackhole-hook-1184-', async (mainRepo, worktree) => {
        const result = await run(build(path.join(mainRepo, 'out.txt')), worktree);

        expect(result.exitCode).toBe(2);
        expect(readHookEvents(mainRepo)[0]).toMatchObject({ tier: 'block', pattern_id: 'bash-outside-assigned-worktree' });
      });
    });
  }
});

describe('bash-write-target-guard.js — #1184 review: linear-time option scan', () => {
  test('#1184: an 80k-character `-iii…` yq flag is evaluated in linear time', async () => {
    await withLinkedWorktree('blackhole-hook-1184-', async (_mainRepo, worktree) => {
      const { evaluateBashWriteTargets } = require(path.join(PRETOOLUSE_HOOKS_DIR, 'utils', 'bash-write-target-guard.js'));
      expectLinearTime({ build: (k) => `yq -${'i'.repeat(k)}! a.yaml`, run: (command) => evaluateBashWriteTargets(command, worktree), n: 20_000 });
    });
  });
});

// Re-review of #1208: git global options ahead of the subcommand, format-patch's output
// directory, and wrappers or valued options in front of a piped shell.
describe('validate-bash-command.js — #1184 re-review: git globals, format-patch, piped-shell wrappers', () => {
  const OUTSIDE_FORMS: Array<(main: string) => string> = [
    (m) => `git -c x.y=1 -C ${m} diff --output=o1`,
    (m) => `git --no-pager -C ${m} diff --output=o1`,
    (m) => `git --git-dir=${m}/.git -C ${m} diff --output=o1`,
    (m) => `git --git-dir ${m}/.git log -p --output=o1`,
    (m) => `git --work-tree=${m} diff --output=o1`,
    (m) => `git -C ${m} format-patch -o patches HEAD~1`,
    (m) => `git format-patch -o ${m}/patches HEAD~1`,
    (m) => `git format-patch -o${m}/patches HEAD~1`,
    (m) => `git format-patch --output-directory=${m}/patches HEAD~1`,
    (m) => `git format-patch --output-directory ${m}/patches HEAD~1`,
  ];
  for (const build of OUTSIDE_FORMS) {
    test(`#1184: \`${build('<main>')}\` is denied`, async () => {
      await withLinkedWorktree('blackhole-hook-1184-', async (mainRepo, worktree) => {
        const result = await run(build(mainRepo), worktree);

        expect(result.exitCode).toBe(2);
        expect(readHookEvents(mainRepo)[0]).toMatchObject({ tier: 'block', pattern_id: 'bash-outside-assigned-worktree' });
      });
    });
  }

  for (const command of ['git -c x.y=1 --no-pager diff --output=o1', 'git format-patch -o patches HEAD~1', 'git --work-tree=WT diff --output=o1']) {
    test(`#1184: in-root \`${command}\` stays allowed`, async () => {
      await withLinkedWorktree('blackhole-hook-1184-', async (mainRepo, worktree) => {
        const result = await run(command.replace('WT', worktree), worktree);

        expect(result.exitCode).toBe(0);
        expect(readHookEvents(mainRepo)).toEqual([]);
      });
    });
  }

  for (const command of ["echo 'x' | bash -o pipefail", "echo 'x' | env bash", "echo 'x' | sudo sh", "echo 'x' | bash +o posix -s"]) {
    test(`#1184: \`${command}\` warns as a piped shell script`, async () => {
      await withLinkedWorktree('blackhole-hook-1184-', async (mainRepo, worktree) => {
        const result = await run(command, worktree);

        expect(result.exitCode).toBe(0);
        expect(readHookEvents(mainRepo)[0]).toMatchObject({ tier: 'warn', pattern_id: 'bash-write-target-unresolvable' });
      });
    });
  }

  test('#1184: 16k chained `-C a` options are evaluated in linear time', async () => {
    await withLinkedWorktree('blackhole-hook-1184-', async (_mainRepo, worktree) => {
      const { evaluateBashWriteTargets } = require(path.join(PRETOOLUSE_HOOKS_DIR, 'utils', 'bash-write-target-guard.js'));
      expectLinearTime({ build: (k) => `git ${'-C a '.repeat(k)}diff --output=o1`, run: (command) => evaluateBashWriteTargets(command, worktree), n: 4_000 });
    });
  });
});

// Follow-ups from the #1208 review (#1222): linear containment for deep relative targets, git
// aliases and exec-carrying config passed with `-c`, format-patch writing into the `-C` directory,
// and a piped `grep bash` that is not a shell.
describe('bash-write-target-guard.js — #1222 deep-path containment stays linear', () => {
  const guard = () => require(path.join(PRETOOLUSE_HOOKS_DIR, 'utils', 'bash-write-target-guard.js'));

  test('#1222: 64k chained `-C a` options are evaluated in linear time', async () => {
    await withLinkedWorktree('blackhole-hook-1222-', async (_mainRepo, worktree) => {
      const { evaluateBashWriteTargets } = guard();
      expectLinearTime({ build: (k) => `git ${'-C a '.repeat(k)}diff --output=o1`, run: (command) => evaluateBashWriteTargets(command, worktree), n: 16_000 });
    });
  });

  // Direct timings of the resolver itself: a missing 32k-deep path, and a deep existing tree.
  test('#1222: resolveExistingAncestor on a 32k-deep missing path stays linear', () => {
    const { resolveExistingAncestor } = require(path.join(PRETOOLUSE_HOOKS_DIR, 'utils', 'hook-event-log.js'));
    const deep = path.join(os.tmpdir(), 'a/'.repeat(32_000), 'x');
    expect(resolveExistingAncestor(deep)).toBe(fs.realpathSync(os.tmpdir()));
    expectLinearTime({ build: (k) => path.join(os.tmpdir(), 'a/'.repeat(k), 'x'), run: (target) => resolveExistingAncestor(target), n: 8_000 });
  });

  test('#1222: resolveExistingAncestor under a deep existing tree behind a symlink stays linear', () => {
    const { resolveExistingAncestor } = require(path.join(PRETOOLUSE_HOOKS_DIR, 'utils', 'hook-event-log.js'));
    const base = fs.mkdtempSync(path.join(os.tmpdir(), 'blackhole-hook-1222-deep-'));
    try {
      fs.mkdirSync(path.join(base, 'real'));
      fs.symlinkSync(path.join(base, 'real'), path.join(base, 'link'));
      const depth = Math.floor((3_800 - base.length) / 2);
      const tree = 'a/'.repeat(depth);
      fs.mkdirSync(path.join(base, 'real', tree), { recursive: true });
      const target = path.join(base, 'link', tree, 'missing', 'x');
      expect(resolveExistingAncestor(target)).toBe(fs.realpathSync(path.join(base, 'real', tree)));
      // Depth is bounded by PATH_MAX, so the step is 2x with a proportionally lower ratio limit.
      expectLinearTime({
        build: (k) => path.join(base, 'link', 'a/'.repeat(k), 'missing', 'x'),
        run: (p) => resolveExistingAncestor(p),
        n: Math.floor(depth / 2),
        factor: 2,
        maxRatio: 3,
      });
    } finally {
      fs.rmSync(base, { recursive: true, force: true });
    }
  });

  test('#1222: a 32k-character `-c` key is matched in linear time', async () => {
    await withLinkedWorktree('blackhole-hook-1222-', async (_mainRepo, worktree) => {
      const { evaluateBashWriteTargets } = require(path.join(PRETOOLUSE_HOOKS_DIR, 'utils', 'bash-write-target-guard.js'));
      for (const family of ['sendemail', 'diff', 'includeIf']) {
        expectLinearTime({
          build: (k) => `git -c ${family}.${'a.'.repeat(k)}x=1 log`,
          run: (command) => evaluateBashWriteTargets(command, worktree),
          n: 4_000,
        });
      }
    });
  });

  test('#1222: a deep relative path that climbs out with `..` is still denied', async () => {
    await withLinkedWorktree('blackhole-hook-1222-', async (mainRepo, worktree) => {
      const up = path.relative(worktree, mainRepo);
      const verdict = guard().evaluateBashWriteTargets(`echo hi > ${'a/'.repeat(50)}${'../'.repeat(50)}${up}/x`, worktree);
      expect(verdict).toMatchObject({ tier: 'block', pattern_id: 'bash-outside-assigned-worktree' });
    });
  });
});

describe('validate-bash-command.js — #1222 git -c aliases, -C format-patch, piped grep', () => {
  // One row per exec-carrying config key family; removing any family from the guard fails its row.
  for (const setting of [
    'filter.lfs.clean=x',
    'pager.log=x',
    'core.editor=x',
    'core.fsmonitor=x',
    'core.hooksPath=x',
    'core.askpass=x',
    'sequence.editor=x',
    'diff.foo.textconv=x',
    'diff.foo.command=x',
    'gpg.program=x',
    'gpg.x509.program=x',
    'credential.helper=x',
    'include.path=x',
    'includeIf.gitdir:/x.path=x',
    'core.alternateRefsCommand=x',
    'core.gitProxy=x',
    'remote.origin.uploadpack=x',
    'remote.origin.receivepack=x',
    'merge.foo.driver=x',
    'difftool.foo.cmd=x',
    'mergetool.foo.cmd=x',
    'submodule.foo.update=!x',
    'gpg.ssh.defaultKeyCommand=x',
    'sendemail.sendmailCmd=x',
    'sendemail.toCmd=x',
    'protocol.ext.allow=always',
    '"alias.d"=x',
    'core.pa"ger"=x',
  ]) {
    test(`#1222: \`git -c ${setting} log\` warns (exec-carrying config key)`, async () => {
      await withLinkedWorktree('blackhole-hook-1222-', async (_mainRepo, worktree) => {
        const { evaluateBashWriteTargets } = require(path.join(PRETOOLUSE_HOOKS_DIR, 'utils', 'bash-write-target-guard.js'));
        expect(evaluateBashWriteTargets(`git -c ${setting} log`, worktree)).toMatchObject({ tier: 'warn' });
      });
    });
  }

  for (const command of [
    'GIT_PAGER=x git log',
    'env GIT_EXTERNAL_DIFF=x git diff',
    'GIT_SSH_COMMAND=x git fetch',
    'GIT_CONFIG_COUNT=1 GIT_CONFIG_KEY_0=core.pager GIT_CONFIG_VALUE_0=x git log',
    "GIT_CONFIG_PARAMETERS=\"'core.pager'='x'\" git log",
    'export GIT_CONFIG_GLOBAL=/tmp/cfg; git log',
  ]) {
    test(`#1222: \`${command}\` warns (git config or command through the environment)`, async () => {
      await withLinkedWorktree('blackhole-hook-1222-', async (_mainRepo, worktree) => {
        const { evaluateBashWriteTargets } = require(path.join(PRETOOLUSE_HOOKS_DIR, 'utils', 'bash-write-target-guard.js'));
        expect(evaluateBashWriteTargets(command, worktree)).toMatchObject({ tier: 'warn' });
      });
    });
  }

  test('#1222: `submodule.foo.update=checkout` (no command) stays allowed', async () => {
    await withLinkedWorktree('blackhole-hook-1222-', async (_mainRepo, worktree) => {
      const { evaluateBashWriteTargets } = require(path.join(PRETOOLUSE_HOOKS_DIR, 'utils', 'bash-write-target-guard.js'));
      expect(evaluateBashWriteTargets('git -c submodule.foo.update=checkout status', worktree)).toBeNull();
    });
  });

  for (const build of [
    (m: string) => `git -c format.outputDirectory=${m} format-patch -1`,
    (m: string) => `git -c Format.OutputDirectory="${m}" format-patch -1`,
  ]) {
    test(`#1222: \`${build('<main>')}\` (configured output directory) is denied`, async () => {
      await withLinkedWorktree('blackhole-hook-1222-', async (mainRepo, worktree) => {
        const result = await run(build(mainRepo), worktree);

        expect(result.exitCode).toBe(2);
        expect(readHookEvents(mainRepo)[0]).toMatchObject({ tier: 'block', pattern_id: 'bash-outside-assigned-worktree' });
      });
    });
  }

  for (const command of [
    "git -c alias.d='!touch /etc/x' d",
    'git -c alias.d=!sh d',
    "git -c alias.fp='format-patch -o /etc' fp",
    "git -c 'alias.d=!touch /etc/x' d",
    'git --config-env=alias.d=CMD d',
    "git -c core.pager='sh -c x' log",
    "git -c core.sshCommand='touch /etc/x' fetch",
    "git -c diff.external='touch /etc/x' diff",
  ]) {
    test(`#1222: \`${command}\` warns (git runs a command the string does not show)`, async () => {
      await withLinkedWorktree('blackhole-hook-1222-', async (mainRepo, worktree) => {
        const result = await run(command, worktree);

        expect(result.exitCode).toBe(0);
        expect(readHookEvents(mainRepo)[0]).toMatchObject({ tier: 'warn', pattern_id: 'bash-write-target-unresolvable' });
      });
    });
  }

  test('#1222: `git -c user.name=x commit` (no exec-carrying key) stays allowed with no event', async () => {
    await withLinkedWorktree('blackhole-hook-1222-', async (mainRepo, worktree) => {
      const result = await run("git -c user.name=x -c core.autocrlf=false status", worktree);

      expect(result.exitCode).toBe(0);
      expect(readHookEvents(mainRepo)).toEqual([]);
    });
  });

  test('#1222: `git -C <outside> format-patch -1` (patches written into the -C directory) is denied', async () => {
    await withLinkedWorktree('blackhole-hook-1222-', async (mainRepo, worktree) => {
      const result = await run(`git -C ${mainRepo} format-patch -1`, worktree);

      expect(result.exitCode).toBe(2);
      expect(readHookEvents(mainRepo)[0]).toMatchObject({ tier: 'block', pattern_id: 'bash-outside-assigned-worktree' });
    });
  });

  for (const command of ['git format-patch -1', 'git -C sub format-patch -1', 'git -C MAIN format-patch --stdout -1']) {
    test(`#1222: \`${command}\` stays allowed`, async () => {
      await withLinkedWorktree('blackhole-hook-1222-', async (mainRepo, worktree) => {
        const result = await run(command.replace('MAIN', mainRepo), worktree);

        expect(result.exitCode).toBe(0);
        expect(readHookEvents(mainRepo)).toEqual([]);
      });
    });
  }

  for (const command of ['ps aux | grep bash', 'ps | grep -c sh', "pgrep -a node | rg 'bash'"]) {
    test(`#1222: \`${command}\` is not a piped shell and stays allowed with no event`, async () => {
      await withLinkedWorktree('blackhole-hook-1222-', async (mainRepo, worktree) => {
        const result = await run(command, worktree);

        expect(result.exitCode).toBe(0);
        expect(readHookEvents(mainRepo)).toEqual([]);
      });
    });
  }

  test('#1222: `echo x | grep x | bash` still warns (the last stage is a shell)', async () => {
    await withLinkedWorktree('blackhole-hook-1222-', async (mainRepo, worktree) => {
      const result = await run("echo 'x' | grep x | bash", worktree);

      expect(result.exitCode).toBe(0);
      expect(readHookEvents(mainRepo)[0]).toMatchObject({ tier: 'warn', pattern_id: 'bash-write-target-unresolvable' });
    });
  });
});

// Round-2 review of #1232 (#1222): `--config-env` output directories, `-c` words the shell rewrites,
// and the remaining exec-carrying environment variables and config keys.
describe('bash-write-target-guard.js — #1222 round 2: config words, env and keys', () => {
  const verdict = async (build: (main: string) => string) => {
    let result: unknown = undefined;
    await withLinkedWorktree('blackhole-hook-1222-', async (mainRepo, worktree) => {
      const { evaluateBashWriteTargets } = require(path.join(PRETOOLUSE_HOOKS_DIR, 'utils', 'bash-write-target-guard.js'));
      result = evaluateBashWriteTargets(build(mainRepo), worktree);
    });
    return result;
  };

  test('#1222: `git --config-env=format.outputDirectory=D format-patch -1` warns (directory read from the env)', async () => {
    expect(await verdict(() => 'git --config-env=format.outputDirectory=D format-patch -1')).toMatchObject({
      tier: 'warn',
      pattern_id: 'bash-write-target-unresolvable',
    });
  });

  // A backslash, `$` or `$'..'` in a `-c` word is rewritten by the shell before git sees it, so
  // the key or value read from the string is not the one git applies.
  for (const build of [
    () => 'git -c core.pa\\ger=x log',
    () => 'git -c \\core.pager=x log',
    () => "git -c $'core.pager'=x log",
    () => 'git -c "$K"=x log',
    () => 'git -c core.$P=x log',
    () => 'git -c submodule.foo.update=\\!x submodule update',
    (m: string) => `git -c format.output\\Directory=${m} format-patch -1`,
    (m: string) => `git -c format.outputDirectory=\\${m} format-patch -1`,
    () => 'git -c core.`echo`pager=x log',
    () => 'git -c {alias.x=!touch\\ X,-p} x',
    () => 'git {-c,alias.x=!touch\\ X} x',
    () => 'git -c {alias.x=!touch,-p} x',
    () => 'git {-c,alias.x=!touch} x',
    () => 'git -c x=1 {-c,alias.x=!touch} x',
  ]) {
    test(`#1222: \`${build('<main>')}\` warns or blocks, never allows`, async () => {
      expect(await verdict(build)).toMatchObject({ tier: expect.stringMatching(/^(warn|block)$/) });
    });
  }

  for (const command of ["git commit -m '{a,b}'", 'git log --format="{x,y}"', 'git log \\{a,b\\}', 'git log {a}']) {
    test(`#1222: \`${command}\` (no unquoted brace expansion) stays allowed`, async () => {
      expect(await verdict(() => command)).toBeNull();
    });
  }

  test('#1222: a `$` in the value of a key that runs nothing stays allowed', async () => {
    expect(await verdict(() => 'git -c user.name="$NAME" status')).toBeNull();
  });

  for (const command of [
    'GIT_SSH=x git fetch',
    'GIT_EDITOR=x git commit',
    'GIT_SEQUENCE_EDITOR=x git rebase -i HEAD~2',
    'GIT_ASKPASS=x git fetch',
    'GIT_PROXY_COMMAND=x git fetch',
    'PAGER=x git log',
    'EDITOR=x git commit',
    'VISUAL=x git commit',
    'SSH_ASKPASS=x git fetch',
    'GIT_EXEC_PATH=/tmp/x git log',
    'GIT_ALLOW_PROTOCOL=ext git fetch',
  ]) {
    test(`#1222: \`${command}\` warns (git runs a command through the environment)`, async () => {
      expect(await verdict(() => command)).toMatchObject({ tier: 'warn', pattern_id: 'bash-write-target-unresolvable' });
    });
  }

  for (const setting of [
    'protocol.allow=always',
    'sendemail.smtpServer=/tmp/x',
    'uploadpack.packObjectsHook=x',
    'man.foo.cmd=x',
    'man.foo.path=x',
    'man.viewer=foo',
    'browser.foo.cmd=x',
    'browser.foo.path=x',
    'web.browser=foo',
    'instaweb.httpd=x',
  ]) {
    test(`#1222: \`git -c ${setting} log\` warns (exec-carrying config key)`, async () => {
      expect(await verdict(() => `git -c ${setting} log`)).toMatchObject({ tier: 'warn', pattern_id: 'bash-write-target-unresolvable' });
    });
  }

  for (const command of ['PAGERS=x git log', 'MY_EDITOR=x git status', 'git -c man.foo.other=x log']) {
    test(`#1222: \`${command}\` (not an exec variable or key) stays allowed`, async () => {
      expect(await verdict(() => command)).toBeNull();
    });
  }
});

// Issue #1246: git appends a trace to the file a `GIT_TRACE*` variable names, so a literal
// absolute value is a write target. `1`, `true`, `0`, `false` and `2`–`9` mean stderr, off or an
// fd; any other value that is not absolute is ignored by git.
describe('bash-write-target-guard.js — GIT_TRACE* variables write files (#1246)', () => {
  const verdict = async (build: (main: string, wt: string) => string) => {
    let result: unknown = undefined;
    await withLinkedWorktree('blackhole-hook-1246-', async (mainRepo, worktree) => {
      const { evaluateBashWriteTargets } = require(path.join(PRETOOLUSE_HOOKS_DIR, 'utils', 'bash-write-target-guard.js'));
      result = evaluateBashWriteTargets(build(mainRepo, worktree), worktree);
    });
    return result;
  };
  const BLOCK = { tier: 'block', pattern_id: 'bash-outside-assigned-worktree' };
  const WARN = { tier: 'warn', pattern_id: 'bash-write-target-unresolvable' };

  const FAMILIES = [
    'GIT_TRACE',
    'GIT_TRACE_PACKET',
    'GIT_TRACE_PERFORMANCE',
    'GIT_TRACE_SETUP',
    'GIT_TRACE_CURL',
    'GIT_TRACE2',
    'GIT_TRACE2_EVENT',
    'GIT_TRACE2_PERF',
  ];

  for (const name of FAMILIES) {
    test(`#1246: \`${name}=<main>/t git status\` is denied`, async () => {
      expect(await verdict((m) => `${name}=${m}/t git status`)).toMatchObject(BLOCK);
    });
    test(`#1246: \`${name}=<wt>/t git status\` stays allowed`, async () => {
      expect(await verdict((_m, w) => `${name}=${w}/t git status`)).toBeNull();
    });
  }

  test('#1246: the issue example `GIT_TRACE=<outside>/x git status` is denied through the full hook', async () => {
    await withLinkedWorktree('blackhole-hook-1246-', async (mainRepo, worktree) => {
      const result = await run(`GIT_TRACE=${mainRepo}/x git status`, worktree);

      expect(result.exitCode).toBe(2);
      expect(readHookEvents(mainRepo)[0]).toMatchObject(BLOCK);
    });
  });

  for (const [label, build] of [
    ['export then git', (m: string) => `export GIT_TRACE=${m}/t; git status`],
    ['through env', (m: string) => `env GIT_TRACE_PACKET=${m}/t git fetch`],
    ['quoted value', (m: string) => `GIT_TRACE="${m}/t" git status`],
    ['GIT_TRACE2_EVENT naming a directory', (m: string) => `GIT_TRACE2_EVENT=${m} git status`],
    ['a later family member', (m: string) => `GIT_TRACE_PACK_ACCESS=${m}/t git status`],
    // A whole-word-quoted assignment, `+=`, and a quoted name, where the shell expects an assignment.
    ['env with a quoted assignment', (m: string) => `env "GIT_TRACE=${m}/x" git status`],
    ['env with a single-quoted assignment', (m: string) => `env 'GIT_TRACE=${m}/x' git status`],
    ['env with an option before a quoted assignment', (m: string) => `env -i "GIT_TRACE=${m}/x" git status`],
    ['a wrapper before env', (m: string) => `sudo env "GIT_TRACE_PACKET=${m}/t" git fetch`],
    ['export with a quoted assignment', (m: string) => `export "GIT_TRACE=${m}/x"; git status`],
    ['export after another assignment', (m: string) => `export A=1 "GIT_TRACE=${m}/x"; git status`],
    ['export after a bare name', (m: string) => `export FOO "GIT_TRACE=${m}/x"; git status`],
    ['export after two bare names', (m: string) => `export A B "GIT_TRACE=${m}/x"; git status`],
    ['export -n after a bare name', (m: string) => `export -n A "GIT_TRACE=${m}/x"; git status`],
    ['declare -x after a bare name', (m: string) => `declare -x A "GIT_TRACE=${m}/x"; git status`],
    ['typeset after a bare name', (m: string) => `typeset A "GIT_TRACE=${m}/x"; git status`],
    ['readonly after a bare name', (m: string) => `readonly A "GIT_TRACE=${m}/x"; git status`],
    ['local after a bare name', (m: string) => `local A "GIT_TRACE=${m}/x"; git status`],
    ['a quoted variable name', (m: string) => `env 'GIT_TRACE'=${m}/x git status`],
    ['`+=` on a prefix assignment', (m: string) => `GIT_TRACE+=${m}/x git status`],
    ['`+=` through export', (m: string) => `export GIT_TRACE+=${m}/x; git status`],
    ['`+=` through env with a quoted word', (m: string) => `env "GIT_TRACE+=${m}/x" git status`],
  ] as const) {
    test(`#1246: ${label} is denied`, async () => {
      expect(await verdict(build)).toMatchObject(BLOCK);
    });
  }

  for (const command of ['GIT_TRACE=$LOG git status', 'GIT_TRACE="$HOME/t" git status', 'GIT_TRACE=`pwd`/t git status', 'GIT_TRACE=~/t git status']) {
    test(`#1246: \`${command}\` warns (the trace file is not known statically)`, async () => {
      expect(await verdict(() => command)).toMatchObject(WARN);
    });
  }

  for (const command of ['env "GIT_TRACE=$LOG" git status', 'export "GIT_TRACE=$HOME/t"; git status', 'GIT_TRACE+=$LOG git status']) {
    test(`#1246: \`${command}\` warns (a quoted or appended trace file is not known statically)`, async () => {
      expect(await verdict(() => command)).toMatchObject(WARN);
    });
  }

  // A slot word holding `$`, a backtick, `\`, `{` or `}` is opaque: the guard does not decode
  // `$'...'` or `$"..."`, so an opaque word holding `=` whose name is not a plain identifier warns.
  for (const build of [
    (m: string) => `env $'GIT_TRACE=${m}/x' git status`,
    (m: string) => `export A $'GIT_TRACE=${m}/x'; git status`,
    (m: string) => `export $'GIT_TRACE=${m}/x'; git status`,
    (m: string) => `env $'GIT_TRACE'=${m}/x git status`,
    (m: string) => `export A $'GIT_TRACE'=${m}/x; git status`,
    (m: string) => `export GIT_$'TRACE'=${m}/x; git status`,
    (m: string) => `env GIT_$'TRACE'=${m}/x git status`,
    (m: string) => `export $'GIT_TRAC\\x45=${m}/x'`,
    (m: string) => `export $'GIT\\x5fTRACE=${m}/x'`,
    (m: string) => `env $'\\x47IT_TRACE=${m}/x' git status`,
    (m: string) => `export $'\\107IT_TRACE=${m}/x'`,
    (m: string) => `env $'GIT_\\x54RACE=${m}/x' git status`,
    (m: string) => `env $'GIT_T\\122ACE=${m}/x' git status`,
    (m: string) => `env $'GIT_TRAC\\u0045=${m}/x' git status`,
    (m: string) => `env $'GIT_TRAC\\U00000045=${m}/x' git status`,
    (m: string) => `env $'GIT_TRAC\\x4' git status; env $'GIT_TRACE=${m}/x' git status`,
    (m: string) => `env $'GIT_TRACE=\\x${[...m].map((c) => c.charCodeAt(0).toString(16)).join('\\x')}/x' git status`,
    (m: string) => `export $"GIT_TRACE=${m}/x"`,
    (m: string) => `env $"GIT_TRACE=${m}/x" git status`,
    (m: string) => `env $"GIT_TRACE"=${m}/x git status`,
    (m: string) => `export A $"GIT_TRACE=${m}/x"; git status`,
  ]) {
    test(`#1246: \`${build('<main>')}\` warns (opaque slot word)`, async () => {
      expect(await verdict((m) => build(m))).toMatchObject(WARN);
    });
  }

  for (const command of ["env $'GIT_TRACE=$LOG' git status", "env $'GIT_TRAC\\x45'=$LOG git status", 'env $"GIT_TRACE=$LOG" git status']) {
    test(`#1246: \`${command}\` warns (the decoded name carries an expanded value)`, async () => {
      expect(await verdict(() => command)).toMatchObject(WARN);
    });
  }

  // A NUL inside `$'...'` ends the span in bash; the guard does not model that, so every such word is
  // opaque and warns, whichever side of the root the decoded value lands on.
  const tail = (m: string, w: string) => path.relative(`${m}/x`, `${w}/y`);
  for (const nul of ['\\x00', '\\000', '\\400', '\\c@', '\\0', '\\00', '\\u0000', '\\x0']) {
    for (const build of [
      (m: string, w: string) => `export $'GIT_TRACE=${m}/x${nul}/${tail(m, w)}'; git status`,
      (m: string, w: string) => `env $'GIT_TRACE=${m}/x${nul}/${tail(m, w)}' git status`,
      (m: string, w: string) => `$'GIT_TRACE=${m}/x${nul}/${tail(m, w)}' git status`,
      (m: string, w: string) => `export GIT_TRACE=$'${m}/x${nul}/${tail(m, w)}'; git status`,
    ]) {
      test(`#1246: \`${build('<main>', '<wt>')}\` warns (opaque slot word)`, async () => {
        expect(await verdict(build)).toMatchObject(WARN);
      });
    }
  }
  for (const build of [
    // A NUL ends a span that spells the command word (`commandName` decodes it).
    (m: string) => `$'tee\\x00z' ${m}/x`,
    (m: string) => `$'cp\\x00z' a ${m}/x`,
    (m: string) => `$'export\\x00z' "GIT_TRACE=${m}/x"; git status`,
    // `env` reads every operand holding `=` as an assignment, quoted or not, up to its command.
    (m: string) => `env "A=1" "GIT_TRACE=${m}/x" git status`,
    (m: string) => `env -u B "A=1" "GIT_TRACE=${m}/x" git status`,
  ]) {
    test(`#1246: \`${build('<main>', '<wt>')}\` is denied`, async () => {
      expect(await verdict(build)).toMatchObject(BLOCK);
    });
  }
  for (const build of [
    (m: string, w: string) => `export $'GIT_TRACE=${w}/a\\c\\\\x00/${path.relative(`${w}/a\x1cx00`, `${m}/y`)}'; git status`,
    (m: string) => `env 'A=1' $'GIT_TRACE=${m}/x' git status`,
    (m: string) => `env $'GIT_TRAC\\x4'=/tmp/t $'GIT_TRAC\\x45=${m}/x' git status`,
    (m: string) => `GIT_TRACE=\\${m}/t git status`,
  ]) {
    test(`#1246: \`${build('<main>', '<wt>')}\` warns (opaque slot word)`, async () => {
      expect(await verdict(build)).toMatchObject(WARN);
    });
  }
  // A `$` inside quotes still makes the word opaque, so these warn rather than resolve.
  const escapedTo = (from: string, to: string) => path.relative(from, to).split('/').join('\\x2f');
  for (const build of [
    (m: string, w: string) => `export "GIT_TRACE=${m}/evil$'\\x2f${escapedTo(`${m}/evil`, `${w}/z`)}'"; git status`,
    (m: string, w: string) => `export "GIT_TRACE=${w}/a$'\\x00/${path.relative(`${w}/x`, `${m}/y`)}'"; git status`,
    (m: string, w: string) => `env "GIT_TRACE=${m}/evil$'\\x2f${escapedTo(`${m}/evil`, `${w}/z`)}'" git status`,
    (m: string, w: string) => `export 'GIT_TRACE=${m}/evil$"\\x2f${escapedTo(`${m}/evil`, `${w}/z`)}"'; git status`,
  ]) {
    test(`#1246: \`${build('<main>', '<wt>')}\` warns (opaque slot word)`, async () => {
      expect(await verdict(build)).toMatchObject(WARN);
    });
  }

  // An `env` option that takes a value (`-u`, `-C`, `-a` and their long forms, quoted or not)
  // consumes the next word without ending the assignments.
  for (const build of [
    (m: string) => `env --unset B "GIT_TRACE=${m}/x" git status`,
    (m: string) => `env --unset=B "GIT_TRACE=${m}/x" git status`,
    (m: string) => `env --chdir /tmp "GIT_TRACE=${m}/x" git status`,
    (m: string) => `env '-u' B "GIT_TRACE=${m}/x" git status`,
    (m: string) => `env "--unset" B "GIT_TRACE=${m}/x" git status`,
    (m: string) => `env -iu B "GIT_TRACE=${m}/x" git status`,
    (m: string) => `env -C /tmp 'GIT_TRACE=${m}/x' git status`,
    (m: string) => `env --argv0 g "GIT_TRACE=${m}/x" git status`,
  ]) {
    test(`#1246: \`${build('<main>')}\` is denied (an env option value never ends the assignments)`, async () => {
      expect(await verdict(build)).toMatchObject(BLOCK);
    });
  }
  // A `-S` string holding an expansion, and a value with glob or brace characters (which `env` and
  // `export` operands expand), name a trace file that is not known statically.
  for (const build of [
    () => 'env -S "GIT_TRACE=$LOG git status"',
    () => 'env --split-string="GIT_TRACE=$LOG git status"',
    () => 'env -S"GIT_TRACE=$LOG git status"',
    (_m: string, w: string) => `env GIT_TRACE=${w}/* git status`,
    (_m: string, w: string) => `export GIT_TRACE=${w}/{a,b}; git status`,
  ]) {
    test(`#1246: \`${build('<main>', '<wt>')}\` warns (the trace file is not known statically)`, async () => {
      expect(await verdict(build)).toMatchObject(WARN);
    });
  }

  // Fail closed: an `env` option word that is not an exact known option (getopt_long accepts any
  // unambiguous abbreviation, and every `-S` spelling is refused), and a bare `export GIT_TRACE` of
  // a value set elsewhere, warn.
  for (const build of [
    (m: string) => `env --uns B "GIT_TRACE=${m}/x" git status`,
    (m: string) => `env --u B "GIT_TRACE=${m}/x" git status`,
    (m: string) => `env --ch /tmp "GIT_TRACE=${m}/x" git status`,
    (m: string) => `env --split "A=1 GIT_TRACE=${m}/x" git status`,
    (m: string) => `env '--uns' B "GIT_TRACE=${m}/x" git status`,
    (m: string) => `env --frobnicate B "GIT_TRACE=${m}/x" git status`,
    (m: string) => `env -x B "GIT_TRACE=${m}/x" git status`,
    (m: string) => `env -S 'A=1\\_GIT_TRACE=${m}/x git status'`,
    (m: string) => `env -S"A=1\\_GIT_TRACE=${m}/x git status"`,
    (m: string) => `env --split-string='A=1\\_GIT_TRACE=${m}/x' git status`,
    (m: string) => `printf -v GIT_TRACE %s ${m}/x; export GIT_TRACE; git status`,
    () => 'read GIT_TRACE < f; export A GIT_TRACE; git status',
    () => 'declare -x GIT_TRACE_PACKET; git fetch',
  ]) {
    test(`#1246: \`${build('<main>')}\` warns (fails closed)`, async () => {
      expect(await verdict(build)).toMatchObject(WARN);
    });
  }

  // `env -S` in any spelling warns. A trace name exported with no value, an opaque declarer
  // operand, and `set -a` in a command that mentions a trace name warn whatever the command runs
  // (git may run in a subshell, `bash -c` or a substitution).
  for (const build of [
    (m: string) => `BS='\\'; env -S "A=1\${BS}_GIT_TRACE=${m}/x git status"`,
    (m: string) => `X=' '; env -S "A=1\${X}GIT_TRACE=${m}/x git status"`,
    (m: string) => `env -S "A=1$(printf ' ')GIT_TRACE=${m}/x git status"`,
    (m: string) => `env -S 'A=1\${NOPE}GIT_TRACE=${m}/x git status'`,
    (m: string, w: string) => `env -S "GIT_TRACE='${w}/a /${path.relative(`${w}/a `, `${m}/x`)}'" git status`,
    () => 'export GIT_TRACE; (git status)',
    () => "export GIT_TRACE; bash -c 'git status'",
    () => 'export GIT_TRACE; echo "$(git status)"',
    () => 'export GIT_TRACE; echo done',
    () => 'export GIT_TRACE{,}; git status',
    () => "export 'GIT_TRACE'; git status",
    (m: string) => `export GIT_TRACE{,}=${m}/x; git status`,
    (m: string) => `set -a; printf -v GIT_TRACE %s ${m}/x; git status`,
    () => 'set -o allexport; read GIT_TRACE < f; git status',
  ]) {
    test(`#1246: \`${build('<main>', '<wt>')}\` warns (structural fail-closed)`, async () => {
      expect(await verdict(build)).toMatchObject(WARN);
    });
  }
  for (const build of [
    () => 'env --ignore-environment --null git status',
    () => 'env FOO=1 git status',
    () => 'env -i PATH=/usr/bin git log',
    () => 'set -a; FOO=1; git status',
  ]) {
    test(`#1246: \`${build()}\` stays allowed (structural)`, async () => {
      expect(await verdict(build)).toBeNull();
    });
  }
  for (const build of [(m: string) => `env --unset B git commit -m "GIT_TRACE=${m}/x"`]) {
    test(`#1246: \`${build('<main>', '<wt>')}\` stays allowed`, async () => {
      expect(await verdict(build)).toBeNull();
    });
  }

  for (const build of [(m: string) => `env "A=1" git commit -m "GIT_TRACE=${m}/x"`]) {
    test(`#1246: \`${build('<main>', '<wt>')}\` stays allowed`, async () => {
      expect(await verdict(build)).toBeNull();
    });
  }
  for (const build of [
    (m: string, w: string) => `export $'GIT_TRACE=${w}/x\\x00/${path.relative(`${w}/x`, `${m}/y`)}'; git status`,
    (m: string, w: string) => `export $'GIT_TRACE=${m}/x\\x00'/${tail(m, w)}; git status`,
    (m: string, w: string) => `export $'GIT_TRACE=${w}/x\\x00'/${path.relative(`${w}/x`, `${m}/y`)}; git status`,
    () => "env $'GIT_TRAC\\x45=1' git status",
    () => "env $'GIT_TRAC\\u0045=true' git status",
    () => "export $'FOO\\x41=/etc/x'; git status",
    () => "export $'GIT_TRAC\\x58=/etc/x'; git status",
    () => 'export $"FOO=/etc/x"; git status',
    (_m: string, w: string) => `env $'GIT_TRAC\\x45=${w}/x' git status`,
    () => 'env -S "FOO=1 git status"',
    (_m: string, w: string) => `env -S "GIT_TRACE=${w}/x git status"`,
    (m: string) => `env -S "GIT_TRACE=${m}/x git status"`,
    (m: string) => `env --split-string "A=1 GIT_TRACE=${m}/x" git status`,
    (m: string) => `env --split-string="GIT_TRACE=${m}/x git status"`,
    (m: string) => `env -iS"GIT_TRACE=${m}/x git status"`,
  ]) {
    test(`#1246: \`${build('<main>', '<wt>')}\` warns (opaque slot word or \`env -S\`)`, async () => {
      expect(await verdict(build)).toMatchObject(WARN);
    });
  }

  // Closure table of the guard contract (documentation/investigations/issue-1246-guard-contract.md):
  // each row is titled with its row number there.
  const nbsp = (m: string, w: string, sp: string) => `env -S "GIT_TRACE=${w}/a${sp}/${path.relative(`${w}/a${sp}`, `${m}/x`)} git status"`;
  for (const [row, build] of [
    [29, (m: string, w: string) => nbsp(m, w, '\u00a0')],
    [30, (m: string, w: string) => nbsp(m, w, '\u3000')],
    [31, (m: string) => `export {X,GIT}_TRACE=${m}/x; git status`],
    [32, (m: string) => `env {X,GIT}_TRACE=${m}/x git status`],
    [33, (m: string) => `printf -v GIT_TRACE %s ${m}/x; export {X,GIT_TRACE}; git status`],
    [34, (m: string) => `printf -v GIT_TRACE %s ${m}/x; export {GIT,X}_TRACE; git status`],
    [35, (m: string) => `P=GIT_; env \${P}TRACE=${m}/x git status`],
    [36, (m: string) => `P=GIT_; export \${P}TRACE=${m}/x; git status`],
    [37, (m: string) => `env "$P$Q=${m}/x" git status`],
    [38, (m: string) => `declare -x "$P$Q=${m}/x"`],
    [39, (m: string) => `N=GIT_TRACE; printf -v "$N" %s ${m}/x; export "$N"; git status`],
    [40, (m: string) => `declare -n R=GIT_TRACE; export R=${m}/x; git status`],
    [41, (m: string) => `set -o errexit -o allexport; printf -v GIT_TRACE %s ${m}/x; git status`],
    [42, (m: string) => `set -o pipefail -a; printf -v GIT_TRACE %s ${m}/x; git status`],
    [43, (m: string) => `set -euo pipefail -a; printf -v GIT_TRACE %s ${m}/x; git status`],
    [44, (m: string) => `set '-a'; printf -v GIT_TRACE %s ${m}/x; git status`],
    [45, (m: string) => `set \\-a; printf -v GIT_TRACE %s ${m}/x; git status`],
    [46, (m: string) => `set -a; printf -v GIT_TRAC\\E %s ${m}/x; git status`],
    [47, (m: string) => `set -a; printf -v 'GIT_'TRACE %s ${m}/x; git status`],
    [48, (m: string) => `set -a; read -r GIT_TRAC\\E <<< ${m}/x; git status`],
    [53, (m: string) => `export $'\\x47IT_TRAC\\x45=${m}/x'`],
    [54, (m: string) => `export {G,X}IT_T{R,}ACE=${m}/x`],
    [55, (m: string) => `env $'GIT_TRACE\\x3d${m}/x' git status`],
    [56, (m: string) => `shopt -os allexport; printf -v GIT_TRACE %s ${m}/x; git status`],
    [57, (m: string) => `set -$'a'; printf -v GIT_TRACE %s ${m}/x; git status`],
    [58, (m: string) => `typeset -n R=GIT_TRACE; export R=${m}/x; git status`],
    [58, (m: string) => `local -n R=GIT_TRACE; export R=${m}/x; git status`],
    [59, (m: string) => `env -vS'GIT_TRACE=${m}/x git status'`],
    [60, (m: string) => `env --split-s="GIT_TRACE=${m}/x git status"`],
    [61, (m: string) => `X='GIT_TRACE=${m}/x'; env $X git status`],
    [64, (m: string) => `exec env -S 'GIT_TRACE=${m}/x git status'`],
    [80, (m: string) => `case x in a) export {X,GIT}_TRACE=${m}/x;; esac`],
    [81, (m: string) => `export $(printf 'GIT_TRACE=%s' ${m}/x); git status`],
    [82, (m: string) => `P=GIT_; Q=TRACE; env "$P$Q=${m}/x" git status`],
  ] as const) {
    test(`#1246: contract row ${row} \`${build('<main>', '<wt>')}\` warns`, async () => {
      expect(await verdict(build)).toMatchObject(WARN);
    });
  }
  for (const [row, build] of [
    [62, (m: string) => `export $(echo GIT_TRACE=${m}/x); git status`],
    [63, (m: string) => `set -a; source <(echo GIT_TRACE=${m}/x); git status`],
    [66, (m: string) => `make GIT_TRACE=${m}/x`],
    [73, (m: string) => `case x in a) export "GIT_TRACE=${m}/x";; esac; git status`],
    [74, (m: string) => `f() { export "GIT_TRACE=${m}/x"; }; f; git status`],
    [75, (m: string) => `function f { export "GIT_TRACE=${m}/x"; }; f; git status`],
    [76, (m: string) => `if true; then export "GIT_TRACE=${m}/x"; fi; git status`],
    [77, (m: string) => `while true; do export "GIT_TRACE=${m}/x"; done`],
    [78, (m: string) => `case x in a) env "GIT_TRACE=${m}/x" git status;; esac`],
    [79, (m: string) => `f() { env "GIT_TRACE=${m}/x" git status; }; f`],
    [83, (m: string) => `export X=$(true) "GIT_TRACE=${m}/x"; git status`],
    [84, (m: string) => `export X=\\( "GIT_TRACE=${m}/x"; git status`],
  ] as const) {
    test(`#1246: contract row ${row} \`${build('<main>')}\` is denied`, async () => {
      expect(await verdict(build)).toMatchObject(BLOCK);
    });
  }
  for (const [row, command] of [
    ['A1', 'git status'],
    ['A5', 'set -a; source .env; npm test'],
    ['A6', 'set -a; . ./.env; set +a; npm test'],
    ['A7', 'set -euo pipefail; git status'],
    ['A8', 'export GIT_TRACE=1; git status'],
    ['A9', 'export PATH="$HOME/bin:$PATH"; git status'],
    ['A10', 'declare -x FOO=bar; git status'],
    ['A11', "git commit -m 'GIT_TRACE=/x'"],
    ['A16', 'export X=$(cmd "$y"); git status'],
    ['A17', 'local d=$(dirname "$0")'],
    ['A18', 'export X="$(git rev-parse --show-toplevel)"'],
    ['A19', 'declare -a arr=("$a" "$b"); git status'],
    ['A20', 'grep -rn export "$DIR"'],
    ['everyday', 'NODE_OPTIONS=--max-old-space-size=1536 bun test x'],
  ] as const) {
    test(`#1246: contract row ${row} \`${command}\` stays allowed`, async () => {
      expect(await verdict(() => command)).toBeNull();
    });
  }

  for (const value of ['1', 'true', 'TRUE', '0', 'false', '', ...'23456789']) {
    test(`#1246: \`GIT_TRACE=${value} git status\` (stderr, off or an fd) stays allowed`, async () => {
      expect(await verdict(() => `GIT_TRACE=${value} git status`)).toBeNull();
    });
  }

  for (const build of [
    (_m: string, w: string) => `GIT_TRACE2_EVENT=${w}/traces git status`,
    () => 'GIT_TRACE=relative/t git status',
    () => 'GIT_TRACE2_CONFIG_PARAMS=core.pager git status',
    () => 'GIT_TRACE2_ENV_VARS=HOME,PATH git status',
    () => 'GIT_TRACE_REDACT=0 git status',
    () => "git commit -m 'GIT_TRACE=/etc/x'",
    () => 'echo "GIT_TRACE=/etc/x"',
    () => 'grep "GIT_TRACE=/etc/x" notes.txt',
    () => 'env "GIT_TRACE=1" git status',
    () => 'export "GIT_TRACE=true"; git status',
    () => 'export FOO "BAR=1"; git status',
    () => 'export FOO "GIT_TRACE=true"; git status',
    () => "git commit -m $'GIT_TRACE=/etc/x'",
    () => "echo $'GIT_TRACE=/etc/x'",
    () => 'export FOO="GIT_TRACE=/etc/x"; git status',
    (m: string) => `GIT_DIR=${m}/.git git log`,
  ]) {
    test(`#1246: \`${build('<main>', '<wt>')}\` stays allowed`, async () => {
      expect(await verdict(build)).toBeNull();
    });
  }
});
