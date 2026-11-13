import { describe, expect, test } from 'bun:test';
import { buildBlockers } from './overview.ts';
import { closedIssues, reconcileMerged } from './merged.ts';
import type { MergedPr, QueueIssue } from './types.ts';

const START = '2026-11-10T08:00:00.000Z';
const merged = (number: number, mergedAt: string, extra: Partial<MergedPr> = {}): MergedPr => ({ number, title: `PR ${number}`, mergedAt, ...extra });

const issues: Record<string, QueueIssue> = {
  '1': { title: 'in review', status: 'in-flight', phase: 'review', pr: 11 },
  '2': { title: 'delivered', status: 'in-flight', phase: 'review', pr: 12, notes: 'delivered-at-LGTM' },
  '3': { title: 'already done', status: 'merged', phase: 'done', pr: 13 },
  '4': { title: 'still open', status: 'in-flight', phase: 'review', pr: 14 },
  '5': { title: 'no PR yet', status: 'ready', phase: 'handle' },
};

describe('reconcileMerged', () => {
  const out = reconcileMerged(
    issues,
    [merged(11, '2026-11-12T09:00:00Z'), merged(12, '2026-11-12T10:00:00Z'), merged(13, '2026-11-11T10:00:00Z'), merged(90, '2026-11-12T11:00:00Z')],
    START,
  );

  test('a queue entry whose PR the forge merged is read as merged and listed as drift', () => {
    expect(out.issues['1']!.status).toBe('merged');
    expect(out.issues['2']!.status).toBe('merged');
    expect(out.drift).toEqual([
      { issue: 1, pr: 11, title: 'in review', queue: 'in-flight', forge: 'merged' },
      { issue: 2, pr: 12, title: 'delivered', queue: 'in-flight', forge: 'merged' },
    ]);
  });

  test('an entry the forge agrees with, or does not mention, is left as the queue has it', () => {
    expect(out.issues['3']).toBe(issues['3']!);
    expect(out.issues['4']).toBe(issues['4']!);
    expect(out.issues['5']).toBe(issues['5']!);
  });

  test('the input queue is never changed', () => {
    expect(issues['1']!.status).toBe('in-flight');
  });

  test('a merged PR no entry names counts as done work of the campaign', () => {
    expect(out.mergedOnly).toEqual([merged(90, '2026-11-12T11:00:00Z')]);
  });
});

describe('the campaign start date bounds the merged PRs without an entry', () => {
  const list = [merged(70, '2026-11-09T23:59:59Z'), merged(71, '2026-11-10T08:00:00Z'), merged(72, '2026-11-12T00:00:00Z')];

  test('a PR merged before the start is not the campaign work', () => {
    expect(reconcileMerged({}, list, START).mergedOnly.map((p) => p.number)).toEqual([71, 72]);
  });

  test('without a start date nothing can be bounded, so none is counted', () => {
    expect(reconcileMerged({}, list, null).mergedOnly).toEqual([]);
    expect(reconcileMerged({}, list, 'not a date').mergedOnly).toEqual([]);
  });

  test('a merged PR before the start that a queue entry names is still drift: the entry is the campaign\'s', () => {
    const r = reconcileMerged({ '9': { title: 't', status: 'in-flight', pr: 70 } }, list, START);
    expect(r.drift.map((d) => d.pr)).toEqual([70]);
  });
});

describe('closedIssues, the issues a PR body closes', () => {
  test('reads the closing keywords GitHub, Gitea and GitLab share, in any case', () => {
    expect(closedIssues('Closes #12\nfixes #13 and Resolved: #14\nCLOSED #15')).toEqual([12, 13, 14, 15]);
  });

  test('ignores a plain mention, another repository and a repeated number', () => {
    expect(closedIssues('See #20. Related to #21. Closes acme/other#22. Closes #23, closes #23')).toEqual([23]);
  });

  test('an empty body closes nothing', () => {
    expect(closedIssues('')).toEqual([]);
  });
});

describe('a queue entry with no linked PR whose issue a merged PR closed', () => {
  const entries: Record<string, QueueIssue> = {
    '40': { title: 'no PR linked', status: 'ready', phase: 'handle' },
    '41': { title: 'already done, no PR', status: 'closed' },
    '42': { title: 'linked to another PR', status: 'in-flight', phase: 'review', pr: 80 },
  };
  const list = [merged(95, '2026-11-12T09:00:00Z', { closes: [40, 41, 42] }), merged(96, '2026-11-12T10:00:00Z', { closes: [999] })];
  const out = reconcileMerged(entries, list, START);

  test('is read as merged, and listed as drift against the merged PR', () => {
    expect(out.issues['40']!.status).toBe('merged');
    expect(out.drift).toEqual([{ issue: 40, pr: 95, title: 'no PR linked', queue: 'ready', forge: 'merged' }]);
  });

  test('is not counted a second time as a merged PR no entry names', () => {
    expect(out.mergedOnly.map((p) => p.number)).toEqual([96]);
  });

  test('an entry that already reads done is matched without drift, and an entry with its own PR is left alone', () => {
    expect(out.issues['41']).toBe(entries['41']!);
    expect(out.issues['42']).toBe(entries['42']!);
  });

  test('a merged PR before the campaign start still belongs to the entry that names it', () => {
    const r = reconcileMerged(entries, [merged(95, '2026-11-01T09:00:00Z', { closes: [40] })], START);
    expect(r.drift.map((d) => d.issue)).toEqual([40]);
    expect(r.mergedOnly).toEqual([]);
  });
});

describe('the campaign scope labels bound the merged PRs without an entry', () => {
  const list = [
    merged(60, '2026-11-12T09:00:00Z', { labels: ['campaign', 'bug'] }),
    merged(61, '2026-11-12T10:00:00Z', { labels: ['bug'] }),
    merged(62, '2026-11-12T11:00:00Z'),
  ];

  test('a PR missing a scope label is not the campaign work; a PR whose labels are unknown is kept', () => {
    expect(reconcileMerged({}, list, START, { labels: ['campaign'] }).mergedOnly.map((p) => p.number)).toEqual([60, 62]);
  });

  test('no scope labels means no filter, and the milestone is not applied because a PR row carries none', () => {
    expect(reconcileMerged({}, list, START, { milestone: 'v2' }).mergedOnly.map((p) => p.number)).toEqual([60, 61, 62]);
  });

  test('a PR a queue entry names is drift whatever its labels', () => {
    const r = reconcileMerged({ '9': { title: 't', status: 'in-flight', pr: 61 } }, list, START, { labels: ['campaign'] });
    expect(r.drift.map((d) => d.pr)).toEqual([61]);
  });
});

describe('a merged list that was not read', () => {
  test('changes nothing and claims nothing', () => {
    const r = reconcileMerged(issues, null, START);
    expect(r.issues).toBe(issues);
    expect(r.drift).toEqual([]);
    expect(r.mergedOnly).toEqual([]);
  });
});

describe('drift on the page header', () => {
  const drift = [
    { issue: 1, pr: 11, title: 'a', queue: 'in-flight', forge: 'merged' as const },
    { issue: 2, pr: 12, title: 'b', queue: 'ready', forge: 'merged' as const },
  ];

  test('drift is a warning line next to the checkpoint blockers, saying the next sync fixes it', () => {
    const out = buildBlockers('## Blocking the run\n\n- Vendor SDK is not out\n', [], [], true, drift);
    expect(out).toEqual([
      { text: 'Vendor SDK is not out', tone: '', source: 'checkpoint' },
      { text: '2 queue entries say less than the forge: #11, #12 are merged there. Sync the queue to update them', tone: 'warn', source: 'generated' },
    ]);
  });

  test('no drift adds no line', () => {
    expect(buildBlockers('## Blocking the run\n\n- Vendor SDK is not out\n', [], [], true, [])).toHaveLength(1);
  });
});
