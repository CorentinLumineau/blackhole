import { describe, expect, test } from 'bun:test';
import {
  KNOWN_VCODE_PARITY_DIVERGENCES,
  findSnapshotStaleness,
  findVcodeParityMismatches,
  mapMercureSeverityToBlackholeAction,
  runChecks,
} from './checks/vcode-parity.check.ts';

// Issue #869 (plan Design Decisions D1) — vcode-parity.check.ts advisory (WARN) parity check
// against a vendored mercure V-code snapshot. Every test below runs against pure fixture
// data — never the real documentation/audits/mercure-vcode-snapshot.json or the real
// src/references/blackhole-vcodes.md table — so this comparator's expected outcomes are
// structurally independent of whatever mercure-vcode-snapshot.ts's `main()` produces (the
// non-circularity requirement: a comparator whose "expected" values come from the same code
// path as its "actual" values is green by construction and can never fail).

describe('mapMercureSeverityToBlackholeAction', () => {
  test('CRITICAL and HIGH collapse to BLOCK', () => {
    expect(mapMercureSeverityToBlackholeAction('CRITICAL')).toBe('BLOCK');
    expect(mapMercureSeverityToBlackholeAction('HIGH')).toBe('BLOCK');
  });

  test('MEDIUM and LOW collapse to WARN (blackhole has no INFO tier)', () => {
    expect(mapMercureSeverityToBlackholeAction('MEDIUM')).toBe('WARN');
    expect(mapMercureSeverityToBlackholeAction('LOW')).toBe('WARN');
  });
});

describe('findVcodeParityMismatches', () => {
  test('a shared, non-allowlisted id with mercure HIGH vs blackhole WARN is reported', () => {
    const mercureMap = new Map([['V-FAKE-01', 'HIGH']]);
    const blackholeSevMap = new Map([['V-FAKE-01', 'WARN']]);
    const mismatches = findVcodeParityMismatches(mercureMap, blackholeSevMap, []);
    expect(mismatches).toEqual([{ code: 'V-FAKE-01', mercureSeverity: 'HIGH', mappedAction: 'BLOCK', blackholeAction: 'WARN' }]);
  });

  test('the same pair with the id present in the allowlist is not reported', () => {
    const mercureMap = new Map([['V-FAKE-01', 'HIGH']]);
    const blackholeSevMap = new Map([['V-FAKE-01', 'WARN']]);
    const mismatches = findVcodeParityMismatches(mercureMap, blackholeSevMap, [{ code: 'V-FAKE-01', reason: 'documented divergence' }]);
    expect(mismatches).toEqual([]);
  });

  test('a shared id with mercure LOW vs blackhole WARN is never reported, even with an empty allowlist (D1 non-circularity: mirrors the real V-DOC-07 shape)', () => {
    const mercureMap = new Map([['V-FAKE-02', 'LOW']]);
    const blackholeSevMap = new Map([['V-FAKE-02', 'WARN']]);
    expect(findVcodeParityMismatches(mercureMap, blackholeSevMap, [])).toEqual([]);
  });

  test('an id that is not shared (present in only one map) is never reported', () => {
    const mercureMap = new Map([['V-FAKE-03', 'HIGH']]);
    const blackholeSevMap = new Map([['V-OTHER-01', 'WARN']]);
    expect(findVcodeParityMismatches(mercureMap, blackholeSevMap, [])).toEqual([]);
  });
});

describe('findSnapshotStaleness', () => {
  const now = new Date('2026-09-07T00:00:00.000Z');

  test('a syncedAt more than thresholdDays before now is stale', () => {
    const syncedAt = new Date('2026-06-01T00:00:00.000Z').toISOString(); // 98 days before now
    expect(findSnapshotStaleness(syncedAt, 90, now)).toBe(true);
  });

  test('a syncedAt less than thresholdDays before now is not stale', () => {
    const syncedAt = new Date('2026-08-20T00:00:00.000Z').toISOString(); // 18 days before now
    expect(findSnapshotStaleness(syncedAt, 90, now)).toBe(false);
  });

  test('a syncedAt exactly thresholdDays before now (boundary-equal) is not stale', () => {
    const syncedAt = new Date(now.getTime() - 90 * 24 * 60 * 60 * 1000).toISOString();
    expect(findSnapshotStaleness(syncedAt, 90, now)).toBe(false);
  });
});

describe('KNOWN_VCODE_PARITY_DIVERGENCES', () => {
  test('is seeded with exactly V-ADA-05 and V-DOC-GOV-01 (plan Design Decisions D1 — no other code needs suppression)', () => {
    expect(KNOWN_VCODE_PARITY_DIVERGENCES.map((d) => d.code).sort()).toEqual(['V-ADA-05', 'V-DOC-GOV-01']);
    for (const d of KNOWN_VCODE_PARITY_DIVERGENCES) expect(d.reason).toBeTruthy();
  });
});

describe('runChecks — real repo state', () => {
  test('V-MPARITY-01 and V-MPARITY-02 are both reported (ok:true either via the file-absent skip, or, once the real snapshot exists, via a fully-allowlisted, freshly-synced comparison)', () => {
    const results = runChecks();
    expect(results).toHaveLength(2);
    const byId = new Map(results.map((r) => [r.id, r]));
    expect(byId.get('V-MPARITY-01')).toEqual({ id: 'V-MPARITY-01', ok: true });
    expect(byId.get('V-MPARITY-02')).toEqual({ id: 'V-MPARITY-02', ok: true });
  });
});
