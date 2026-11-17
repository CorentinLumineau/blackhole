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
    const r = sync({ queue, issues: [issue(1), issue(2), issue(3), issue(4)], prs: [pr(11, { headRefName: 'claude/login', body: 'Closes #1' }), pr(12, { headRefName: 'blackhole/issue-2-thing' })] });
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
    sync({ queue, issues: [issue(1, { title: 'changed' }), issue(5)], prs: [pr(11, { headRefName: 'claude/x', body: 'Closes #1' })] });
    expect(JSON.stringify(queue)).toBe(before);
  });

  test('a done entry stays done even when its issue is reopened open on the forge', () => {
    const done = { issues: { '6': { title: 'six', phase: 'done', status: 'merged', pr: 60 } } };
    expect(sync({ queue: done, issues: [issue(6)] }).queue.issues?.['6']).toMatchObject({ status: 'merged', phase: 'done' });
  });
});

describe('syncQueue — another lane', () => {
  test('an issue labelled agent:cursor or in-progress:<other> is ingested blocked, never ready', () => {
    const r = sync({ issues: [issue(1, { labels: [{ name: 'agent:cursor' }] }), issue(2, { labels: [{ name: 'in-progress:cursor' }] }), issue(3, { labels: [{ name: 'in-progress:claude' }] })] });
    expect(r.queue.issues['1']).toMatchObject({ status: 'blocked', notes: 'another lane: agent:cursor' });
    expect(r.queue.issues['2']).toMatchObject({ status: 'blocked', notes: 'another lane: in-progress:cursor' });
    expect(r.queue.issues['3']).toMatchObject({ status: 'ready', notes: 'auto-sync ingest' });
  });

  test('an open PR from a foreign branch blocks its issue and is not linked as the campaign PR', () => {
    const r = sync({ issues: [issue(4)], prs: [pr(40, { headRefName: 'cursor/fix-4', body: 'Closes #4' })] });
    expect(r.queue.issues['4']).toMatchObject({ status: 'blocked', notes: 'another lane: cursor/fix-4', pr: null });
  });

  test('reconcile: a ready entry that gains a foreign label turns blocked, and turns ready again once the lane is gone', () => {
    const queue = { issues: { '5': { title: 'five', phase: 'handle', status: 'ready', pr: null } } };
    const blocked = sync({ queue, issues: [issue(5, { labels: [{ name: 'agent:cursor' }] })] }).queue;
    expect(blocked.issues['5']).toMatchObject({ status: 'blocked', notes: 'another lane: agent:cursor' });
    expect(sync({ queue: blocked, issues: [issue(5)] }).queue.issues['5']).toMatchObject({ status: 'ready', notes: null });
  });

  test('an in-flight entry is never taken over by the lane rule', () => {
    const queue = { issues: { '6': { title: 'six', phase: 'implement', status: 'in-flight', pr: null } } };
    expect(sync({ queue, issues: [issue(6, { labels: [{ name: 'agent:cursor' }] })] }).queue.issues['6']).toMatchObject({ status: 'in-flight' });
  });
});

describe('syncQueue — what a PR may claim', () => {
  test('a merged PR that names the issue only by branch (Part of #N) never marks it done', () => {
    const r = sync({ queue: { issues: { '1221': { title: 't', phase: 'review', status: 'in-flight', pr: 1236 } } }, issues: [issue(1221)], prs: [pr(1234, { state: 'MERGED', mergedAt: NOW, headRefName: 'blackhole/issue-1221-a', body: 'Part of #1221' })] });
    expect(r.queue.issues['1221']).toMatchObject({ status: 'in-flight', phase: 'review', pr: 1236 });
    expect(r.closed).toEqual([]);
  });

  test('the forge OPEN state wins over a merged closing PR', () => {
    const r = sync({ queue: { issues: { '7': { title: 't', phase: 'review', status: 'in-flight', pr: 70 } } }, issues: [issue(7)], prs: [pr(70, { state: 'MERGED', mergedAt: NOW, body: 'Closes #7' })] });
    expect(r.queue.issues['7']).toMatchObject({ status: 'in-flight' });
  });

  test('an open PR with a closing keyword is linked before a lower-numbered Part-of PR', () => {
    const r = sync({ issues: [issue(8)], prs: [pr(80, { headRefName: 'blackhole/issue-8-part1', body: 'Part of #8' }), pr(81, { headRefName: 'blackhole/issue-8-part2', body: 'Closes #8' })] });
    expect(r.queue.issues['8'].pr).toBe(81);
  });

  test('a dependency-blocked entry still gets its own open PR linked', () => {
    const queue = { issues: { '10': { title: 't', phase: 'handle', status: 'blocked', pr: null, depends_on: [1] } } };
    expect(sync({ queue, issues: [issue(10)], prs: [pr(100, { headRefName: 'blackhole/issue-10', body: 'Closes #10' })] }).queue.issues['10']).toMatchObject({ status: 'blocked', pr: 100 });
  });

  test('with no closing PR, the branch match links the PR', () => {
    expect(sync({ issues: [issue(9)], prs: [pr(90, { headRefName: 'blackhole/issue-9-x', body: 'Part of #9' })] }).queue.issues['9'].pr).toBe(90);
  });
});

describe('syncQueue — user_queue_order', () => {
  test('ingested issues are appended once, existing order kept', () => {
    const queue = { user_queue_order: [3, 1], issues: { '1': { title: 'a', phase: 'handle', status: 'ready' }, '3': { title: 'c', phase: 'handle', status: 'ready' } } };
    expect(sync({ queue, issues: [issue(1), issue(2), issue(3), issue(4)] }).queue.user_queue_order).toEqual([3, 1, 2, 4]);
    expect(sync({ issues: [issue(5)] }).queue.user_queue_order).toEqual([5]);
  });
});

describe('syncQueue — round 2: gates survive, own branches only', () => {
  const GATES = ['awaiting-user-clarification', 'awaiting-plan-approval', 'waiting-on-trunk-fix #12', 'overlap with #4', 'merge-conflict-semantic: parser.ts'];

  test('a blocked entry with a gate note keeps it through a foreign label coming and going', () => {
    for (const notes of GATES) {
      const queue = { issues: { '20': { title: 't', phase: 'plan', status: 'blocked', pr: null, notes } } };
      const during = sync({ queue, issues: [issue(20, { labels: [{ name: 'agent:cursor' }] })] }).queue;
      expect(during.issues['20']).toMatchObject({ status: 'blocked', notes });
      expect(sync({ queue: during, issues: [issue(20)] }).queue.issues['20']).toMatchObject({ status: 'blocked', notes });
    }
  });

  test('a note that only starts like a lane note is not promoted back', () => {
    const queue = { issues: { '21': { title: 't', phase: 'handle', status: 'blocked', pr: null, notes: 'another lane: agent:cursor — then owner: decide scope' } } };
    expect(sync({ queue, issues: [issue(21)] }).queue.issues['21']).toMatchObject({ status: 'blocked', notes: 'another lane: agent:cursor — then owner: decide scope' });
  });

  test('a fork patch-1 or an unprefixed human branch blocks the issue instead of linking', () => {
    for (const headRefName of ['patch-1', 'fix-x', 'feature/x']) {
      const r = sync({ issues: [issue(22)], prs: [pr(220, { headRefName, body: 'Fixes #22' })] });
      expect(r.queue.issues['22']).toMatchObject({ status: 'blocked', notes: `another lane: ${headRefName}`, pr: null });
    }
  });

  test('a bare issue-N branch is not the campaign\'s own and does not link by name', () => {
    const r = sync({ issues: [issue(23)], prs: [pr(230, { headRefName: 'issue-23-x', body: '' })] });
    expect(r.queue.issues['23']).toMatchObject({ status: 'ready', pr: null });
  });

  test('a renovate or dependabot PR closing the issue is noted as an open PR', () => {
    for (const headRefName of ['renovate/lodash-4.x', 'dependabot/npm_and_yarn/x-1.2']) {
      expect(sync({ issues: [issue(24)], prs: [pr(240, { headRefName, body: 'Closes #24' })] }).queue.issues['24']).toMatchObject({ status: 'blocked', notes: `open PR: ${headRefName}` });
    }
  });

  test('a lane note this sync wrote is promoted back once the PR closes', () => {
    const blocked = sync({ issues: [issue(25)], prs: [pr(250, { headRefName: 'patch-1', body: 'Closes #25' })] }).queue;
    expect(sync({ queue: blocked, issues: [issue(25)] }).queue.issues['25']).toMatchObject({ status: 'ready', notes: null });
  });
});


describe('syncQueue — lane ownership and the claim lease', () => {
  const nowMs = Date.parse(NOW);
  const ago = (h: number): string => new Date(nowMs - h * 3_600_000).toISOString();
  const withLabel = (n: number, label: string, extra: Partial<ForgeIssue> = {}) => issue(n, { labels: [{ name: label }], ...extra });
  const lane = { lane: 'acct-a' };

  test('under a lane only its own label is not foreign; the legacy pair is foreign', () => {
    const r = sync({ ...lane, issues: [withLabel(1, 'in-progress:acct-a'), withLabel(2, 'in-progress:acct-b'), withLabel(3, 'in-progress:claude'), withLabel(4, 'agent:cursor')] });
    expect(r.queue.issues['1']).toMatchObject({ status: 'ready' });
    expect(r.queue.issues['2']).toMatchObject({ status: 'blocked', notes: 'another lane: in-progress:acct-b' });
    expect(r.queue.issues['3']).toMatchObject({ status: 'blocked' });
    expect(r.queue.issues['4']).toMatchObject({ status: 'blocked' });
  });

  test('a claim stale past the lease is ignored; a fresh or untimed one holds', () => {
    const r = sync({ ...lane, issues: [withLabel(1, 'in-progress:acct-b', { updatedAt: ago(25) }), withLabel(2, 'in-progress:acct-b', { updatedAt: ago(23) }), withLabel(3, 'in-progress:acct-b')] });
    expect(r.queue.issues['1']).toMatchObject({ status: 'ready' });
    expect(r.queue.issues['2']).toMatchObject({ status: 'blocked' });
    expect(r.queue.issues['3']).toMatchObject({ status: 'blocked' });
  });

  test('the lease follows claimLeaseHours', () => {
    const r = sync({ ...lane, claimLeaseHours: 6, issues: [withLabel(1, 'in-progress:acct-b', { updatedAt: ago(7) })] });
    expect(r.queue.issues['1']).toMatchObject({ status: 'ready' });
  });

  test('an open PR closing the issue with recent activity keeps a stale claim held', () => {
    const r = sync({ ...lane, issues: [withLabel(1, 'in-progress:acct-b', { updatedAt: ago(30) })], prs: [pr(10, { headRefName: 'cursor/x', body: 'Closes #1', updatedAt: ago(1) })] });
    expect(r.queue.issues['1']).toMatchObject({ status: 'blocked' });
  });

  test('agent labels never lease', () => {
    const r = sync({ ...lane, issues: [withLabel(1, 'agent:cursor', { updatedAt: ago(48) })] });
    expect(r.queue.issues['1']).toMatchObject({ status: 'blocked' });
  });

  test('a stale label this sync once wrote goes back to ready', () => {
    const queue = { issues: { '1': { title: 't', phase: 'handle', status: 'blocked', pr: null, notes: 'another lane: in-progress:acct-b' } } };
    const r = sync({ ...lane, queue, issues: [withLabel(1, 'in-progress:acct-b', { updatedAt: ago(30) })] });
    expect(r.queue.issues['1']).toMatchObject({ status: 'ready', notes: null });
  });

  test('the own lane label makes a PR the campaign PR whatever its branch', () => {
    const r = sync({ ...lane, issues: [withLabel(9, 'in-progress:acct-a')], prs: [pr(90, { headRefName: 'foo/issue-9', body: 'Closes #9' })] });
    expect(r.queue.issues['9']).toMatchObject({ pr: 90 });
    expect(r.linked).toEqual([9]);
  });

  test('another lane label keeps a campaign-prefixed PR from being linked', () => {
    const r = sync({ ...lane, issues: [withLabel(9, 'in-progress:acct-b')], prs: [pr(90, { headRefName: 'blackhole/issue-9', body: 'Closes #9' })] });
    expect(r.queue.issues['9']).toMatchObject({ status: 'blocked', pr: null });
    expect(r.linked).toEqual([]);
  });

  test('with no lane label the branch prefix still decides', () => {
    const r = sync({ ...lane, issues: [issue(4), issue(5)], prs: [pr(40, { headRefName: 'blackhole/issue-4', body: 'Closes #4' }), pr(50, { headRefName: 'cursor/x', body: 'Closes #5' })] });
    expect(r.queue.issues['4']).toMatchObject({ pr: 40 });
    expect(r.queue.issues['5']).toMatchObject({ status: 'blocked', notes: 'another lane: cursor/x' });
  });
});
