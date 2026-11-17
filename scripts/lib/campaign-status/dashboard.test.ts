import { describe, expect, test } from 'bun:test';
import { crossRepoBlockers } from '../../forge-deps.ts';
import type { PrLanding } from '../forge-adapter/pr-landing.ts';
import {
  computeQueueHealth,
  formatDashboard,
  renderLedgerOpenSection,
  renderMergeNextSection,
  renderRoutingSection,
  renderStackMergeOrderSection,
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

describe('renderStackMergeOrderSection', () => {
  test('renders nothing when no stacked PR is open', () => {
    expect(renderStackMergeOrderSection({})).toEqual([]);
    expect(renderStackMergeOrderSection({ '1': { status: 'in-flight', pr: 11 } } as never)).toEqual([]);
  });
  test('renders the merge order for an open stack', () => {
    const issues = {
      '1': { status: 'in-flight', pr: 11 },
      '2': { status: 'in-flight', pr: 12, stacked_on: 1 },
    } as never;
    expect(renderStackMergeOrderSection(issues)).toEqual([
      '### Stacked PR merge order',
      '- merge #1, then #2 (stacked on #1)',
      '',
    ]);
  });
});

describe('Merge next — cross-repo dependencies', () => {
  const issues = [{ number: 6241, body: 'Depends on #6240\nDepends on acme/workflows#185' }];
  const queue = { '6241': { status: 'in-flight', phase: 'review', pr: 50 } } as never;
  const withLanding = (landing: PrLanding | null) => renderMergeNextSection(queue, [], crossRepoBlockers(issues, () => landing));

  test('an unmerged PR in another repo is named as the item blocker', () => {
    expect(withLanding({ state: 'open', mergedAt: null, mergeCommitSha: null })).toEqual([
      '### Merge next',
      '1. #6241 (PR #50) — waits on acme/workflows#185 (cross-repo, not merged yet)',
      '',
    ]);
  });

  test('an unreadable PR stays a blocker', () => {
    expect(withLanding(null)[1]).toBe('1. #6241 (PR #50) — waits on acme/workflows#185 (cross-repo, merged state unreadable, treated as unmet)');
  });

  test('once the other repo PR is merged, nothing blocks the item', () => {
    expect(withLanding({ state: 'merged', mergedAt: '2026-11-16T10:00:00Z', mergeCommitSha: 'abc' })[1]).toBe('1. #6241 (PR #50) — none');
  });

  test('formatDashboard carries the blockers into Merge next, and says so when the bodies were not read', () => {
    const base = { checkpoint: {}, queue: { issues: queue }, ledger: {}, forge: { ok: true, openIssues: 1, openPrs: 1 } };
    const read = formatDashboard({ ...base, crossRepoBlockers: crossRepoBlockers(issues, () => null) } as never);
    expect(read).toContain('### Merge next\n1. #6241 (PR #50) — waits on acme/workflows#185 (cross-repo,');
    expect(read).not.toContain('Cross-repo blockers');
    const unread = formatDashboard({ ...base, crossRepoBlockers: null } as never);
    expect(unread).toContain('1. #6241 (PR #50) — none\n- cross-repo dependencies not read: the forge issue list failed');
  });
});

describe('renderMergeNextSection', () => {
  test('numbers every open PR in merge order with its blocker, and reports a cycle', () => {
    const issues = {
      '1': { status: 'in-flight', pr: 11 },
      '2': { status: 'in-flight', pr: 12, stacked_on: 1 },
      '3': { status: 'in-flight', pr: 13 },
      '4': { status: 'in-flight', pr: 14, stacked_on: 5 },
      '5': { status: 'in-flight', pr: 15, stacked_on: 4 },
      '6': { status: 'merged', pr: 16 },
    } as never;
    expect(renderMergeNextSection(issues, [3])).toEqual([
      '### Merge next',
      '1. #3 (PR #13) — none — CI fix, merge first',
      '2. #1 (PR #11) — after CI fix #3',
      '3. #2 (PR #12) — waits on #1 (stacked on)',
      '- **Cycle, not ordered:** #4, #5 — their stack or depends_on edges loop',
      '',
    ]);
  });

  test('prints nothing when no PR is open', () => {
    expect(renderMergeNextSection({ '1': { status: 'merged', pr: 11 } } as never)).toEqual([]);
  });

  test('formatDashboard shows the section ahead of the stacked merge order', () => {
    const out = formatDashboard({
      checkpoint: {},
      queue: { issues: { '1': { status: 'in-flight', phase: 'review', pr: 11 }, '2': { status: 'in-flight', phase: 'review', pr: 12, stacked_on: 1 } } },
      ledger: {},
      forge: { ok: true, openIssues: 0, openPrs: 2 },
    } as never);
    expect(out).toContain('### Merge next\n1. #1 (PR #11) — none\n2. #2 (PR #12) — waits on #1 (stacked on)');
    expect(out.indexOf('### Merge next')).toBeLessThan(out.indexOf('### Stacked PR merge order'));
  });

  test('formatDashboard puts the trunk-red base-fix PR first and names it on each waiting PR', () => {
    const out = formatDashboard({
      checkpoint: {},
      queue: {
        issues: {
          '1': { status: 'blocked', phase: 'review', pr: 11, notes: 'waiting-on-trunk-fix #7' },
          '2': { status: 'blocked', phase: 'review', pr: 12, notes: 'waiting-on-trunk-fix #7' },
          '7': { status: 'in-flight', phase: 'review', pr: 17 },
        },
      },
      ledger: {},
      forge: { ok: true, openIssues: 0, openPrs: 3 },
    } as never);
    expect(out).toContain(
      '### Merge next\n1. #7 (PR #17) — none — CI fix, merge first\n2. #1 (PR #11) — waits on #7 (trunk fix)\n3. #2 (PR #12) — waits on #7 (trunk fix)',
    );
  });
});
