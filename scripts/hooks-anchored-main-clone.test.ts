import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { PRETOOLUSE_HOOKS_DIR, readHookEvents, runGit, writeInstalledPlugins } from './lib/test-fixtures.ts';

// The campaign config, state dir and scratchpad config are read from a main clone anchored to the
// harness project dir (`CLAUDE_PROJECT_DIR`); git metadata in cwd is only confirmed against it.
// With an established anchor, a worker that forges that metadata (a worktree whose admin dir sits in
// a clone it controls, a planted nested `.git`, a real nested repo) must not turn a forged
// `config.json` into a write root. When no anchor can be established the pre-anchor decision holds
// (git metadata in cwd) plus one stderr warning, and never a new deny.
// `HOOKS_DIR` points the spec at another copy of the hooks, for a head-versus-main differential.

const HOOKS_DIR = process.env.HOOKS_DIR || PRETOOLUSE_HOOKS_DIR;
const FILE_HOOK = 'validate-file-changes.js';
const BASH_HOOK = 'validate-bash-command.js';
const NO_CLAUDE_HOME = path.join(os.tmpdir(), 'blackhole-hook-fixtures-no-claude-home');
const ANCHOR_WARNING = 'main-clone-anchor-unavailable';
// Variant A is refused earlier, where `mainCloneRoot` throws on a `.git` pointer into the worktree:
// the Write hook reports it as a resolution failure, the Bash guard through its fail-closed catch-all.
const FORGED_POINTER_IDS = ['worktree-root-resolution-failure', 'uncaught-validator-error'];
const CONTAINMENT_IDS = ['outside-worktree', 'outside-assigned-worktree', 'bash-outside-worktree', 'bash-outside-assigned-worktree'];
const SCOPED_ENV = ['BLACKHOLE_ASSIGNED_WORKTREE', 'BLACKHOLE_SCRATCHPAD_DIR', 'CLAUDE_PROJECT_DIR', 'BLACKHOLE_HOOK_SCOPE', 'BLACKHOLE_HOOK_EVENT_DIR'];

type Verdict = 'allow' | 'deny';

let top: string;
let home: string;
let main: string; // the real campaign main clone M
let legit: string; // a legitimate linked worktree of M
let sibling: string; // another campaign worktree of M
let scratch: string; // the harness scratchpad, holding forged clones
let seq = 0;

const git = (cwd: string, ...args: string[]) => runGit(cwd, args);

const initRepo = (dir: string) => {
  fs.mkdirSync(dir, { recursive: true });
  git(dir, 'init', '--quiet');
  fs.appendFileSync(path.join(dir, '.git', 'config'), '[user]\n\temail = campaign@example.invalid\n\tname = campaign\n');
  git(dir, 'commit', '--allow-empty', '--quiet', '-m', 'init');
  return fs.realpathSync(dir);
};

const writeConfig = (repo: string, config: Record<string, unknown>) => {
  fs.mkdirSync(path.join(repo, '.blackhole'), { recursive: true });
  fs.writeFileSync(path.join(repo, '.blackhole', 'config.json'), JSON.stringify(config));
};

const fresh = (name: string) => path.join(scratch, `${name}-${(seq += 1)}`);

const spawnHook = async (script: string, payload: unknown, cwd: string, env: Record<string, string>) => {
  const base: Record<string, string | undefined> = { ...process.env };
  for (const key of SCOPED_ENV) delete base[key];
  const proc = Bun.spawn({
    cmd: ['bun', 'run', path.join(HOOKS_DIR, script)],
    stdin: new Blob([JSON.stringify({ agent_type: 'implementer', cwd, ...(payload as object) })]),
    stdout: 'pipe',
    stderr: 'pipe',
    cwd,
    env: { ...base, HOME: home, BLACKHOLE_CLAUDE_HOME: NO_CLAUDE_HOME, ...env } as Record<string, string>,
  });
  const [exitCode, stdout, stderr] = await Promise.all([proc.exited, new Response(proc.stdout).text(), new Response(proc.stderr).text()]);
  return { exitCode, stderr, verdict: (exitCode === 0 ? 'allow' : 'deny') as Verdict, patternId: stdout.match(/\[([a-z-]+)\]/)?.[1] };
};

type HookResult = Awaited<ReturnType<typeof spawnHook>>;

/** A refusal is the hook's own containment deny: exit 2 and a containment pattern id, not a crash. */
const expectContainmentDeny = (result: HookResult, extraIds: string[] = []) => {
  expect(result.exitCode).toBe(2);
  expect([...CONTAINMENT_IDS, ...extraIds]).toContain(result.patternId as string);
};
const warningCount = (result: HookResult) => result.stderr.split(ANCHOR_WARNING).length - 1;

const runBoth = async (target: string, cwd: string, env: Record<string, string>) => ({
  write: await spawnHook(FILE_HOOK, { tool_name: 'Write', tool_input: { file_path: target, content: 'x' } }, cwd, env),
  bash: await spawnHook(BASH_HOOK, { tool_name: 'Bash', tool_input: { command: `echo x > ${target}` } }, cwd, env),
});

/** One verdict for a target, asserted equal across the Write hook and the Bash write guard. */
const verdict = async (target: string, cwd: string, env: Record<string, string> = {}): Promise<Verdict> => {
  const { write, bash } = await runBoth(target, cwd, env);
  expect(`${target} bash:${bash.verdict}`).toBe(`${target} bash:${write.verdict}`);
  if (write.verdict === 'deny') {
    expectContainmentDeny(write);
    expectContainmentDeny(bash);
  }
  return write.verdict;
};

beforeAll(() => {
  top = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'anchor-')));
  home = path.join(top, 'home');
  scratch = path.join(top, 'scratch');
  fs.mkdirSync(home);
  fs.mkdirSync(scratch);
  main = initRepo(path.join(top, 'main'));
  writeConfig(main, { forge: 'github' });
  fs.mkdirSync(path.join(main, '.worktrees'));
  legit = path.join(main, '.worktrees', 'wt-legit');
  sibling = path.join(main, '.worktrees', 'wt-sibling');
  git(main, 'worktree', 'add', '--detach', '--quiet', legit);
  git(main, 'worktree', 'add', '--detach', '--quiet', sibling);
  legit = fs.realpathSync(legit);
  sibling = fs.realpathSync(sibling);
});

afterAll(() => fs.rmSync(top, { recursive: true, force: true }));

/** A forged clone F whose `config.json` names `scratchpad_dir`, built per variant. */
type Variant = { name: string; build: () => { cwd: string } };

const forgedClone = (parent: string, scratchpadDir: string) => {
  const clone = initRepo(path.join(parent, `forged-${(seq += 1)}`));
  writeConfig(clone, { forge: 'github', scratchpad_dir: scratchpadDir });
  return clone;
};

const variants: Variant[] = [
  {
    // A: the clone is inside the worker's own worktree and its `.git` pointer names it.
    name: 'A: clone inside the worker worktree',
    build: () => {
      const wt = path.join(main, '.worktrees', `wt-a-${(seq += 1)}`);
      git(main, 'worktree', 'add', '--detach', '--quiet', wt);
      const real = fs.realpathSync(wt);
      const clone = forgedClone(real, main);
      const admin = path.join(scratch, `a-admin-${seq}`);
      git(clone, 'worktree', 'add', '--detach', '--quiet', admin);
      const adminDir = path.join(clone, '.git', 'worktrees', path.basename(admin));
      fs.writeFileSync(path.join(real, '.git'), `gitdir: ${adminDir}\n`);
      return { cwd: real };
    },
  },
  {
    // B: the worktree's admin dir lives in a forged clone placed in the harness scratchpad.
    name: 'B: worktree of a forged clone in the scratchpad',
    build: () => {
      const clone = forgedClone(scratch, main);
      const wt = fresh('wt-b');
      git(clone, 'worktree', 'add', '--detach', '--quiet', wt);
      return { cwd: fs.realpathSync(wt) };
    },
  },
  {
    // C: a `.git` planted in a subdirectory of the legitimate worktree, cwd set to that subdirectory.
    name: 'C: planted .git in a subdirectory',
    build: () => {
      const clone = forgedClone(scratch, main);
      const wt = path.join(legit, `sub-${(seq += 1)}`);
      git(clone, 'worktree', 'add', '--detach', '--quiet', wt);
      return { cwd: fs.realpathSync(wt) };
    },
  },
];

// D: cwd is inside a real nested repository carrying the forged config.
const nestedVariant: Variant = {
  name: 'D: real nested repository',
  build: () => {
    const nested = path.join(legit, `nested-${(seq += 1)}`);
    initRepo(nested);
    writeConfig(nested, { forge: 'github', scratchpad_dir: main });
    return { cwd: fs.realpathSync(nested) };
  },
};
variants.push(nestedVariant);

const forgedTargets = () => [path.join(main, 'pwn.txt'), path.join(sibling, 'pwn.txt'), path.join(main, '.blackhole', 'plans', 'pwn.md')];

describe('with an established anchor, forged main clone variants A-D never mint a write root', () => {
  for (const variant of variants) {
    test(`${variant.name}: the real main clone and a sibling worktree stay denied, with no anchor warning`, async () => {
      const { cwd } = variant.build();
      for (const target of forgedTargets()) {
        const { write, bash } = await runBoth(target, cwd, { CLAUDE_PROJECT_DIR: main });
        const extra = variant.name.startsWith('A') ? FORGED_POINTER_IDS : [];
        expectContainmentDeny(write, extra);
        expectContainmentDeny(bash, extra);
        expect(warningCount(write)).toBe(0);
        expect(warningCount(bash)).toBe(0);
      }
    });
  }

  test('the legitimate worktree denies the same targets (baseline)', async () => {
    expect(await verdict(path.join(main, 'pwn.txt'), legit, { CLAUDE_PROJECT_DIR: main })).toBe('deny');
    expect(await verdict(path.join(sibling, 'pwn.txt'), legit, { CLAUDE_PROJECT_DIR: main })).toBe('deny');
  });
});

describe('with no anchor, the pre-anchor decision holds, warns once and never adds a deny', () => {
  test('A (a clone inside the worker worktree) is still denied: that check does not need the anchor', async () => {
    const { cwd } = variants[0].build();
    for (const target of forgedTargets()) {
      const { write, bash } = await runBoth(target, cwd, {});
      expectContainmentDeny(write, FORGED_POINTER_IDS);
      expectContainmentDeny(bash, FORGED_POINTER_IDS);
    }
  });

  // Residual risk, pinned on purpose (nested repository D for Bash tracked in #1609, sandbox in #1357):
  // without an anchor the config a forged clone carries is read as the campaign's, as before the anchor.
  for (const variant of variants.slice(1, 3)) {
    test(`${variant.name}: CLAUDE_PROJECT_DIR unset keeps the pre-anchor verdict and emits one warning per tool`, async () => {
      const { cwd } = variant.build();
      const target = path.join(main, 'pwn.txt');
      const { write, bash } = await runBoth(target, cwd, {});
      expect(write.exitCode).toBe(0);
      expect(warningCount(write)).toBe(1);
      expect(bash.exitCode).toBe(0);
      expect(warningCount(bash)).toBe(1);
    });
  }

  test('D: a real nested repository inside a campaign worktree is contained in both tools', async () => {
    const { cwd } = nestedVariant.build();
    for (const target of forgedTargets()) {
      const { write, bash } = await runBoth(target, cwd, {});
      expectContainmentDeny(write);
      expectContainmentDeny(bash);
    }
    expect(await verdict(path.join(cwd, 'ok.txt'), cwd)).toBe('allow');
  });

  test('D: a nested repository outside any campaign worktree still reads as the clone (never a new deny)', async () => {
    const loose = initRepo(fresh('loose-clone'));
    const { bash } = await runBoth(path.join(loose, 'f.txt'), loose, {});
    expect(bash.exitCode).toBe(0);
  });

  test('a legitimate worktree keeps reaching the configured scratchpad and state dir, with one warning per tool', async () => {
    const pad = fresh('pad');
    fs.mkdirSync(pad);
    writeConfig(main, { forge: 'github', scratchpad_dir: pad });
    try {
      for (const target of [path.join(pad, 'x.txt'), path.join(main, '.blackhole', 'plans', 'x.md')]) {
        const { write, bash } = await runBoth(target, legit, {});
        expect(write.exitCode).toBe(0);
        expect(bash.exitCode).toBe(0);
        expect(warningCount(write)).toBe(1);
        expect(warningCount(bash)).toBe(1);
      }
    } finally {
      writeConfig(main, { forge: 'github' });
    }
  });

  test('an established anchor emits no warning on the same layout', async () => {
    const { write, bash } = await runBoth(path.join(legit, 'f.txt'), legit, { CLAUDE_PROJECT_DIR: main });
    expect(write.exitCode).toBe(0);
    expect(bash.exitCode).toBe(0);
    expect(warningCount(write)).toBe(0);
    expect(warningCount(bash)).toBe(0);
  });
});

describe('the project dir is the anchor, and only a trustworthy one', () => {
  const scratchpadConfigured = () => {
    const pad = fresh('pad');
    fs.mkdirSync(pad);
    writeConfig(main, { forge: 'github', scratchpad_dir: pad });
    return pad;
  };
  const resetConfig = () => writeConfig(main, { forge: 'github' });

  test('a project dir naming a linked worktree does not anchor: the pre-anchor decision holds and warns', async () => {
    const pad = scratchpadConfigured();
    try {
      for (const project of [legit, sibling]) {
        const { write, bash } = await runBoth(path.join(pad, 'x.txt'), legit, { CLAUDE_PROJECT_DIR: project });
        expect(write.exitCode).toBe(0);
        expect(bash.exitCode).toBe(0);
        expect(warningCount(write)).toBe(1);
        expect(warningCount(bash)).toBe(1);
      }
    } finally {
      resetConfig();
    }
  });

  test('a relative, missing, nested-forged or inside-scratchpad project dir does not anchor either', async () => {
    const pad = scratchpadConfigured();
    const nested = path.join(legit, `forged-project-${(seq += 1)}`);
    initRepo(nested);
    try {
      const projects: Record<string, string>[] = [
        { CLAUDE_PROJECT_DIR: path.relative(process.cwd(), main) },
        { CLAUDE_PROJECT_DIR: path.join(top, 'missing') },
        { CLAUDE_PROJECT_DIR: nested },
        { CLAUDE_PROJECT_DIR: main, BLACKHOLE_SCRATCHPAD_DIR: main },
      ];
      for (const env of projects) {
        const { write, bash } = await runBoth(path.join(pad, 'x.txt'), legit, env);
        expect(write.exitCode).toBe(0);
        expect(bash.exitCode).toBe(0);
        expect(warningCount(write)).toBe(1);
        expect(warningCount(bash)).toBe(1);
      }
    } finally {
      resetConfig();
    }
  });

  test('a subdirectory of the main clone anchors it', async () => {
    const pad = scratchpadConfigured();
    fs.mkdirSync(path.join(main, 'subdir'), { recursive: true });
    try {
      expect(await verdict(path.join(pad, 'x.txt'), legit, { CLAUDE_PROJECT_DIR: path.join(main, 'subdir') })).toBe('allow');
    } finally {
      resetConfig();
    }
  });

  test('a worktree of another repo does not borrow its own config under another repo\'s project dir', async () => {
    const other = initRepo(path.join(top, `other-${(seq += 1)}`));
    const otherPad = fresh('other-pad');
    fs.mkdirSync(otherPad);
    writeConfig(other, { forge: 'github', scratchpad_dir: otherPad });
    const otherWt = path.join(top, `other-wt-${(seq += 1)}`);
    git(other, 'worktree', 'add', '--detach', '--quiet', otherWt);
    const real = fs.realpathSync(otherWt);
    expect(await verdict(path.join(otherPad, 'x.txt'), real, { CLAUDE_PROJECT_DIR: other })).toBe('allow');
    expect(await verdict(path.join(otherPad, 'x.txt'), real, { CLAUDE_PROJECT_DIR: main })).toBe('deny');
    const { write } = await runBoth(path.join(otherPad, 'x.txt'), real, { CLAUDE_PROJECT_DIR: main });
    expect(warningCount(write)).toBe(0);
  });
});

describe('legitimate layouts keep their verdicts', () => {
  test('the configured scratchpad and the state dir are writable from a worker worktree', async () => {
    const pad = fresh('pad');
    fs.mkdirSync(pad);
    writeConfig(main, { forge: 'github', scratchpad_dir: pad });
    try {
      const env = { CLAUDE_PROJECT_DIR: main };
      expect(await verdict(path.join(pad, 'x.txt'), legit, env)).toBe('allow');
      expect(await verdict(path.join(main, '.blackhole', 'plans', 'x.md'), legit, env)).toBe('allow');
    } finally {
      writeConfig(main, { forge: 'github' });
    }
  });

  test('a main-clone session reaches its own tree', async () => {
    expect(await verdict(path.join(main, 'f.txt'), main, { CLAUDE_PROJECT_DIR: main })).toBe('allow');
  });

  test('the payload scratchpad_dir and BLACKHOLE_SCRATCHPAD_DIR work without a project dir', async () => {
    const pad = fresh('pad');
    fs.mkdirSync(pad);
    expect(await verdict(path.join(pad, 'e.txt'), legit, { BLACKHOLE_SCRATCHPAD_DIR: pad })).toBe('allow');
    const viaPayload = await spawnHook(FILE_HOOK, { tool_name: 'Write', tool_input: { file_path: path.join(pad, 'p.txt'), content: 'x' }, scratchpad_dir: pad }, legit, {});
    expect(viaPayload.verdict).toBe('allow');
  });

  test('a declared cross-repo campaign worktree from the user settings is admitted without a project dir', async () => {
    const other = initRepo(path.join(top, `cross-${(seq += 1)}`));
    writeConfig(other, { forge: 'github' });
    const otherWt = path.join(top, `cross-wt-${(seq += 1)}`);
    git(other, 'worktree', 'add', '--detach', '--quiet', otherWt);
    const real = fs.realpathSync(otherWt);
    fs.mkdirSync(path.join(home, '.claude'), { recursive: true });
    fs.writeFileSync(path.join(home, '.claude', 'settings.json'), JSON.stringify({ permissions: { additionalDirectories: [real] } }));
    try {
      expect(await verdict(path.join(real, 'x.txt'), legit, { CLAUDE_PROJECT_DIR: main })).toBe('allow');
      expect(await verdict(path.join(real, 'x.txt'), legit, {})).toBe('allow');
    } finally {
      fs.rmSync(path.join(home, '.claude'), { recursive: true, force: true });
    }
  });
});

describe('the audit trail follows the anchor', () => {
  test('a deny under a forged worktree is recorded in the real main clone, not in the forged one', async () => {
    const clone = forgedClone(scratch, main);
    const wt = fresh('wt-audit');
    git(clone, 'worktree', 'add', '--detach', '--quiet', wt);
    const cwd = fs.realpathSync(wt);
    const realBefore = readHookEvents(main).length;
    const result = await spawnHook(FILE_HOOK, { tool_name: 'Write', tool_input: { file_path: path.join(main, 'pwn.txt'), content: 'x' } }, cwd, {
      CLAUDE_PROJECT_DIR: main,
    });
    expectContainmentDeny(result);
    expect(readHookEvents(main).length).toBe(realBefore + 1);
    expect(readHookEvents(clone)).toEqual([]);
  });
});

describe('the sibling-plugin defer reads the anchored clone', () => {
  const claudeHome = () => {
    const dir = fs.realpathSync(fs.mkdtempSync(path.join(top, 'claude-home-')));
    writeInstalledPlugins(dir, ['mercure@some-marketplace'], { healthy: true });
    return dir;
  };

  test('a forged clone without a config does not read as "no campaign" and switch containment off', async () => {
    const clone = initRepo(path.join(scratch, `noconfig-${(seq += 1)}`));
    const wt = fresh('wt-defer');
    git(clone, 'worktree', 'add', '--detach', '--quiet', wt);
    const target = path.join(main, 'pwn.txt');
    const result = await spawnHook(FILE_HOOK, { tool_name: 'Write', tool_input: { file_path: target, content: 'x' } }, fs.realpathSync(wt), {
      CLAUDE_PROJECT_DIR: main,
      BLACKHOLE_CLAUDE_HOME: claudeHome(),
    });
    expectContainmentDeny(result);
  });

  test('the real main clone without a config still defers under its own project dir', async () => {
    const bare = initRepo(path.join(top, `bare-${(seq += 1)}`));
    const result = await spawnHook(FILE_HOOK, { tool_name: 'Write', tool_input: { file_path: '/etc/passwd', content: 'x' } }, bare, {
      CLAUDE_PROJECT_DIR: bare,
      BLACKHOLE_CLAUDE_HOME: claudeHome(),
    });
    expect(result.verdict).toBe('allow');
  });
});
