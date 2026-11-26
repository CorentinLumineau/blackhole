import { describe, expect, test } from 'bun:test';
import type { ForgePr } from '../forge-adapter/types.ts';
import { collectOwnerNeeds, renderOwnerNeeds } from './owner-needs.ts';
import type { PendingDecision } from './pending-decisions.ts';
import type { QueueIssue } from './types.ts';

const pr = (number: number, labels: string[], state: ForgePr['state'] = 'OPEN'): ForgePr => ({
  number, title: `PR ${number}`, body: '', headRefName: `b${number}`, state, mergedAt: null, labels,
});
const parked = (over: Partial<PendingDecision>): PendingDecision => ({
  id: 'PD-1', question: 'q', options: [{ label: 'A' }, { label: 'B' }], recommended: 0, blocks: [], created_at: '2026-11-17T00:00:00Z', ...over,
});
const blockedIssue = (notes: string, extra: Partial<QueueIssue> = {}): QueueIssue => ({ title: 'T', status: 'blocked', notes, ...extra });

describe('collectOwnerNeeds: PRs', () => {
  test('only open PRs labelled needs-owner or owner-gated, case-insensitively, ascending', () => {
    const { prs } = collectOwnerNeeds({
      prs: [pr(9, ['Owner-Gated']), pr(3, ['needs-owner']), pr(5, ['bug']), pr(6, ['needs-owner'], 'MERGED'), pr(7, [])],
      issues: {}, parked: [],
    });
    expect(prs.map((p) => p.number)).toEqual([3, 9]);
    expect(prs[0]).toEqual({ number: 3, title: 'PR 3', label: 'needs-owner' });
  });

  test('a PR that a parked decision cites is dropped by blocks, by its queue issue, or by #n text', () => {
    const issues = { '40': { title: 'x', status: 'in-flight', pr: 12 } as QueueIssue };
    const all = [pr(10, ['needs-owner']), pr(12, ['needs-owner']), pr(13, ['needs-owner']), pr(14, ['needs-owner']), pr(15, ['needs-owner'])];
    const none = collectOwnerNeeds({ prs: all, issues, parked: [] }).prs.map((p) => p.number);
    expect(none).toEqual([10, 12, 13, 14, 15]);
    const kept = collectOwnerNeeds({
      prs: all,
      issues,
      parked: [
        parked({ blocks: [10] }),
        parked({ id: 'PD-2', blocks: [40] }),
        parked({ id: 'PD-3', question: 'Merge #13 now?' }),
        parked({ id: 'PD-4', evidence: 'see #14, not #150' }),
      ],
    }).prs.map((p) => p.number);
    expect(kept).toEqual([15]);
  });
});

describe('collectOwnerNeeds: blocked items', () => {
  test('lists owner-addressed blocked items; skips parked-gate, dependency and non-blocked rows', () => {
    const { blocked } = collectOwnerNeeds({
      prs: [],
      issues: {
        '21': blockedIssue('needs-owner: pick a name'),
        '22': blockedIssue('Owner: confirm scope'),
        '23': blockedIssue('awaiting-owner-on-return: PD-1'),
        '24': blockedIssue('waiting on #21', { depends_on: [21] }),
        '25': { title: 'T', status: 'ready', notes: 'needs-owner' },
        '26': blockedIssue('blocked-escalated: 3 rounds'),
        'other/repo#1': blockedIssue('needs-owner'),
      },
      parked: [],
    });
    expect(blocked.map((b) => b.number)).toEqual([21, 22, 26]);
    expect(blocked[0]).toEqual({ number: 21, title: 'T', note: 'needs-owner: pick a name' });
  });

  test('a blocked item is dropped when a parked decision blocks its number or its PR number', () => {
    const issues = { '21': blockedIssue('needs-owner', { pr: 99 }), '22': blockedIssue('needs-owner'), '23': blockedIssue('needs-owner') };
    const { blocked } = collectOwnerNeeds({ prs: [], issues, parked: [parked({ blocks: [21] }), parked({ id: 'PD-2', blocks: [99] })] });
    expect(blocked.map((b) => b.number)).toEqual([22, 23]);
    const viaPr = collectOwnerNeeds({ prs: [], issues, parked: [parked({ blocks: [99] })] }).blocked.map((b) => b.number);
    expect(viaPr).toEqual([22, 23]);
  });
});

describe('renderOwnerNeeds', () => {
  test('null prs says not read, never none; an empty read says none', () => {
    const unread = renderOwnerNeeds({ prs: null, blocked: [] });
    expect(unread).toContain('open PRs needing you: not read (forge unavailable)');
    expect(unread).not.toContain('open PRs needing you: none');
    expect(renderOwnerNeeds({ prs: [], blocked: [] })).toContain('open PRs needing you: none');
  });

  test('ranks PRs before blocked items and renders titles as text', () => {
    const out = renderOwnerNeeds({
      prs: [{ number: 3, title: 'Fix `rm -rf`', label: 'needs-owner' }],
      blocked: [{ number: 21, title: 'Name', note: 'needs-owner: pick' }],
    });
    expect(out.indexOf('#3')).toBeLessThan(out.indexOf('#21'));
    expect(out).toContain('#3 Fix `rm -rf` (needs-owner)');
    expect(out).toContain('#21 Name — needs-owner: pick');
  });
});
