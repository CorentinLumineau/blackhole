import { describe, expect, test } from 'bun:test';
import { buildBlockers } from './overview.ts';
import { reconcileMerged } from './merged.ts';
import type { MergedPr, QueueIssue } from './types.ts';

const START = '2026-11-10T08:00:00.000Z';
const merged = (number: number, mergedAt: string): MergedPr => ({ number, title: `PR ${number}`, mergedAt });

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
      { text: '2 queue entries say less than the forge: #11, #12 are merged there. The next sync updates them', tone: 'warn', source: 'generated' },
    ]);
  });

  test('no drift adds no line', () => {
    expect(buildBlockers('## Blocking the run\n\n- Vendor SDK is not out\n', [], [], true, [])).toHaveLength(1);
  });
});
