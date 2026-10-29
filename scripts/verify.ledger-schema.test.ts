import { afterEach, describe, expect, test } from 'bun:test';
import * as fs from 'fs';
import * as path from 'path';
import { makeTempDir } from './lib/fs.ts';
import { checkLedgerSchema, findLedgerSchemaDrift, OUTCOME_STATUSES } from './checks/ledger-schema.check.ts';

// V-LEDGER-01 — a string issue_ref row and a "pr"-keyed row must both be reported, by id, in
// one failing check run.

describe('findLedgerSchemaDrift', () => {
  test('a string issue_ref row and a "pr"-keyed row both fail, both named', () => {
    const findings = [
      { id: 'F-00715', issue_ref: '715', pr_ref: null },
      { id: 'F-00745', issue_ref: 100, pr: 745 },
    ];
    const drift = findLedgerSchemaDrift(findings);
    expect(drift.some((d) => d.includes('F-00715'))).toBe(true);
    expect(drift.some((d) => d.includes('F-00745'))).toBe(true);
  });

  test('a clean ledger (number/null issue_ref and pr_ref, no legacy "pr" key) reports no drift', () => {
    const findings = [
      { id: 'F-1', issue_ref: 100, pr_ref: null },
      { id: 'F-2', issue_ref: 101, pr_ref: 200 },
    ];
    expect(findLedgerSchemaDrift(findings)).toEqual([]);
  });

  test('a pr_ref stored as a string is reported as drift', () => {
    const findings = [{ id: 'F-3', issue_ref: 100, pr_ref: '773' }];
    const drift = findLedgerSchemaDrift(findings);
    expect(drift).toHaveLength(1);
    expect(drift[0]).toContain('F-3');
    expect(drift[0]).toContain('pr_ref');
  });

  test('a row with pr_ref key entirely absent is not reported as drift', () => {
    const findings = [{ id: 'F-4', issue_ref: 100 }];
    expect(findLedgerSchemaDrift(findings)).toEqual([]);
  });

  test('a row violating both issue_ref and pr_ref shape reports two distinct strings', () => {
    const findings = [{ id: 'F-5', issue_ref: '100', pr_ref: '200' }];
    const drift = findLedgerSchemaDrift(findings);
    expect(drift).toHaveLength(2);
  });

  // ADR-036 (issue #815) — verification_mode enum check on ledgered rows.
  test('a verification_mode outside the enum is reported as drift', () => {
    const findings = [{ id: 'F-6', issue_ref: 100, verification_mode: 'guessed' }];
    const drift = findLedgerSchemaDrift(findings);
    expect(drift).toHaveLength(1);
    expect(drift[0]).toContain('F-6');
    expect(drift[0]).toContain('verification_mode');
  });

  test('a verification_mode of "executed" or "reasoned" is not drift', () => {
    const findings = [
      { id: 'F-7', issue_ref: 100, verification_mode: 'executed' },
      { id: 'F-8', issue_ref: 100, verification_mode: 'reasoned' },
    ];
    expect(findLedgerSchemaDrift(findings)).toEqual([]);
  });

  test('a row with verification_mode key entirely absent is not reported as drift', () => {
    const findings = [{ id: 'F-9', issue_ref: 100 }];
    expect(findLedgerSchemaDrift(findings)).toEqual([]);
  });
});

describe('checkLedgerSchema (file-absent SKIP and live read)', () => {
  const tempDirs: string[] = [];

  afterEach(() => {
    for (const dir of tempDirs.splice(0)) fs.rmSync(dir, { recursive: true, force: true });
  });

  test('no findings-ledger.json on disk: ok true, no detail', () => {
    const dir = makeTempDir('ledger-schema-');
    tempDirs.push(dir);
    const result = checkLedgerSchema(path.join(dir, 'findings-ledger.json'));
    expect(result).toEqual({ id: 'V-LEDGER-01', ok: true });
  });

  test('a live ledger with drifted rows fails with both rows named in detail', () => {
    const dir = makeTempDir('ledger-schema-');
    tempDirs.push(dir);
    const ledgerFile = path.join(dir, 'findings-ledger.json');
    fs.writeFileSync(
      ledgerFile,
      JSON.stringify({
        findings: [
          { id: 'F-00715', issue_ref: '715', pr_ref: null },
          { id: 'F-00745', issue_ref: 100, pr: 745 },
        ],
      }),
    );
    const result = checkLedgerSchema(ledgerFile);
    expect(result.ok).toBe(false);
    expect(result.detail).toContain('F-00715');
    expect(result.detail).toContain('F-00745');
  });

  test('a live ledger with no drift passes', () => {
    const dir = makeTempDir('ledger-schema-');
    tempDirs.push(dir);
    const ledgerFile = path.join(dir, 'findings-ledger.json');
    fs.writeFileSync(ledgerFile, JSON.stringify({ findings: [{ id: 'F-1', issue_ref: 100, pr_ref: null }] }));
    const result = checkLedgerSchema(ledgerFile);
    expect(result).toEqual({ id: 'V-LEDGER-01', ok: true });
  });
});

describe('finding outcome statuses', () => {
  test.each([...OUTCOME_STATUSES])('%s with a reason is accepted', (status) => {
    expect(findLedgerSchemaDrift([{ id: 'F-1', status, reason: 'reviewer misread the guard' }])).toEqual([]);
  });

  test.each([...OUTCOME_STATUSES])('%s without a reason is rejected', (status) => {
    const drift = findLedgerSchemaDrift([{ id: 'F-2', status }]);
    expect(drift).toHaveLength(1);
    expect(drift[0]).toContain('F-2');
    expect(drift[0]).toContain('reason');
  });

  test('a blank reason is rejected', () => {
    expect(findLedgerSchemaDrift([{ id: 'F-3', status: 'wrong', reason: '   ' }])).toHaveLength(1);
  });

  test('a multi-line reason is rejected', () => {
    expect(findLedgerSchemaDrift([{ id: 'F-5', status: 'wrong', reason: 'a\nb' }])).toHaveLength(1);
  });

  test('legacy statuses need no reason', () => {
    const findings = ['open', 'fixed-in-pr', 'deferred', 'resolved'].map((status, i) => ({ id: `F-${i}`, status }));
    expect(findLedgerSchemaDrift(findings)).toEqual([]);
  });

  test('the example fixture still validates and carries one row per outcome status', () => {
    const fixture = JSON.parse(fs.readFileSync(path.join(import.meta.dir, '..', 'fixtures', 'findings-ledger.example.json'), 'utf8'));
    expect(findLedgerSchemaDrift(fixture.findings)).toEqual([]);
    const statuses = fixture.findings.map((f: { status: string }) => f.status);
    for (const s of OUTCOME_STATUSES) expect(statuses).toContain(s);
  });
});
