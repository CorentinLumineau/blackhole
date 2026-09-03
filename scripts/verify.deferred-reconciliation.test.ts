import { afterEach, describe, expect, test } from 'bun:test';
import * as fs from 'fs';
import * as path from 'path';
import { makeTempDir } from './lib/fs.ts';
import {
  checkDeferredReconciliation,
  findUnreconciledDeferrals,
  runChecks,
  type LedgerFinding,
  type QueueIssues,
} from './checks/deferred-reconciliation.check.ts';

// Issue #809 — deferred-reconciliation.check.ts: surfaces `findings-ledger.json` `deferred` rows
// whose `deferred_to_issue` target has closed on the forge (per `queue.json`, already
// forge-synced) with no recorded `reconciled_at` — the ledger's never-drop invariant is enforced
// at filing time but nothing previously reconciled it at closure time. Advisory (WARN, `ok: true`
// always) — same shape as V-WATCH-01 (`adr-watch.check.ts`).

const baseFinding = (overrides: Partial<LedgerFinding>): LedgerFinding => ({
  id: 'F-00001',
  vcode: 'V-DRY-01',
  status: 'deferred',
  deferred_to_issue: 305,
  ...overrides,
});

describe('findUnreconciledDeferrals (pure, in-memory)', () => {
  test('a deferred finding whose target is still open in queueIssues is NOT flagged', () => {
    const findings = [baseFinding({ deferred_to_issue: 305 })];
    const queueIssues: QueueIssues = { '305': { status: 'ready' } };
    expect(findUnreconciledDeferrals(findings, queueIssues)).toEqual([]);
  });

  test('a deferred finding whose target is merged in queueIssues IS flagged', () => {
    const findings = [baseFinding({ id: 'F-00002', deferred_to_issue: 305 })];
    const queueIssues: QueueIssues = { '305': { status: 'merged' } };
    const warnings = findUnreconciledDeferrals(findings, queueIssues);
    expect(warnings).toHaveLength(1);
    expect(warnings[0]).toContain('F-00002');
    expect(warnings[0]).toContain('305');
  });

  test('a deferred finding whose target is closed in queueIssues IS flagged', () => {
    const findings = [baseFinding({ id: 'F-00003', deferred_to_issue: 545 })];
    const queueIssues: QueueIssues = { '545': { status: 'closed' } };
    const warnings = findUnreconciledDeferrals(findings, queueIssues);
    expect(warnings).toHaveLength(1);
    expect(warnings[0]).toContain('F-00003');
    expect(warnings[0]).toContain('545');
  });

  test('a deferred finding whose target is absent from queueIssues is flagged as untracked', () => {
    const findings = [baseFinding({ id: 'F-00004', deferred_to_issue: 624 })];
    const queueIssues: QueueIssues = {};
    const warnings = findUnreconciledDeferrals(findings, queueIssues);
    expect(warnings).toHaveLength(1);
    expect(warnings[0]).toContain('F-00004');
    expect(warnings[0]).toContain('624');
    expect(warnings[0]).toContain('untracked');
  });

  test('a deferred finding already carrying reconciled_at is NOT flagged even if target closed', () => {
    const findings = [baseFinding({ id: 'F-00005', deferred_to_issue: 305, reconciled_at: '2026-08-01T00:00:00.000Z' })];
    const queueIssues: QueueIssues = { '305': { status: 'merged' } };
    expect(findUnreconciledDeferrals(findings, queueIssues)).toEqual([]);
  });

  test('a non-deferred (open) finding is never flagged, even naming a target that is closed', () => {
    const findings = [baseFinding({ id: 'F-00006', status: 'open', deferred_to_issue: 305 })];
    const queueIssues: QueueIssues = { '305': { status: 'merged' } };
    expect(findUnreconciledDeferrals(findings, queueIssues)).toEqual([]);
  });

  test('a deferred finding with no deferred_to_issue is never flagged', () => {
    const findings = [baseFinding({ id: 'F-00007', deferred_to_issue: null })];
    const queueIssues: QueueIssues = {};
    expect(findUnreconciledDeferrals(findings, queueIssues)).toEqual([]);
  });

  // Direct AC3 requirement: the fixture pair above (open target not flagged / closed target
  // flagged) is not vacuously true — a stub `() => []` would pass the "not flagged" cases but
  // fail this one.
  test('is not vacuously true — a stub returning [] unconditionally would fail this assertion', () => {
    const findings = [baseFinding({ id: 'F-00008', deferred_to_issue: 545 })];
    const queueIssues: QueueIssues = { '545': { status: 'closed' } };
    expect(findUnreconciledDeferrals(findings, queueIssues).length).toBeGreaterThan(0);
  });
});

describe('checkDeferredReconciliation / runChecks (advisory shape — ok: true always)', () => {
  const tempDirs: string[] = [];

  afterEach(() => {
    for (const dir of tempDirs.splice(0)) fs.rmSync(dir, { recursive: true, force: true });
  });

  const writeFixture = (dir: string, findings: LedgerFinding[], issues: QueueIssues) => {
    const ledgerFile = path.join(dir, 'findings-ledger.json');
    const queueFile = path.join(dir, 'queue.json');
    fs.writeFileSync(ledgerFile, JSON.stringify({ refreshed_at: '2026-08-01T00:00:00.000Z', next_id: findings.length + 1, findings }));
    fs.writeFileSync(queueFile, JSON.stringify({ refreshed_at: '2026-08-01T00:00:00.000Z', issues }));
    return { ledgerFile, queueFile };
  };

  test('clean fixture: single V-DEFER-01 result, ok: true, no detail', () => {
    const dir = makeTempDir('deferred-reconciliation-');
    tempDirs.push(dir);
    const { ledgerFile, queueFile } = writeFixture(dir, [baseFinding({ deferred_to_issue: 305 })], { '305': { status: 'ready' } });
    expect(checkDeferredReconciliation(ledgerFile, queueFile)).toEqual([{ id: 'V-DEFER-01', ok: true }]);
  });

  test('violating fixture: single V-DEFER-01 result, still ok: true (advisory), with detail', () => {
    const dir = makeTempDir('deferred-reconciliation-');
    tempDirs.push(dir);
    const { ledgerFile, queueFile } = writeFixture(dir, [baseFinding({ deferred_to_issue: 305 })], { '305': { status: 'merged' } });
    const results = checkDeferredReconciliation(ledgerFile, queueFile);
    expect(results).toHaveLength(1);
    expect(results[0].id).toBe('V-DEFER-01');
    expect(results[0].ok).toBe(true);
    expect(results[0].detail).toBeDefined();
  });

  test('missing ledger file is SKIPped — ok: true, never crashes', () => {
    const dir = makeTempDir('deferred-reconciliation-');
    tempDirs.push(dir);
    const queueFile = path.join(dir, 'queue.json');
    fs.writeFileSync(queueFile, JSON.stringify({ issues: {} }));
    expect(checkDeferredReconciliation(path.join(dir, 'missing-ledger.json'), queueFile)).toEqual([{ id: 'V-DEFER-01', ok: true }]);
  });

  test('missing queue file is SKIPped — ok: true, never crashes', () => {
    const dir = makeTempDir('deferred-reconciliation-');
    tempDirs.push(dir);
    const ledgerFile = path.join(dir, 'findings-ledger.json');
    fs.writeFileSync(ledgerFile, JSON.stringify({ findings: [] }));
    expect(checkDeferredReconciliation(ledgerFile, path.join(dir, 'missing-queue.json'))).toEqual([{ id: 'V-DEFER-01', ok: true }]);
  });

  test('runChecks() against a worktree with no .blackhole/ directory SKIPs — ok: true', () => {
    const results = runChecks();
    expect(results).toHaveLength(1);
    expect(results[0].id).toBe('V-DEFER-01');
    expect(results[0].ok).toBe(true);
  });
});
