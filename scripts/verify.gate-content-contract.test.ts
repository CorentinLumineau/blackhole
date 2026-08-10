import { describe, expect, test } from 'bun:test';
import { checkGateContentContract, runChecks } from './checks/gate-content-contract.check.ts';

describe('checkGateContentContract (V-GATECONTENT-01 — #483)', () => {
  test('pass: SSOT heading present and every gate-owning file references the contract', () => {
    const clarifyGates = '## Gate Content Contract (R-003)\n\nfailure-mode prose.';
    const gateFiles = {
      'src/references/phase-plan.md': 'Conforms to Gate Content Contract (R-003).',
      'src/agents/planner.md': 'See Gate Content Contract.',
    };
    const result = checkGateContentContract(clarifyGates, gateFiles);
    expect(result).toEqual({ id: 'V-GATECONTENT-01', ok: true });
  });

  test('regression: cross-reference removed from one gate-owning file names that file', () => {
    const clarifyGates = '## Gate Content Contract (R-003)\n\nfailure-mode prose.';
    const gateFiles = {
      'src/references/phase-plan.md': 'Conforms to Gate Content Contract (R-003).',
      'src/agents/planner.md': 'No cross-reference here.',
    };
    const result = checkGateContentContract(clarifyGates, gateFiles);
    expect(result.ok).toBe(false);
    expect(result.id).toBe('V-GATECONTENT-01');
    expect(result.detail).toContain('src/agents/planner.md');
  });

  test('regression: missing SSOT heading is named in detail', () => {
    const clarifyGates = 'No heading here.';
    const gateFiles = { 'src/references/phase-plan.md': 'Conforms to Gate Content Contract (R-003).' };
    const result = checkGateContentContract(clarifyGates, gateFiles);
    expect(result.ok).toBe(false);
    expect(result.detail).toContain('clarify-gates.md');
  });
});

describe('gate-content-contract runChecks() against the real tree', () => {
  test('returns one CheckResult entry', () => {
    const results = runChecks();
    expect(results).toHaveLength(1);
    expect(results.map((r) => r.id)).toEqual(['V-GATECONTENT-01']);
  });

  test('passes against the current tree', () => {
    const results = runChecks();
    expect(results[0].ok).toBe(true);
    expect(results[0].detail ?? '').toBe('');
  });
});
