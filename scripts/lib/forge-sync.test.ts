import { describe, expect, test } from 'bun:test';
import type { ForgeIssue, ForgePr } from './forge-adapter/types.ts';
import { syncQueue } from './forge-sync.ts';

const NOW = '2026-11-17T12:00:00.000Z';
const issue = (number: number, extra: Partial<ForgeIssue> = {}): ForgeIssue => ({
  number,
  title: `Issue ${number}`,
  body: '',
  labels: [],
  milestone: null,
  state: 'OPEN',
  ...extra,
});
const pr = (number: number, extra: Partial<ForgePr> = {}): ForgePr => ({
  number,
  title: `PR ${number}`,
  body: '',
  headRefName: `branch-${number}`,
  state: 'OPEN',
  mergedAt: null,
  ...extra,
});
const sync = (over: Partial<Parameters<typeof syncQueue>[0]> = {}) =>
  syncQueue({ queue: null, issues: [], prs: [], scope: {}, config: {}, now: NOW, ...over });

describe('syncQueue — ingest', () => {
  test('a fresh queue ingests every open in-scope issue as ready/handle, with deps, epic, size, labels and milestone', () => {
    const r = sync({
      issues: [
        issue(7, { body: 'Do it.\nBlocked by #5\nPart of #2', labels: [{ name: 'size:s' }, { name: 'bug' }], milestone: { title: 'v1' } }),
        issue(5),
      ],
      config: { default_touch_paths: ['src/**'] },
    });
    expect(r.added).toEqual([5, 7]);
    expect(r.queue.refreshed_at).toBe(NOW);
    expect(r.queue.campaign_started_at).toBe(NOW);
    expect(r.queue.issues?.['7']).toEqual({
      title: 'Issue 7',
      phase: 'handle',
      status: 'ready',
      depends_on: [5],
      blocks: [],
      worktree: null,
      pr: null,
      migration_slot: false,
      touch_paths: ['src/**'],
      size: 's',
      labels: ['size:s', 'bug'],
      milestone: 'v1',
      epic_parent: 2,
      notes: 'auto-sync ingest',
    });
  });

  test('out-of-scope open issues are not ingested; closed issues never are', () => {
    const r = sync({
      issues: [issue(1, { milestone: { title: 'v1' } }), issue(2, { milestone: { title: 'v2' } }), issue(3, { milestone: { title: 'v1' }, state: 'CLOSED' })],
      scope: { milestone: 'v1' },
    });
    expect(Object.keys(r.queue.issues ?? {})).toEqual(['1']);
  });

  test('a custom size label prefix is read', () => {
    expect(sync({ issues: [issue(1, { labels: [{ name: 'sz/m' }] })], config: { size_label_prefix: 'sz/' } }).queue.issues?.['1'].size).toBe('m');
  });
});

describe('syncQueue — reconcile', () => {
  const queue = {
    refreshed_at: '2026-11-01T00:00:00.000Z',
    campaign_started_at: '2026-11-01T00:00:00.000Z',
    issues: {
      '1': { title: 'old title', phase: 'implement', status: 'in-flight', depends_on: [9], pr: null, notes: 'worker on it' },
      '2': { title: 'two', phase: 'handle', status: 'ready', pr: null },
      '3': { title: 'three', phase: 'review', status: 'in-flight', pr: 30 },
      '4': { title: 'out of scope now', phase: 'handle', status: 'blocked', pr: null },
    },
  };

  test('title, labels, milestone refresh; deps from the body join the queue ones; in-flight stays in flight', () => {
    const r = sync({ queue, issues: [issue(1, { title: 'new title', body: 'Depends on #2', labels: [{ name: 'x' }] }), issue(2), issue(3), issue(4)] });
    expect(r.queue.issues?.['1']).toMatchObject({ title: 'new title', status: 'in-flight', phase: 'implement', depends_on: [9, 2], labels: ['x'], milestone: null, notes: 'worker on it' });
    expect(r.queue.campaign_started_at).toBe('2026-11-01T00:00:00.000Z');
    expect(r.added).toEqual([]);
  });

  test('an open PR closing the issue links it and moves implement to review', () => {
    const r = sync({ queue, issues: [issue(1), issue(2), issue(3), issue(4)], prs: [pr(11, { body: 'Closes #1' }), pr(12, { headRefName: 'blackhole/issue-2-thing' })] });
    expect(r.queue.issues?.['1']).toMatchObject({ pr: 11, phase: 'review', status: 'in-flight' });
    expect(r.queue.issues?.['2']).toMatchObject({ pr: 12, phase: 'handle' });
    expect(r.linked).toEqual([1, 2]);
  });

  test('a merged PR marks its issue merged/done; a closed issue with no merged PR is closed/done', () => {
    const r = sync({
      queue,
      issues: [issue(1), issue(2, { state: 'CLOSED' }), issue(3, { state: 'CLOSED' }), issue(4)],
      prs: [pr(30, { state: 'MERGED', mergedAt: '2026-11-16T00:00:00Z', body: 'Fixes #3' })],
    });
    expect(r.queue.issues?.['3']).toMatchObject({ status: 'merged', phase: 'done', pr: 30 });
    expect(r.queue.issues?.['2']).toMatchObject({ status: 'closed', phase: 'done' });
    expect(r.closed).toEqual([2, 3]);
  });

  test('a queue entry the forge did not list is kept as is, never dropped', () => {
    const r = sync({ queue, issues: [issue(1)] });
    expect(Object.keys(r.queue.issues ?? {}).sort()).toEqual(['1', '2', '3', '4']);
    expect(r.queue.issues?.['4']).toEqual(queue.issues['4']);
  });

  test('the input queue is not mutated', () => {
    const before = JSON.stringify(queue);
    sync({ queue, issues: [issue(1, { title: 'changed' }), issue(5)], prs: [pr(11, { body: 'Closes #1' })] });
    expect(JSON.stringify(queue)).toBe(before);
  });

  test('a done entry stays done even when its issue is reopened open on the forge', () => {
    const done = { issues: { '6': { title: 'six', phase: 'done', status: 'merged', pr: 60 } } };
    expect(sync({ queue: done, issues: [issue(6)] }).queue.issues?.['6']).toMatchObject({ status: 'merged', phase: 'done' });
  });
});
