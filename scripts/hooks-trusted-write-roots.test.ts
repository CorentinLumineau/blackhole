import { describe, expect, test } from 'bun:test';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import {
  PRETOOLUSE_HOOKS_DIR,
  readHookEvents,
  runGit,
  withLinkedWorktree,
  writeCampaignConfig,
} from './lib/test-fixtures.ts';

// One helper (`trustedWriteRoots` in utils/hook-event-log.js) decides the extra roots a campaign
// worker may write beyond its assigned worktree: the validated harness scratchpad and the linked
// worktrees of other blackhole repos named in `permissions.additionalDirectories`. The Write/Edit
// hook and the Bash write guard must reach the same verdict for every target.

const FILE_HOOK = 'validate-file-changes.js';
const BASH_HOOK = 'validate-bash-command.js';
const NO_CLAUDE_HOME = path.join(os.tmpdir(), 'blackhole-hook-fixtures-no-claude-home');
const SCOPED_ENV = ['BLACKHOLE_ASSIGNED_WORKTREE', 'BLACKHOLE_SCRATCHPAD_DIR', 'CLAUDE_PROJECT_DIR', 'BLACKHOLE_HOOK_SCOPE'];

type Verdict = 'allow' | 'deny';
type Opts = { cwd?: string; payload?: Record<string, unknown>; env?: Record<string, string> };
type World = {
  mainA: string;
  wtA: string;
  mainB: string;
  wtB: string;
  home: string;
  scratch: string;
  declare: (where: 'home' | 'project' | 'local', dirs: string[]) => void;
  write: (target: string, opts?: Opts) => Promise<{ verdict: Verdict; patternId?: string }>;
  bash: (command: string, opts?: Opts) => Promise<{ verdict: Verdict; patternId?: string }>;
  both: (target: string, opts?: Opts) => Promise<Verdict>;
};

const tempDir = (prefix: string) => fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), prefix)));

const spawnHook = async (script: string, payload: unknown, cwd: string, home: string, env: Record<string, string> = {}) => {
  const base: Record<string, string | undefined> = { ...process.env };
  for (const key of SCOPED_ENV) delete base[key];
  const proc = Bun.spawn({
    cmd: ['bun', 'run', path.join(PRETOOLUSE_HOOKS_DIR, script)],
    stdin: new Blob([JSON.stringify({ agent_type: 'implementer', ...(payload as object) })]),
    stdout: 'pipe',
    stderr: 'pipe',
    cwd,
    env: { ...base, HOME: home, BLACKHOLE_CLAUDE_HOME: NO_CLAUDE_HOME, ...env } as Record<string, string>,
  });
  const [exitCode, stdout] = await Promise.all([proc.exited, new Response(proc.stdout).text(), new Response(proc.stderr).text()]);
  return { exitCode, stdout };
};

const patternOf = (stdout: string) => stdout.match(/\[([a-z-]+)\]/)?.[1];

const withWorld = async (fn: (w: World) => Promise<void>) =>
  withLinkedWorktree('trw-a-', async (mainA, wtA) => {
    writeCampaignConfig(mainA, { forge: 'github' });
    await withLinkedWorktree('trw-b-', async (mainB, wtB) => {
      writeCampaignConfig(mainB, { forge: 'github' });
      const home = tempDir('trw-home-');
      const scratch = tempDir('trw-scratch-');
      fs.mkdirSync(path.join(wtA, 'srcdir'), { recursive: true });
      fs.writeFileSync(path.join(wtA, 'srcdir', 'f.txt'), 'x');
      const settingsFile = (where: 'home' | 'project' | 'local') =>
        where === 'home'
          ? path.join(home, '.claude', 'settings.json')
          : path.join(mainA, '.claude', where === 'project' ? 'settings.json' : 'settings.local.json');
      const world: World = {
        mainA,
        wtA,
        mainB,
        wtB,
        home,
        scratch,
        declare: (where, dirs) => {
          const file = settingsFile(where);
          fs.mkdirSync(path.dirname(file), { recursive: true });
          fs.writeFileSync(file, JSON.stringify({ permissions: { additionalDirectories: dirs } }));
        },
        write: async (target, opts = {}) => {
          const cwd = opts.cwd ?? wtA;
          const r = await spawnHook(
            FILE_HOOK,
            { tool_name: 'Write', tool_input: { file_path: target, content: 'x' }, cwd, ...opts.payload },
            cwd,
            home,
            opts.env,
          );
          return { verdict: r.exitCode === 0 ? 'allow' : 'deny', patternId: patternOf(r.stdout) };
        },
        bash: async (command, opts = {}) => {
          const cwd = opts.cwd ?? wtA;
          const r = await spawnHook(BASH_HOOK, { tool_name: 'Bash', tool_input: { command }, cwd, ...opts.payload }, cwd, home, opts.env);
          return { verdict: r.exitCode === 0 ? 'allow' : 'deny', patternId: patternOf(r.stdout) };
        },
        both: async (target, opts) => {
          const w = (await world.write(target, opts)).verdict;
          const b = (await world.bash(`echo x > ${target}`, opts)).verdict;
          expect(b).toBe(w);
          return w;
        },
      };
      try {
        await fn(world);
      } finally {
        fs.rmSync(home, { recursive: true, force: true });
        fs.rmSync(scratch, { recursive: true, force: true });
      }
    });
  });

describe('scratchpad leg: both tools admit the validated scratchpad', () => {
  test('payload scratchpad_dir, with the worktree derived from cwd', async () => {
    await withWorld(async (w) => {
      expect(await w.both(path.join(w.scratch, 'probe.txt'), { payload: { scratchpad_dir: w.scratch } })).toBe('allow');
    });
  });

  test('payload scratchpad_dir, with BLACKHOLE_ASSIGNED_WORKTREE declared', async () => {
    await withWorld(async (w) => {
      const opts = { payload: { scratchpad_dir: w.scratch }, env: { BLACKHOLE_ASSIGNED_WORKTREE: w.wtA } };
      expect(await w.both(path.join(w.scratch, 'probe.txt'), opts)).toBe('allow');
    });
  });

  test('configured scratchpad_dir and BLACKHOLE_SCRATCHPAD_DIR', async () => {
    await withWorld(async (w) => {
      const fromEnv = await w.both(path.join(w.scratch, 'e.txt'), { env: { BLACKHOLE_SCRATCHPAD_DIR: w.scratch } });
      expect(fromEnv).toBe('allow');
      const assigned = { BLACKHOLE_SCRATCHPAD_DIR: w.scratch, BLACKHOLE_ASSIGNED_WORKTREE: w.wtA };
      expect(await w.both(path.join(w.scratch, 'ea.txt'), { env: assigned })).toBe('allow');
      writeCampaignConfig(w.mainA, { forge: 'github', scratchpad_dir: w.scratch });
      expect(await w.both(path.join(w.scratch, 'c.txt'))).toBe('allow');
      expect(await w.both(path.join(w.scratch, 'ca.txt'), { env: { BLACKHOLE_ASSIGNED_WORKTREE: w.wtA } })).toBe('allow');
    });
  });

  test('without any scratchpad source the same target stays denied', async () => {
    await withWorld(async (w) => {
      expect(await w.both(path.join(w.scratch, 'probe.txt'))).toBe('deny');
    });
  });

  test('a scratchpad that does not exist, or a non-string value, grants nothing', async () => {
    await withWorld(async (w) => {
      const gone = path.join(w.scratch, 'gone');
      expect(await w.both(path.join(gone, 'x.txt'), { payload: { scratchpad_dir: gone } })).toBe('deny');
      expect(await w.both(path.join(w.scratch, 'x.txt'), { payload: { scratchpad_dir: [w.scratch] } })).toBe('deny');
    });
  });

  test('broad, symlinked and state-dir scratchpads are refused', async () => {
    await withWorld(async (w) => {
      const link = path.join(w.scratch, 'to-home');
      fs.symlinkSync(w.home, link);
      const tmpFile = path.join(os.tmpdir(), `trw-broad-${process.pid}.txt`);
      const state = path.join(w.mainA, '.blackhole');
      fs.mkdirSync(path.join(state, 'hook-events'), { recursive: true });
      const cases: [string, string][] = [
        [os.tmpdir(), tmpFile],
        [w.home, path.join(w.home, 'x.txt')],
        [link, path.join(w.home, 'x.txt')],
        [w.mainA, path.join(w.mainA, 'README.md')],
        [state, path.join(state, 'config.json')],
        [state, path.join(state, 'hook-events', 'e.json')],
        [path.join(state, 'hook-events'), path.join(state, 'hook-events', 'e.json')],
      ];
      for (const [scratchpad, target] of cases) {
        expect(await w.both(target, { payload: { scratchpad_dir: scratchpad } })).toBe('deny');
      }
    });
  });
});

describe('cross-repo leg: declared linked worktrees of blackhole repos', () => {
  test('a campaign worktree in another repo is writable from either tool, from any of the three settings files', async () => {
    await withWorld(async (w) => {
      for (const where of ['home', 'project', 'local'] as const) {
        w.declare(where, [w.wtB]);
        expect(await w.both(path.join(w.wtB, `${where}.txt`))).toBe('allow');
        fs.rmSync(path.join(w.home, '.claude'), { recursive: true, force: true });
        fs.rmSync(path.join(w.mainA, '.claude'), { recursive: true, force: true });
      }
    });
  });

  test('CLAUDE_PROJECT_DIR names the project settings; a session cwd in the main clone also works', async () => {
    await withWorld(async (w) => {
      const project = tempDir('trw-project-');
      try {
        fs.mkdirSync(path.join(project, '.claude'));
        fs.writeFileSync(path.join(project, '.claude', 'settings.json'), JSON.stringify({ permissions: { additionalDirectories: [w.wtB] } }));
        expect(await w.both(path.join(w.wtB, 'p.txt'), { env: { CLAUDE_PROJECT_DIR: project } })).toBe('allow');
        w.declare('home', [w.wtB]);
        expect((await w.write(path.join(w.wtB, 'm.txt'), { cwd: w.mainA })).verdict).toBe('allow');
      } finally {
        fs.rmSync(project, { recursive: true, force: true });
      }
    });
  });

  test('an undeclared worktree of the other repo stays denied', async () => {
    await withWorld(async (w) => {
      expect(await w.both(path.join(w.wtB, 'u.txt'))).toBe('deny');
    });
  });

  test('entries that are not a campaign worktree are refused', async () => {
    await withWorld(async (w) => {
      const plain = tempDir('trw-plain-');
      const symlinkToMain = path.join(w.scratch, 'main-link');
      const symlinkToWt = path.join(w.scratch, 'wt-link');
      fs.symlinkSync(w.mainB, symlinkToMain);
      fs.symlinkSync(w.wtB, symlinkToWt);
      const noCampaignMain = tempDir('trw-nocamp-');
      try {
        runGit(noCampaignMain, ['init', '--quiet']);
        runGit(noCampaignMain, ['-c', 'user.email=t@e.invalid', '-c', 'user.name=t', 'commit', '--allow-empty', '--quiet', '-m', 'i']);
        const noCampaignWt = path.join(noCampaignMain, '.worktrees', 'wt');
        runGit(noCampaignMain, ['worktree', 'add', '--detach', '--quiet', noCampaignWt]);
        fs.writeFileSync(path.join(w.mainB, 'tracked.md'), 'x');
        const entries = [plain, w.mainB, symlinkToMain, symlinkToWt, noCampaignWt, '/', w.home, os.tmpdir(), path.join(w.wtB, 'sub'), 'relative/dir', 42];
        w.declare('home', entries as string[]);
        const targets = [
          path.join(plain, 'x.txt'),
          path.join(w.mainB, 'tracked.md'),
          path.join(w.mainB, 'new.txt'),
          path.join(symlinkToMain, 'new.txt'),
          path.join(symlinkToWt, 'new.txt'),
          path.join(noCampaignWt, 'x.txt'),
          path.join(w.home, 'x.txt'),
          path.join(os.tmpdir(), `trw-entry-${process.pid}.txt`),
        ];
        for (const target of targets) expect(await w.both(target)).toBe('deny');
      } finally {
        fs.rmSync(noCampaignMain, { recursive: true, force: true });
        fs.rmSync(plain, { recursive: true, force: true });
      }
    });
  });

  test('at most 16 declared entries are considered', async () => {
    await withWorld(async (w) => {
      const junk = Array.from({ length: 16 }, (_, i) => path.join(w.scratch, `junk-${i}`));
      w.declare('home', [...junk, w.wtB]);
      expect(await w.both(path.join(w.wtB, 'late.txt'))).toBe('deny');
      w.declare('home', [w.wtB, ...junk]);
      expect(await w.both(path.join(w.wtB, 'early.txt'))).toBe('allow');
    });
  });

  test('a malformed settings file contributes nothing and breaks nothing', async () => {
    await withWorld(async (w) => {
      fs.mkdirSync(path.join(w.home, '.claude'), { recursive: true });
      fs.writeFileSync(path.join(w.home, '.claude', 'settings.json'), '{ not json');
      expect(await w.both(path.join(w.wtB, 'x.txt'))).toBe('deny');
      expect(await w.both(path.join(w.wtA, 'own.txt'))).toBe('allow');
    });
  });

  test('a declared worktree never opens the other repo main clone or its state dir', async () => {
    await withWorld(async (w) => {
      w.declare('home', [w.wtB]);
      const state = path.join(w.mainB, '.blackhole');
      fs.mkdirSync(path.join(state, 'hook-events'), { recursive: true });
      for (const target of [path.join(w.mainB, 'README.md'), path.join(state, 'config.json'), path.join(state, 'hook-events', 'e.json')]) {
        expect(await w.both(target)).toBe('deny');
      }
    });
  });
});

describe('settings files that hold the roots are never written by a worker', () => {
  test('home, project and local settings files are denied to both tools', async () => {
    await withWorld(async (w) => {
      const files = [
        path.join(w.home, '.claude', 'settings.json'),
        path.join(w.mainA, '.claude', 'settings.json'),
        path.join(w.mainA, '.claude', 'settings.local.json'),
      ];
      for (const file of files) {
        expect((await w.write(file)).verdict).toBe('deny');
        expect((await w.write(file, { cwd: w.mainA })).verdict).toBe('deny');
        expect((await w.bash(`echo '{}' > ${file}`)).verdict).toBe('deny');
        expect((await w.bash(`cp ${path.join(w.wtA, 'srcdir', 'f.txt')} ${file}`)).verdict).toBe('deny');
      }
    });
  });

  test('a project dir that is the assigned worktree is still protected', async () => {
    await withWorld(async (w) => {
      const env = { CLAUDE_PROJECT_DIR: w.wtA };
      for (const name of ['settings.json', 'settings.local.json']) {
        const file = path.join(w.wtA, '.claude', name);
        expect((await w.write(file, { env })).verdict).toBe('deny');
        expect((await w.bash(`echo x > ${file}`, { env })).verdict).toBe('deny');
      }
    });
  });

  test('the denial is the named settings rule, and other files in .claude stay writable inside the worktree', async () => {
    await withWorld(async (w) => {
      const env = { CLAUDE_PROJECT_DIR: w.wtA };
      const file = path.join(w.wtA, '.claude', 'settings.local.json');
      expect((await w.write(file, { env })).patternId).toBe('settings-roots-write');
      expect((await w.bash(`echo x > ${file}`, { env })).patternId).toBe('bash-settings-roots-write');
      expect((await w.write(path.join(w.wtA, '.claude', 'notes.md'), { env })).verdict).toBe('allow');
    });
  });
});

describe('Bash writes into a newly trusted root are limited to the plain file shapes', () => {
  test('redirect, tee and single-file cp/mv/install into the scratchpad and a declared worktree are allowed', async () => {
    await withWorld(async (w) => {
      w.declare('home', [w.wtB]);
      const payload = { scratchpad_dir: w.scratch };
      const src = path.join(w.wtA, 'srcdir', 'f.txt');
      fs.writeFileSync(path.join(w.scratch, 'old.txt'), 'x');
      for (const root of [w.scratch, w.wtB]) {
        for (const command of [
          `echo x >> ${root}/a.txt`,
          `echo x | tee ${root}/b.txt`,
          `cp ${src} ${root}/c.txt`,
          `install -m644 ${src} ${root}/d.txt`,
        ]) {
          expect((await w.bash(command, { payload })).verdict).toBe('allow');
        }
      }
      expect((await w.bash(`mv ${w.scratch}/old.txt ${w.scratch}/new.txt`, { payload })).verdict).toBe('allow');
    });
  });

  test('directory destinations, recursive copies, links and other writers are denied', async () => {
    await withWorld(async (w) => {
      w.declare('home', [w.wtB]);
      const payload = { scratchpad_dir: w.scratch };
      const src = path.join(w.wtA, 'srcdir', 'f.txt');
      fs.mkdirSync(path.join(w.scratch, 'dir'));
      for (const root of [w.scratch, w.wtB]) {
        const commands = [
          `cp ${src} ${root}/`,
          `cp -r ${path.join(w.wtA, 'srcdir')} ${root}/out`,
          `cp -t ${root} ${src}`,
          `ln -s ${w.mainA}/README.md ${root}/l`,
          `ln ${w.mainA}/README.md ${root}/h`,
          `rsync -a ${path.join(w.wtA, 'srcdir')}/ ${root}/r/`,
          `sed -i s/a/b/ ${root}/a.txt`,
          `dd if=${src} of=${root}/d`,
          `cp ${src} ${root}/../escape.txt`,
        ];
        for (const command of commands) expect((await w.bash(command, { payload })).verdict).toBe('deny');
      }
      expect((await w.bash(`cp ${src} ${w.scratch}/dir`, { payload })).verdict).toBe('deny');
    });
  });

  test('a planted symlink or hard link leaf is never written through, by either tool', async () => {
    await withWorld(async (w) => {
      const victim = path.join(w.mainA, 'victim.txt');
      fs.writeFileSync(victim, 'x');
      fs.symlinkSync(victim, path.join(w.scratch, 'sl.txt'));
      fs.linkSync(victim, path.join(w.scratch, 'hl.txt'));
      const payload = { scratchpad_dir: w.scratch };
      for (const leaf of ['sl.txt', 'hl.txt']) {
        expect(await w.both(path.join(w.scratch, leaf), { payload })).toBe('deny');
      }
      expect(await w.both(path.join(w.scratch, 'plain.txt'), { payload })).toBe('allow');
    });
  });
});

describe('Write and Bash reach the same verdict for every target', () => {
  test('table of targets', async () => {
    await withWorld(async (w) => {
      w.declare('home', [w.wtB]);
      const payload = { scratchpad_dir: w.scratch };
      const rows: [string, Verdict][] = [
        [path.join(w.scratch, 's.txt'), 'allow'],
        [path.join(w.wtB, 'b.txt'), 'allow'],
        [path.join(w.wtA, 'own.txt'), 'allow'],
        [path.join(w.mainA, 'README.md'), 'deny'],
        [path.join(w.mainB, 'README.md'), 'deny'],
        [path.join(w.home, '.claude', 'settings.json'), 'deny'],
        [path.join(w.mainA, '.blackhole', 'config.json'), 'deny'],
        [path.join(os.tmpdir(), `trw-table-${process.pid}.txt`), 'deny'],
      ];
      for (const [target, expected] of rows) expect([target, await w.both(target, { payload })]).toEqual([target, expected]);
    });
  });

  test('a denial through an extra root is recorded as a block', async () => {
    await withWorld(async (w) => {
      await w.write(path.join(w.mainB, 'README.md'));
      expect(readHookEvents(w.mainA).at(-1)).toMatchObject({ tier: 'block', pattern_id: 'outside-assigned-worktree' });
    });
  });
});
