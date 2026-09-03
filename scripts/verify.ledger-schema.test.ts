import { afterEach, describe, expect, test } from 'bun:test';
import * as fs from 'fs';
import * as path from 'path';
import { makeTempDir } from './lib/fs.ts';
import { checkLedgerSchema, findLedgerSchemaDrift } from './checks/ledger-schema.check.ts';

// V-LEDGER-01 (issue #754) — the AC-named fixture: a string issue_ref row and a "pr"-keyed row
// must both be reported, by id, in one failing check run.

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
