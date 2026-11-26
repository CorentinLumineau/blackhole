import { describe, expect, test } from 'bun:test';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import {
  PRETOOLUSE_HOOKS_DIR,
  readHookEvents,
  runPreToolUseHook,
  withLinkedWorktree,
  writeCampaignConfig,
} from './lib/test-fixtures.ts';

// The campaign's own state dir (<main clone>/.blackhole) is a trusted write root for campaign
// agents whose assigned root is a linked worktree, in both the Write/Edit hook and the Bash write
// guard. Everything else in the main clone stays protected, and inside the state dir the hook
// event log and config.json stay denied.

const FILE_HOOK = 'validate-file-changes.js';
const BASH_HOOK = 'validate-bash-command.js';

// The harness project dir of the fixture campaign: the state dir is read only from the main clone
// it names, so the helpers below pass it as `CLAUDE_PROJECT_DIR` while `withState` runs.
let projectDir: string | undefined;

const writeAt = (filePath: string, cwd: string, tool = 'Write') =>
  runPreToolUseHook(
    FILE_HOOK,
    { tool_name: tool, tool_input: { file_path: filePath, content: 'x' }, tool_use_id: 'toolu_state_file', agent_type: 'implementer' },
    cwd,
    PRETOOLUSE_HOOKS_DIR,
    undefined,
    undefined,
    undefined,
    projectDir,
  );

const bashAt = (command: string, cwd: string) =>
  runPreToolUseHook(
    BASH_HOOK,
    { tool_name: 'Bash', tool_input: { command }, tool_use_id: 'toolu_state_bash', cwd },
    cwd,
    PRETOOLUSE_HOOKS_DIR,
    undefined,
    cwd,
    undefined,
    projectDir,
  );

const decision = (stdout: string): string | undefined => JSON.parse(stdout || '{}').hookSpecificOutput?.permissionDecision;

const withState = async (fn: (main: string, wt: string, state: string) => Promise<void>) =>
  withLinkedWorktree('blackhole-state-trust-', async (main, wt) => {
    writeCampaignConfig(main, { forge: 'github' });
    const state = path.join(fs.realpathSync(main), '.blackhole');
    for (const sub of ['plans', 'staged/1', 'hook-events', 'archive']) fs.mkdirSync(path.join(state, sub), { recursive: true });
    projectDir = fs.realpathSync(main);
    try {
      await fn(main, wt, state);
    } finally {
      projectDir = undefined;
    }
  });

describe('state dir trust: Write/Edit hook', () => {
  for (const rel of [
    'plans/issue-1.md',
    'staged/1/manifest.json',
    'queue.json.tmp',
    'findings-ledger.json.tmp',
    'campaign-checkpoint.md',
  ]) {
    test(`allows a campaign worker to write .blackhole/${rel}`, async () => {
      await withState(async (_main, wt, state) => {
        const result = await writeAt(path.join(state, rel), wt);
        expect(result.exitCode).toBe(0);
        expect(decision(result.stdout)).not.toBe('deny');
      });
    });
  }

  for (const [label, rel] of [
    ['config.json', 'config.json'],
    ['hook-events/', 'hook-events/e.json'],
    ['archive/hook-events-<ts>/', 'archive/hook-events-1/e.json'],
  ]) {
    test(`still denies .blackhole/${label} inside the trusted dir`, async () => {
      await withState(async (_main, wt, state) => {
        const result = await writeAt(path.join(state, rel), wt);
        expect(result.exitCode).toBe(2);
        expect(readHookEvents(_main).at(-1)).toMatchObject({ tier: 'block', pattern_id: 'outside-assigned-worktree' });
      });
    });
  }

  test('denies a tracked main-clone file outside .blackhole', async () => {
    await withState(async (main, wt) => {
      const result = await writeAt(path.join(fs.realpathSync(main), 'README.md'), wt);
      expect(result.exitCode).toBe(2);
    });
  });

  test('denies a sibling-prefix directory and a traversal out of .blackhole', async () => {
    await withState(async (main, wt, state) => {
      expect((await writeAt(`${state}-evil/x`, wt)).exitCode).toBe(2);
      expect((await writeAt(path.join(state, '..', 'README.md'), wt)).exitCode).toBe(2);
    });
  });

  test('denies a symlink inside the state dir that escapes it', async () => {
    await withState(async (_main, wt, state) => {
      const outside = fs.mkdtempSync(path.join(os.homedir(), '.state-trust-escape-'));
      try {
        fs.symlinkSync(outside, path.join(state, 'plans', 'link'));
        const result = await writeAt(path.join(state, 'plans', 'link', 'x.md'), wt);
        expect(result.exitCode).toBe(2);
      } finally {
        fs.rmSync(outside, { recursive: true, force: true });
      }
    });
  });

  test('grants no trust when .blackhole has no config.json', async () => {
    await withLinkedWorktree('blackhole-state-noconfig-', async (main, wt) => {
      const state = path.join(fs.realpathSync(main), '.blackhole', 'plans');
      fs.mkdirSync(state, { recursive: true });
      expect((await writeAt(path.join(state, 'issue-1.md'), wt)).exitCode).toBe(2);
    });
  });

  test('grants no trust when .blackhole is a symlink to a broad directory that holds a config.json', async () => {
    await withLinkedWorktree('blackhole-state-broad-', async (main, wt) => {
      const broad = fs.realpathSync(os.tmpdir());
      const planted = path.join(broad, 'config.json');
      expect(fs.existsSync(planted)).toBe(false);
      try {
        fs.writeFileSync(planted, '{}');
        fs.symlinkSync(broad, path.join(main, '.blackhole'));
        expect((await writeAt(path.join(broad, `state-broad-probe-${process.pid}.md`), wt)).exitCode).toBe(2);
      } finally {
        fs.rmSync(path.join(main, '.blackhole'), { force: true });
        fs.rmSync(planted, { force: true });
      }
    });
  });

  test('protected names match case-insensitively', async () => {
    await withState(async (_main, wt, state) => {
      for (const rel of ['Config.JSON', 'Hook-Events/e.json', 'archive/HOOK-EVENTS-1/e.json']) {
        expect((await writeAt(path.join(state, rel), wt)).exitCode).toBe(2);
      }
      expect((await bashAt(`echo x > ${state}/CONFIG.json`, wt)).exitCode).toBe(2);
    });
  });

  test('denies the state root and archive directory themselves as Write targets', async () => {
    await withState(async (_main, wt, state) => {
      expect((await writeAt(state, wt)).exitCode).toBe(2);
      expect((await writeAt(path.join(state, 'archive'), wt)).exitCode).toBe(2);
    });
  });

  test("a sibling repo's .blackhole is not trusted", async () => {
    await withState(async (_main, wt) => {
      await withLinkedWorktree('blackhole-state-other-', async (other) => {
        writeCampaignConfig(other, { forge: 'github' });
        const result = await writeAt(path.join(fs.realpathSync(other), '.blackhole', 'plans', 'x.md'), wt);
        expect(result.exitCode).toBe(2);
      });
    });
  });

  test('an interactive session in the main clone is unaffected', async () => {
    await withState(async (main) => {
      const result = await runPreToolUseHook(
        FILE_HOOK,
        { tool_name: 'Write', tool_input: { file_path: path.join(main, 'README.md'), content: 'x' }, tool_use_id: 't', agent_type: undefined },
        main,
      );
      expect(result.exitCode).toBe(0);
    });
  });
});


/** A state dir with the fixtures the write-shape rows read: worktree sources (a regular file, a
 * symlink onto config.json, and a directory holding a nested link onto it), a queue tmp file, and
 * planted leaves in plans/ — a symlink and a hard link to config.json, a dangling symlink into
 * hook-events/ (no realpath to judge, so only the leaf rule catches it), and a directory — plus a
 * worktree alias `arc` onto archive/. */
const withShapes = async (fn: (main: string, wt: string, state: string) => Promise<void>) =>
  withState(async (main, wt, state) => {
    fs.writeFileSync(path.join(state, 'queue.json.tmp'), '{}');
    fs.writeFileSync(path.join(wt, 'x.md'), 'x');
    fs.writeFileSync(path.join(wt, 'config.json'), '{}');
    fs.symlinkSync(path.join(state, 'config.json'), path.join(wt, 'lnk'));
    fs.mkdirSync(path.join(wt, 'src'));
    fs.symlinkSync('../../config.json', path.join(wt, 'src', 'config.json'));
    fs.symlinkSync('../config.json', path.join(state, 'plans', 'sl.md'));
    fs.symlinkSync('../hook-events/new.json', path.join(state, 'plans', 'dangling.md'));
    fs.linkSync(path.join(state, 'config.json'), path.join(state, 'plans', 'hl.md'));
    fs.mkdirSync(path.join(state, 'plans', 'sub'));
    fs.symlinkSync(path.join(state, 'archive'), path.join(wt, 'arc'));
    await fn(main, wt, state);
  });

const blockCount = (main: string) => readHookEvents(main).filter((e) => e.tier === 'block').length;

/** Every command exits `exitCode`; a denial must also add exactly one recorded block event. */
const expectVerdicts = async (wt: string, main: string, commands: string[], exitCode: number) => {
  for (const cmd of commands) {
    const before = blockCount(main);
    const result = await bashAt(cmd, wt);
    expect([cmd, result.exitCode, blockCount(main) - before]).toEqual([cmd, exitCode, exitCode === 2 ? 1 : 0]);
  }
};

describe('state dir trust: Bash write guard allows only the two write shapes', () => {
  test('shape 1 (redirect, heredoc, tee) and shape 2 (single regular file cp/mv/install) are allowed', async () => {
    await withShapes(async (main, wt, state) => {
      await expectVerdicts(
        wt,
        main,
        [
          `echo x > ${state}/plans/a.md`,
          `echo x >> ${state}/plans/a.md`,
          `cat > ${state}/staged/1/m.json <<'X'\n{}\nX`,
          `echo x | tee ${state}/campaign-checkpoint.md`,
          `echo x | tee -a ${state}/campaign-checkpoint.md`,
          `cp x.md ${state}/plans/issue-9.md`,
          `mv ${state}/queue.json.tmp ${state}/queue.json`,
          `cd ${state} && mv queue.json.tmp queue.json`,
          `install -m644 x.md ${state}/plans/y.md`,
          `install -m 644 x.md ${state}/plans/y.md`,
          `cd ${state} && echo x > plans/issue-2.md`,
        ],
        0,
      );
    });
  });

  test('protected names stay denied in every allowed shape and in any case', async () => {
    await withShapes(async (main, wt, state) => {
      await expectVerdicts(
        wt,
        main,
        [
          `echo {} > ${state}/config.json`,
          `echo {} > ${state}/CONFIG.json`,
          `echo x > ${state}/hook-events/e.json`,
          `echo x > ${state}/Hook-Events/e.json`,
          `echo x > ${state}/archive/hook-events-1/e.json`,
          `echo x | tee ${state}/config.json`,
          `cp x.md ${state}/config.json`,
          `mv ${state}/queue.json.tmp ${state}/config.json`,
          `mv ${state}/config.json ${state}/plans/c.md`,
          `mv ${state}/hook-events/e.json ${state}/plans/e.md`,
          `cd ${state} && echo x > config.json`,
          `echo x > ${state}/config.json;true`,
          `echo x > ${state}/config.json&&true`,
          `echo x > ${state}/config.json|cat`,
          `(echo x > ${state}/config.json)`,
        ],
        2,
      );
    });
  });

  test('a planted symlink, hard link or directory leaf is never written through', async () => {
    await withShapes(async (main, wt, state) => {
      await expectVerdicts(
        wt,
        main,
        [
          `echo x > ${state}/plans/sl.md`,
          `echo x > ${state}/plans/dangling.md`,
          `cp x.md ${state}/plans/dangling.md`,
          `echo x > ${state}/plans/hl.md`,
          `echo x | tee ${state}/plans/hl.md`,
          `cp x.md ${state}/plans/sl.md`,
          `cp x.md ${state}/plans/hl.md`,
          `install -m644 x.md ${state}/plans/hl.md`,
          `cp x.md ${state}/plans/sub`,
          `echo x > ${state}/plans/sl.md;true`,
        ],
        2,
      );
    });
  });

  test('directory destinations, target-directory flags and several sources are denied', async () => {
    await withShapes(async (main, wt, state) => {
      await expectVerdicts(
        wt,
        main,
        [
          `cp config.json ${state}/`,
          `mv config.json ${state}`,
          `cp x.md ${state}/plans/`,
          `cp x.md ${state}/staged/1/`,
          `cp config.json ${state}/staged/`,
          `cp config.json ${state}/archive/`,
          `cp -t ${state} config.json`,
          `cp -t ${state}/plans x.md`,
          `cp --target-directory=${state}/plans x.md`,
          `install -t ${state}/staged config.json`,
          `cp -T x.md ${state}/plans/t.md`,
          `cp x.md config.json ${state}/plans/two.md`,
          `cp x.md ${state}/plans/..`,
          `cp x.md ${state}/plans/../q.md`,
          `cd ${state} && cp ${wt}/x.md .`,
        ],
        2,
      );
    });
  });

  test('recursive, archive and directory-source copies are denied, nested link or not', async () => {
    await withShapes(async (main, wt, state) => {
      await expectVerdicts(
        wt,
        main,
        [
          `cp -r src ${state}/staged/`,
          `cp -r src ${state}/staged/src`,
          `cp -R src ${state}/staged/src`,
          `cp -a src ${state}/staged/src`,
          `cp --recursive src ${state}/staged/src`,
          `cp --rec src ${state}/staged/src`,
          `cp -rT src ${state}/staged/src`,
          `cp -r src/. ${state}/staged/`,
          `mv src ${state}/staged/`,
          `mv src ${state}/staged/src`,
          `cp --parents x.md ${state}/plans/p.md`,
          `cp -r src ${state}/staged/src && echo x > ${state}/staged/src/config.json`,
        ],
        2,
      );
    });
  });

  test('rsync, links and other write shapes into the state dir keep the main-clone block', async () => {
    await withShapes(async (main, wt, state) => {
      await expectVerdicts(
        wt,
        main,
        [
          `rsync x.md ${state}/plans/r.md`,
          `rsync -a src/ ${state}/staged/src/`,
          `rsync -a src ${state}/staged/`,
          `rsync --link-dest=${state} x.md ${state}/plans/r.md`,
          `ln -s ../config.json ${state}/staged/config.json`,
          `ln ../config.json ${state}/staged/c`,
          `ln -sf x.md ${state}`,
          `cp -s ${wt}/x.md ${state}/plans/s.md`,
          `cp -l x.md ${state}/plans/l.md`,
          `cp --symbolic-link x.md ${state}/plans/s.md`,
          `cp -P lnk ${state}/plans/lnk.md`,
          `mv lnk ${state}/plans/lnk.md`,
          `cp lnk ${state}/plans/lnk.md`,
          `cp -b x.md ${state}/plans/b.md`,
          `install -d ${state}/plans/d`,
          `install -D x.md ${state}/plans/d/y.md`,
          `sed -i s/a/b/ ${state}/plans/a.md`,
          `dd if=x.md of=${state}/plans/d.md`,
          `truncate -s0 ${state}/plans/t.md`,
          `ln -s ../config.json ${state}/staged/config.json && cp config.json ${state}/staged/`,
        ],
        2,
      );
    });
  });

  test('a mv source that does not exist yet is denied, so the create-then-rename one-liner needs two calls', async () => {
    await withShapes(async (main, wt, state) => {
      await expectVerdicts(wt, main, [`echo {} > ${state}/new.json.tmp && mv ${state}/new.json.tmp ${state}/new.json`], 2);
    });
  });

  test('a mv source outside the state dir is denied, since an earlier clause can swap it for a link', async () => {
    await withShapes(async (main, wt, state) => {
      await expectVerdicts(
        wt,
        main,
        [
          `mv x.md ${state}/plans/a.md`,
          `ln -sf ${state}/config.json x.md && mv x.md ${state}/plans/a.md`,
          `ln -f ${state}/config.json x.md && mv x.md ${state}/plans/a.md`,
          `ln -sf ${state}/config.json x.md && mv x.md ${state}/plans/a.md && echo x > ${state}/plans/a.md`,
        ],
        2,
      );
    });
  });

  test('a worktree alias onto archive/ cannot reach a protected name', async () => {
    await withShapes(async (main, wt) => {
      await expectVerdicts(wt, main, [`echo x > arc/hook-events-9`, `cp x.md arc/hook-events-9`, `echo x > ${wt}/arc/HOOK-EVENTS-9`], 2);
      expect((await writeAt(path.join(wt, 'arc', 'hook-events-9'), wt)).exitCode).toBe(2);
    });
  });

  test('a dynamic source or target is never trusted', async () => {
    await withShapes(async (main, wt, state) => {
      await expectVerdicts(wt, main, [`cp "$SRC" ${state}/plans/`, `cp $SRC ${state}/plans/v.md`], 2);
      const warns = () => readHookEvents(main).filter((e) => e.pattern_id === 'bash-write-target-unresolvable').length;
      const before = warns();
      const result = await bashAt(`F=${state}/queue.json; echo {} > $F.tmp && mv $F.tmp $F`, wt);
      expect(result.exitCode).toBe(0);
      expect(warns() - before).toBe(1);
    });
  });

  test('main-clone files outside .blackhole, a sibling prefix and a symlink escape stay denied', async () => {
    await withShapes(async (main, wt, state) => {
      const outside = fs.mkdtempSync(path.join(os.homedir(), '.state-trust-bash-'));
      try {
        fs.symlinkSync(outside, path.join(state, 'plans', 'link'));
        await expectVerdicts(
          wt,
          main,
          [
            `echo x > ${fs.realpathSync(main)}/README.md`,
            `echo x > ${state}-evil/x`,
            `echo x > ${state}/../README.md`,
            `echo x > ${state}/plans/link/x.md`,
            `cp x.md ${state}/plans/link/x.md`,
          ],
          2,
        );
      } finally {
        fs.rmSync(outside, { recursive: true, force: true });
      }
    });
  });

  test('grants no trust without config.json', async () => {
    await withLinkedWorktree('blackhole-state-bash-noconfig-', async (main, wt) => {
      const state = path.join(fs.realpathSync(main), '.blackhole');
      fs.mkdirSync(path.join(state, 'plans'), { recursive: true });
      expect((await bashAt(`echo x > ${state}/plans/a.md`, wt)).exitCode).toBe(2);
    });
  });
});

describe('state dir trust: Write/Edit hook leaf rule', () => {
  test('a symlink, hard link or directory leaf in the state dir is denied; a plain file is allowed', async () => {
    await withShapes(async (_main, wt, state) => {
      for (const leaf of ['plans/sl.md', 'plans/dangling.md', 'plans/hl.md', 'plans/sub']) {
        for (const tool of ['Write', 'Edit']) {
          expect([leaf, tool, (await writeAt(path.join(state, leaf), wt, tool)).exitCode]).toEqual([leaf, tool, 2]);
        }
      }
      fs.writeFileSync(path.join(state, 'plans', 'plain.md'), 'x');
      expect((await writeAt(path.join(state, 'plans', 'plain.md'), wt, 'Edit')).exitCode).toBe(0);
    });
  });
});
