import { describe, expect, test } from 'bun:test';
import { buildBoard, buildMoves, buildStreams, cardTitle, DEFAULT_STREAM, prPlacement, stageCounts, streamOf, type BoardInput } from './board.ts';
import type { PrSignal, QueueIssue } from './types.ts';

const sig = (over: Partial<PrSignal> = {}): PrSignal => ({ review: null, review_read: true, ci: 'green', failing: [], mergeable: true, ...over });

describe('prPlacement — a PR card from the forge signal', () => {
  const plain = { delivered: false, phase: 'review' };

  test('a conflict or failing CI blocks the PR, in red, whatever the review says', () => {
    expect(prPlacement(sig({ review: 'LGTM', mergeable: false }), plain)).toEqual({ stage: 'blocked', status: 'conflict with its base', tone: 'bad' });
    expect(prPlacement(sig({ ci: 'failing', failing: ['lint', 'unit tests', 'e2e'] }), plain)).toEqual({ stage: 'blocked', status: 'CI failing: lint, unit tests', tone: 'bad' });
  });

  test('LGTM with green CI is ready to merge; a held PR says it is held, in orange', () => {
    expect(prPlacement(sig({ review: 'LGTM' }), plain)).toEqual({ stage: 'ready', status: 'LGTM, CI green: merge', tone: 'ok' });
    expect(prPlacement(sig({ review: 'LGTM' }), { ...plain, heldFor: 'workflows' })).toEqual({
      stage: 'ready', status: 'LGTM, CI green: held for you (workflows)', tone: 'warn',
    });
  });

  test('a delivered-at-LGTM queue marker counts as LGTM when the PR carries no review label', () => {
    expect(prPlacement(sig(), { ...plain, delivered: true }).stage).toBe('ready');
  });

  test('review stages: CI running, changes requested, reviewer errored, waiting', () => {
    expect(prPlacement(sig({ review: 'LGTM', ci: 'running' }), plain)).toMatchObject({ stage: 'review', status: 'LGTM, CI running', tone: 'ok' });
    expect(prPlacement(sig({ review: 'NEEDS_CHANGES' }), plain)).toMatchObject({ stage: 'review', status: 'changes requested' });
    expect(prPlacement(sig({ review: 'ERROR' }), plain)).toMatchObject({ stage: 'review', tone: 'bad' });
    expect(prPlacement(sig({ ci: 'none' }), plain)).toMatchObject({ stage: 'review', status: 'waiting for review' });
  });

  test('an unread CI says "CI not checked" and never claims green or no CI', () => {
    expect(prPlacement(sig({ ci: 'unknown', review: 'LGTM' }), plain)).toEqual({ stage: 'review', status: 'LGTM, CI not checked', tone: 'ok' });
    expect(prPlacement(sig({ ci: 'unknown' }), { ...plain, delivered: true })).toEqual({ stage: 'ready', status: 'LGTM: merge · CI not checked', tone: 'ok' });
    expect(prPlacement(sig({ ci: 'unknown' }), plain)).toEqual({ stage: 'review', status: 'waiting for review, CI not checked', tone: '' });
  });

  test('an unread review says "review not checked" and never "waiting for review"', () => {
    expect(prPlacement(sig({ review_read: false }), plain)).toEqual({ stage: 'review', status: 'review not checked', tone: '' });
    expect(prPlacement(sig({ review_read: false, ci: 'running' }), plain).status).toBe('review not checked, CI running');
    expect(prPlacement(sig({ review_read: false, ci: 'unknown' }), plain).status).toBe('review not checked, CI not checked');
  });

  test('a known conflict or failing CI still blocks when the other read failed', () => {
    expect(prPlacement(sig({ review_read: false, ci: 'failing', failing: ['unit'] }), plain).stage).toBe('blocked');
    expect(prPlacement(sig({ ci: 'unknown', mergeable: false }), plain).stage).toBe('blocked');
  });

  test('without a signal it never guesses: the card says CI was not checked', () => {
    expect(prPlacement(undefined, { delivered: true })).toEqual({ stage: 'ready', status: 'LGTM: merge · CI not checked', tone: 'ok' });
    expect(prPlacement(undefined, { delivered: false, phase: 'review', reviewIteration: 2 })).toEqual({
      stage: 'review', status: 'in review (round 2) · CI not checked', tone: '',
    });
    expect(prPlacement(undefined, { delivered: false, phase: 'implement' }).status).toBe('implementing · CI not checked');
  });
});

const ISSUES: Record<string, QueueIssue> = {
  '1': { title: 'feat(ui): new header', status: 'merged', pr: 11, labels: ['stream:UI'] },
  '2': { title: 'Gate me', status: 'blocked', phase: 'plan', notes: 'awaiting-plan-approval' },
  '3': { title: 'Ship it', status: 'in-flight', phase: 'review', pr: 13, notes: 'delivered-at-LGTM (leave-open)', labels: ['stream:UI'] },
  '4': { title: 'Working', status: 'in-flight', phase: 'implement' },
  '5': { title: 'Waits', status: 'blocked', phase: 'handle', depends_on: [4] },
  '6': { title: 'Later', status: 'ready', phase: 'handle' },
  '7': { title: 'Parked one', status: 'ready', phase: 'handle' },
  '8': { title: 'Odd', status: 'in-review' },
  '9': { title: 'Conflicted', status: 'blocked', phase: 'implement', notes: 'merge-conflict: src/a.ts' },
};

function input(over: Partial<BoardInput> = {}): BoardInput {
  return {
    issues: ISSUES,
    readyToMerge: [{ issue: 3, title: 'Ship it', phase: 'review', status: 'in-flight', pr: 13, notes: null, next_step: '', pr_url: 'https://github.com/acme/widgets/pull/13' }],
    ownerItems: [{ issue: 2, title: 'Gate me', phase: 'plan', status: 'blocked', pr: null, notes: 'awaiting-plan-approval', next_step: '', detail: 'Owner: approve the plan' }],
    mergeConflicts: new Set([9]),
    untrackedPrs: [{ pr: 40, title: 'chore(deps): bump a library' }],
    scope: [{ kind: 'parked', text: 'Parked work', set_at: '2026-11-12', reason: 'not ours', refs: [7] }],
    signals: { 13: sig({ review: 'LGTM' }), 40: sig({ ci: 'running' }) },
    streams: { from: 'label' },
    prUrl: (n) => `https://github.com/acme/widgets/pull/${n}`,
    issueUrl: (n) => `https://github.com/acme/widgets/issues/${n}`,
    ...over,
  };
}

describe('buildBoard — one card per queue entry and untracked PR', () => {
  const board = buildBoard(input());
  const card = (ref: number) => board.find((c) => c.ref === ref)!;

  test('each entry lands in the stage its queue state, scope and PR signal say', () => {
    expect(card(11)).toMatchObject({ stage: 'done', kind: 'pr', issue: 1, tone: 'ok', url: 'https://github.com/acme/widgets/pull/11' });
    expect(card(2)).toMatchObject({ stage: 'you', status: 'Owner: approve the plan', tone: 'warn', url: 'https://github.com/acme/widgets/issues/2' });
    expect(card(13)).toMatchObject({ stage: 'ready', status: 'LGTM, CI green: merge' });
    expect(card(4)).toMatchObject({ stage: 'active', status: 'implementing, no PR yet' });
    expect(card(5)).toMatchObject({ stage: 'blocked', status: 'waits for #4', tone: '' });
    expect(card(6)).toMatchObject({ stage: 'todo', status: '' });
    expect(card(7)).toMatchObject({ stage: 'parked', status: 'parked: not ours' });
    expect(card(8)).toMatchObject({ stage: 'blocked', status: 'unknown queue status "in-review"', tone: 'bad' });
    expect(card(9)).toMatchObject({ stage: 'blocked', status: 'merge-conflict: src/a.ts', tone: 'bad' });
    expect(card(40)).toMatchObject({ stage: 'review', kind: 'pr', issue: null, title: 'Bump a library', status: 'waiting for review, CI running' });
  });

  test('sorted by stage, worst tone first, then newest', () => {
    expect(board.map((c) => c.stage)).toEqual(['ready', 'review', 'active', 'blocked', 'blocked', 'blocked', 'you', 'todo', 'parked', 'done']);
    expect(board.filter((c) => c.stage === 'blocked').map((c) => c.ref)).toEqual([9, 8, 5]);
  });

  test('a blocked-upstream scope entry puts its item in blocked, not parked', () => {
    const b = buildBoard(input({ scope: [{ kind: 'blocked_upstream', text: 'Vendor', set_at: '2026-11-12', refs: [6] }] }));
    expect(b.find((c) => c.ref === 6)).toMatchObject({ stage: 'blocked', status: 'blocked upstream' });
  });

  test('offline: no untracked PRs, and PR cards say not checked', () => {
    const b = buildBoard(input({ signals: null, untrackedPrs: null }));
    expect(b.some((c) => c.ref === 40)).toBe(false);
    expect(b.find((c) => c.ref === 13)?.status).toBe('LGTM: merge · CI not checked');
  });

  test('moves: the delivered PR, then the owner gate; counts fold stages into five columns', () => {
    const moves = buildMoves(board, new Set([3]));
    expect(moves.map((m) => m.ref)).toEqual([13, 2]);
    expect(moves[0]).toEqual({ text: 'Merge #13: Ship it', url: 'https://github.com/acme/widgets/pull/13', ref: 13 });
    expect(moves[1].text).toBe('Approve the plan: #2 Gate me');
    expect(stageCounts(board, moves.length)).toEqual({ done: 1, in_review: 3, on_you: 2, blocked: 3, parked: 1, not_started: 2, total: 10 });
  });
});

describe('streams — mapped from labels, milestone or epic, with overrides and one default', () => {
  const issues: Record<string, QueueIssue> = {
    '1': { title: 'Epic: billing', labels: ['stream:Billing'], milestone: 'v2' },
    '2': { title: 'child', labels: ['area:x'], milestone: 'v2', epic_parent: 1 },
    '3': { title: 'loose' },
  };

  test('no stream config puts everything in one default stream', () => {
    expect(streamOf(undefined, issues, 1, null)).toBe(DEFAULT_STREAM);
    expect(streamOf(undefined, issues, null, 99)).toBe(DEFAULT_STREAM);
  });

  test('label, milestone and epic sources', () => {
    expect(streamOf({ from: 'label' }, issues, 1, null)).toBe('Billing');
    expect(streamOf({ from: 'label', label_prefix: 'area:' }, issues, 2, null)).toBe('x');
    expect(streamOf({ from: 'milestone' }, issues, 2, null)).toBe('v2');
    expect(streamOf({ from: 'epic' }, issues, 2, null)).toBe('Epic: billing');
    expect(streamOf({ from: 'label', default: 'Other' }, issues, 3, null)).toBe('Other');
  });

  test('an override by issue or PR number wins over the source', () => {
    expect(streamOf({ from: 'label', overrides: { '1': 'Core' } }, issues, 1, null)).toBe('Core');
    expect(streamOf({ from: 'label', overrides: { '77': 'Deps' } }, issues, null, 77)).toBe('Deps');
  });

  test('stream rows count done, in review and left, and name the next card; the default stream is last', () => {
    const rows = buildStreams(buildBoard(input()));
    expect(rows.map((r) => r.stream)).toEqual(['UI', DEFAULT_STREAM]);
    expect(rows[0]).toEqual({ stream: 'UI', done: 1, in_review: 1, left: 0, next: '#13 LGTM, CI green: merge' });
    expect(rows[1]).toMatchObject({ done: 0, in_review: 2, left: 5 });
  });
});

test('cardTitle drops a conventional-commit prefix and clips long titles', () => {
  expect(cardTitle('fix(api)!: handle empty bodies')).toBe('Handle empty bodies');
  expect(cardTitle('x'.repeat(100))).toHaveLength(70);
});

describe('merged pull requests and queue drift on the board', () => {
  const base = (over: Partial<BoardInput> = {}): BoardInput => ({
    issues: {},
    readyToMerge: [],
    ownerItems: [],
    mergeConflicts: new Set(),
    untrackedPrs: [],
    scope: [],
    signals: null,
    prUrl: (n) => `https://forge.example/acme/widgets/pulls/${n}`,
    issueUrl: (n) => `https://forge.example/acme/widgets/issues/${n}`,
    ...over,
  });

  test('a merged PR no queue entry names is a done card in its stream', () => {
    const board = buildBoard(base({ mergedPrs: [{ number: 60, title: 'fix(api): handle empty input', mergedAt: '2026-11-12T08:00:00Z' }], streams: { overrides: { '60': 'Fixes' } } }));
    expect(board).toEqual([
      {
        stage: 'done', status: '', tone: 'ok', ref: 60, kind: 'pr', issue: null, pr: 60,
        title: 'Handle empty input', url: 'https://forge.example/acme/widgets/pulls/60', stream: 'Fixes',
      },
    ]);
  });

  test('merged PRs raise the done count of their workstream, next to the queue entries', () => {
    const board = buildBoard(
      base({
        issues: { '1': { title: 'feat(ui): header', status: 'merged', pr: 11 }, '2': { title: 'Later', status: 'ready', phase: 'handle' } },
        mergedPrs: [{ number: 60, title: 'a', mergedAt: '2026-11-12T08:00:00Z' }, { number: 61, title: 'b', mergedAt: '2026-11-12T09:00:00Z' }],
      }),
    );
    expect(buildStreams(board)).toEqual([{ stream: DEFAULT_STREAM, done: 3, in_review: 0, left: 1, next: '#2 not started' }]);
    expect(stageCounts(board, 0)).toMatchObject({ done: 3, not_started: 1, total: 4 });
  });

  test('a queue entry the forge merged shows as done, saying what the queue said', () => {
    const board = buildBoard(
      base({
        issues: { '5': { title: 'Refund fee', status: 'merged', phase: 'review', pr: 25 } },
        drift: [{ issue: 5, pr: 25, title: 'Refund fee', queue: 'in-flight', forge: 'merged' }],
      }),
    );
    expect(board[0]).toMatchObject({ stage: 'done', tone: 'ok', status: 'merged on the forge; queue said in-flight', ref: 25, issue: 5 });
  });

  test('a done entry the queue and the forge agree on carries no drift text', () => {
    expect(buildBoard(base({ issues: { '5': { title: 'x', status: 'merged', pr: 25 } } }))[0]!.status).toBe('');
  });
});
