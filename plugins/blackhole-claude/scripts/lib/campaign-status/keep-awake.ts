import { spawn, spawnSync } from 'child_process';
import * as fs from 'fs';
import * as path from 'path';
import { readJsonFile } from '../fs.ts';
import { detectRunContext } from '../run-context.ts';
import { writeJsonAtomic } from './record.ts';

// The keep-awake hold a running campaign takes on a local host (`keep-awake.md`, ADR-059
// amendment): held while a worker is in flight or a wake is armed, released at drain, stop and
// `STOP-CAMPAIGN` (`campaign-record.ts keep-awake`). The record
// lives in `.blackhole/.tmp/`, ignored wherever `.blackhole/` is tracked and never carried on the
// state branch. A recorded pid is acted on only while its start time and command line still
// match the record, so a reused pid is never signalled. Every process call goes through
// `HoldDeps`, so unit tests never start a real inhibitor.

export const HOLD_FILE = path.join('.tmp', 'keep-awake-hold.json');
/** Where retired sleep mode recorded its hold; a record found there is moved to `HOLD_FILE` on first read. */
export const LEGACY_SLEEP_HOLD_FILE = path.join('.tmp', 'sleep-hold.json');
/** How long a fresh inhibitor gets to fail (no D-Bus, no permission) before it counts as holding. */
export const SETTLE_MS = 300;

export type InhibitorTool = 'caffeinate' | 'systemd-inhibit';
/** `identity` is the process start time (UTC, C locale) and command line, as `ps -o lstart=,args=` printed them. */
export type HoldRecord = { pid: number; tool: InhibitorTool; started_at: string; identity: string };
export type StateStore = 'local' | 'branch';
/** `unknown`: the process table could not be read, so neither "held" nor "gone" may be assumed. */
export type ProcState = { state: 'running'; identity: string } | { state: 'gone' } | { state: 'unknown'; reason: string };

export type HoldDeps = {
  platform: NodeJS.Platform;
  /** True when `bin` is an executable on PATH. */
  onPath: (bin: string) => boolean;
  /** Starts `command` detached (its own process group), stderr to `stderrFile`, and returns its pid. */
  spawnDetached: (command: string[], stderrFile: string) => number;
  /** The process `pid` names now; a zombie counts as gone. */
  identify: (pid: number) => ProcState;
  /** Stops `pid`'s process group. */
  kill: (pid: number) => void;
  /** Blocks for `ms`. */
  wait: (ms: number) => void;
};

/** The idle inhibitor this platform offers, or null. Each one holds until it is killed. */
export function inhibitorFor(platform: NodeJS.Platform, onPath: (bin: string) => boolean): { tool: InhibitorTool; command: string[] } | null {
  if (platform === 'darwin' && onPath('caffeinate')) return { tool: 'caffeinate', command: ['caffeinate', '-i'] };
  if (platform === 'linux' && onPath('systemd-inhibit')) {
    return {
      tool: 'systemd-inhibit',
      command: ['systemd-inhibit', '--what=idle:sleep', '--who=blackhole', '--why=campaign keep-awake', '--mode=block', 'sleep', 'infinity'],
    };
  }
  return null;
}

/**
 * `route.state_store` from `run-context.json`; with no readable run context, the disk-persistence
 * rule `detectRunContext` applies to the environment (a cloud, Project or CI container is reclaimed).
 */
export function resolveStateStore(campaignDir: string, env: Record<string, string | undefined>): StateStore {
  const file = path.join(campaignDir, 'run-context.json');
  if (fs.existsSync(file)) {
    try {
      const store = (readJsonFile(file, file) as { route?: { state_store?: unknown } }).route?.state_store;
      if (store === 'local' || store === 'branch') return store;
    } catch {
      // An unreadable run context falls through to the environment.
    }
  }
  return detectRunContext(env, { ghAuthenticated: false }, []).persistent_disk.value ? 'local' : 'branch';
}

const isTool = (v: unknown): v is InhibitorTool => v === 'caffeinate' || v === 'systemd-inhibit';

/** The recorded hold, or null when there is none or the file is not a valid record (pid 1 and below included). */
export function readHold(campaignDir: string): HoldRecord | null {
  adoptLegacyHold(campaignDir);
  const file = path.join(campaignDir, HOLD_FILE);
  if (!fs.existsSync(file)) return null;
  try {
    const r = readJsonFile(file, file) as Partial<HoldRecord>;
    const ok = Number.isInteger(r.pid) && (r.pid as number) > 1 && isTool(r.tool) && typeof r.started_at === 'string'
      && typeof r.identity === 'string' && r.identity.length > 0;
    return ok ? (r as HoldRecord) : null;
  } catch {
    return null;
  }
}

/** Moves a hold recorded by retired sleep mode to `HOLD_FILE`, so its live inhibitor can still be released. */
function adoptLegacyHold(campaignDir: string): void {
  const legacy = path.join(campaignDir, LEGACY_SLEEP_HOLD_FILE);
  const current = path.join(campaignDir, HOLD_FILE);
  if (fs.existsSync(legacy) && !fs.existsSync(current)) fs.renameSync(legacy, current);
}

const dropHold = (campaignDir: string): void => fs.rmSync(path.join(campaignDir, HOLD_FILE), { force: true });

type Check = { state: 'live' } | { state: 'stale' } | { state: 'unknown'; reason: string };

/** Whether the recorded process is still the hold: same pid, same start time and command line. */
function checkHold(record: HoldRecord, identify: HoldDeps['identify']): Check {
  const p = identify(record.pid);
  if (p.state === 'unknown') return p;
  return p.state === 'running' && p.identity === record.identity ? { state: 'live' } : { state: 'stale' };
}

const unknownLine = (pid: number, reason: string) => `hold state unknown for pid ${pid} (${reason})`;

function firstLine(file: string): string {
  try {
    return fs.readFileSync(file, 'utf-8').trim().split('\n')[0]?.trim().slice(0, 200) ?? '';
  } catch {
    return '';
  }
}

/**
 * Spawns `command`, gives it `SETTLE_MS` to fail, then confirms it is still running. Returns its pid
 * and identity, or why it is not holding: it exited (with its first stderr line), or its state
 * could not be read (it is then stopped, since an unconfirmed inhibitor cannot be tracked).
 */
export function startInhibitor(
  command: string[],
  deps: HoldDeps,
  stderrFile: string,
): { ok: true; pid: number; identity: string } | { ok: false; reason: string } {
  fs.mkdirSync(path.dirname(stderrFile), { recursive: true });
  let pid: number;
  try {
    pid = deps.spawnDetached(command, stderrFile);
  } catch (err) {
    return { ok: false, reason: `did not start: ${(err as Error).message}` };
  }
  deps.wait(SETTLE_MS);
  const p = deps.identify(pid);
  const stderr = firstLine(stderrFile);
  fs.rmSync(stderrFile, { force: true });
  if (p.state === 'running') return { ok: true, pid, identity: p.identity };
  if (p.state === 'gone') return { ok: false, reason: stderr ? `exited: ${stderr}` : 'exited' };
  try {
    deps.kill(pid);
  } catch {
    // Its state is already unreadable; the reason below says the hold was not confirmed.
  }
  return { ok: false, reason: `not confirmed running (${p.reason}), stopped` };
}

/**
 * Takes the hold. Idempotent: a live recorded hold is kept; a stale one (pid gone
 * or reused) is cleared and replaced; one whose state cannot be read is kept and nothing new starts.
 * Never throws on an inhibitor problem: the campaign runs on and the line says why.
 */
export function takeHold(campaignDir: string, stateStore: StateStore, deps: HoldDeps, nowIso: string): string {
  if (stateStore === 'branch') return 'Keep-awake: not held — ephemeral host (state_store: branch), nothing to inhibit.';
  const current = readHold(campaignDir);
  let stale = '';
  if (current) {
    const check = checkHold(current, deps.identify);
    if (check.state === 'live') return `Keep-awake: already held by ${current.tool} (pid ${current.pid}).`;
    if (check.state === 'unknown') return `Keep-awake: ${unknownLine(current.pid, check.reason)}; record kept, no second inhibitor started.`;
    stale = `; stale pid ${current.pid} cleared`;
  }
  dropHold(campaignDir);
  const inhibitor = inhibitorFor(deps.platform, deps.onPath);
  if (!inhibitor) return `Keep-awake: not held — no caffeinate (macOS) or systemd-inhibit (Linux) on this host${stale}.`;
  const started = startInhibitor(inhibitor.command, deps, path.join(campaignDir, '.tmp', 'keep-awake-hold.stderr'));
  if (!started.ok) return `Keep-awake: not held — ${inhibitor.tool} ${started.reason}${stale}.`;
  const record: HoldRecord = { pid: started.pid, tool: inhibitor.tool, started_at: nowIso, identity: started.identity };
  try {
    writeJsonAtomic(path.join(campaignDir, HOLD_FILE), record);
  } catch (err) {
    // An unrecorded inhibitor could never be released, so it does not outlive this call.
    deps.kill(started.pid);
    return `Keep-awake: not held — could not record pid ${started.pid}, inhibitor stopped: ${(err as Error).message}${stale}.`;
  }
  return `Keep-awake: held by ${inhibitor.tool} (pid ${started.pid}) until the campaign drains or stops${stale}.`;
}

/**
 * Releases the hold. The record is dropped only once the hold is gone:
 * after a successful kill, or when its pid no longer names the hold. Returns the line to print.
 */
export function releaseHold(campaignDir: string, deps: HoldDeps): string {
  const current = readHold(campaignDir);
  if (!current) {
    dropHold(campaignDir);
    return 'Keep-awake: nothing to release.';
  }
  const check = checkHold(current, deps.identify);
  if (check.state === 'unknown') return `Keep-awake: ${unknownLine(current.pid, check.reason)}; record kept.`;
  if (check.state === 'stale') {
    dropHold(campaignDir);
    return `Keep-awake: pid ${current.pid} is no longer the hold; stale record cleared.`;
  }
  try {
    deps.kill(current.pid);
  } catch (err) {
    return `Keep-awake: could not stop ${current.tool} (pid ${current.pid}): ${(err as Error).message}; record kept.`;
  }
  dropHold(campaignDir);
  return `Keep-awake: released ${current.tool} (pid ${current.pid}).`;
}

/** The keep-awake rule: hold while a worker is in flight or a wake is armed; otherwise nothing needs the machine. */
export const keepAwakeWanted = (state: { workers: number; wakeArmed: boolean }): boolean => state.workers > 0 || state.wakeArmed;

/** Takes or releases the hold so it matches `keepAwakeWanted`. Idempotent; called at spawn, turn end, drain and stop. */
export function reconcileHold(
  campaignDir: string,
  stateStore: StateStore,
  deps: HoldDeps,
  nowIso: string,
  state: { workers: number; wakeArmed: boolean },
): string {
  return keepAwakeWanted(state) ? takeHold(campaignDir, stateStore, deps, nowIso) : releaseHold(campaignDir, deps);
}

export type KeepAwake = { held: true; tool: InhibitorTool; pid: number; since: string } | { held: false; reason: string };

/** What `run-context.json` records about the hold: held, or why not. Reads only; never starts or stops one. */
export function keepAwakeStatus(campaignDir: string, stateStore: StateStore, identify: HoldDeps['identify']): KeepAwake {
  if (stateStore === 'branch') return { held: false, reason: 'ephemeral host (state_store: branch): nothing to inhibit' };
  const current = readHold(campaignDir);
  if (!current) return { held: false, reason: 'no hold recorded' };
  const check = checkHold(current, identify);
  if (check.state === 'unknown') return { held: false, reason: unknownLine(current.pid, check.reason) };
  if (check.state === 'stale') return { held: false, reason: `stale record: pid ${current.pid} is no longer the hold; the next \`keep-awake\` takes a new hold` };
  return { held: true, tool: current.tool, pid: current.pid, since: current.started_at };
}

/** `ps -o stat=,lstart=,args=` output → state; lstart is always five words (`Tue Nov 17 02:00:00 2026`). */
function parsePs(out: string): ProcState {
  const words = out.trim().split(/\s+/);
  if (words.length < 7) return { state: 'gone' };
  if (words[0].startsWith('Z')) return { state: 'gone' };
  return { state: 'running', identity: words.slice(1).join(' ') };
}

/** `identify` backed by the `ps` at `psBin`; a `ps` that cannot run reads as unknown. */
export function identifyWith(psBin: string): HoldDeps['identify'] {
  return (pid) => {
    // `lstart` prints local time in the caller's locale: pin both, so the same process reads the
    // same identity whichever shell takes the hold and which one releases it.
    const ps = spawnSync(psBin, ['-p', String(pid), '-o', 'stat=', '-o', 'lstart=', '-o', 'args='], {
      encoding: 'utf-8',
      env: { ...process.env, TZ: 'UTC', LC_ALL: 'C' },
    });
    if (ps.error) return { state: 'unknown', reason: `ps failed: ${ps.error.message}` };
    if (ps.status === 0) return parsePs(ps.stdout);
    // ps exits non-zero with no output when the pid does not exist; anything on stderr is a real failure.
    return ps.stderr.trim() ? { state: 'unknown', reason: `ps failed: ${ps.stderr.trim()}` } : { state: 'gone' };
  };
}

/** The real process calls. */
export const systemHoldDeps: HoldDeps = {
  platform: process.platform,
  onPath: (bin) =>
    (process.env.PATH ?? '').split(path.delimiter).some((dir) => {
      try {
        fs.accessSync(path.join(dir, bin), fs.constants.X_OK);
        return true;
      } catch {
        return false;
      }
    }),
  spawnDetached: (command, stderrFile) => {
    const err = fs.openSync(stderrFile, 'w');
    try {
      const child = spawn(command[0], command.slice(1), { detached: true, stdio: ['ignore', 'ignore', err] });
      let spawnError: Error | null = null;
      child.on('error', (e) => {
        spawnError = e;
      });
      if (child.pid === undefined) throw spawnError ?? new Error(`could not spawn ${command[0]}`);
      child.unref();
      return child.pid;
    } finally {
      fs.closeSync(err);
    }
  },
  identify: identifyWith('ps'),
  kill: (pid) => {
    // The inhibitor leads its own process group (spawned detached): signalling the group also stops
    // the `sleep infinity` that `systemd-inhibit` runs, so nothing is left orphaned.
    process.kill(-pid, 'SIGTERM');
  },
  wait: (ms) => {
    Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);
  },
};
