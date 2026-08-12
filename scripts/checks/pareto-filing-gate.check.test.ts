import { describe, expect, test } from 'bun:test';
import { read } from './check-utils.ts';
import { parseVcodeTableRows } from '../lib/check-common.ts';
import { KNOWN_SEVERITY_EXEMPTIONS } from './vcode-severity-sync.check.ts';
import { findVcodeRow, parseVcodeRules, runChecks, scanStaleGateCites } from './pareto-filing-gate.check.ts';

// Issue #586 — pareto-filing-gate.check.ts: pins the ADR-022 split — V-PARETO-02 WARN discovery
// label vs V-PARETO-03 BLOCK filing gate.

describe('pareto-filing-gate SSOT table', () => {
  const rows = parseVcodeTableRows(read('src/references/blackhole-vcodes.md'));

  test('V-PARETO-02 SSOT severity is WARN', () => {
    expect(findVcodeRow(rows, 'V-PARETO-02')?.severity).toBe('WARN');
  });

  test('V-PARETO-03 exists with severity BLOCK and gate description', () => {
    const vcodes = read('src/references/blackhole-vcodes.md');
    const row = findVcodeRow(parseVcodeTableRows(vcodes), 'V-PARETO-03');
    const rule = parseVcodeRules(vcodes).get('V-PARETO-03') ?? '';
    expect(row?.severity).toBe('BLOCK');
    expect(rule).toMatch(/Priority/);
    expect(rule).toMatch(/>=\s*30/);
  });
});

describe('pareto-filing-gate prose cites', () => {
  test('phase-loop.md kaizen gate step cites V-PARETO-03 for Priority >= 30', () => {
    const content = read('src/references/phase-loop.md');
    expect(content).toMatch(/Apply `V-PARETO-03`.*Priority = Gain \* \(11 - Effort\) >= 30/);
    expect(content).not.toMatch(/Apply `V-PARETO-02`.*Priority = Gain \* \(11 - Effort\) >= 30/);
  });

  test('no stale V-PARETO-02 filing-gate cites under src/', () => {
    expect(scanStaleGateCites([])).toEqual([]);
  });
});

describe('vcode-severity-sync exemption removal (#567)', () => {
  test('KNOWN_SEVERITY_EXEMPTIONS is empty after the split', () => {
    expect(KNOWN_SEVERITY_EXEMPTIONS).toEqual([]);
  });
});

describe('runChecks integration', () => {
  test('all pareto-filing-gate checks pass on the live tree', () => {
    expect(runChecks().every((r) => r.ok)).toBe(true);
  });
});
