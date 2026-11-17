import { spawn, spawnSync } from 'child_process';
import * as fs from 'fs';
import * as path from 'path';
import { readJsonFile } from '../fs.ts';
import { detectRunContext } from '../run-context.ts';
import { writeJsonAtomic } from './record.ts';

// The keep-awake hold of a sleeping campaign on a local host (`sleep-mode.md` § Keeps itself
// alive): `sleep --on` starts an OS idle inhibitor, `sleep --off` and `wake` stop it. Its pid
// lives in `.blackhole/sleep-hold.json`, a per-machine record that never travels on the state
// branch, so every hold can be found and stopped again. Every process call goes through
// `HoldDeps`, so tests never start a real inhibitor.

export const SLEEP_HOLD_FILE = 'sleep-hold.json';

export type InhibitorTool = 'caffeinate' | 'systemd-inhibit';
export type HoldRecord = { pid: number; tool: InhibitorTool; started_at: string };
export type StateStore = 'local' | 'branch';

export type HoldDeps = {
  platform: NodeJS.Platform;
  /** True when `bin` is an executable on PATH. */
  onPath: (bin: string) => boolean;
  /** Starts `command` detached from this process (its own process group) and returns its pid. */
  spawnDetached: (command: string[]) => number;
  /** True when `pid` is alive and runs `tool`, so a reused pid is never mistaken for the hold. */
  isRunning: (pid: number, tool: InhibitorTool) => boolean;
  /** Stops `pid` and its process group. */
  kill: (pid: number) => void;
};

/** The idle inhibitor this platform offers, or null. Each one holds until it is killed. */
export function inhibitorFor(platform: NodeJS.Platform, onPath: (bin: string) => boolean): { tool: InhibitorTool; command: string[] } | null {
  if (platform === 'darwin' && onPath('caffeinate')) return { tool: 'caffeinate', command: ['caffeinate', '-i'] };
  if (platform === 'linux' && onPath('systemd-inhibit')) {
    return {
      tool: 'systemd-inhibit',
      command: ['systemd-inhibit', '--what=idle:sleep', '--who=blackhole', '--why=campaign sleep mode', '--mode=block', 'sleep', 'infinity'],
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

/** The recorded hold, or null when there is none or the file is not a hold record. */
export function readHold(campaignDir: string): HoldRecord | null {
  const file = path.join(campaignDir, SLEEP_HOLD_FILE);
  if (!fs.existsSync(file)) return null;
  try {
    const r = readJsonFile(file, file) as Partial<HoldRecord>;
    return Number.isInteger(r.pid) && (r.pid as number) > 0 && isTool(r.tool) && typeof r.started_at === 'string' ? (r as HoldRecord) : null;
  } catch {
    return null;
  }
}

const dropHold = (campaignDir: string): void => fs.rmSync(path.join(campaignDir, SLEEP_HOLD_FILE), { force: true });

/**
 * Takes the hold for `sleep --on`. Idempotent: a live recorded hold is kept, a stale one (its pid
 * gone or reused) is cleared and replaced. Never throws on a hold that cannot start: sleep mode
 * stays on and the line says why. Returns the `Keep-awake:` line to print.
 */
export function takeHold(campaignDir: string, stateStore: StateStore, deps: HoldDeps, nowIso: string): string {
  if (stateStore === 'branch') return 'Keep-awake: not held — ephemeral host (state_store: branch), nothing to inhibit.';
  const current = readHold(campaignDir);
  if (current && deps.isRunning(current.pid, current.tool)) return `Keep-awake: already held by ${current.tool} (pid ${current.pid}).`;
  const stale = current ? `; stale pid ${current.pid} cleared` : '';
  dropHold(campaignDir);
  const inhibitor = inhibitorFor(deps.platform, deps.onPath);
  if (!inhibitor) return `Keep-awake: not held — no caffeinate (macOS) or systemd-inhibit (Linux) on this host${stale}.`;
  let pid: number;
  try {
    pid = deps.spawnDetached(inhibitor.command);
  } catch (err) {
    return `Keep-awake: not held — ${inhibitor.tool} did not start: ${(err as Error).message}${stale}.`;
  }
  const record: HoldRecord = { pid, tool: inhibitor.tool, started_at: nowIso };
  writeJsonAtomic(path.join(campaignDir, SLEEP_HOLD_FILE), record);
  return `Keep-awake: held by ${inhibitor.tool} (pid ${pid}) until \`sleep --off\` or \`wake\`${stale}.`;
}

/** Releases the hold for `sleep --off` and `wake`; the record goes either way. Returns the line to print. */
export function releaseHold(campaignDir: string, deps: HoldDeps): string {
  const current = readHold(campaignDir);
  dropHold(campaignDir);
  if (!current) return 'Keep-awake: nothing to release.';
  if (!deps.isRunning(current.pid, current.tool)) return `Keep-awake: pid ${current.pid} was no longer running; stale record cleared.`;
  try {
    deps.kill(current.pid);
  } catch (err) {
    return `Keep-awake: could not stop ${current.tool} (pid ${current.pid}): ${(err as Error).message}.`;
  }
  return `Keep-awake: released ${current.tool} (pid ${current.pid}).`;
}

export type KeepAwake = { held: true; tool: InhibitorTool; pid: number; since: string } | { held: false; reason: string };

/** What `run-context.json` records about the hold: held, or why not. Reads only; never starts or stops one. */
export function keepAwakeStatus(campaignDir: string, stateStore: StateStore, isRunning: HoldDeps['isRunning']): KeepAwake {
  if (stateStore === 'branch') return { held: false, reason: 'ephemeral host (state_store: branch): nothing to inhibit' };
  const current = readHold(campaignDir);
  if (!current) return { held: false, reason: 'no hold recorded' };
  if (!isRunning(current.pid, current.tool)) return { held: false, reason: `stale record: pid ${current.pid} is not running; \`sleep --on\` takes a new hold` };
  return { held: true, tool: current.tool, pid: current.pid, since: current.started_at };
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
  spawnDetached: (command) => {
    const child = spawn(command[0], command.slice(1), { detached: true, stdio: 'ignore' });
    // A spawn failure is reported through the missing pid below; the async event carries nothing more.
    child.on('error', () => {});
    if (child.pid === undefined) throw new Error(`could not spawn ${command[0]}`);
    child.unref();
    return child.pid;
  },
  isRunning: (pid, tool) => {
    // `comm` is the executable name, cut to 15 characters on Linux; `systemd-inhibit` is exactly 15.
    const ps = spawnSync('ps', ['-p', String(pid), '-o', 'comm='], { encoding: 'utf-8' });
    return ps.status === 0 && path.basename(ps.stdout.trim()) === tool.slice(0, 15);
  },
  kill: (pid) => {
    // The inhibitor leads its own process group (spawned detached): stopping the group also stops
    // the `sleep infinity` that `systemd-inhibit` runs, so nothing is left orphaned.
    try {
      process.kill(-pid, 'SIGTERM');
    } catch {
      process.kill(pid, 'SIGTERM');
    }
  },
};
