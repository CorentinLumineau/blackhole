import { describe, expect, test } from 'bun:test';
import { isClaimStale, laneLabel, laneOfLabel, LEGACY_OWN_LANES, ownLanes, readLaneConfig } from './lane.ts';

const NOW = Date.parse('2026-11-17T12:00:00Z');
const hoursAgo = (h: number): string => new Date(NOW - h * 3_600_000).toISOString();

describe('laneOfLabel', () => {
  test('parses in-progress and agent labels only', () => {
    expect(laneOfLabel('in-progress:acct-a')).toBe('acct-a');
    expect(laneOfLabel('agent:cursor')).toBe('cursor');
    expect(laneOfLabel('bug')).toBeNull();
    expect(laneOfLabel('in-progress:')).toBeNull();
  });
  test('laneLabel builds the claim label', () => {
    expect(laneLabel('acct-a')).toBe('in-progress:acct-a');
  });
});

describe('ownLanes', () => {
  test('no lane means the legacy set, a lane means only itself', () => {
    expect([...ownLanes(null)].sort()).toEqual(['blackhole', 'claude']);
    expect([...LEGACY_OWN_LANES].sort()).toEqual(['blackhole', 'claude']);
    expect([...ownLanes('acct-a')]).toEqual(['acct-a']);
  });
});

describe('readLaneConfig', () => {
  test('reads tolerantly', () => {
    expect(readLaneConfig({})).toEqual({ lane: null, leaseHours: 24 });
    expect(readLaneConfig({ catchup: { lane: 'acct-a', claim_lease_hours: 6 } })).toEqual({ lane: 'acct-a', leaseHours: 6 });
    expect(readLaneConfig({ catchup: { lane: 'Bad Lane' } })).toEqual({ lane: null, leaseHours: 24 });
    expect(readLaneConfig({ catchup: 'x' })).toEqual({ lane: null, leaseHours: 24 });
  });
});

describe('isClaimStale', () => {
  const base = { now: NOW, leaseHours: 24 };
  test('stale only past the lease', () => {
    expect(isClaimStale({ ...base, updatedAt: hoursAgo(25) })).toBe(true);
    expect(isClaimStale({ ...base, updatedAt: hoursAgo(23) })).toBe(false);
  });
  test('absent or unparseable time reads as live', () => {
    expect(isClaimStale({ ...base })).toBe(false);
    expect(isClaimStale({ ...base, updatedAt: 'garbage' })).toBe(false);
  });
  test('recent PR activity keeps the claim live', () => {
    expect(isClaimStale({ ...base, updatedAt: hoursAgo(30), activityAt: hoursAgo(1) })).toBe(false);
  });
});
