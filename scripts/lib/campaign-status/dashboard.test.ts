import { describe, expect, test } from 'bun:test';
import {
  computeQueueHealth,
  formatDashboard,
  renderLedgerOpenSection,
  renderRoutingSection,
  renderWavesSection,
} from './dashboard.ts';
import type { IssueRow, LedgerFinding, QueueIssue } from './types.ts';

// ADR-042 — Task 2(d)/(e): renderLedgerOpenSection gains occurrences/last_seen_at
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

// Issue #929 Task 2 — computeQueueHealth boundary matrix. Priority order is load-bearing:
// !forgeOk overrides everything (counts cannot be trusted without the forge), then the
// stalled check, then healthy as the fallback.
describe('computeQueueHealth', () => {
  test('forge unavailable → degraded, regardless of counts', () => {
    expect(computeQueueHealth({ forgeOk: false, blockedCount: 0, inFlightCount: 0 })).toBe(
      'degraded',
    );
    expect(computeQueueHealth({ forgeOk: false, blockedCount: 5, inFlightCount: 5 })).toBe(
      'degraded',
    );
  });

  test('forge available + blocked > 0 + in-flight = 0 → stalled', () => {
    expect(computeQueueHealth({ forgeOk: true, blockedCount: 1, inFlightCount: 0 })).toBe(
      'stalled',
    );
  });

  test('inFlightCount 0→1 boundary flips stalled → healthy', () => {
    expect(computeQueueHealth({ forgeOk: true, blockedCount: 1, inFlightCount: 0 })).toBe(
      'stalled',
    );
    expect(computeQueueHealth({ forgeOk: true, blockedCount: 1, inFlightCount: 1 })).toBe(
      'healthy',
    );
  });

  test('blockedCount 1→0 boundary flips stalled → healthy', () => {
    expect(computeQueueHealth({ forgeOk: true, blockedCount: 1, inFlightCount: 0 })).toBe(
      'stalled',
    );
    expect(computeQueueHealth({ forgeOk: true, blockedCount: 0, inFlightCount: 0 })).toBe(
      'healthy',
    );
  });

  test('forge available + blocked = 0 + in-flight = 0 → healthy', () => {
    expect(computeQueueHealth({ forgeOk: true, blockedCount: 0, inFlightCount: 0 })).toBe(
      'healthy',
    );
  });
});

describe('formatDashboard — Queue health line', () => {
  test('renders a **Queue health:** line', () => {
    const out = formatDashboard({
      checkpoint: { orchestrator_turn_id: 1 },
      queue: { refreshed_at: '2026-09-06T00:00:00.000Z', issues: {} },
      ledger: { findings: [] },
      forge: { openIssues: 0, openPrs: 0, ok: true },
    });

    expect(out).toContain('**Queue health:**');
  });
});

// Issue #929 Task 3 — Routing/Waves output caps, mirroring the existing 350-row
// renderLedgerOpenSection cap test.
describe('renderRoutingSection — section cap', () => {
  test('350 routed issues render exactly SECTION_CAP (10) blocks plus one overflow line', () => {
    const active: IssueRow[] = [];
    for (let i = 1; i <= 350; i++) {
      active.push({
        num: i,
        issue: { title: `Routed ${i}`, phase: 'plan', status: 'in-flight', route: {} },
      });
    }

    const lines = renderRoutingSection(active);
    const issueBlocks = lines.filter((l) => l.startsWith('- **#'));
    expect(issueBlocks.length).toBe(10);
    expect(lines).toContain('- …and 340 more');
  });
});

describe('renderWavesSection — section cap', () => {
  test('350-issue linear dependency chain renders exactly 10 Wave lines plus one overflow line', () => {
    const issues: Record<string, QueueIssue> = {};
    for (let i = 1; i <= 350; i++) {
      issues[String(i)] = {
        title: `Chain ${i}`,
        phase: 'handle',
        status: 'ready',
        depends_on: i > 1 ? [i - 1] : [],
      };
    }

    const lines = renderWavesSection(issues);
    const waveLines = lines.filter((l) => l.startsWith('**Wave '));
    expect(waveLines.length).toBe(10);
    expect(lines).toContain('- …and 340 more');
  });
});
