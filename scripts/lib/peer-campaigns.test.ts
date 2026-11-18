import { describe, expect, test } from 'bun:test';
import {
  claimsOf,
  detectPeers,
  isSessionId,
  livePeers,
  parseRecord,
  PEER_LEASE_MINUTES,
  peerClaims,
  type PeerRecord,
  type SelfIdentity,
} from './peer-campaigns.ts';

const NOW = Date.parse('2026-11-18T12:00:00.000Z');
const minutesAgo = (m: number): string => new Date(NOW - m * 60_000).toISOString();

const record = (over: Partial<PeerRecord> = {}): PeerRecord => ({
  version: 1,
  session: 'a1b2c3d4-0000-4000-8000-000000000001',
  worktree: '/repo/.claude/worktrees/other',
  host: 'box',
  host_session: null,
  role: 'solo',
  manager_session: null,
  turn: 12,
  started_at: minutesAgo(120),
  heartbeat_at: minutesAgo(5),
  claims: [1240, 1241],
  ...over,
});

const self: SelfIdentity = {
  session: 'ffffffff-0000-4000-8000-000000000009',
  worktree: '/repo',
  host: 'box',
  host_session: null,
  manager_session: null,
};

describe('parseRecord', () => {
  test('a well-formed record round-trips', () => {
    expect(parseRecord(JSON.stringify(record()))).toEqual(record());
  });

  test('a torn or invalid record reads as null, never throws', () => {
    expect(parseRecord('{"version":1,"session":"a1b2')).toBeNull();
    expect(parseRecord('')).toBeNull();
    expect(parseRecord('[]')).toBeNull();
    expect(parseRecord(JSON.stringify({ ...record(), heartbeat_at: 'yesterday' }))).toBeNull();
    expect(parseRecord(JSON.stringify({ ...record(), claims: ['1240'] }))).toBeNull();
    expect(parseRecord(JSON.stringify({ ...record(), role: 'boss' }))).toBeNull();
    expect(parseRecord(JSON.stringify({ ...record(), version: 2 }))).toBeNull();
  });

  test('a session id that is not a safe file name is rejected', () => {
    expect(parseRecord(JSON.stringify(record({ session: '../../hooks/pre-commit' })))).toBeNull();
    expect(isSessionId('../x')).toBe(false);
    expect(isSessionId('a1b2c3d4-0000-4000-8000-000000000001')).toBe(true);
  });
});

describe('livePeers', () => {
  test(`the lease is ${PEER_LEASE_MINUTES} minutes: 39 is live, exactly 40 is live, 41 is not`, () => {
    expect(PEER_LEASE_MINUTES).toBe(40);
    expect(livePeers([record({ heartbeat_at: minutesAgo(39) })], self, NOW)).toHaveLength(1);
    expect(livePeers([record({ heartbeat_at: minutesAgo(40) })], self, NOW)).toHaveLength(1);
    expect(livePeers([record({ heartbeat_at: minutesAgo(41) })], self, NOW)).toHaveLength(0);
  });

  test('a heartbeat dated in the future counts as live', () => {
    expect(livePeers([record({ heartbeat_at: minutesAgo(-3) })], self, NOW)).toHaveLength(1);
  });

  test('the self session is excluded', () => {
    expect(livePeers([record({ session: self.session })], self, NOW)).toEqual([]);
  });

  test('another session on the same worktree and host is a superseded self, excluded', () => {
    expect(livePeers([record({ worktree: self.worktree, host: self.host })], self, NOW)).toEqual([]);
  });

  test('the same worktree path on another host is a peer', () => {
    expect(livePeers([record({ worktree: self.worktree, host: 'other-box' })], self, NOW)).toHaveLength(1);
  });
});

describe('peerClaims', () => {
  test('maps each live peer claim to its session id', () => {
    const a = record();
    const b = record({ session: 'b0000000-0000-4000-8000-000000000002', worktree: '/repo/wt-b', claims: [7] });
    expect(peerClaims([a, b])).toEqual({ '1240': a.session, '1241': a.session, '7': b.session });
  });
});

describe('claimsOf', () => {
  test('every non-done entry that is in-flight or carries a pr is claimed', () => {
    const claims = claimsOf({
      issues: {
        '1': { status: 'in-flight', pr: null },
        '2': { status: 'blocked', pr: 50 },
        '3': { status: 'ready', pr: null },
        '4': { status: 'merged', pr: 51 },
        '5': { status: 'closed', pr: null },
        '6': { status: 'blocked', pr: null },
      },
    });
    expect(claims).toEqual([1, 2]);
  });

  test('no queue claims nothing', () => {
    expect(claimsOf(null)).toEqual([]);
  });
});

describe('detectPeers', () => {
  test('no live peer is solo, and reach is stated as the clone', () => {
    expect(detectPeers([record({ heartbeat_at: minutesAgo(90) })], self, NOW)).toEqual({ verdict: 'solo', reach: 'clone', peers: [] });
  });

  test('a live peer is reported with its age and claims', () => {
    const result = detectPeers([record()], self, NOW);
    expect(result.verdict).toBe('peers');
    expect(result.peers).toHaveLength(1);
    expect(result.peers[0]).toMatchObject({
      worktree: '/repo/.claude/worktrees/other',
      turn: 12,
      heartbeat_age_minutes: 5,
      claims: [1240, 1241],
      names_me: false,
      coordinated: false,
    });
  });

  test('a peer whose manager_session is my host_session names me and is coordinated', () => {
    const me = { ...self, host_session: 'session_me' };
    const [peer] = detectPeers([record({ role: 'peer', manager_session: 'session_me' })], me, NOW).peers;
    expect(peer.names_me).toBe(true);
    expect(peer.coordinated).toBe(true);
  });

  test('the peer I joined as manager is coordinated, so the gate does not ask again', () => {
    const me = { ...self, manager_session: 'session_mgr' };
    const [peer] = detectPeers([record({ host_session: 'session_mgr', role: 'manager' })], me, NOW).peers;
    expect(peer.names_me).toBe(false);
    expect(peer.coordinated).toBe(true);
  });

  test('a null host_session never matches a null manager_session', () => {
    const [peer] = detectPeers([record()], self, NOW).peers;
    expect(peer.names_me).toBe(false);
    expect(peer.coordinated).toBe(false);
  });
});
