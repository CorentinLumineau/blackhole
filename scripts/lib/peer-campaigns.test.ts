import { describe, expect, test } from 'bun:test';
import {
  claimsOf,
  detectPeers,
  isSessionId,
  joinTarget,
  livePeers,
  parseRecord,
  PEER_LEASE_MINUTES,
  peerClaims,
  type DetectedPeer,
  type PeerRecord,
  type RegistryEntry,
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

/** A registry file holding `r` (or raw text), written `mtimeAgo` minutes before NOW. */
const entry = (r: PeerRecord | string, mtimeAgo = 0, file?: string): RegistryEntry => ({
  file: file ?? (typeof r === 'string' ? 'garbage.json' : `${r.session}.json`),
  text: typeof r === 'string' ? r : JSON.stringify(r),
  mtimeMs: NOW - mtimeAgo * 60_000,
});

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

  test('worktree, host and session strings that could break a double-quoted argument are rejected', () => {
    expect(parseRecord(JSON.stringify(record({ worktree: 'relative/path' })))).toBeNull();
    expect(parseRecord(JSON.stringify(record({ worktree: '/repo\n$(rm -rf ~)' })))).toBeNull();
    for (const bad of ['/repo/a"b', '/repo/$HOME', '/repo/`id`', '/repo/a\\b']) expect(parseRecord(JSON.stringify(record({ worktree: bad })))).toBeNull();
    expect(parseRecord(JSON.stringify(record({ host: 'box$(id)' })))).toBeNull();
    expect(parseRecord(JSON.stringify(record({ host: 'box with space' })))).toBeNull();
    expect(parseRecord(JSON.stringify(record({ host_session: 'a" --gate x' })))).toBeNull();
    expect(parseRecord(JSON.stringify(record({ manager_session: '`id`' })))).toBeNull();
    expect(parseRecord(JSON.stringify(record({ host_session: 'session_01AbC:2' })))).not.toBeNull();
  });

  test("ordinary path punctuation is accepted: /home/x/R&D/wt it's", () => {
    expect(parseRecord(JSON.stringify(record({ worktree: "/home/x/R&D/wt it's" })))?.worktree).toBe("/home/x/R&D/wt it's");
    expect(parseRecord(JSON.stringify(record({ worktree: 'C:/work/repo' })))).not.toBeNull();
  });
});

describe('livePeers', () => {
  test(`the lease is ${PEER_LEASE_MINUTES} minutes: 39 is live, exactly 40 is live, 41 is not`, () => {
    expect(PEER_LEASE_MINUTES).toBe(40);
    expect(livePeers([record({ heartbeat_at: minutesAgo(39) })], self, NOW)).toHaveLength(1);
    expect(livePeers([record({ heartbeat_at: minutesAgo(40) })], self, NOW)).toHaveLength(1);
    expect(livePeers([record({ heartbeat_at: minutesAgo(41) })], self, NOW)).toHaveLength(0);
  });

  test('a future heartbeat is capped at now + lease: 39 minutes ahead is live, 41 ahead is not', () => {
    expect(livePeers([record({ heartbeat_at: minutesAgo(-39) })], self, NOW)).toHaveLength(1);
    expect(livePeers([record({ heartbeat_at: minutesAgo(-41) })], self, NOW)).toHaveLength(0);
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
    expect(detectPeers([entry(record({ heartbeat_at: minutesAgo(90) }), 90)], self, NOW)).toEqual({
      verdict: 'solo',
      reach: 'clone',
      unreadable: 0,
      unreadable_files: [],
      peers: [],
    });
  });

  test('a live peer is reported with its age and claims', () => {
    const result = detectPeers([entry(record())], self, NOW);
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
    const [peer] = detectPeers([entry(record({ role: 'peer', manager_session: 'session_me' }))], me, NOW).peers;
    expect(peer.names_me).toBe(true);
    expect(peer.coordinated).toBe(true);
  });

  test('the peer I joined as manager is coordinated, so the gate does not ask again', () => {
    const me = { ...self, manager_session: 'session_mgr' };
    const [peer] = detectPeers([entry(record({ host_session: 'session_mgr', role: 'manager' }))], me, NOW).peers;
    expect(peer.names_me).toBe(false);
    expect(peer.coordinated).toBe(true);
  });

  test('two peers of one manager are coordinated with each other', () => {
    const me = { ...self, manager_session: 'session_mgr' };
    const sibling = record({ session: 'b0000000-0000-4000-8000-000000000002', role: 'peer', manager_session: 'session_mgr' });
    const [peer] = detectPeers([entry(sibling)], me, NOW).peers;
    expect(peer.coordinated).toBe(true);
  });

  test('a null host_session never matches a null manager_session', () => {
    const [peer] = detectPeers([entry(record())], self, NOW).peers;
    expect(peer.names_me).toBe(false);
    expect(peer.coordinated).toBe(false);
  });

  test('fresh unreadable files fail closed: version 2, garbage JSON and a misnamed file each count', () => {
    const skewed = entry(JSON.stringify({ ...record(), version: 2 }), 1, 'skewed.json');
    const garbage = entry('{"version":1,', 1);
    const misnamed = entry(record(), 1, 'not-the-session.json');
    expect(detectPeers([skewed, garbage, misnamed], self, NOW)).toEqual({
      verdict: 'unknown',
      reach: 'clone',
      unreadable: 3,
      unreadable_files: ['garbage.json', 'not-the-session.json', 'skewed.json'],
      peers: [],
    });
  });

  test('an unreadable file older than the lease is dead and not counted', () => {
    expect(detectPeers([entry('garbage', 41)], self, NOW)).toMatchObject({ verdict: 'solo', unreadable: 0 });
  });

  test('a record dated beyond now + lease is untrusted: unreadable while its file is fresh', () => {
    expect(detectPeers([entry(record({ heartbeat_at: minutesAgo(-120) }), 0)], self, NOW)).toMatchObject({ verdict: 'unknown', unreadable: 1 });
    expect(detectPeers([entry(record({ heartbeat_at: minutesAgo(-120) }), 60)], self, NOW)).toMatchObject({ verdict: 'solo', unreadable: 0 });
  });

  test('my own unreadable file is not counted: the next heartbeat rewrites it', () => {
    expect(detectPeers([entry('garbage', 0, `${self.session}.json`)], self, NOW).unreadable).toBe(0);
  });

  test('an unreadable registry dir counts as one unreadable entry', () => {
    expect(detectPeers([], self, NOW, { dirError: true })).toEqual({
      verdict: 'unknown',
      reach: 'clone',
      unreadable: 1,
      unreadable_files: ['(registry dir)'],
      peers: [],
    });
  });

  test('an unreadable file with a future mtime lapses: beyond one lease ahead it is not counted', () => {
    expect(detectPeers([entry('garbage', -39)], self, NOW).unreadable).toBe(1);
    expect(detectPeers([entry('garbage', -41)], self, NOW).unreadable).toBe(0);
  });

  test('a non-regular entry (text null) counts by its own mtime', () => {
    const dir: RegistryEntry = { file: 'dir.json', text: null, mtimeMs: NOW - 60_000 };
    const old: RegistryEntry = { file: 'old.json', text: null, mtimeMs: NOW - 90 * 60_000 };
    expect(detectPeers([dir, old], self, NOW)).toMatchObject({ unreadable: 1, unreadable_files: ['dir.json'] });
  });
});

describe('joinTarget', () => {
  const peer = (over: Partial<DetectedPeer>): DetectedPeer => ({
    ...record(),
    heartbeat_age_minutes: 0,
    names_me: false,
    coordinated: false,
    ...over,
  });
  const solo = peer({ session: 'a0000000-0000-4000-8000-000000000001', host_session: 'session_solo' });
  const sub = peer({ session: 'b0000000-0000-4000-8000-000000000002', role: 'peer', host_session: 'session_sub', manager_session: 'session_mgr' });
  const mgr = peer({ session: 'c0000000-0000-4000-8000-000000000003', role: 'manager', host_session: 'session_mgr' });

  test('a manager record is preferred, whatever the order', () => {
    expect(joinTarget([solo, sub, mgr])).toBe('session_mgr');
    expect(joinTarget([mgr, sub, solo])).toBe('session_mgr');
  });

  test('without a manager record, a peer names its manager', () => {
    expect(joinTarget([solo, sub])).toBe('session_mgr');
    expect(joinTarget([sub, solo])).toBe('session_mgr');
  });

  test('only solo peers: the one with a host_session, by session order', () => {
    const other = peer({ session: 'd0000000-0000-4000-8000-000000000004', host_session: 'session_other' });
    expect(joinTarget([other, solo])).toBe('session_solo');
  });

  test('no host_session anywhere: no join target', () => {
    expect(joinTarget([peer({})])).toBeNull();
  });
});
