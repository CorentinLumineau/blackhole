import { afterAll, describe, expect, test } from 'bun:test';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import {
  inhibitorFor,
  keepAwakeStatus,
  readHold,
  releaseHold,
  resolveStateStore,
  SLEEP_HOLD_FILE,
  takeHold,
  type HoldDeps,
  type InhibitorTool,
} from './sleep-hold.ts';

// The keep-awake hold of a sleeping campaign: every process call is a fake, so no test ever starts
// a real caffeinate or systemd-inhibit.

const dirs: string[] = [];
function campaignDir(): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'bh-sleep-hold-'));
  dirs.push(dir);
  return dir;
}
afterAll(() => {
  for (const d of dirs) fs.rmSync(d, { recursive: true, force: true });
});

const NOW_ISO = '2026-11-17T02:00:00.000Z';

/** A fake host: `running` maps live pids to the executable they run; spawns hand out pids from 500. */
function fakeHost(platform: NodeJS.Platform, bins: string[], running: Record<number, string> = {}) {
  const spawned: string[][] = [];
  const killed: number[] = [];
  let next = 500;
  const deps: HoldDeps = {
    platform,
    onPath: (bin) => bins.includes(bin),
    spawnDetached: (command) => {
      spawned.push(command);
      running[next] = command[0];
      return next++;
    },
    isRunning: (pid, tool: InhibitorTool) => running[pid] === tool,
    kill: (pid) => {
      killed.push(pid);
      delete running[pid];
    },
  };
  return { deps, spawned, killed, running };
}

const writeHold = (dir: string, pid: number, tool: InhibitorTool = 'caffeinate') =>
  fs.writeFileSync(path.join(dir, SLEEP_HOLD_FILE), JSON.stringify({ pid, tool, started_at: NOW_ISO }));

describe('inhibitorFor', () => {
  test('caffeinate on macOS, systemd-inhibit on Linux, nothing elsewhere or when absent', () => {
    expect(inhibitorFor('darwin', () => true)).toEqual({ tool: 'caffeinate', command: ['caffeinate', '-i'] });
    const linux = inhibitorFor('linux', (b) => b === 'systemd-inhibit');
    expect(linux?.tool).toBe('systemd-inhibit');
    expect(linux?.command).toContain('--what=idle:sleep');
    expect(linux?.command.slice(-2)).toEqual(['sleep', 'infinity']);
    expect(inhibitorFor('darwin', () => false)).toBeNull();
    expect(inhibitorFor('linux', (b) => b === 'caffeinate')).toBeNull();
    expect(inhibitorFor('win32', () => true)).toBeNull();
  });
});

describe('takeHold', () => {
  test('a local host starts the inhibitor and records its pid', () => {
    const dir = campaignDir();
    const host = fakeHost('darwin', ['caffeinate']);
    expect(takeHold(dir, 'local', host.deps, NOW_ISO)).toBe('Keep-awake: held by caffeinate (pid 500) until `sleep --off` or `wake`.');
    expect(host.spawned).toEqual([['caffeinate', '-i']]);
    expect(readHold(dir)).toEqual({ pid: 500, tool: 'caffeinate', started_at: NOW_ISO });
  });

  test('is idempotent: a live recorded hold is kept, no second inhibitor starts', () => {
    const dir = campaignDir();
    const host = fakeHost('darwin', ['caffeinate']);
    takeHold(dir, 'local', host.deps, NOW_ISO);
    expect(takeHold(dir, 'local', host.deps, '2026-11-17T05:00:00.000Z')).toBe('Keep-awake: already held by caffeinate (pid 500).');
    expect(host.spawned).toHaveLength(1);
    expect(readHold(dir)?.started_at).toBe(NOW_ISO);
  });

  test('a stale pid (gone, or reused by another program) is cleared and replaced', () => {
    const dir = campaignDir();
    writeHold(dir, 42);
    const host = fakeHost('darwin', ['caffeinate'], { 42: 'zsh' });
    expect(takeHold(dir, 'local', host.deps, NOW_ISO)).toBe('Keep-awake: held by caffeinate (pid 500) until `sleep --off` or `wake`; stale pid 42 cleared.');
    expect(host.killed).toEqual([]);
    expect(readHold(dir)?.pid).toBe(500);
  });

  test('an ephemeral host (state_store branch) is a no-op and says so', () => {
    const dir = campaignDir();
    const host = fakeHost('linux', ['systemd-inhibit']);
    expect(takeHold(dir, 'branch', host.deps, NOW_ISO)).toBe('Keep-awake: not held — ephemeral host (state_store: branch), nothing to inhibit.');
    expect(host.spawned).toEqual([]);
    expect(fs.existsSync(path.join(dir, SLEEP_HOLD_FILE))).toBe(false);
  });

  test('no inhibitor on the host, or one that fails to start, records nothing', () => {
    const dir = campaignDir();
    expect(takeHold(dir, 'local', fakeHost('linux', []).deps, NOW_ISO)).toBe(
      'Keep-awake: not held — no caffeinate (macOS) or systemd-inhibit (Linux) on this host.',
    );
    const failing = fakeHost('linux', ['systemd-inhibit']);
    failing.deps.spawnDetached = () => {
      throw new Error('EACCES');
    };
    expect(takeHold(dir, 'local', failing.deps, NOW_ISO)).toBe('Keep-awake: not held — systemd-inhibit did not start: EACCES.');
    expect(readHold(dir)).toBeNull();
  });
});

describe('releaseHold', () => {
  test('stops the recorded inhibitor and drops the record', () => {
    const dir = campaignDir();
    const host = fakeHost('linux', ['systemd-inhibit']);
    takeHold(dir, 'local', host.deps, NOW_ISO);
    expect(releaseHold(dir, host.deps)).toBe('Keep-awake: released systemd-inhibit (pid 500).');
    expect(host.killed).toEqual([500]);
    expect(fs.existsSync(path.join(dir, SLEEP_HOLD_FILE))).toBe(false);
    expect(releaseHold(dir, host.deps)).toBe('Keep-awake: nothing to release.');
  });

  test('a stale pid is never killed: the record is cleared instead', () => {
    const dir = campaignDir();
    writeHold(dir, 42);
    const host = fakeHost('darwin', ['caffeinate'], { 42: 'node' });
    expect(releaseHold(dir, host.deps)).toBe('Keep-awake: pid 42 was no longer running; stale record cleared.');
    expect(host.killed).toEqual([]);
    expect(readHold(dir)).toBeNull();
  });

  test('a malformed record is dropped without killing anything', () => {
    const dir = campaignDir();
    fs.writeFileSync(path.join(dir, SLEEP_HOLD_FILE), JSON.stringify({ pid: -1, tool: 'caffeinate' }));
    const host = fakeHost('darwin', ['caffeinate']);
    expect(releaseHold(dir, host.deps)).toBe('Keep-awake: nothing to release.');
    expect(host.killed).toEqual([]);
    expect(fs.existsSync(path.join(dir, SLEEP_HOLD_FILE))).toBe(false);
  });
});

describe('keepAwakeStatus', () => {
  test('held, stale, absent, and not needed on an ephemeral host', () => {
    const dir = campaignDir();
    const alive = (pid: number) => pid === 500;
    expect(keepAwakeStatus(dir, 'local', alive)).toEqual({ held: false, reason: 'no hold recorded' });
    writeHold(dir, 500);
    expect(keepAwakeStatus(dir, 'local', alive)).toEqual({ held: true, tool: 'caffeinate', pid: 500, since: NOW_ISO });
    expect(keepAwakeStatus(dir, 'branch', alive)).toEqual({ held: false, reason: 'ephemeral host (state_store: branch): nothing to inhibit' });
    writeHold(dir, 42);
    expect(keepAwakeStatus(dir, 'local', alive)).toEqual({
      held: false,
      reason: 'stale record: pid 42 is not running; `sleep --on` takes a new hold',
    });
  });
});

describe('resolveStateStore', () => {
  test('run-context.json route wins; without one the environment decides', () => {
    const dir = campaignDir();
    expect(resolveStateStore(dir, { CLAUDE_CODE_REMOTE: 'true' })).toBe('branch');
    expect(resolveStateStore(dir, {})).toBe('local');
    fs.writeFileSync(path.join(dir, 'run-context.json'), JSON.stringify({ route: { state_store: 'branch' } }));
    expect(resolveStateStore(dir, {})).toBe('branch');
    fs.writeFileSync(path.join(dir, 'run-context.json'), '{not json');
    expect(resolveStateStore(dir, { CLAUDE_CODE_REMOTE: 'true' })).toBe('branch');
  });
});
