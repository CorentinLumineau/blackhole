import { DONE_STATUSES } from './campaign-status/queue.ts';
import type { QueueJson } from './campaign-status/types.ts';

// Peer campaign detection (ADR-057). Every campaign session keeps one heartbeat record in the
// clone's git common dir, so sessions in different worktrees of one clone see each other. This
// module is pure: registry entries, identity and the clock come in as arguments;
// `scripts/peer-campaigns.ts` does the git and file I/O.
//
// Reach is one clone. A peer in another clone or on another machine is invisible here, so a clean
// result says `reach: "clone"` instead of a bare `solo`. Detection fails closed: a recently
// written record that cannot be read or trusted counts as `unreadable`, never as no peer.

/** A record whose heartbeat is older than this is dead; the same 40 minutes as `multitask-mode.md` § Grant lease. */
export const PEER_LEASE_MINUTES = 40;
/** `PEER_LEASE_MINUTES` in milliseconds; also how far into the future a heartbeat may be dated (clock skew) and still be trusted. */
export const PEER_LEASE_MS = PEER_LEASE_MINUTES * 60_000;

/** The `usage_budget.coordination.role` values a record may carry. */
export const PEER_ROLES = ['solo', 'manager', 'peer'] as const;
export type PeerRole = (typeof PEER_ROLES)[number];

export type PeerRecord = {
  version: 1;
  session: string;
  /** Absolute toplevel of the worktree the campaign runs in. */
  worktree: string;
  host: string;
  /** The host's cross-session message id, when the host has a transport; else null. */
  host_session: string | null;
  /** The host process id (`CLAUDE_PID`), so a later session in this worktree can tell a gone predecessor from a live peer; null when unknown or in a record written before it existed. */
  host_pid: number | null;
  role: PeerRole;
  manager_session: string | null;
  turn: number;
  started_at: string;
  heartbeat_at: string;
  claims: number[];
};

/** One `*.json` file of the registry dir: its name, its text (null when it could not be read) and its mtime. */
export type RegistryEntry = { file: string; text: string | null; mtimeMs: number };

/** Who "self" is: a record matching `session` or listed in `superseded`. */
export type SelfIdentity = {
  session: string;
  worktree: string;
  host: string;
  host_session: string | null;
  manager_session: string | null;
  /** Earlier sessions of this same campaign (`supersededSessions`), read as self, never as peers. */
  superseded: string[];
};

export type DetectedPeer = Pick<
  PeerRecord,
  'session' | 'worktree' | 'host' | 'host_session' | 'role' | 'manager_session' | 'turn' | 'heartbeat_at' | 'claims'
> & {
  heartbeat_age_minutes: number;
  /** The peer runs as `peer` of this session (its `manager_session` is my `host_session`). */
  names_me: boolean;
  /** Already coordinated with this session (its manager, its peer, or a peer of the same manager), so the gate does not ask about it. */
  coordinated: boolean;
};

/**
 * `unknown`: no readable live peer, but `unreadable` fresh entries might be one; the gate treats it
 * like a live peer. `unreadable_files` names them (sorted) so the owner can remove them.
 */
export type DetectResult = {
  verdict: 'solo' | 'peers' | 'unknown';
  reach: 'clone';
  unreadable: number;
  unreadable_files: string[];
  peers: DetectedPeer[];
};

/** Stands for the registry dir itself in `unreadable_files` when it cannot be listed. */
export const REGISTRY_DIR_UNREADABLE = '(registry dir)';

// The worktree and host reach the gate only inside a double-quoted `--evidence "<row value>"`
// argument, so they may not carry what a double quote does not neutralise: `"`, `$`, a backtick,
// `\` or a control character. Session ids become file names and option text, so they stay
// strict. Git prints Windows toplevels with forward slashes (`C:/...`).
const SESSION_ID = /^[A-Za-z0-9_-]{1,64}$/;
const HOST_SESSION = /^[A-Za-z0-9._:-]{1,128}$/;
const HOST = /^[^\x00-\x20\x7f"$`\\]{1,253}$/;
const WORKTREE = /^(?:\/|[A-Za-z]:\/)[^\x00-\x1f\x7f"$`\\]{0,4095}$/;

/** True for a session id usable as a registry file name: letters, digits, `_` and `-`, 64 at most. */
export const isSessionId = (v: unknown): v is string => typeof v === 'string' && SESSION_ID.test(v);
/** True for a host cross-session id (or a configured `manager_session`) safe to print in a gate option. */
export const isHostSession = (v: unknown): v is string => typeof v === 'string' && HOST_SESSION.test(v);

const isIso = (v: unknown): v is string => typeof v === 'string' && !Number.isNaN(Date.parse(v));
const isNullable = (v: unknown, ok: (x: unknown) => boolean): boolean => v === null || ok(v);
const isIssueNumber = (v: unknown): v is number => Number.isInteger(v) && (v as number) > 0;
/** True for a process id: a positive integer. */
export const isPid = (v: unknown): v is number => Number.isInteger(v) && (v as number) > 0;

/** A record file's text, or null when it is torn, foreign, version-skewed or carries an unsafe string. Never throws. */
export function parseRecord(text: string): PeerRecord | null {
  let v: unknown;
  try {
    v = JSON.parse(text);
  } catch {
    return null;
  }
  if (typeof v !== 'object' || v === null || Array.isArray(v)) return null;
  const r = v as Record<string, unknown>;
  const valid =
    r.version === 1 &&
    isSessionId(r.session) &&
    typeof r.worktree === 'string' &&
    WORKTREE.test(r.worktree) &&
    typeof r.host === 'string' &&
    HOST.test(r.host) &&
    isNullable(r.host_session, isHostSession) &&
    (r.host_pid === undefined || isNullable(r.host_pid, isPid)) &&
    PEER_ROLES.includes(r.role as PeerRole) &&
    isNullable(r.manager_session, isHostSession) &&
    Number.isInteger(r.turn) &&
    isIso(r.started_at) &&
    isIso(r.heartbeat_at) &&
    Array.isArray(r.claims) &&
    r.claims.every(isIssueNumber);
  if (!valid) return null;
  return {
    version: 1,
    session: r.session as string,
    worktree: r.worktree as string,
    host: r.host as string,
    host_session: r.host_session as string | null,
    host_pid: (r.host_pid ?? null) as number | null,
    role: r.role as PeerRole,
    manager_session: r.manager_session as string | null,
    turn: r.turn as number,
    started_at: r.started_at as string,
    heartbeat_at: r.heartbeat_at as string,
    claims: r.claims as number[],
  };
}

/** True for this session's record or an earlier session of this campaign (`supersededSessions`). */
export const isSelf = (r: PeerRecord, self: SelfIdentity): boolean => r.session === self.session || self.superseded.includes(r.session);

/** What `supersededSessions` knows about this session. */
export type SuccessorView = {
  session: string;
  worktree: string;
  host: string;
  /**
   * The id comes from the host session, not from the campaign dir's shared token, so two sessions
   * on one campaign dir differ and a same-worktree record may be another live session's.
   */
  hostScoped: boolean;
  /** This session's host process id, or null when unknown. */
  pid: number | null;
  /** The campaign dir's last host-scoped session (`.tmp/campaign-last-session.json`), or null. */
  lastSession: string | null;
  /** When this session's own record started, or null before its first heartbeat. */
  startedAtMs: number | null;
};

/**
 * The records in this worktree on this host that are this campaign's own earlier sessions (a
 * resume in a new session, `/clear`, `--fork-session` after the old one exited, a lost token),
 * not a peer. With a recorded host pid: superseded when it is this same host process or that
 * process is gone, so a live host-scoped session is always a peer. Without one: for a token id,
 * always (the campaign before its token was lost); for a host-scoped id, only when it is the
 * campaign dir's `lastSession` and did not heartbeat after this session's first heartbeat, so a
 * live token-mode session's record stays a peer (and a dead one lapses with its lease).
 */
export function supersededSessions(records: PeerRecord[], me: SuccessorView, pidAlive: (pid: number) => boolean): string[] {
  return records
    .filter((r) => r.session !== me.session && r.worktree === me.worktree && r.host === me.host)
    .filter((r) =>
      r.host_pid !== null
        ? r.host_pid === me.pid || !pidAlive(r.host_pid)
        : !me.hostScoped || (r.session === me.lastSession && (me.startedAtMs === null || Date.parse(r.heartbeat_at) <= me.startedAtMs)),
    )
    .map((r) => r.session);
}

/** A heartbeat dated more than one lease ahead is not trusted (capped at now + lease). */
const tooFuture = (r: PeerRecord, nowMs: number): boolean => Date.parse(r.heartbeat_at) - nowMs > PEER_LEASE_MS;

/** Records of other sessions whose heartbeat is within the lease, and dated no further ahead than one lease. */
export function livePeers(records: PeerRecord[], self: SelfIdentity, nowMs: number, leaseMs = PEER_LEASE_MS): PeerRecord[] {
  return records.filter((r) => !isSelf(r, self) && !tooFuture(r, nowMs) && nowMs - Date.parse(r.heartbeat_at) <= leaseMs);
}

/**
 * The note forge-sync writes on an entry held for a live peer: `another session: <session id>`.
 * Such an entry is the peer's, so `claimsOf` never claims it back.
 */
export const ANOTHER_SESSION = 'another session:';

/** Issue number (as a queue key) → the live peer session that claims it. */
export function peerClaims(peers: Pick<PeerRecord, 'session' | 'claims'>[]): Record<string, string> {
  const out: Record<string, string> = {};
  for (const p of peers) for (const n of p.claims) out[String(n)] = p.session;
  return out;
}

/** True for a queue note holding the entry for a live peer (`ANOTHER_SESSION`). */
export const isPeerHold = (notes: string | null | undefined): boolean => (notes ?? '').startsWith(`${ANOTHER_SESSION} `);

/** What this session claims: every non-done queue entry that is `in-flight`, or carries a PR and is not held for a peer. */
export function claimsOf(queue: QueueJson | null): number[] {
  return Object.entries(queue?.issues ?? {})
    .filter(([, e]) => !DONE_STATUSES.includes(e.status ?? '') && (e.status === 'in-flight' || ((e.pr ?? null) !== null && !isPeerHold(e.notes))))
    .map(([n]) => Number(n))
    .filter(isIssueNumber)
    .sort((a, b) => a - b);
}

/** Within one lease of now, either way: an mtime further ahead is as untrusted as one further back. */
const fresh = (mtimeMs: number, nowMs: number): boolean => Math.abs(nowMs - mtimeMs) <= PEER_LEASE_MS;

/**
 * Splits registry entries into readable records and the unreadable file names. An entry that is
 * not a regular file (text null), does not parse, is not named `<session>.json`, or carries a
 * heartbeat dated beyond now + lease is unreadable while its mtime is fresh; outside that window it
 * is dead like any expired record, so no entry holds the gate forever. This session's own file is
 * never counted: its next heartbeat rewrites it.
 */
function readEntries(entries: RegistryEntry[], self: SelfIdentity, nowMs: number): { records: PeerRecord[]; unreadable: string[] } {
  const records: PeerRecord[] = [];
  const unreadable: string[] = [];
  for (const e of entries) {
    const r = e.text === null ? null : parseRecord(e.text);
    if (r && `${r.session}.json` === e.file && !tooFuture(r, nowMs)) records.push(r);
    else if (e.file !== `${self.session}.json` && fresh(e.mtimeMs, nowMs)) unreadable.push(e.file);
  }
  return { records, unreadable: unreadable.sort() };
}

/** The `detect` verdict: live peers with their age and coordination, plus the unreadable count (an unreadable dir counts one). */
export function detectPeers(entries: RegistryEntry[], self: SelfIdentity, nowMs: number, { dirError = false } = {}): DetectResult {
  const read = readEntries(entries, self, nowMs);
  const unreadable_files = dirError ? [REGISTRY_DIR_UNREADABLE, ...read.unreadable] : read.unreadable;
  const unreadable = unreadable_files.length;
  const peers = livePeers(read.records, self, nowMs).map((r): DetectedPeer => {
    const names_me = self.host_session !== null && r.manager_session === self.host_session;
    const joined = self.manager_session !== null && r.host_session === self.manager_session;
    const sibling = self.manager_session !== null && r.manager_session === self.manager_session;
    return {
      session: r.session,
      worktree: r.worktree,
      host: r.host,
      host_session: r.host_session,
      role: r.role,
      manager_session: r.manager_session,
      turn: r.turn,
      heartbeat_at: r.heartbeat_at,
      heartbeat_age_minutes: Math.max(0, Math.round((nowMs - Date.parse(r.heartbeat_at)) / 60_000)),
      claims: r.claims,
      names_me,
      coordinated: names_me || joined || sibling,
    };
  });
  return { verdict: peers.length ? 'peers' : unreadable ? 'unknown' : 'solo', reach: 'clone', unreadable, unreadable_files, peers };
}

/**
 * The `host_session` "Join as peer" would write as `manager_session`: a live manager's own id,
 * else the manager a live peer already follows, else a solo peer's id. Ties go by session id,
 * never by directory order. Null when no peer can be joined.
 */
export function joinTarget(peers: DetectedPeer[]): string | null {
  const sorted = [...peers].sort((a, b) => a.session.localeCompare(b.session));
  return (
    sorted.find((p) => p.role === 'manager' && p.host_session)?.host_session ??
    sorted.find((p) => p.role === 'peer' && p.manager_session)?.manager_session ??
    sorted.find((p) => p.host_session)?.host_session ??
    null
  );
}
