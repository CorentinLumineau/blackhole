import { spawnSync } from 'child_process';
import { randomUUID } from 'crypto';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { parseFlags, unknownFlagKeys, type Flags } from './lib/argv-flags.ts';
import { writeJsonAtomic } from './lib/campaign-status/record.ts';
import type { QueueJson } from './lib/campaign-status/types.ts';
import { readJsonFile } from './lib/fs.ts';
import {
  claimsOf,
  detectPeers,
  isHostSession,
  isPid,
  isSelf,
  isSessionId,
  parseRecord,
  supersededSessions,
  PEER_ROLES,
  type DetectResult,
  type PeerRecord,
  type PeerRole,
  type RegistryEntry,
  type SelfIdentity,
} from './lib/peer-campaigns.ts';

// The peer campaign registry (ADR-057, `multitask-mode.md` § Peer campaign registry):
//
//   heartbeat --turn <n> [--host-session <id>]   write or refresh this session's record
//   detect                                        print {verdict, reach, unreadable, peers[]} as JSON; read-only
//   release                                       remove this session's record
//
// All take --campaign-dir (default ./.blackhole). Records live in
// `<git common dir>/blackhole/campaigns/<session>.json`, shared by every worktree of the clone and
// never pushed. This session's id is the host session id (`CLAUDE_CODE_SESSION_ID`) when the host
// sets one, so two sessions on one campaign dir keep two records; otherwise it lives in
// `<campaign dir>/.tmp/campaign-session.json`, shared by every session on that campaign dir. A
// host-scoped session writes `.tmp/campaign-last-session.json` instead, and a record left in this
// worktree by an earlier session of this campaign is superseded (`supersededSessions`), not a peer.
// Exit 0 on success; 1 when the git common dir cannot be resolved, or when heartbeat refuses a
// worktree, host or host session its peers could not read (nothing is written), or when the record
// cannot be written (one line with the errno code); 2 on a usage error.

const USAGE =
  'Usage: bun run scripts/peer-campaigns.ts <heartbeat --turn <n> [--host-session <id>] | detect | release> [--campaign-dir <dir>]';
/** The registry dir, relative to the git common dir. */
export const REGISTRY_DIR = path.join('blackhole', 'campaigns');
/** The env var carrying the host's own session id (Claude Code), used as this session's id when valid. */
export const HOST_SESSION_ENV = 'CLAUDE_CODE_SESSION_ID';
/** The env var carrying the host process id (Claude Code), recorded so a successor can tell a gone predecessor from a live peer. */
export const HOST_PID_ENV = 'CLAUDE_PID';
/** The last host-scoped session of this campaign dir (`{"session": "<id>"}`), relative to the campaign dir; never read as a token. */
export const LAST_SESSION_FILE = path.join('.tmp', 'campaign-last-session.json');
/** This session's id (`{"session": "<id>"}`) when the host sets none, relative to the campaign dir. */
export const SESSION_TOKEN_FILE = path.join('.tmp', 'campaign-session.json');

export type RegistryDeps = {
  /** `git -C <cwd> <args>`: exit status and trimmed stdout. */
  git: (cwd: string, args: string[]) => { status: number | null; stdout: string };
  hostname: () => string;
  nowMs: () => number;
  newSession: () => string;
  /** The host's own session id, or null when the host sets none. */
  hostSessionId: () => string | null;
  /** The host process id, or null when the host sets none. */
  hostPid: () => number | null;
  /** True while a process with this id exists on this host. */
  pidAlive: (pid: number) => boolean;
};

/** The real git, hostname, clock and UUID source; tests pass their own `RegistryDeps`. */
export const realDeps: RegistryDeps = {
  git: (cwd, args) => {
    const r = spawnSync('git', ['-C', cwd, ...args], { encoding: 'utf-8' });
    return { status: r.status, stdout: (r.stdout ?? '').trim() };
  },
  hostname: () => os.hostname(),
  nowMs: () => Date.now(),
  newSession: () => randomUUID(),
  hostSessionId: () => process.env[HOST_SESSION_ENV] ?? null,
  hostPid: () => {
    const pid = Number(process.env[HOST_PID_ENV] ?? '');
    return isPid(pid) ? pid : null;
  },
  pidAlive: (pid) => {
    try {
      process.kill(pid, 0);
      return true;
    } catch (error) {
      // EPERM: the process exists but belongs to another user.
      return (error as NodeJS.ErrnoException).code === 'EPERM';
    }
  },
};

type Clone = { worktree: string; registry: string };

/**
 * A worktree path as a record carries it: forward slashes on Windows, where `realpath` gives
 * backslashes the record format refuses (git itself prints `C:/...`). Elsewhere a backslash is a
 * real file-name character, so the path is kept as is and heartbeat refuses it.
 */
export const recordedWorktree = (p: string, sep: string = path.sep): string => (sep === '\\' ? p.replaceAll('\\', '/') : p);

/** The worktree toplevel and registry dir for a campaign dir, resolved from its parent; null outside a git repo. */
export function resolveClone(campaignDir: string, deps: RegistryDeps): Clone | null {
  const base = path.dirname(path.resolve(campaignDir));
  const top = deps.git(base, ['rev-parse', '--show-toplevel']);
  const common = deps.git(base, ['rev-parse', '--git-common-dir']);
  if (top.status !== 0 || common.status !== 0 || !top.stdout || !common.stdout) return null;
  return { worktree: recordedWorktree(fs.realpathSync(top.stdout)), registry: path.join(path.resolve(base, common.stdout), REGISTRY_DIR) };
}

const readOptionalJson = (file: string): unknown => {
  if (!fs.existsSync(file)) return null;
  try {
    return readJsonFile(file, file);
  } catch {
    return null;
  }
};

const readSessionFile = (campaignDir: string, file: string): string | null => {
  const session = (readOptionalJson(path.join(campaignDir, file)) as { session?: unknown } | null)?.session;
  return isSessionId(session) ? session : null;
};

/** This session's id from its token file; null when none was minted yet. */
export const readSessionToken = (campaignDir: string): string | null => readSessionFile(campaignDir, SESSION_TOKEN_FILE);

/**
 * This session's id: the host session id when the host sets a valid one (`hostScoped`), else the
 * campaign dir's token (null when none was minted yet). A host id that is set but unusable as a
 * file name falls back to the token with a `warning` for stderr.
 */
export function sessionIdentity(
  campaignDir: string,
  deps: RegistryDeps = realDeps,
): { session: string | null; hostScoped: boolean; warning: string | null } {
  const host = deps.hostSessionId();
  if (isSessionId(host)) return { session: host, hostScoped: true, warning: null };
  const warning = host
    ? `peer-campaigns: warning: ${HOST_SESSION_ENV} is not a usable session id (letters, digits, _ and -, 64 at most); using the campaign-dir token, so another session on this campaign dir stays unseen`
    : null;
  return { session: readSessionToken(campaignDir), hostScoped: false, warning };
}

/** Earlier sessions of this campaign in this worktree (`supersededSessions`). */
function predecessors(campaignDir: string, clone: Clone, session: string, hostScoped: boolean, records: PeerRecord[], deps: RegistryDeps): string[] {
  const own = records.find((r) => r.session === session);
  return supersededSessions(
    records,
    {
      session,
      worktree: clone.worktree,
      host: deps.hostname(),
      hostScoped,
      pid: hostScoped ? deps.hostPid() : null,
      markers: [readSessionFile(campaignDir, LAST_SESSION_FILE), readSessionToken(campaignDir)].filter((m): m is string => m !== null),
      startedAtMs: own ? Date.parse(own.started_at) : null,
    },
    deps.pidAlive,
  );
}

/**
 * Every `*.json` entry of the registry (`*.json.tmp` writes in progress are skipped); `dirError`
 * when the dir exists but cannot be listed. Entries are `lstat`ed, never followed: anything but a
 * regular file (a directory, a symlink) has no text and keeps its own mtime, so it lapses like a
 * record does. An entry gone before its `lstat` (ENOENT) was released and is skipped; any other
 * `lstat` failure has no mtime, so it is dated `nowMs` and reads as a fresh unreadable entry.
 */
export function readRegistry(registry: string, nowMs: number = Date.now()): { entries: RegistryEntry[]; dirError: boolean } {
  if (!fs.existsSync(registry)) return { entries: [], dirError: false };
  let names: string[];
  try {
    names = fs.readdirSync(registry).filter((f) => f.endsWith('.json'));
  } catch {
    return { entries: [], dirError: true };
  }
  const entries = names.flatMap((file): RegistryEntry[] => {
    const full = path.join(registry, file);
    let stat: fs.Stats;
    try {
      stat = fs.lstatSync(full);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return [];
      return [{ file, text: null, mtimeMs: nowMs }];
    }
    if (!stat.isFile()) return [{ file, text: null, mtimeMs: stat.mtimeMs }];
    try {
      return [{ file, text: fs.readFileSync(full, 'utf-8'), mtimeMs: stat.mtimeMs }];
    } catch {
      return [{ file, text: null, mtimeMs: stat.mtimeMs }];
    }
  });
  return { entries, dirError: false };
}

/** The parseable, correctly named records of a registry read, for heartbeat's own bookkeeping. */
const recordsOf = (entries: RegistryEntry[]): PeerRecord[] =>
  entries.flatMap((e) => {
    const r = e.text === null ? null : parseRecord(e.text);
    return r && `${r.session}.json` === e.file ? [r] : [];
  });

type Coordination = { role: PeerRole; manager_session: string | null };
const readCoordination = (campaignDir: string): Coordination => {
  const c = (readOptionalJson(path.join(campaignDir, 'config.json')) as { usage_budget?: { coordination?: Record<string, unknown> } } | null)
    ?.usage_budget?.coordination;
  const role = PEER_ROLES.includes(c?.role as PeerRole) ? (c?.role as PeerRole) : 'solo';
  const manager = isHostSession(c?.manager_session) ? c.manager_session : null;
  return { role, manager_session: manager };
};

/** This session's identity. Read-only: an absent token matches no record by session, only by worktree. */
function selfIdentity(campaignDir: string, clone: Clone, entries: RegistryEntry[], deps: RegistryDeps): SelfIdentity {
  const id = sessionIdentity(campaignDir, deps);
  const session = id.session ?? '';
  const records = recordsOf(entries);
  const own = records.find((r) => r.session === session);
  return {
    session,
    worktree: clone.worktree,
    host: deps.hostname(),
    host_session: own?.host_session ?? null,
    manager_session: readCoordination(campaignDir).manager_session,
    superseded: predecessors(campaignDir, clone, session, id.hostScoped, records, deps),
  };
}

/** The `detect` verdict for a campaign dir, or null outside a git repo. Never writes. */
export function detectForCampaign(campaignDir: string, deps: RegistryDeps = realDeps): DetectResult | null {
  const clone = resolveClone(campaignDir, deps);
  if (!clone) return null;
  return detectIn(campaignDir, clone, deps);
}

function detectIn(campaignDir: string, clone: Clone, deps: RegistryDeps): DetectResult {
  const { entries, dirError } = readRegistry(clone.registry, deps.nowMs());
  return detectPeers(entries, selfIdentity(campaignDir, clone, entries, deps), deps.nowMs(), { dirError });
}

/** A heartbeat whose record would not parse back: nothing is written. */
class HeartbeatRefused extends Error {}

function heartbeat(campaignDir: string, clone: Clone, turn: number, hostSession: string | null, deps: RegistryDeps): string {
  const host = deps.hostname();
  const probe = { version: 1, session: 'probe', worktree: clone.worktree, host, host_session: hostSession, host_pid: null, role: 'solo', manager_session: null, turn, started_at: new Date(0).toISOString(), heartbeat_at: new Date(0).toISOString(), claims: [] };
  if (!parseRecord(JSON.stringify(probe))) {
    throw new HeartbeatRefused(
      `worktree ${JSON.stringify(clone.worktree)}, host ${JSON.stringify(host)} or --host-session cannot be recorded: peers would read the record as unreadable (no ", $, backtick, \\ or control characters)`,
    );
  }
  const id = sessionIdentity(campaignDir, deps);
  let session = id.session;
  if (!session) {
    session = deps.newSession();
    fs.mkdirSync(path.join(campaignDir, '.tmp'), { recursive: true });
    writeJsonAtomic(path.join(campaignDir, SESSION_TOKEN_FILE), { session });
  }
  fs.mkdirSync(clone.registry, { recursive: true });
  const records = recordsOf(readRegistry(clone.registry, deps.nowMs()).entries);
  const self: SelfIdentity = {
    session,
    worktree: clone.worktree,
    host,
    host_session: null,
    manager_session: null,
    superseded: predecessors(campaignDir, clone, session, id.hostScoped, records, deps),
  };
  const own = records.find((r) => r.session === session);
  // An earlier session of this campaign in this worktree (a lost token, or a host-scoped predecessor) is replaced.
  for (const r of records) if (r.session !== session && isSelf(r, self)) fs.rmSync(path.join(clone.registry, `${r.session}.json`), { force: true });
  const now = new Date(deps.nowMs()).toISOString();
  const record: PeerRecord = {
    version: 1,
    session,
    worktree: clone.worktree,
    host,
    host_session: hostSession ?? own?.host_session ?? null,
    host_pid: id.hostScoped ? deps.hostPid() : null,
    ...readCoordination(campaignDir),
    turn,
    started_at: own?.started_at ?? now,
    heartbeat_at: now,
    claims: claimsOf(readOptionalJson(path.join(campaignDir, 'queue.json')) as QueueJson | null),
  };
  writeJsonAtomic(path.join(clone.registry, `${session}.json`), record);
  // A host-scoped session records itself as this campaign dir's last session, for the next one's predecessor check.
  if (id.hostScoped && readSessionFile(campaignDir, LAST_SESSION_FILE) !== session) {
    fs.mkdirSync(path.join(campaignDir, '.tmp'), { recursive: true });
    writeJsonAtomic(path.join(campaignDir, LAST_SESSION_FILE), { session });
  }
  return `Heartbeat: session ${session}, turn ${turn}, ${record.claims.length} claim${record.claims.length === 1 ? '' : 's'}.`;
}

function release(campaignDir: string, clone: Clone, deps: RegistryDeps): string {
  const { session } = sessionIdentity(campaignDir, deps);
  const file = session ? path.join(clone.registry, `${session}.json`) : null;
  if (!file || !fs.existsSync(file)) return 'Release: no record for this session.';
  fs.rmSync(file, { force: true });
  return `Release: session ${session} removed from the registry.`;
}

const optional = (flags: Flags, key: string): string | null => (typeof flags[key] === 'string' ? (flags[key] as string) : null);

/** Runs one subcommand; returns the exit code and the text for stdout or stderr. */
export function run(argv: string[], deps: RegistryDeps = realDeps): { code: number; out?: string; err?: string } {
  const [sub, ...rest] = argv;
  const flags = parseFlags(rest);
  const known = sub === 'heartbeat' ? ['campaign-dir', 'turn', 'host-session'] : ['campaign-dir'];
  if (!['heartbeat', 'detect', 'release'].includes(sub ?? '') || unknownFlagKeys(flags, known).length) return { code: 2, err: USAGE };
  const turnFlag = optional(flags, 'turn');
  const turn = turnFlag === null || !turnFlag.trim() ? Number.NaN : Number(turnFlag);
  const hostSession = optional(flags, 'host-session');
  if (sub === 'heartbeat' && (!Number.isInteger(turn) || turn < 0)) return { code: 2, err: `--turn must be a whole number.\n${USAGE}` };
  if (hostSession !== null && !hostSession.trim()) return { code: 2, err: `--host-session must not be empty.\n${USAGE}` };
  const campaignDir = path.resolve(optional(flags, 'campaign-dir') ?? '.blackhole');
  const clone = resolveClone(campaignDir, deps);
  if (!clone) return { code: 1, err: `peer-campaigns: cannot resolve the git common dir for ${campaignDir}` };
  const { warning } = sessionIdentity(campaignDir, deps);
  const result = runIn(sub as string, campaignDir, clone, turn, hostSession, deps);
  return warning ? { ...result, err: result.err ? `${warning}\n${result.err}` : warning } : result;
}

function runIn(sub: string, campaignDir: string, clone: Clone, turn: number, hostSession: string | null, deps: RegistryDeps): { code: number; out?: string; err?: string } {
  if (sub === 'heartbeat') {
    try {
      return { code: 0, out: heartbeat(campaignDir, clone, turn, hostSession, deps) };
    } catch (error) {
      if (error instanceof HeartbeatRefused) return { code: 1, err: `peer-campaigns: ${error.message}` };
      const { code } = error as NodeJS.ErrnoException;
      if (typeof code === 'string' && /^E[A-Z0-9]+$/.test(code)) return { code: 1, err: `peer-campaigns: heartbeat could not be written (${code}): ${clone.registry}` };
      throw error;
    }
  }
  if (sub === 'release') return { code: 0, out: release(campaignDir, clone, deps) };
  return { code: 0, out: JSON.stringify(detectIn(campaignDir, clone, deps), null, 2) };
}

if (import.meta.main) {
  const result = run(process.argv.slice(2));
  if (result.out) console.log(result.out);
  if (result.err) console.error(result.err);
  process.exit(result.code);
}
