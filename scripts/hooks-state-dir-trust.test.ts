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

const writeAt = (filePath: string, cwd: string, tool = 'Write') =>
  runPreToolUseHook(
    FILE_HOOK,
    { tool_name: tool, tool_input: { file_path: filePath, content: 'x' }, tool_use_id: 'toolu_state_file', agent_type: 'implementer' },
    cwd,
  );

const bashAt = (command: string, cwd: string) =>
  runPreToolUseHook(
    BASH_HOOK,
    { tool_name: 'Bash', tool_input: { command }, tool_use_id: 'toolu_state_bash', cwd },
    cwd,
    PRETOOLUSE_HOOKS_DIR,
    undefined,
    cwd,
  );

const decision = (stdout: string): string | undefined => JSON.parse(stdout || '{}').hookSpecificOutput?.permissionDecision;

const withState = async (fn: (main: string, wt: string, state: string) => Promise<void>) =>
  withLinkedWorktree('blackhole-state-trust-', async (main, wt) => {
    writeCampaignConfig(main, { forge: 'github' });
    const state = path.join(fs.realpathSync(main), '.blackhole');
    for (const sub of ['plans', 'staged/1', 'hook-events', 'archive']) fs.mkdirSync(path.join(state, sub), { recursive: true });
    await fn(main, wt, state);
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

describe('state dir trust: Bash write guard', () => {
  test('allows literal absolute writes to plans/, tmp files and the final mv', async () => {
    await withState(async (_main, wt, state) => {
      for (const cmd of [
        `cat > ${state}/plans/issue-1.md <<'X'\nbody\nX`,
        `echo {} > ${state}/queue.json.tmp && mv ${state}/queue.json.tmp ${state}/queue.json`,
        `echo {} > ${state}/findings-ledger.json.tmp`,
        `echo x > ${state}/campaign-checkpoint.md`,
        `echo x > ${state}/staged/1/manifest.json`,
      ]) {
        const result = await bashAt(cmd, wt);
        expect(result.exitCode).toBe(0);
      }
    });
  });

  test('allows a relative write after cd into the state dir', async () => {
    await withState(async (_main, wt, state) => {
      const result = await bashAt(`cd ${state} && echo x > plans/issue-2.md`, wt);
      expect(result.exitCode).toBe(0);
    });
  });

  test('a variable-built target stays warn-and-record, never silent', async () => {
    await withState(async (main, wt, state) => {
      const result = await bashAt(`F=${state}/queue.json; echo {} > $F.tmp && mv $F.tmp $F`, wt);
      expect(result.exitCode).toBe(0);
      expect(readHookEvents(main).at(-1)).toMatchObject({ tier: 'warn', pattern_id: 'bash-write-target-unresolvable' });
    });
  });

  test('denies config.json and hook-events writes inside the trusted dir', async () => {
    await withState(async (_main, wt, state) => {
      for (const cmd of [
        `echo {} > ${state}/config.json`,
        `echo x > ${state}/hook-events/e.json`,
        `mv ${state}/queue.json.tmp ${state}/config.json`,
        `cd ${state} && echo x > config.json`,
      ]) {
        const result = await bashAt(cmd, wt);
        expect([cmd, result.exitCode]).toEqual([cmd, 2]);
      }
    });
  });

  test('denies main-clone files outside .blackhole, a sibling prefix and a symlink escape', async () => {
    await withState(async (main, wt, state) => {
      const outside = fs.mkdtempSync(path.join(os.homedir(), '.state-trust-bash-'));
      try {
        fs.symlinkSync(outside, path.join(state, 'plans', 'link'));
        for (const cmd of [
          `echo x > ${fs.realpathSync(main)}/README.md`,
          `echo x > ${state}-evil/x`,
          `echo x > ${state}/../README.md`,
          `echo x > ${state}/plans/link/x.md`,
        ]) {
          const result = await bashAt(cmd, wt);
          expect(result.exitCode).toBe(2);
        }
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

  test('directory-destination writers cannot reach the protected paths', async () => {
    await withState(async (_main, wt, state) => {
      fs.mkdirSync(path.join(wt, 'src'), { recursive: true });
      for (const cmd of [
        `cp config.json ${state}/`,
        `mv config.json ${state}`,
        `cp -t ${state} config.json`,
        `cp --target-directory=${state} config.json`,
        `install -t ${state} config.json`,
        `cp -r hook-events ${state}`,
        `cp hook-events-1 ${state}/archive/`,
        `cp -rT src ${state}`,
        `cp -r src/. ${state}/`,
        `rsync -a src/ ${state}/`,
        `ln -sf X ${state}`,
        `cp config.json ${state}/plans/..`,
        `cd ${state} && cp x .`,
      ]) {
        const result = await bashAt(cmd, wt);
        expect([cmd, result.exitCode, readHookEvents(_main).at(-1)?.tier]).toEqual([cmd, 2, 'block']);
      }
    });
  });

  test('ordinary copies into plans/ and the queue rename still work', async () => {
    await withState(async (_main, wt, state) => {
      for (const cmd of [`cp x ${state}/plans/`, `mv ${state}/queue.json.tmp ${state}/queue.json`]) {
        expect([cmd, (await bashAt(cmd, wt)).exitCode]).toEqual([cmd, 0]);
      }
    });
  });
});
