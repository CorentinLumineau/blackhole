import { describe, expect, test } from 'bun:test';
import {
  countLedgerByStatus,
  discoveryFilings,
  formatDashboard,
  groupIssuesByPhase,
  parseCheckpointFrontmatter,
} from './campaign-status';

describe('parseCheckpointFrontmatter', () => {
  test('parses YAML frontmatter fields', () => {
    const meta = parseCheckpointFrontmatter(`---
refreshed_at: 2026-07-05T12:00:00.000Z
orchestrator_turn_id: 7
last_completed_phase: review
---

# Campaign Checkpoint
`);
    expect(meta.orchestrator_turn_id).toBe(7);
    expect(meta.last_completed_phase).toBe('review');
  });
});

describe('groupIssuesByPhase', () => {
  test('splits active vs done and in-flight', () => {
    const grouped = groupIssuesByPhase({
      '22': { title: 'A', phase: 'review', status: 'in-flight', pr: 40 },
      '21': { title: 'B', phase: 'done', status: 'merged', pr: 41 },
      '20': { title: 'C', phase: 'implement', status: 'ready' },
      '19': { title: 'D', phase: 'plan', status: 'blocked', notes: 'overlap' },
    });
    expect(grouped.inFlight).toHaveLength(1);
    expect(grouped.done).toHaveLength(1);
    expect(grouped.ready).toHaveLength(1);
    expect(grouped.blocked).toHaveLength(1);
  });
});

describe('countLedgerByStatus', () => {
  test('counts open severities and deferred', () => {
    const counts = countLedgerByStatus([
      { status: 'open', severity: 'BLOCK' },
      { status: 'open', severity: 'WARN' },
      { status: 'deferred', severity: 'WARN', deferred_to_issue: 99 },
    ]);
    expect(counts.open).toBe(2);
    expect(counts.block).toBe(1);
    expect(counts.deferred).toBe(1);
  });
});

describe('discoveryFilings', () => {
  test('extracts deferred_to_issue rows', () => {
    const filed = discoveryFilings([
      { status: 'deferred', deferred_to_issue: 46, summary: 'Remove synth', vcode: 'V-YAGNI' },
      { status: 'open', deferred_to_issue: null },
    ]);
    expect(filed).toEqual([{ issue: 46, summary: 'Remove synth', vcode: 'V-YAGNI' }]);
  });
});

describe('formatDashboard', () => {
  const baseOpts = {
    checkpoint: { orchestrator_turn_id: 3 },
    queue: { refreshed_at: '2026-07-05T18:00:00.000Z', issues: {} },
    ledger: { findings: [] },
    forge: { openIssues: 6, openPrs: 0, ok: true },
  };

  test('renders milestone scope and in-flight table', () => {
    const out = formatDashboard({
      ...baseOpts,
      scope: { milestone: 'v0.4.2' },
      queue: {
        refreshed_at: '2026-07-05T18:00:00.000Z',
        issues: {
          '34': {
            title: 'Model inherit',
            phase: 'plan',
            status: 'in-flight',
          },
        },
      },
    });

    expect(out).toContain('milestone **v0.4.2**');
    expect(out).toContain('Turn:** 3');
    expect(out).toContain('6 open issues');
    expect(out).toContain('### In-flight');
    expect(out).toContain('#34 Model inherit');
  });

  test('renders label scope', () => {
    const out = formatDashboard({
      ...baseOpts,
      scope: { labels: ['size:xs', 'track:standard'] },
    });

    expect(out).toContain('labels `size:xs`, `track:standard`');
  });

  test('renders blocked issues with notes', () => {
    const out = formatDashboard({
      ...baseOpts,
      queue: {
        refreshed_at: '2026-07-05T18:00:00.000Z',
        issues: {
          '19': {
            title: 'Overlap fix',
            phase: 'plan',
            status: 'blocked',
            notes: 'awaiting-user-clarification',
          },
        },
      },
    });

    expect(out).toContain('### Blocked');
    expect(out).toContain('**#19** Overlap fix — awaiting-user-clarification');
  });

  test('renders ready issues with phase', () => {
    const out = formatDashboard({
      ...baseOpts,
      queue: {
        refreshed_at: '2026-07-05T18:00:00.000Z',
        issues: {
          '20': { title: 'Next up', phase: 'implement', status: 'ready' },
          '21': { title: 'Another', phase: 'handle', status: 'ready' },
        },
      },
    });

    expect(out).toContain('### Ready');
    expect(out).toContain('#20 (implement)');
    expect(out).toContain('#21 (handle)');
  });

  test('renders completed queue with PR links', () => {
    const out = formatDashboard({
      ...baseOpts,
      queue: {
        refreshed_at: '2026-07-05T18:00:00.000Z',
        issues: {
          '10': { title: 'Done', phase: 'done', status: 'merged', pr: 42 },
          '11': { title: 'Closed', phase: 'done', status: 'closed' },
        },
      },
    });

    expect(out).toContain('### Completed (queue)');
    expect(out).toContain('#10 → PR #42');
    expect(out).toContain('#11');
  });

  test('renders deferred discovery filings with vcode', () => {
    const out = formatDashboard({
      ...baseOpts,
      ledger: {
        findings: [
          {
            status: 'deferred',
            deferred_to_issue: 46,
            summary: 'Remove synth',
            vcode: 'V-YAGNI',
          },
        ],
      },
    });

    expect(out).toContain('### Issues filed (deferred discoveries)');
    expect(out).toContain('**#46** — Remove synth (`V-YAGNI`)');
  });

  test('renders ledger open with severity and issue_ref', () => {
    const out = formatDashboard({
      ...baseOpts,
      ledger: {
        findings: [
          {
            id: 'F-00001',
            status: 'open',
            vcode: 'V-SCOPE-02',
            severity: 'BLOCK',
            summary: 'Touch-path violation',
            issue_ref: 34,
          },
        ],
      },
    });

    expect(out).toContain('### Ledger open');
    expect(out).toContain('**F-00001** `V-SCOPE-02` BLOCK — Touch-path violation (#34)');
  });

  test('shows forge unavailable when gh fails', () => {
    const out = formatDashboard({
      ...baseOpts,
      forge: { openIssues: 0, openPrs: 0, ok: false, error: 'skipped' },
    });

    expect(out).toContain('**Forge:** unavailable (skipped)');
  });

  test('renders active workers from checkpoint body', () => {
    const out = formatDashboard({
      ...baseOpts,
      checkpointBody: `---
orchestrator_turn_id: 5
---

# Campaign Checkpoint

## In-flight workers

- worker_1: issue #34 (plan)
- worker_2: issue #35 (implement)

## Next actions
`,
    });

    expect(out).toContain('### Active workers');
    expect(out).toContain('worker_1: issue #34 (plan)');
    expect(out).toContain('worker_2: issue #35 (implement)');
  });
});
