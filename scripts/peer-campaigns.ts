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
  isSelf,
  isSessionId,
  parseRecord,
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
// never pushed. This session's id lives in `<campaign dir>/.tmp/campaign-session.json`.
// Exit 0 on success, 1 when the git common dir cannot be resolved, 2 on a usage error.

const USAGE =
  'Usage: bun run scripts/peer-campaigns.ts <heartbeat --turn <n> [--host-session <id>] | detect | release> [--campaign-dir <dir>]';
/** The registry dir, relative to the git common dir. */
export const REGISTRY_DIR = path.join('blackhole', 'campaigns');
/** This session's id (`{"session": "<id>"}`), relative to the campaign dir. */
export const SESSION_TOKEN_FILE = path.join('.tmp', 'campaign-session.json');

export type RegistryDeps = {
  /** `git -C <cwd> <args>`: exit status and trimmed stdout. */
  git: (cwd: string, args: string[]) => { status: number | null; stdout: string };
  hostname: () => string;
  nowMs: () => number;
  newSession: () => string;
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
};

type Clone = { worktree: string; registry: string };

/** The worktree toplevel and registry dir for a campaign dir, resolved from its parent; null outside a git repo. */
export function resolveClone(campaignDir: string, deps: RegistryDeps): Clone | null {
  const base = path.dirname(path.resolve(campaignDir));
  const top = deps.git(base, ['rev-parse', '--show-toplevel']);
  const common = deps.git(base, ['rev-parse', '--git-common-dir']);
  if (top.status !== 0 || common.status !== 0 || !top.stdout || !common.stdout) return null;
  return { worktree: fs.realpathSync(top.stdout), registry: path.join(path.resolve(base, common.stdout), REGISTRY_DIR) };
}

const readOptionalJson = (file: string): unknown => {
  if (!fs.existsSync(file)) return null;
  try {
    return readJsonFile(file, file);
  } catch {
    return null;
  }
};

const readToken = (campaignDir: string): string | null => {
  const session = (readOptionalJson(path.join(campaignDir, SESSION_TOKEN_FILE)) as { session?: unknown } | null)?.session;
  return isSessionId(session) ? session : null;
};

/** Every `*.json` file of the registry (`*.json.tmp` writes in progress are skipped); `dirError` when the dir exists but cannot be listed. */
export function readRegistry(registry: string): { entries: RegistryEntry[]; dirError: boolean } {
  if (!fs.existsSync(registry)) return { entries: [], dirError: false };
  let names: string[];
  try {
    names = fs.readdirSync(registry).filter((f) => f.endsWith('.json'));
  } catch {
    return { entries: [], dirError: true };
  }
  const entries = names.map((file): RegistryEntry => {
    const full = path.join(registry, file);
    try {
      return { file, text: fs.readFileSync(full, 'utf-8'), mtimeMs: fs.statSync(full).mtimeMs };
    } catch {
      return { file, text: null, mtimeMs: Date.now() };
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
  const session = readToken(campaignDir) ?? '';
  const own = recordsOf(entries).find((r) => r.session === session);
  return {
    session,
    worktree: clone.worktree,
    host: deps.hostname(),
    host_session: own?.host_session ?? null,
    manager_session: readCoordination(campaignDir).manager_session,
  };
}

/** The `detect` verdict for a campaign dir, or null outside a git repo. Never writes. */
export function detectForCampaign(campaignDir: string, deps: RegistryDeps = realDeps): DetectResult | null {
  const clone = resolveClone(campaignDir, deps);
  if (!clone) return null;
  return detectIn(campaignDir, clone, deps);
}

function detectIn(campaignDir: string, clone: Clone, deps: RegistryDeps): DetectResult {
  const { entries, dirError } = readRegistry(clone.registry);
  return detectPeers(entries, selfIdentity(campaignDir, clone, entries, deps), deps.nowMs(), { dirError });
}

function heartbeat(campaignDir: string, clone: Clone, turn: number, hostSession: string | null, deps: RegistryDeps): string {
  let session = readToken(campaignDir);
  if (!session) {
    session = deps.newSession();
    fs.mkdirSync(path.join(campaignDir, '.tmp'), { recursive: true });
    writeJsonAtomic(path.join(campaignDir, SESSION_TOKEN_FILE), { session });
  }
  fs.mkdirSync(clone.registry, { recursive: true });
  const records = recordsOf(readRegistry(clone.registry).entries);
  const host = deps.hostname();
  const self: SelfIdentity = { session, worktree: clone.worktree, host, host_session: null, manager_session: null };
  const own = records.find((r) => r.session === session);
  // An older session's record in this worktree is this campaign before its token was lost.
  for (const r of records) if (r.session !== session && isSelf(r, self)) fs.rmSync(path.join(clone.registry, `${r.session}.json`), { force: true });
  const now = new Date(deps.nowMs()).toISOString();
  const record: PeerRecord = {
    version: 1,
    session,
    worktree: clone.worktree,
    host,
    host_session: hostSession ?? own?.host_session ?? null,
    ...readCoordination(campaignDir),
    turn,
    started_at: own?.started_at ?? now,
    heartbeat_at: now,
    claims: claimsOf(readOptionalJson(path.join(campaignDir, 'queue.json')) as QueueJson | null),
  };
  writeJsonAtomic(path.join(clone.registry, `${session}.json`), record);
  return `Heartbeat: session ${session}, turn ${turn}, ${record.claims.length} claim${record.claims.length === 1 ? '' : 's'}.`;
}

function release(campaignDir: string, clone: Clone): string {
  const session = readToken(campaignDir);
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
  if (sub === 'heartbeat') return { code: 0, out: heartbeat(campaignDir, clone, turn, hostSession, deps) };
  if (sub === 'release') return { code: 0, out: release(campaignDir, clone) };
  return { code: 0, out: JSON.stringify(detectIn(campaignDir, clone, deps), null, 2) };
}

if (import.meta.main) {
  const result = run(process.argv.slice(2));
  if (result.out) console.log(result.out);
  if (result.err) console.error(result.err);
  process.exit(result.code);
}
