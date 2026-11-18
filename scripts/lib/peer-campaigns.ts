import { DONE_STATUSES } from './campaign-status/queue.ts';
import type { QueueJson } from './campaign-status/types.ts';

// Peer campaign detection (ADR-057). Every campaign session keeps one heartbeat record in the
// clone's git common dir, so sessions in different worktrees of one clone see each other. This
// module is pure: records, identity and the clock come in as arguments; `scripts/peer-campaigns.ts`
// does the git and file I/O.
//
// Reach is one clone. A peer in another clone or on another machine is invisible here, so a clean
// result says `reach: "clone"` instead of a bare `solo`.

/** A record whose heartbeat is older than this is dead; the same 40 minutes as `multitask-mode.md` § Grant lease. */
export const PEER_LEASE_MINUTES = 40;
export const PEER_LEASE_MS = PEER_LEASE_MINUTES * 60_000;

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
  role: PeerRole;
  manager_session: string | null;
  turn: number;
  started_at: string;
  heartbeat_at: string;
  claims: number[];
};

/** Who "self" is. A record matching `session`, or the same `worktree` on the same `host`, is self. */
export type SelfIdentity = {
  session: string;
  worktree: string;
  host: string;
  host_session: string | null;
  manager_session: string | null;
};

export type DetectedPeer = Pick<
  PeerRecord,
  'session' | 'worktree' | 'host' | 'host_session' | 'role' | 'manager_session' | 'turn' | 'heartbeat_at' | 'claims'
> & {
  heartbeat_age_minutes: number;
  /** The peer runs as `peer` of this session (its `manager_session` is my `host_session`). */
  names_me: boolean;
  /** Already coordinated with this session in either direction, so the launch gate does not ask about it. */
  coordinated: boolean;
};

export type DetectResult = { verdict: 'solo' | 'peers'; reach: 'clone'; peers: DetectedPeer[] };

// The session id becomes a file name in the git common dir: it must not be able to name a path.
const SESSION_ID = /^[A-Za-z0-9_-]{1,64}$/;
export const isSessionId = (v: unknown): v is string => typeof v === 'string' && SESSION_ID.test(v);

const isIso = (v: unknown): v is string => typeof v === 'string' && !Number.isNaN(Date.parse(v));
const isNullableString = (v: unknown): v is string | null => v === null || typeof v === 'string';
const isIssueNumber = (v: unknown): v is number => Number.isInteger(v) && (v as number) > 0;

/** A record file's text, or null when it is torn, foreign or invalid. Never throws. */
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
    typeof r.host === 'string' &&
    isNullableString(r.host_session) &&
    PEER_ROLES.includes(r.role as PeerRole) &&
    isNullableString(r.manager_session) &&
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
    role: r.role as PeerRole,
    manager_session: r.manager_session as string | null,
    turn: r.turn as number,
    started_at: r.started_at as string,
    heartbeat_at: r.heartbeat_at as string,
    claims: r.claims as number[],
  };
}

/** True for this session's record, or an older session's record left in this same worktree on this host. */
export const isSelf = (r: PeerRecord, self: SelfIdentity): boolean =>
  r.session === self.session || (r.worktree === self.worktree && r.host === self.host);

/** Records of other sessions whose heartbeat is within the lease. A future-dated heartbeat counts as live. */
export function livePeers(records: PeerRecord[], self: SelfIdentity, nowMs: number, leaseMs = PEER_LEASE_MS): PeerRecord[] {
  return records.filter((r) => !isSelf(r, self) && nowMs - Date.parse(r.heartbeat_at) <= leaseMs);
}

/** Issue number (as a queue key) → the live peer session that claims it. */
export function peerClaims(peers: PeerRecord[]): Record<string, string> {
  const out: Record<string, string> = {};
  for (const p of peers) for (const n of p.claims) out[String(n)] = p.session;
  return out;
}

/** What this session claims: every non-done queue entry that is `in-flight` or carries a PR. */
export function claimsOf(queue: QueueJson | null): number[] {
  return Object.entries(queue?.issues ?? {})
    .filter(([, e]) => !DONE_STATUSES.includes(e.status ?? '') && (e.status === 'in-flight' || (e.pr ?? null) !== null))
    .map(([n]) => Number(n))
    .filter(isIssueNumber)
    .sort((a, b) => a - b);
}

/** The `detect` verdict: live peers with their age, and whether each is already coordinated with this session. */
export function detectPeers(records: PeerRecord[], self: SelfIdentity, nowMs: number): DetectResult {
  const peers = livePeers(records, self, nowMs).map((r): DetectedPeer => {
    const names_me = self.host_session !== null && r.manager_session === self.host_session;
    const joined = self.manager_session !== null && r.host_session === self.manager_session;
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
      coordinated: names_me || joined,
    };
  });
  return { verdict: peers.length ? 'peers' : 'solo', reach: 'clone', peers };
}
