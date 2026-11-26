import { describe, expect, test } from 'bun:test';
import type { QueueIssue } from './campaign-status/types.ts';
import { orderIssues, orderReady, selectBatch, unscoredIn, waveOf } from './pareto-order.ts';

const p = (gain: number, effort: number) => ({ gain, effort, priority: gain * (11 - effort) });
const ready = (extra: QueueIssue = {}): QueueIssue => ({ status: 'ready', ...extra });
// priority 48 = (8,5); 70 = (10,4) = (7,1), so #2, #3 and #5 tie on priority and differ on effort.
const fixture = (): Record<string, QueueIssue> => ({
  '1': ready({ pareto: p(8, 5) }),
  '2': ready({ pareto: p(10, 4) }),
  '3': ready({ pareto: p(7, 1) }),
  '4': ready(),
  '5': ready({ pareto: p(7, 1) }),
  '6': ready({ pareto: p(10, 1), depends_on: [1] }),
});

describe('waveOf', () => {
  test('no deps is wave 0; an unmet dep adds a wave; a merged or closed dep does not', () => {
    const issues = {
      '1': { status: 'in-flight' },
      '2': ready({ depends_on: [1] }),
      '3': ready({ depends_on: [2] }),
      '4': { status: 'merged' },
      '5': ready({ depends_on: [4] }),
      '6': ready({ depends_on: [1, 3] }),
    } as Record<string, QueueIssue>;
    const { waves, cycles } = waveOf(issues);
    expect(waves).toEqual({ 1: 0, 2: 1, 3: 2, 4: 0, 5: 0, 6: 3 });
    expect(cycles).toEqual([]);
  });
  test('a cycle terminates with a stable wave and is reported', () => {
    const issues = { '1': ready({ depends_on: [2] }), '2': ready({ depends_on: [1] }) } as Record<string, QueueIssue>;
    const first = waveOf(issues);
    expect(first.cycles).toEqual([1]); // the issue where the cycle closes
    expect(waveOf(issues).waves).toEqual(first.waves);
  });
});

describe('orderReady', () => {
  test('wave, then priority desc, then effort asc, then issue number; unscored last in its wave', () => {
    // 70s: #2 effort 4, #3 and #5 effort 1 -> effort asc puts 3,5 before 2; number asc breaks 3 vs 5.
    expect(orderReady(fixture())).toEqual([3, 5, 2, 1, 4, 6]);
  });
  test('only ready issues are ordered', () => {
    const issues = { ...fixture(), '3': { status: 'in-flight', pareto: p(10, 1) }, '5': { status: 'blocked' } } as Record<string, QueueIssue>;
    expect(orderReady(issues)).toEqual([2, 1, 4, 6]);
  });
  test('the stored priority is the key, not the label', () => {
    const issues = {
      '1': ready({ labels: ['pareto:P1'], pareto: p(2, 9) }),
      '2': ready({ labels: ['pareto:P4'], pareto: { gain: 9, effort: 1, priority: 90 } }),
    } as Record<string, QueueIssue>;
    expect(orderReady(issues)).toEqual([2, 1]);
  });
});

describe('selectBatch', () => {
  test('takes from the lowest wave only', () => {
    expect(selectBatch(fixture(), 2)).toEqual([3, 5]);
    expect(selectBatch(fixture(), 10)).toEqual([3, 5, 2, 1, 4]);
  });
  test('user_queue_order wins over Pareto, within the current wave', () => {
    expect(selectBatch(fixture(), 3, [2, 6])).toEqual([2, 3, 5]);
  });
  test('unpinned issues follow stored priority, not key order or number', () => {
    const issues = { '1': ready({ pareto: p(2, 9) }), '9': ready({ pareto: p(9, 1) }) } as Record<string, QueueIssue>;
    expect(selectBatch(issues, 1)).toEqual([9]);
    expect(selectBatch(issues, 2, [])).toEqual([9, 1]);
  });
  test('an empty user_queue_order gives exactly the Pareto order', () => {
    expect(selectBatch(fixture(), 10, [])).toEqual(orderReady(fixture()).filter((n) => n !== 6));
  });
  test('a pinned low-priority issue ranks first in its wave', () => {
    expect(selectBatch(fixture(), 2, [4])).toEqual([4, 3]);
  });
  test('a pin in a later wave does not leapfrog a lower-wave issue', () => {
    expect(selectBatch(fixture(), 1, [6])).toEqual([3]);
  });
  test('empty and non-positive limits', () => {
    expect(selectBatch({}, 4)).toEqual([]);
    expect(selectBatch(fixture(), 0)).toEqual([]);
  });
});

describe('orderIssues', () => {
  test('a pin moves an issue to the front of its own wave, never over a lower wave', () => {
    const all = () => true;
    expect(orderIssues(fixture(), all, [4, 6])).toEqual([4, 3, 5, 2, 1, 6]);
    expect(orderIssues(fixture(), all, [6])).toEqual([3, 5, 2, 1, 4, 6]);
  });
  test('pins order pinned issues by their position in user_queue_order', () => {
    expect(orderIssues(fixture(), (i) => i.status === 'ready', [5, 3]).slice(0, 2)).toEqual([5, 3]);
  });
  test('the include predicate selects the issues, whatever their status', () => {
    const issues = { '1': { status: 'blocked', pareto: p(1, 1) }, '2': { status: 'merged' } } as Record<string, QueueIssue>;
    expect(orderIssues(issues, (i) => i.status !== 'merged')).toEqual([1]);
  });
});

describe('unscoredIn', () => {
  test('lists the batch members with no stored score', () => {
    const issues = { '1': { status: 'ready', pareto: { gain: 8, effort: 5, priority: 48 } }, '2': { status: 'ready' }, '3': { status: 'ready' } } as never;
    expect(unscoredIn(issues, [1, 2, 3])).toEqual([2, 3]);
    expect(unscoredIn(issues, [1])).toEqual([]);
  });
});
