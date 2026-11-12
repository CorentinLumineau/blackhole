import { describe, expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import { formatDashboard } from './dashboard.ts';
import { buildStatusReport } from './report.ts';
import { classifyBlocked, classPreview, groupBlockedRows } from './blocked-classes.ts';
import type { QueueIssue, QueueJson } from './types.ts';

const blocked = (title: string, notes: string, extra: Partial<QueueIssue> = {}): QueueIssue => ({
  title,
  status: 'blocked',
  notes,
  ...extra,
});

const issues: Record<string, QueueIssue> = {
  '1': blocked('gate', 'awaiting-plan-approval'),
  '2': blocked('escalated', 'blocked-escalated: 3 iterations'),
  '3': blocked('dep a', 'depends on upstream release'),
  '4': blocked('dep b', 'upstream fix'),
  '5': blocked('dep c', 'dependency: zod'),
  '6': blocked('dep d', 'upstream again'),
  '7': blocked('dep e', 'upstream last'),
  '8': blocked('tracker', 'tracking issue, stays open'),
  '9': blocked('lane', 'waiting', { labels: ['agent:cursor'] }),
};
const queue: QueueJson = { refreshed_at: '2026-09-06T00:00:00.000Z', issues };

const render = () =>
  formatDashboard({
    checkpoint: { orchestrator_turn_id: 1 },
    queue,
    ledger: { findings: [] },
    forge: { openIssues: 0, openPrs: 0, ok: true },
  });

const blockedSection = (out: string): string[] => {
  const start = out.split('\n').findIndex((l) => l === '### Blocked');
  const rest = out.split('\n').slice(start + 1);
  const end = rest.findIndex((l) => l.startsWith('###') || l === '');
  return rest.slice(0, end === -1 ? undefined : end);
};

describe('dashboard Blocked section groups by reason class (#1132)', () => {
  const report = buildStatusReport({
    config: {},
    queue,
    ledger: { findings: [] },
    checkpoint: { orchestrator_turn_id: 1 },
    forge: { openIssues: 0, openPrs: 0, ok: true },
    paceLine: null,
    hostNotes: [],
    generatedAt: '2026-09-06T00:00:00.000Z',
  });

  test('one line per owner gate plus one line per class', () => {
    const lines = blockedSection(render());
    expect(lines).toHaveLength(report.waiting_on_owner.length + report.blocked_classes.length);
    expect(lines).toHaveLength(2 + 3);
  });

  test('class line carries label, count (matching blocked_classes) and the first 3 issues', () => {
    const lines = blockedSection(render());
    const dep = report.blocked_classes.find((c) => c.class === 'dependency');
    expect(dep?.count).toBe(5);
    const line = lines.find((l) => l.includes(dep?.label ?? '?')) ?? '';
    expect(line).toContain('5');
    expect(line).toContain('#3, #4, #5');
    expect(line).toContain('and 2 more');
    expect(line).not.toContain('#6');
  });

  test('every class matches blocked_classes count', () => {
    const lines = blockedSection(render());
    for (const c of report.blocked_classes) {
      const line = lines.find((l) => l.includes(c.label)) ?? '';
      expect(line).toContain(`${c.count}`);
    }
  });

  test('owner gates stay as individual visible lines', () => {
    const lines = blockedSection(render());
    expect(lines.some((l) => l.includes('#1') && l.includes('awaiting-plan-approval'))).toBe(true);
    expect(lines.some((l) => l.includes('#2'))).toBe(true);
  });
});

describe('single-source classifier (V-DRY)', () => {
  test('report.ts re-exports the very same classifyBlocked function', async () => {
    const report = await import('./report.ts');
    expect(report.classifyBlocked).toBe(classifyBlocked);
  });

  test('the classifier and its rules are defined in blocked-classes.ts only', () => {
    for (const f of ['report.ts', 'dashboard.ts', 'html.ts', 'data.ts']) {
      const src = readFileSync(new URL(`./${f}`, import.meta.url), 'utf8');
      expect(src).not.toMatch(/function classifyBlocked\(|tracking issue|OWN_LANES/);
    }
  });

  test('groupBlockedRows and classPreview', () => {
    const rows = Object.entries(issues).map(([num, issue]) => ({ num, issue }));
    const groups = groupBlockedRows(rows, issues);
    expect(groups.map((g) => g.kind)).toEqual(['tracking_issue', 'dependency', 'another_lane']);
    expect(classPreview([1, 2, 3, 4, 5], 5)).toEqual({ first: [1, 2, 3], more: 2 });
    expect(classPreview([1], 1)).toEqual({ first: [1], more: 0 });
  });
});
