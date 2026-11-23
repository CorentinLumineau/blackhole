import { afterAll, describe, expect, test } from 'bun:test';
import { spawnSync } from 'child_process';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import {
  inhibitorFor,
  identifyWith,
  keepAwakeStatus,
  readHold,
  releaseHold,
  resolveStateStore,
  SETTLE_MS,
  HOLD_FILE,
  keepAwakeWanted,
  LEGACY_SLEEP_HOLD_FILE,
  reconcileHold,
  startInhibitor,
  systemHoldDeps,
  takeHold,
  type HoldDeps,
  type ProcState,
} from './keep-awake.ts';

// The keep-awake hold a running campaign takes on a local host. The unit tests fake every process call, so none
// starts a real caffeinate or systemd-inhibit; `systemHoldDeps` is exercised on plain `sh` and
// `sleep` processes this file starts and stops itself.

const dirs: string[] = [];
function campaignDir(): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'bh-keep-awake-'));
  dirs.push(dir);
  return dir;
}
const pids: number[] = [];
afterAll(() => {
  for (const d of dirs) fs.rmSync(d, { recursive: true, force: true });
  for (const p of pids) {
    try {
      process.kill(-p, 'SIGKILL');
    } catch {
      // already gone
    }
  }
});

const NOW_ISO = '2026-11-17T02:00:00.000Z';
const ID = (pid: number) => `Tue Nov 17 02:00:00 2026 caffeinate -i #${pid}`;
const holdPath = (dir: string) => path.join(dir, HOLD_FILE);
const writeHold = (dir: string, record: Record<string, unknown>) => {
  fs.mkdirSync(path.dirname(holdPath(dir)), { recursive: true });
  fs.writeFileSync(holdPath(dir), JSON.stringify(record));
};
const record = (pid: number, over: Record<string, unknown> = {}) => ({ pid, tool: 'caffeinate', started_at: NOW_ISO, identity: ID(pid), ...over });

/**
 * A fake host. `procs` maps pid → its identity (running), 'unknown' (ps failed) or absent (gone).
 * Spawns hand out pids from 500 and, unless `dies` is set, leave them running with identity ID(pid).
 */
function fakeHost(platform: NodeJS.Platform, bins: string[], procs: Record<number, string> = {}, opts: { dies?: string } = {}) {
  const calls: string[] = [];
  let next = 500;
  const deps: HoldDeps = {
    platform,
    onPath: (bin) => bins.includes(bin),
    spawnDetached: (command, stderrFile) => {
      calls.push(`spawn ${command.join(' ')}`);
      const pid = next++;
      if (opts.dies !== undefined) fs.writeFileSync(stderrFile, opts.dies);
      else procs[pid] = ID(pid);
      return pid;
    },
    identify: (pid): ProcState => {
      const p = procs[pid];
      if (p === undefined) return { state: 'gone' };
      if (p === 'unknown') return { state: 'unknown', reason: 'ps not found' };
      return { state: 'running', identity: p };
    },
    kill: (pid) => {
      calls.push(`kill ${pid}`);
      delete procs[pid];
    },
    wait: () => {},
  };
  return { deps, calls, procs };
}

describe('inhibitorFor', () => {
  test('caffeinate on macOS, systemd-inhibit on Linux, nothing elsewhere or when absent', () => {
    expect(inhibitorFor('darwin', () => true)).toEqual({ tool: 'caffeinate', command: ['caffeinate', '-i'] });
    expect(inhibitorFor('linux', (b) => b === 'systemd-inhibit')).toEqual({
      tool: 'systemd-inhibit',
      command: ['systemd-inhibit', '--what=idle:sleep', '--who=blackhole', '--why=campaign keep-awake', '--mode=block', 'sleep', 'infinity'],
    });
    expect(inhibitorFor('darwin', () => false)).toBeNull();
    expect(inhibitorFor('linux', (b) => b === 'caffeinate')).toBeNull();
    expect(inhibitorFor('win32', () => true)).toBeNull();
  });
});

describe('readHold', () => {
  test('lives under .tmp, so it is ignored wherever .blackhole/ is tracked and never travels', () => {
    expect(HOLD_FILE).toBe(path.join('.tmp', 'keep-awake-hold.json'));
  });

  test('adopts a hold recorded under the retired sleep-mode name, so a live inhibitor is never orphaned', () => {
    const dir = campaignDir();
    fs.mkdirSync(path.join(dir, '.tmp'), { recursive: true });
    fs.writeFileSync(path.join(dir, LEGACY_SLEEP_HOLD_FILE), JSON.stringify(record(42)));
    expect(LEGACY_SLEEP_HOLD_FILE).toBe(path.join('.tmp', 'sleep-hold.json'));
    expect(readHold(dir)).toEqual(record(42));
    expect(fs.existsSync(path.join(dir, LEGACY_SLEEP_HOLD_FILE))).toBe(false);
    expect(JSON.parse(fs.readFileSync(holdPath(dir), 'utf-8'))).toEqual(record(42));
    const host = fakeHost('darwin', ['caffeinate'], { 42: ID(42) });
    expect(releaseHold(dir, host.deps)).toBe('Keep-awake: released caffeinate (pid 42).');
    expect(host.calls).toEqual(['kill 42']);
  });

  test('accepts a full record', () => {
    const dir = campaignDir();
    writeHold(dir, record(42));
    expect(readHold(dir)).toEqual(record(42) as never);
  });

  test.each([
    ['pid 1 (init)', { pid: 1 }],
    ['pid 0', { pid: 0 }],
    ['negative pid (a process group)', { pid: -42 }],
    ['fractional pid', { pid: 42.5 }],
    ['unknown tool', { tool: 'bash' }],
    ['missing started_at', { started_at: undefined }],
    ['missing identity', { identity: undefined }],
    ['empty identity', { identity: '' }],
  ])('rejects %s', (_label, over) => {
    const dir = campaignDir();
    writeHold(dir, record(42, over));
    expect(readHold(dir)).toBeNull();
  });
});

describe('takeHold', () => {
  test('a local host starts the inhibitor and records its pid and identity', () => {
    const dir = campaignDir();
    const host = fakeHost('darwin', ['caffeinate']);
    expect(takeHold(dir, 'local', host.deps, NOW_ISO)).toBe('Keep-awake: held by caffeinate (pid 500) until the campaign drains or stops.');
    expect(host.calls).toEqual(['spawn caffeinate -i']);
    expect(readHold(dir)).toEqual({ pid: 500, tool: 'caffeinate', started_at: NOW_ISO, identity: ID(500) });
  });

  test('is idempotent: a live recorded hold is kept, no second inhibitor starts', () => {
    const dir = campaignDir();
    const host = fakeHost('darwin', ['caffeinate']);
    takeHold(dir, 'local', host.deps, NOW_ISO);
    expect(takeHold(dir, 'local', host.deps, '2026-11-17T05:00:00.000Z')).toBe('Keep-awake: already held by caffeinate (pid 500).');
    expect(host.calls).toHaveLength(1);
    expect(readHold(dir)?.started_at).toBe(NOW_ISO);
  });

  test('a stale pid (gone, or reused by another process) is cleared and replaced, never killed', () => {
    for (const procs of [{}, { 42: 'Mon Nov 16 09:00:00 2026 caffeinate -i' }]) {
      const dir = campaignDir();
      writeHold(dir, record(42));
      const host = fakeHost('darwin', ['caffeinate'], { ...procs });
      expect(takeHold(dir, 'local', host.deps, NOW_ISO)).toBe(
        'Keep-awake: held by caffeinate (pid 500) until the campaign drains or stops; stale pid 42 cleared.',
      );
      expect(host.calls).toEqual(['spawn caffeinate -i']);
      expect(readHold(dir)?.pid).toBe(500);
    }
  });

  test('a record whose state cannot be read is kept and no second inhibitor starts', () => {
    const dir = campaignDir();
    writeHold(dir, record(42));
    const host = fakeHost('darwin', ['caffeinate'], { 42: 'unknown' });
    expect(takeHold(dir, 'local', host.deps, NOW_ISO)).toBe(
      'Keep-awake: hold state unknown for pid 42 (ps not found); record kept, no second inhibitor started.',
    );
    expect(host.calls).toEqual([]);
    expect(readHold(dir)?.pid).toBe(42);
  });

  test('an ephemeral host (state_store branch) is a no-op and says so', () => {
    const dir = campaignDir();
    const host = fakeHost('linux', ['systemd-inhibit']);
    expect(takeHold(dir, 'branch', host.deps, NOW_ISO)).toBe('Keep-awake: not held — ephemeral host (state_store: branch), nothing to inhibit.');
    expect(host.calls).toEqual([]);
    expect(fs.existsSync(holdPath(dir))).toBe(false);
  });

  test('no inhibitor on the host, or one that fails to spawn, records nothing', () => {
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

  test('an inhibitor that exits at once is reported with its stderr, and nothing is recorded', () => {
    const dir = campaignDir();
    const host = fakeHost('linux', ['systemd-inhibit'], {}, { dies: 'Failed to connect to bus: No such file or directory\nmore\n' });
    expect(takeHold(dir, 'local', host.deps, NOW_ISO)).toBe(
      'Keep-awake: not held — systemd-inhibit exited: Failed to connect to bus: No such file or directory.',
    );
    expect(readHold(dir)).toBeNull();
    expect(fs.readdirSync(path.join(dir, '.tmp'))).toEqual([]);
  });

  test('a stale record plus a failed spawn: the stale record is cleared, no new one written', () => {
    const dir = campaignDir();
    writeHold(dir, record(42));
    const host = fakeHost('linux', ['systemd-inhibit'], {}, { dies: '' });
    expect(takeHold(dir, 'local', host.deps, NOW_ISO)).toBe('Keep-awake: not held — systemd-inhibit exited; stale pid 42 cleared.');
    expect(readHold(dir)).toBeNull();
  });

  test('a record that cannot be written stops the new inhibitor', () => {
    const dir = campaignDir();
    fs.mkdirSync(`${holdPath(dir)}.tmp`, { recursive: true }); // a directory where the atomic write's .tmp goes: the write fails
    const host = fakeHost('darwin', ['caffeinate']);
    expect(takeHold(dir, 'local', host.deps, NOW_ISO)).toStartWith('Keep-awake: not held — could not record pid 500, inhibitor stopped: ');
    expect(host.calls).toEqual(['spawn caffeinate -i', 'kill 500']);
  });
});

describe('startInhibitor', () => {
  test('waits SETTLE_MS before judging, so an inhibitor that dies during that wait is not taken as held', () => {
    const waits: number[] = [];
    let waited = false;
    const host = fakeHost('linux', ['systemd-inhibit']);
    host.deps.spawnDetached = (_command, stderrFile) => {
      fs.writeFileSync(stderrFile, 'Failed to inhibit\n');
      return 900;
    };
    host.deps.identify = () => (waited ? { state: 'gone' } : { state: 'running', identity: 'x' });
    host.deps.wait = (ms) => {
      waits.push(ms);
      waited = true;
    };
    expect(startInhibitor(['systemd-inhibit'], host.deps, path.join(campaignDir(), '.tmp', 'err'))).toEqual({
      ok: false,
      reason: 'exited: Failed to inhibit',
    });
    expect(waits).toEqual([SETTLE_MS]);
  });
});

describe('releaseHold', () => {
  test('stops the recorded inhibitor, then drops the record', () => {
    const dir = campaignDir();
    const host = fakeHost('linux', ['systemd-inhibit']);
    takeHold(dir, 'local', host.deps, NOW_ISO);
    expect(releaseHold(dir, host.deps)).toBe('Keep-awake: released systemd-inhibit (pid 500).');
    expect(host.calls.at(-1)).toBe('kill 500');
    expect(fs.existsSync(holdPath(dir))).toBe(false);
    expect(releaseHold(dir, host.deps)).toBe('Keep-awake: nothing to release.');
  });

  test('a failed kill keeps the record so the hold can still be found', () => {
    const dir = campaignDir();
    writeHold(dir, record(42));
    const host = fakeHost('darwin', ['caffeinate'], { 42: ID(42) });
    host.deps.kill = () => {
      throw new Error('EPERM');
    };
    expect(releaseHold(dir, host.deps)).toBe('Keep-awake: could not stop caffeinate (pid 42): EPERM; record kept.');
    expect(readHold(dir)?.pid).toBe(42);
  });

  test('a pid reused by another process is never killed: the record is cleared instead', () => {
    const dir = campaignDir();
    writeHold(dir, record(42));
    const host = fakeHost('darwin', ['caffeinate'], { 42: 'Wed Nov 18 08:00:00 2026 caffeinate -i' });
    expect(releaseHold(dir, host.deps)).toBe('Keep-awake: pid 42 is no longer the hold; stale record cleared.');
    expect(host.calls).toEqual([]);
    expect(readHold(dir)).toBeNull();
  });

  test('an unreadable process state keeps the record and kills nothing', () => {
    const dir = campaignDir();
    writeHold(dir, record(42));
    const host = fakeHost('darwin', ['caffeinate'], { 42: 'unknown' });
    expect(releaseHold(dir, host.deps)).toBe('Keep-awake: hold state unknown for pid 42 (ps not found); record kept.');
    expect(host.calls).toEqual([]);
    expect(readHold(dir)?.pid).toBe(42);
  });

  test('a malformed record is dropped without killing anything', () => {
    const dir = campaignDir();
    writeHold(dir, { pid: 1, tool: 'caffeinate' });
    const host = fakeHost('darwin', ['caffeinate'], { 1: 'init' });
    expect(releaseHold(dir, host.deps)).toBe('Keep-awake: nothing to release.');
    expect(host.calls).toEqual([]);
    expect(fs.existsSync(holdPath(dir))).toBe(false);
  });
});

describe('keepAwakeStatus', () => {
  test('held, stale, unknown, absent, and not needed on an ephemeral host', () => {
    const dir = campaignDir();
    const { deps, procs } = fakeHost('darwin', ['caffeinate']);
    expect(keepAwakeStatus(dir, 'local', deps.identify)).toEqual({ held: false, reason: 'no hold recorded' });
    writeHold(dir, record(500));
    procs[500] = ID(500);
    expect(keepAwakeStatus(dir, 'local', deps.identify)).toEqual({ held: true, tool: 'caffeinate', pid: 500, since: NOW_ISO });
    expect(keepAwakeStatus(dir, 'branch', deps.identify)).toEqual({ held: false, reason: 'ephemeral host (state_store: branch): nothing to inhibit' });
    procs[500] = 'unknown';
    expect(keepAwakeStatus(dir, 'local', deps.identify)).toEqual({ held: false, reason: 'hold state unknown for pid 500 (ps not found)' });
    delete procs[500];
    expect(keepAwakeStatus(dir, 'local', deps.identify)).toEqual({
      held: false,
      reason: 'stale record: pid 500 is no longer the hold; the next `keep-awake` takes a new hold',
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

describe('systemHoldDeps on real processes', () => {
  const stderrFile = () => path.join(campaignDir(), 'stderr');
  const childrenOf = (pid: number): number[] =>
    spawnSync('pgrep', ['-P', String(pid)], { encoding: 'utf-8' }).stdout.trim().split('\n').filter(Boolean).map(Number);

  test('identify reads a live process start time and command line, a zombie or missing pid is gone', () => {
    const pid = systemHoldDeps.spawnDetached(['sleep', '30'], stderrFile());
    pids.push(pid);
    const p = systemHoldDeps.identify(pid);
    expect(p.state).toBe('running');
    const identity = (p as { identity: string }).identity;
    expect(identity).toMatch(/^\w{3} \w{3} +\d+ \d\d:\d\d:\d\d \d{4} sleep 30$/);
    expect(systemHoldDeps.identify(pid)).toEqual(p); // stable for the same process
    systemHoldDeps.kill(pid);
    systemHoldDeps.wait(200);
    expect(systemHoldDeps.identify(pid)).toEqual({ state: 'gone' });
    expect(systemHoldDeps.identify(2 ** 22 + 7)).toEqual({ state: 'gone' });
  });

  test('identify does not depend on the caller time zone or locale', () => {
    const pid = systemHoldDeps.spawnDetached(['sleep', '30'], stderrFile());
    pids.push(pid);
    const saved = { TZ: process.env.TZ, LC_ALL: process.env.LC_ALL };
    try {
      process.env.TZ = 'Pacific/Kiritimati';
      process.env.LC_ALL = 'C';
      const east = systemHoldDeps.identify(pid);
      process.env.TZ = 'America/Adak';
      const west = systemHoldDeps.identify(pid);
      expect(east.state).toBe('running');
      expect(west).toEqual(east);
    } finally {
      for (const [k, v] of Object.entries(saved)) {
        if (v === undefined) delete process.env[k];
        else process.env[k] = v;
      }
      systemHoldDeps.kill(pid);
    }
  });

  test('a missing ps binary reads as unknown, never gone', () => {
    const identify = identifyWith(path.join(campaignDir(), 'no-such-ps'));
    const p = identify(process.pid);
    expect(p.state).toBe('unknown');
    expect((p as { reason: string }).reason).toStartWith('ps failed: ');
  });

  test('kill stops the whole process group, not only its leader', () => {
    const pid = systemHoldDeps.spawnDetached(['sh', '-c', 'sleep 30 & sleep 30'], stderrFile());
    pids.push(pid);
    systemHoldDeps.wait(200);
    const children = childrenOf(pid);
    expect(children.length).toBe(2);
    systemHoldDeps.kill(pid);
    systemHoldDeps.wait(300);
    for (const p of [pid, ...children]) expect(systemHoldDeps.identify(p)).toEqual({ state: 'gone' });
  });

  test('startInhibitor reports a tool that exits at once, with its stderr', () => {
    const file = stderrFile();
    expect(startInhibitor(['sh', '-c', 'echo "Failed to connect to bus" >&2; exit 1'], systemHoldDeps, file)).toEqual({
      ok: false,
      reason: 'exited: Failed to connect to bus',
    });
  });

  test('startInhibitor confirms a tool that stays up, and returns its identity', () => {
    const started = startInhibitor(['sleep', '30'], systemHoldDeps, stderrFile());
    expect(started.ok).toBe(true);
    const { pid, identity } = started as { pid: number; identity: string };
    pids.push(pid);
    expect(identity).toEndWith(' sleep 30');
    systemHoldDeps.kill(pid);
  });
});

describe('keepAwakeWanted', () => {
  test('held while a worker is in flight or a wake is armed, released otherwise', () => {
    expect(keepAwakeWanted({ workers: 1, wakeArmed: false })).toBe(true);
    expect(keepAwakeWanted({ workers: 0, wakeArmed: true })).toBe(true);
    expect(keepAwakeWanted({ workers: 0, wakeArmed: false })).toBe(false);
  });
});

describe('reconcileHold', () => {
  test('a spawned worker takes the hold; a PACE-WAIT drain with its wake armed keeps it', () => {
    const dir = campaignDir();
    const host = fakeHost('darwin', ['caffeinate']);
    expect(reconcileHold(dir, 'local', host.deps, NOW_ISO, { workers: 2, wakeArmed: false })).toBe(
      'Keep-awake: held by caffeinate (pid 500) until the campaign drains or stops.',
    );
    expect(reconcileHold(dir, 'local', host.deps, NOW_ISO, { workers: 0, wakeArmed: true })).toBe(
      'Keep-awake: already held by caffeinate (pid 500).',
    );
    expect(host.calls).toEqual(['spawn caffeinate -i']);
  });

  test('a drain, a stop or a STOP-CAMPAIGN (no worker, no wake) releases it', () => {
    const dir = campaignDir();
    const host = fakeHost('darwin', ['caffeinate']);
    reconcileHold(dir, 'local', host.deps, NOW_ISO, { workers: 1, wakeArmed: false });
    expect(reconcileHold(dir, 'local', host.deps, NOW_ISO, { workers: 0, wakeArmed: false })).toBe('Keep-awake: released caffeinate (pid 500).');
    expect(host.calls).toEqual(['spawn caffeinate -i', 'kill 500']);
    expect(fs.existsSync(holdPath(dir))).toBe(false);
    expect(reconcileHold(dir, 'local', host.deps, NOW_ISO, { workers: 0, wakeArmed: false })).toBe('Keep-awake: nothing to release.');
  });

  test('an ephemeral host (state_store branch) never starts an inhibitor', () => {
    const dir = campaignDir();
    const host = fakeHost('darwin', ['caffeinate']);
    expect(reconcileHold(dir, 'branch', host.deps, NOW_ISO, { workers: 3, wakeArmed: true })).toBe(
      'Keep-awake: not held — ephemeral host (state_store: branch), nothing to inhibit.',
    );
    expect(host.calls).toEqual([]);
  });
});
