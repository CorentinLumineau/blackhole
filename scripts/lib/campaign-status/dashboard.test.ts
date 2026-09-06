import { describe, expect, test } from 'bun:test';
import { renderLedgerOpenSection } from './dashboard.ts';
import type { LedgerFinding } from './types.ts';

// ADR-042 (issue #893) — Task 2(d)/(e): renderLedgerOpenSection gains occurrences/last_seen_at
// rendering and a severity-then-recency sort. Both discriminate against `main`, where the
// function neither references either field nor sorts its input at all.

describe('renderLedgerOpenSection — occurrences, last_seen_at, sort', () => {
  test('2d — emits occurrences and last_seen_at when present', () => {
    const findings: LedgerFinding[] = [
      {
        id: 'F-00010',
        vcode: 'V-HOOK-03',
        severity: 'BLOCK',
        status: 'open',
        summary: 'hook-exec-failure',
        occurrences: 7,
        last_seen_at: '2026-09-06T10:00:00.000Z',
      },
    ];

    const lines = renderLedgerOpenSection(findings);
    const row = lines.find((l) => l.includes('F-00010'));
    expect(row).toBeDefined();
    expect(row).toContain('×7');
    expect(row).toContain('2026-09-06T10:00:00.000Z');
  });

  test('a row with neither field renders exactly as before (no stray suffix)', () => {
    const findings: LedgerFinding[] = [
      { id: 'F-00011', vcode: 'V-DRY-01', severity: 'WARN', status: 'open', summary: 'dup code' },
    ];
    const lines = renderLedgerOpenSection(findings);
    const row = lines.find((l) => l.includes('F-00011'));
    expect(row).toBe('- **F-00011** `V-DRY-01` WARN — dup code');
  });

  test('2e — sorted BLOCK-before-WARN then most-recent-first, even when append order disagrees', () => {
    const findings: LedgerFinding[] = [
      { id: 'F-01', vcode: 'V-WARN-A', severity: 'WARN', status: 'open', summary: 'old warn', last_seen_at: '2026-01-01T00:00:00.000Z' },
      { id: 'F-02', vcode: 'V-BLOCK-A', severity: 'BLOCK', status: 'open', summary: 'old block', last_seen_at: '2026-01-01T00:00:00.000Z' },
      { id: 'F-03', vcode: 'V-BLOCK-B', severity: 'BLOCK', status: 'open', summary: 'new block', last_seen_at: '2026-06-01T00:00:00.000Z' },
    ];
    // Append order: WARN, BLOCK(old), BLOCK(new) — deliberately disagreeing with the required
    // output order (BLOCK(new), BLOCK(old), WARN).
    const lines = renderLedgerOpenSection(findings);
    const ids = lines.filter((l) => l.startsWith('- **F-')).map((l) => l.match(/F-\d+/)?.[0]);
    expect(ids).toEqual(['F-03', 'F-02', 'F-01']);
  });

  test('Task 5 AC — with 350 synthetic open rows, every BLOCK row surfaces within the first 10 lines', () => {
    const findings: LedgerFinding[] = [];
    for (let i = 0; i < 345; i++) {
      findings.push({ id: `F-warn-${i}`, vcode: 'V-WARN-X', severity: 'WARN', status: 'open', summary: 'warn' });
    }
    const blockIds = ['F-block-1', 'F-block-2', 'F-block-3', 'F-block-4', 'F-block-5'];
    for (const id of blockIds) {
      findings.push({ id, vcode: 'V-BLOCK-X', severity: 'BLOCK', status: 'open', summary: 'block' });
    }

    const lines = renderLedgerOpenSection(findings);
    // '### Ledger open' header is line 0; the 10 rendered rows follow.
    const first10 = lines.slice(0, 11).join('\n');
    for (const id of blockIds) {
      expect(first10).toContain(id);
    }
  });

  test('no open findings renders nothing', () => {
    expect(renderLedgerOpenSection([{ id: 'F-1', vcode: 'V-X', severity: 'BLOCK', status: 'deferred' }])).toEqual([]);
  });
});
