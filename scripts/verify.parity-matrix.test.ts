import { describe, expect, test } from 'bun:test';
import { runChecks, validateParityMatrixContent } from './checks/parity-matrix.check.ts';

// ADR-013 D1/T2 — parity-matrix.check.ts (V-PMATRIX-01): validates the row schema of
// documentation/audits/mercure-parity-matrix.md (row-id uniqueness, status-enum validity,
// in-flight-requires-ref, gap-requires-priority). The matrix file itself is only created by M2
// — this milestone (M1) ships the check inert (file-absent → ok:true skip), see case 1 below.
//
// 12-case spec (milestone-1.md § T2 AC). Each numbered case below is one `test()` block,
// matching the milestone's "bun test ... → 12 pass / 0 fail" acceptance criterion exactly.

const HEADER = '| id | kind | mechanism | blackhole | status | priority | verified |';
const SEPARATOR = '|---|---|---|---|---|---|---|';

/** Assembles a minimal parity-matrix doc: some prose, then the D1-schema table. */
const matrixDoc = (rows: string[]): string =>
  [
    '# Mercure Parity Matrix',
    '',
    'Some prose above the table that must not be mistaken for the header.',
    '',
    HEADER,
    SEPARATOR,
    ...rows,
    '',
  ].join('\n');

const row = (id: string, kind: string, mechanism: string, blackhole: string, status: string, priority: string, verified: string) =>
  `| ${id} | ${kind} | ${mechanism} | ${blackhole} | ${status} | ${priority} | ${verified} |`;

describe('V-PMATRIX-01 — parity matrix schema validation', () => {
  test('case 1: matrix file absent → ok:true (skip branch, no parse attempted)', () => {
    // documentation/audits/mercure-parity-matrix.md does not exist in this repo until M2 ships
    // it — runChecks() against the real repo therefore exercises the file-absent skip branch
    // directly, exactly as the milestone AC intends ("inert until M2 ships").
    const results = runChecks();
    expect(results).toHaveLength(1);
    expect(results[0]).toEqual({ id: 'V-PMATRIX-01', ok: true });
  });

  test('case 2: well-formed matrix (unique ids, valid statuses, in-flight w/ ref, gap w/ priority) → ok:true', () => {
    const doc = matrixDoc([
      row('PM-001', 'checklist', 'SOLID audit', 'src/agents/reviewer.md', 'covered', '', '2026-07-01/v1.2.0'),
      row('PM-002', 'gate', 'Approval gate', 'AskQuestion async', 'adapted', '', '2026-07-01/v1.2.0'),
      row('PM-003', 'plan-section', 'Threat model', 'no runtime surface', 'N/A(no runtime surface)', '', '2026-07-01/v1.2.0'),
      row('PM-004', 'fleet', 'SRE agent', '—', 'gap', '45', '2026-07-01/v1.2.0'),
      row('PM-005', 'artifact', 'Runbook taxonomy', 'documentation/runbooks/', 'in-flight(#301)', '30', '2026-07-01/v1.2.0'),
    ]);
    expect(validateParityMatrixContent(doc)).toEqual({ id: 'V-PMATRIX-01', ok: true });
  });

  test('case 3: duplicate id across two rows → ok:false, detail cites both occurrences', () => {
    const doc = matrixDoc([
      row('PM-001', 'checklist', 'SOLID audit', 'src/agents/reviewer.md', 'covered', '', '2026-07-01/v1.2.0'),
      row('PM-001', 'gate', 'Approval gate', 'AskQuestion async', 'adapted', '', '2026-07-01/v1.2.0'),
    ]);
    const result = validateParityMatrixContent(doc);
    expect(result.ok).toBe(false);
    expect(result.id).toBe('V-PMATRIX-01');
    expect(result.detail).toContain('PM-001');
    expect(result.detail).toContain('duplicate');
  });

  test('case 4: invalid status value (not in the five-value enum) → ok:false', () => {
    const doc = matrixDoc([row('PM-001', 'checklist', 'SOLID audit', 'src/agents/reviewer.md', 'done', '', '2026-07-01/v1.2.0')]);
    const result = validateParityMatrixContent(doc);
    expect(result.ok).toBe(false);
    expect(result.detail).toContain('PM-001');
    expect(result.detail).toContain('done');
  });

  test('case 5: bare in-flight (no parenthetical ref) → ok:false', () => {
    const doc = matrixDoc([row('PM-005', 'artifact', 'Runbook taxonomy', 'documentation/runbooks/', 'in-flight', '30', '2026-07-01/v1.2.0')]);
    const result = validateParityMatrixContent(doc);
    expect(result.ok).toBe(false);
    expect(result.detail).toContain('PM-005');
    expect(result.detail).toContain('in-flight');
  });

  test('case 6: in-flight(#301) with a ref present → passes (paired positive of case 5)', () => {
    const doc = matrixDoc([row('PM-005', 'artifact', 'Runbook taxonomy', 'documentation/runbooks/', 'in-flight(#301)', '30', '2026-07-01/v1.2.0')]);
    expect(validateParityMatrixContent(doc)).toEqual({ id: 'V-PMATRIX-01', ok: true });
  });

  test('case 7: gap row with empty/missing priority cell → ok:false', () => {
    const doc = matrixDoc([row('PM-004', 'fleet', 'SRE agent', '—', 'gap', '', '2026-07-01/v1.2.0')]);
    const result = validateParityMatrixContent(doc);
    expect(result.ok).toBe(false);
    expect(result.detail).toContain('PM-004');
    expect(result.detail).toContain('priority');
  });

  test('case 8: gap row with a numeric priority → passes (paired positive of case 7)', () => {
    const doc = matrixDoc([row('PM-004', 'fleet', 'SRE agent', '—', 'gap', '45', '2026-07-01/v1.2.0')]);
    expect(validateParityMatrixContent(doc)).toEqual({ id: 'V-PMATRIX-01', ok: true });
  });

  test('case 9: N/A(reason) with non-empty reason passes; bare N/A (no reason) fails', () => {
    const passDoc = matrixDoc([row('PM-003', 'plan-section', 'Threat model', 'no runtime surface', 'N/A(no runtime surface)', '', '2026-07-01/v1.2.0')]);
    expect(validateParityMatrixContent(passDoc)).toEqual({ id: 'V-PMATRIX-01', ok: true });

    const failDoc = matrixDoc([row('PM-003', 'plan-section', 'Threat model', 'no runtime surface', 'N/A', '', '2026-07-01/v1.2.0')]);
    const failResult = validateParityMatrixContent(failDoc);
    expect(failResult.ok).toBe(false);
    expect(failResult.detail).toContain('PM-003');
  });

  test('case 10: multiple simultaneous violations (duplicate id + invalid status) aggregate into one ok:false result citing all', () => {
    const doc = matrixDoc([
      row('PM-001', 'checklist', 'SOLID audit', 'src/agents/reviewer.md', 'covered', '', '2026-07-01/v1.2.0'),
      row('PM-001', 'gate', 'Approval gate', 'AskQuestion async', 'covered', '', '2026-07-01/v1.2.0'),
      row('PM-002', 'checklist', 'Another mechanism', 'src/agents/reviewer.md', 'done', '', '2026-07-01/v1.2.0'),
    ]);
    const result = validateParityMatrixContent(doc);
    expect(result.ok).toBe(false);
    expect(result.id).toBe('V-PMATRIX-01');
    // Single CheckResult, not multiple — both violations joined into one detail string.
    expect(result.detail).toContain('PM-001');
    expect(result.detail).toContain('PM-002');
    expect(result.detail).toContain('duplicate');
    expect(result.detail).toContain('done');
  });

  test('case 11: malformed table (header present but no separator row, or no header found) → ok:false, distinct from the file-absent skip', () => {
    const noSeparator = ['# Mercure Parity Matrix', '', HEADER, row('PM-001', 'checklist', 'SOLID audit', 'x', 'covered', '', 'v1'), ''].join('\n');
    const noSepResult = validateParityMatrixContent(noSeparator);
    expect(noSepResult.ok).toBe(false);
    expect(noSepResult.id).toBe('V-PMATRIX-01');
    expect(noSepResult.detail).toBeTruthy();

    const noHeader = ['# Mercure Parity Matrix', '', 'No table here at all, just prose.', ''].join('\n');
    const noHeaderResult = validateParityMatrixContent(noHeader);
    expect(noHeaderResult.ok).toBe(false);
    expect(noHeaderResult.id).toBe('V-PMATRIX-01');
    expect(noHeaderResult.detail).toBeTruthy();

    // Distinct from case 1 (file-absent skip): both malformed-but-present branches fail,
    // whereas the absent-file branch (case 1) always returns ok:true.
    expect(noSepResult.ok).not.toBe(true);
    expect(noHeaderResult.ok).not.toBe(true);
  });

  test('case 12: contract — result id is always exactly V-PMATRIX-01 and the function never throws, across every branch', () => {
    const fixtures = [
      '',
      'no table at all',
      matrixDoc([]),
      matrixDoc([row('PM-001', 'checklist', 'x', 'y', 'covered', '', 'v1')]),
      matrixDoc([row('PM-001', 'checklist', 'x', 'y', 'garbage-status', '', 'v1')]),
      [HEADER, 'not a separator', ''].join('\n'),
    ];

    for (const fixture of fixtures) {
      expect(() => {
        const result = validateParityMatrixContent(fixture);
        expect(result.id).toBe('V-PMATRIX-01');
      }).not.toThrow();
    }

    expect(() => {
      const results = runChecks();
      for (const r of results) expect(r.id).toBe('V-PMATRIX-01');
    }).not.toThrow();
  });
});
