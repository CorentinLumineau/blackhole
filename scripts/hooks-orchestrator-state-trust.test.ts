import { describe, expect, test } from 'bun:test';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { PRETOOLUSE_HOOKS_DIR, withLinkedWorktree, writeCampaignConfig } from './lib/test-fixtures.ts';

// An orchestrator-class caller (no `agent_type`, or `orchestrator`/`coordinator`) may write single
// files into the state dir of its own clone and of every main clone the owner declares in
// `permissions.additionalDirectories`, even from a linked-worktree cwd. No worker `agent_type`
// gains a write, and `config.json`, `hook-events/` and settings files stay protected for everyone.

const FILE_HOOK = 'validate-file-changes.js';
const BASH_HOOK = 'validate-bash-command.js';
const NO_CLAUDE_HOME = path.join(os.tmpdir(), 'blackhole-hook-fixtures-no-claude-home');
const SCOPED_ENV = ['BLACKHOLE_ASSIGNED_WORKTREE', 'BLACKHOLE_SCRATCHPAD_DIR', 'CLAUDE_PROJECT_DIR', 'BLACKHOLE_HOOK_SCOPE'];
const WRITE_DENY = 'outside-assigned-worktree';
const BASH_DENY = 'bash-outside-assigned-worktree';

type Verdict = { verdict: 'allow' | 'deny'; patternId?: string };
type Caller = { agentType?: string; env?: Record<string, string>; project?: string };

const tempDir = (prefix: string) => fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), prefix)));

const spawnHook = async (script: string, payload: Record<string, unknown>, cwd: string, home: string, caller: Caller): Promise<Verdict> => {
  const base: Record<string, string | undefined> = { ...process.env };
  for (const key of SCOPED_ENV) delete base[key];
  const body = { cwd, ...payload, ...(caller.agentType === undefined ? {} : { agent_type: caller.agentType }) };
  const proc = Bun.spawn({
    cmd: ['bun', 'run', path.join(PRETOOLUSE_HOOKS_DIR, script)],
    stdin: new Blob([JSON.stringify(body)]),
    stdout: 'pipe',
    stderr: 'pipe',
    cwd,
    env: {
      ...base,
      HOME: home,
      BLACKHOLE_CLAUDE_HOME: NO_CLAUDE_HOME,
      ...(caller.project ? { CLAUDE_PROJECT_DIR: caller.project } : {}),
      ...caller.env,
    } as Record<string, string>,
  });
  const [exitCode, stdout] = await Promise.all([proc.exited, new Response(proc.stdout).text(), new Response(proc.stderr).text()]);
  return { verdict: exitCode === 0 ? 'allow' : 'deny', patternId: stdout.match(/\[([a-z-]+)\]/)?.[1] };
};

type World = {
  mainA: string; // the clone whose state dir is written
  wtA: string;
  mainB: string; // another repo's clone
  wtB: string;
  home: string;
  declare: (dirs: string[]) => void;
  write: (target: string, cwd: string, caller: Caller) => Promise<Verdict>;
  move: (target: string, cwd: string, caller: Caller) => Promise<Verdict>;
};

const withWorld = async (fn: (w: World) => Promise<void>) =>
  withLinkedWorktree('ost-a-', async (mainA, wtA) => {
    writeCampaignConfig(mainA, { forge: 'github' });
    await withLinkedWorktree('ost-b-', async (mainB, wtB) => {
      writeCampaignConfig(mainB, { forge: 'github' });
      const home = tempDir('ost-home-');
      const world: World = {
        mainA,
        wtA,
        mainB,
        wtB,
        home,
        declare: (dirs) => {
          fs.mkdirSync(path.join(home, '.claude'), { recursive: true });
          fs.writeFileSync(path.join(home, '.claude', 'settings.json'), JSON.stringify({ permissions: { additionalDirectories: dirs } }));
        },
        write: (target, cwd, caller) => spawnHook(FILE_HOOK, { tool_name: 'Write', tool_input: { file_path: target, content: 'x' } }, cwd, home, caller),
        move: (target, cwd, caller) => {
          const tmp = `${target}.tmp`;
          fs.mkdirSync(path.dirname(tmp), { recursive: true });
          fs.writeFileSync(tmp, '{}');
          return spawnHook(BASH_HOOK, { tool_name: 'Bash', tool_input: { command: `mv ${tmp} ${target}` } }, cwd, home, caller);
        },
      };
      try {
        await fn(world);
      } finally {
        fs.rmSync(home, { recursive: true, force: true });
      }
    });
  });

const ORCHESTRATOR_CALLERS: [string, string | undefined][] = [
  ['no agent_type (main session)', undefined],
  ['agent_type orchestrator', 'orchestrator'],
  ['agent_type blackhole:coordinator', 'blackhole:coordinator'],
];

describe('orchestrator-class callers write main-clone state from a linked worktree', () => {
  for (const [label, agentType] of ORCHESTRATOR_CALLERS) {
    describe(label, () => {
      test('S1: own worktree, project dir is that worktree', async () => {
        await withWorld(async (w) => {
          const caller = { agentType, project: w.wtA };
          expect((await w.write(path.join(w.mainA, '.blackhole', 'plans', 'issue-1.md'), w.wtA, caller)).verdict).toBe('allow');
          expect((await w.move(path.join(w.mainA, '.blackhole', 'queue.json'), w.wtA, caller)).verdict).toBe('allow');
        });
      });

      test('S2: own worktree, project dir is the main clone', async () => {
        await withWorld(async (w) => {
          const caller = { agentType, project: w.mainA };
          expect((await w.write(path.join(w.mainA, '.blackhole', 'plans', 'issue-1.md'), w.wtA, caller)).verdict).toBe('allow');
          expect((await w.move(path.join(w.mainA, '.blackhole', 'queue.json'), w.wtA, caller)).verdict).toBe('allow');
        });
      });

      test('S3: another repo campaign worktree, the target clone is declared in the user settings', async () => {
        await withWorld(async (w) => {
          w.declare([w.mainA]);
          const caller = { agentType, project: w.mainB };
          expect((await w.write(path.join(w.mainA, '.blackhole', 'plans', 'issue-1.md'), w.wtB, caller)).verdict).toBe('allow');
          expect((await w.move(path.join(w.mainA, '.blackhole', 'queue.json'), w.wtB, caller)).verdict).toBe('allow');
        });
      });

      test('S4: own worktree under another repo project dir, the own clone state dir is declared', async () => {
        await withWorld(async (w) => {
          w.declare([path.join(w.mainA, '.blackhole')]);
          const caller = { agentType, project: w.mainB };
          expect((await w.write(path.join(w.mainA, '.blackhole', 'plans', 'issue-1.md'), w.wtA, caller)).verdict).toBe('allow');
          expect((await w.move(path.join(w.mainA, '.blackhole', 'queue.json'), w.wtA, caller)).verdict).toBe('allow');
        });
      });
    });
  }
});

describe('negative cases stay denied', () => {
  const stateFile = (w: World, ...segments: string[]) => path.join(w.mainA, '.blackhole', ...segments);

  for (const agentType of ['implementer', 'reviewer', 'planner', 'general-purpose', 'blackhole:implementer']) {
    test(`worker agent_type ${agentType} gains nothing`, async () => {
      await withWorld(async (w) => {
        w.declare([w.mainA]);
        const caller = { agentType, project: w.mainB };
        expect(await w.write(stateFile(w, 'plans', 'issue-1.md'), w.wtB, caller)).toEqual({ verdict: 'deny', patternId: WRITE_DENY });
        expect(await w.move(stateFile(w, 'queue.json'), w.wtB, caller)).toEqual({ verdict: 'deny', patternId: BASH_DENY });
      });
    });
  }

  test('BLACKHOLE_ASSIGNED_WORKTREE marks a worker even without agent_type', async () => {
    await withWorld(async (w) => {
      w.declare([w.mainA]);
      const caller = { project: w.mainB, env: { BLACKHOLE_ASSIGNED_WORKTREE: w.wtB } };
      expect(await w.write(stateFile(w, 'plans', 'issue-1.md'), w.wtB, caller)).toEqual({ verdict: 'deny', patternId: WRITE_DENY });
      expect(await w.move(stateFile(w, 'queue.json'), w.wtB, caller)).toEqual({ verdict: 'deny', patternId: BASH_DENY });
    });
  });

  test('a main clone absent from the settings gets nothing', async () => {
    await withWorld(async (w) => {
      const caller = { project: w.mainB };
      expect(await w.write(stateFile(w, 'plans', 'issue-1.md'), w.wtB, caller)).toEqual({ verdict: 'deny', patternId: WRITE_DENY });
      expect(await w.move(stateFile(w, 'queue.json'), w.wtB, caller)).toEqual({ verdict: 'deny', patternId: BASH_DENY });
    });
  });

  test('config.json and hook-events stay protected for the orchestrator', async () => {
    await withWorld(async (w) => {
      w.declare([w.mainA]);
      const caller = { project: w.mainB };
      for (const target of [stateFile(w, 'config.json'), stateFile(w, 'hook-events', 'x.json'), stateFile(w, 'archive', 'hook-events-1', 'x.json')]) {
        expect(await w.write(target, w.wtB, caller)).toEqual({ verdict: 'deny', patternId: WRITE_DENY });
        expect(await w.move(target, w.wtB, caller)).toEqual({ verdict: 'deny', patternId: BASH_DENY });
      }
    });
  });

  test('a directory destination and the state root itself are refused', async () => {
    await withWorld(async (w) => {
      w.declare([w.mainA]);
      fs.mkdirSync(stateFile(w, 'plans'), { recursive: true });
      const caller = { project: w.mainB };
      expect((await w.write(stateFile(w, 'plans'), w.wtB, caller)).verdict).toBe('deny');
      expect((await w.write(path.join(w.mainA, '.blackhole'), w.wtB, caller)).verdict).toBe('deny');
    });
  });

  test('a symlink leaf is refused', async () => {
    await withWorld(async (w) => {
      w.declare([w.mainA]);
      fs.symlinkSync(stateFile(w, 'config.json'), stateFile(w, 'alias.json'));
      const caller = { project: w.mainB };
      expect(await w.write(stateFile(w, 'alias.json'), w.wtB, caller)).toEqual({ verdict: 'deny', patternId: WRITE_DENY });
    });
  });

  test('a declared directory whose .git is a planted pointer file grants nothing', async () => {
    await withWorld(async (w) => {
      const planted = tempDir('ost-planted-');
      try {
        writeCampaignConfig(planted, { forge: 'github' });
        fs.writeFileSync(path.join(planted, '.git'), `gitdir: ${path.join(w.mainA, '.git')}\n`);
        w.declare([planted]);
        const caller = { project: w.mainB };
        expect(await w.write(path.join(planted, '.blackhole', 'plans', 'issue-1.md'), w.wtB, caller)).toEqual({ verdict: 'deny', patternId: WRITE_DENY });
      } finally {
        fs.rmSync(planted, { recursive: true, force: true });
      }
    });
  });

  test('a settings file target is refused', async () => {
    await withWorld(async (w) => {
      w.declare([w.mainA]);
      const settings = path.join(w.home, '.claude', 'settings.json');
      const caller = { project: w.mainB };
      expect(await w.write(settings, w.wtB, caller)).toEqual({ verdict: 'deny', patternId: 'settings-roots-write' });
      expect(await w.move(settings, w.wtB, caller)).toEqual({ verdict: 'deny', patternId: 'bash-settings-roots-write' });
    });
  });
});
