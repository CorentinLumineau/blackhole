import { describe, expect, test } from 'bun:test';
import type { QueueIssue, QueueJson } from '../campaign-status/types.ts';
import { buildRoadmap, renderRoadmapBody } from './render.ts';

const p = (gain: number, effort: number, rationale?: string) => ({ gain, effort, priority: gain * (11 - effort), rationale });
const queue = (issues: Record<string, QueueIssue>, user_queue_order?: number[]): QueueJson => ({ issues, user_queue_order });

// #3 waits on #1; #4 waits on #3, so it is a wave later than #3. #6 needs the owner; #7 is merged.
const fixture = (): QueueJson =>
  queue({
    '1': { title: 'Base work', status: 'in-flight', labels: ['app:invest'], route: { task_type: 'feature' }, pareto: p(8, 3, 'unblocks two issues') },
    '2': { title: 'Quick win', status: 'ready', labels: ['app:voyage', 'kind:bug'], pareto: p(9, 1, 'one-line fix') },
    '3': { title: 'Follow-up', status: 'blocked', labels: ['app:invest'], depends_on: [1], pareto: p(10, 2) },
    '4': { title: 'Later piece', status: 'ready', depends_on: [3], pareto: p(5, 5, 'long\nrationale | with pipe') },
    '5': { title: 'Unscored', status: 'ready', labels: ['app:voyage'] },
    '6': { title: 'Pick a provider', status: 'blocked', notes: 'awaiting-user-clarification', labels: ['app:invest'], pareto: p(7, 2) },
    '7': { title: 'Done', status: 'merged', pareto: p(10, 1) },
  });

describe('buildRoadmap', () => {
  test('an issue never ranks above an open dependency, whatever its priority', () => {
    const rows = buildRoadmap(fixture()).rows;
    const rank = (n: number) => rows.findIndex((r) => r.issue === n);
    expect(rank(1)).toBeLessThan(rank(3));
    expect(rank(3)).toBeLessThan(rank(4));
    // #3 has the highest priority (80) yet follows #1 and the wave-0 ready issues.
    expect(rows.map((r) => r.issue)).toEqual([2, 1, 5, 3, 4]);
  });

  test('horizons follow the waves: Now is the first, Next the second, Later the rest', () => {
    const { now, next, later } = buildRoadmap(fixture());
    expect(now.map((r) => r.issue)).toEqual([2, 1, 5]);
    expect(next.map((r) => r.issue)).toEqual([3]);
    expect(later.map((r) => r.issue)).toEqual([4]);
  });

  test('owner-only issues leave the ranking and have no rank', () => {
    const model = buildRoadmap(fixture());
    expect(model.owner.map((r) => r.issue)).toEqual([6]);
    expect(model.rows.map((r) => r.issue)).not.toContain(6);
  });

  test('merged and closed issues, and cross-repo keys, are left out', () => {
    const model = buildRoadmap(queue({ ...fixture().issues, '8': { status: 'closed' }, 'other#9': { status: 'ready' } }));
    expect([...model.rows, ...model.owner].map((r) => r.issue)).not.toContain(7);
    expect([...model.rows, ...model.owner].map((r) => r.issue)).not.toContain(8);
    expect(model.rows).toHaveLength(5);
  });

  test('an owner pin ranks first inside its wave only', () => {
    const model = buildRoadmap(queue(fixture().issues, [5, 4]));
    expect(model.now.map((r) => r.issue)).toEqual([5, 2, 1]);
    expect(model.later.map((r) => r.issue)).toEqual([4]);
  });

  test('app, kind and why come from labels, route and the stored rationale', () => {
    const [two, one] = buildRoadmap(fixture()).rows;
    expect(two).toMatchObject({ issue: 2, app: 'voyage', kind: 'bug', gain: 9, effort: 1, priority: 90, why: 'one-line fix' });
    expect(one).toMatchObject({ issue: 1, app: 'invest', kind: 'feature' });
  });

  test('counts per app cover every open issue, the owner table included, "-" for none', () => {
    expect(buildRoadmap(fixture()).counts).toEqual([
      { app: '-', count: 1 },
      { app: 'invest', count: 3 },
      { app: 'voyage', count: 2 },
    ]);
  });
});

describe('owner-only detection', () => {
  const blocked = (notes: string | undefined, extra: QueueIssue = {}): QueueIssue => ({ title: 'T', status: 'blocked', notes, ...extra });
  const ownerOf = (issue: QueueIssue) => buildRoadmap(queue({ '1': issue })).owner;

  test('an awaiting-* token waits on that token', () => {
    expect(ownerOf(blocked('awaiting-user-clarification: which provider?'))[0]?.waitingFor).toBe('awaiting-user-clarification');
  });

  test('an escalated block waits on blocked-escalated', () => {
    expect(ownerOf(blocked('blocked-escalated: failed attempts'))[0]?.waitingFor).toBe('blocked-escalated');
  });

  test('free-text notes addressed to the owner are shown, flattened and truncated', () => {
    const prefixed = ownerOf(blocked('owner:   pick\n a provider'));
    expect(prefixed.map((r) => r.waitingFor)).toEqual(['owner: pick a provider']);
    expect(ownerOf(blocked('see decision card, needs-owner approval'))).toHaveLength(1);
    const long = ownerOf(blocked(`owner: ${'x'.repeat(200)}`))[0].waitingFor;
    expect(long).toHaveLength(120);
    expect(long.endsWith('…')).toBe(true);
  });

  test('a blocked issue whose notes do not address the owner stays in the ranking', () => {
    for (const notes of [undefined, '', 'merge-conflict-semantic on #3', 'overlap with #9', 'waiting for upstream release']) {
      const model = buildRoadmap(queue({ '1': blocked(notes) }));
      expect(model.owner).toEqual([]);
      expect(model.rows.map((r) => r.issue)).toEqual([1]);
    }
  });

  test('owner notes on an issue that is not blocked do not move it to the owner table', () => {
    const model = buildRoadmap(queue({ '1': { title: 'T', status: 'ready', notes: 'owner: look at this' } }));
    expect(model.owner).toEqual([]);
    expect(model.rows).toHaveLength(1);
  });
});

describe('row details', () => {
  test('a long title is cut to one line with an ellipsis', () => {
    const [row] = buildRoadmap(queue({ '1': { title: `${'word '.repeat(40)}end`, status: 'ready' } })).rows;
    expect(row.title).toHaveLength(120);
    expect(row.title.endsWith('…')).toBe(true);
  });

  test('a missing title renders as the bare issue number, a missing app as "-"', () => {
    const body = renderRoadmapBody(buildRoadmap(queue({ '1': { status: 'ready' } })));
    expect(body).toContain('| 1 | #1 | - | - | - | - | unscored | - | - |');
  });

  test('kind falls back to the route task type, dependencies sort ascending', () => {
    const [row] = buildRoadmap(queue({ '1': { status: 'ready', route: { task_type: 'refactor' }, depends_on: [9, 3] }, '3': { status: 'merged' }, '9': { status: 'merged' } })).rows;
    expect(row).toMatchObject({ kind: 'refactor', dependsOn: [3, 9] });
  });

  test('a third and later wave all land in Later', () => {
    const model = buildRoadmap(queue({ '1': { status: 'ready' }, '2': { status: 'ready', depends_on: [1] }, '3': { status: 'ready', depends_on: [2] }, '4': { status: 'ready', depends_on: [3] } }));
    expect(model.now.map((r) => r.issue)).toEqual([1]);
    expect(model.next.map((r) => r.issue)).toEqual([2]);
    expect(model.later.map((r) => r.issue)).toEqual([3, 4]);
  });

  test('an undefined queue is an empty roadmap', () => {
    expect(buildRoadmap(undefined)).toEqual({ rows: [], now: [], next: [], later: [], owner: [], counts: [] });
  });

  test('a pin for an issue outside the open set is ignored', () => {
    const model = buildRoadmap(queue({ '1': { status: 'ready' }, '2': { status: 'ready' } }, [99, 2]));
    expect(model.rows.map((r) => r.issue)).toEqual([2, 1]);
  });
});

describe('renderRoadmapBody', () => {
  test('snapshot: horizons, dependencies, owner table and counts', () => {
    expect(renderRoadmapBody(buildRoadmap(fixture()))).toBe(`# Roadmap

Generated by \`scripts/roadmap.ts\` from the campaign queue: do not edit by hand. Order: dependency wave, owner pins, priority, effort, oldest.

## Now

| Rank | Issue | App | Kind | Gain | Effort | Priority | Depends on | Why |
|---|---|---|---|---|---|---|---|---|
| 1 | #2 Quick win | voyage | bug | 9 | 1 | 90 | - | one-line fix |
| 2 | #1 Base work | invest | feature | 8 | 3 | 64 | - | unblocks two issues |
| 3 | #5 Unscored | voyage | - | - | - | unscored | - | - |

## Next

| Rank | Issue | App | Kind | Gain | Effort | Priority | Depends on | Why |
|---|---|---|---|---|---|---|---|---|
| 4 | #3 Follow-up | invest | - | 10 | 2 | 90 | #1 | - |

## Later

| Rank | Issue | App | Kind | Gain | Effort | Priority | Depends on | Why |
|---|---|---|---|---|---|---|---|---|
| 5 | #4 Later piece | - | - | 5 | 5 | 30 | #3 | long rationale \\| with pipe |

## Waiting on the owner

| Issue | App | Kind | Gain | Effort | Priority | Waiting for |
|---|---|---|---|---|---|---|
| #6 Pick a provider | invest | - | 7 | 2 | 63 | awaiting-user-clarification |

## Open issues per app

| App | Issues |
|---|---|
| - | 1 |
| invest | 3 |
| voyage | 2 |
`);
  });

  test('an empty queue still renders every section, each as "None."', () => {
    const body = renderRoadmapBody(buildRoadmap(queue({})));
    for (const heading of ['## Now', '## Next', '## Later', '## Waiting on the owner', '## Open issues per app']) {
      expect(body).toContain(`${heading}\n\nNone.\n`);
    }
  });

  test('the same queue renders the same bytes', () => {
    expect(renderRoadmapBody(buildRoadmap(fixture()))).toBe(renderRoadmapBody(buildRoadmap(fixture())));
  });
});
