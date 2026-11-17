import { describe, expect, test } from 'bun:test';
import { formatMergeNextItem, mergeNextOrder, trunkFixIssues } from './merge-next.ts';

describe('mergeNextOrder', () => {
  test('mixed forest: CI-fix PRs first, then parents, then children, each with a named blocker', () => {
    const issues = {
      '1': { status: 'in-flight', pr: 101 },
      '2': { status: 'in-flight', pr: 102, stacked_on: 1 },
      '3': { status: 'in-flight', pr: 103, stacked_on_pr: 102 },
      '4': { status: 'in-flight', pr: 104 },
      '5': { status: 'in-flight', pr: 105, depends_on: [4] },
      '6': { status: 'in-flight', pr: 106 },
      '7': { status: 'merged', pr: 107 },
      '8': { status: 'in-flight', pr: 108, stacked_on: 7 },
      '9': { status: 'ready' },
    };
    const { items, cycles } = mergeNextOrder(issues, [6]);
    expect(cycles).toEqual([]);
    expect(items.map((i) => [i.issue, i.kind])).toEqual([
      [6, 'ci-fix'],
      [1, 'parent'],
      [4, 'parent'],
      [8, 'parent'],
      [2, 'child'],
      [5, 'child'],
      [3, 'child'],
    ]);
    const blocker = (n: number) => items.find((i) => i.issue === n)!.blocker;
    expect(blocker(6)).toBe('none — CI fix, merge first');
    expect(blocker(1)).toBe('after CI fix #6');
    expect(blocker(2)).toBe('waits on #1 (stacked on)');
    expect(blocker(3)).toBe('waits on #2 (stacked on)');
    expect(blocker(5)).toBe('waits on #4 (depends on)');
    expect(items.find((i) => i.issue === 3)!.pr).toBe(103);
  });

  test('no CI fix: a root has no blocker; a blocked status and an unmerged non-PR dependency are named', () => {
    const issues = {
      '1': { status: 'in-flight', pr: 11 },
      '2': { status: 'blocked', pr: 12, notes: 'owner gate' },
      '3': { status: 'in-flight', pr: 13, depends_on: [9, 10, 11] },
      '9': { status: 'in-flight' },
      '10': { status: 'merged' },
    };
    const { items } = mergeNextOrder(issues, []);
    expect(items.map((i) => [i.issue, i.blocker])).toEqual([
      [1, 'none'],
      [2, 'blocked: owner gate'],
      [3, 'waits on #9 (depends on, no PR yet); waits on #11 (depends on, not in queue)'],
    ]);
  });

  test('a stack cycle is reported once and never looped; its descendants still get an order', () => {
    const issues = {
      '1': { status: 'in-flight', pr: 11, stacked_on: 2 },
      '2': { status: 'in-flight', pr: 12, stacked_on: 1 },
      '3': { status: 'in-flight', pr: 13, stacked_on: 2 },
      '4': { status: 'in-flight', pr: 14 },
    };
    const { items, cycles } = mergeNextOrder(issues, []);
    expect(cycles).toEqual([[1, 2]]);
    expect(items.map((i) => i.issue)).toEqual([4, 3]);
    expect(items.find((i) => i.issue === 3)!.blocker).toBe('waits on #2 (stacked on)');
  });

  test('a self-stacked issue is a cycle', () => {
    expect(mergeNextOrder({ '5': { status: 'in-flight', pr: 55, stacked_on: 5 } }, []).cycles).toEqual([[5]]);
  });

  test('a CI fix stacked on another PR still waits for its parent', () => {
    const issues = {
      '1': { status: 'in-flight', pr: 11 },
      '2': { status: 'in-flight', pr: 12, stacked_on: 1 },
    };
    const { items } = mergeNextOrder(issues, [2]);
    expect(items.map((i) => [i.issue, i.kind, i.blocker])).toEqual([
      [1, 'parent', 'none'],
      [2, 'ci-fix', 'waits on #1 (stacked on)'],
    ]);
  });
});

describe('trunkFixIssues', () => {
  test('collects the base-fix issue each waiting-on-trunk-fix note names, once, ascending', () => {
    const issues = {
      '1': { status: 'blocked', pr: 11, notes: 'waiting-on-trunk-fix #9' },
      '2': { status: 'blocked', pr: 12, notes: 'overlap with #3; waiting-on-trunk-fix #9' },
      '3': { status: 'blocked', pr: 13, notes: 'waiting-on-trunk-fix #4' },
      '4': { status: 'in-flight', pr: 14 },
      '5': { status: 'blocked', pr: 15, notes: 'waiting-on-trunk-fix' },
      '6': { status: 'blocked', pr: 16, notes: 'overlap with #9' },
      '9': { status: 'in-flight', pr: 19 },
    };
    expect(trunkFixIssues(issues)).toEqual([4, 9]);
  });
});

describe('mergeNextOrder — trunk red', () => {
  test('the base-fix PR merges first and is named as the blocker of every PR waiting on it', () => {
    const issues = {
      '1': { status: 'blocked', pr: 11, notes: 'waiting-on-trunk-fix #7' },
      '2': { status: 'blocked', pr: 12, notes: 'waiting-on-trunk-fix #7' },
      '3': { status: 'in-flight', pr: 13 },
      '7': { status: 'in-flight', pr: 17 },
    };
    const { items } = mergeNextOrder(issues, trunkFixIssues(issues));
    expect(items.map((i) => [i.issue, i.kind, i.blocker])).toEqual([
      [7, 'ci-fix', 'none — CI fix, merge first'],
      [3, 'parent', 'after CI fix #7'],
      [1, 'child', 'waits on #7 (trunk fix)'],
      [2, 'child', 'waits on #7 (trunk fix)'],
    ]);
  });

  test('once the base fix has merged, a child still parked shows its blocked note', () => {
    const issues = {
      '1': { status: 'blocked', pr: 11, notes: 'waiting-on-trunk-fix #7' },
      '7': { status: 'merged', pr: 17 },
    };
    const { items } = mergeNextOrder(issues, trunkFixIssues(issues));
    expect(items.map((i) => [i.issue, i.kind, i.blocker])).toEqual([[1, 'parent', 'blocked: waiting-on-trunk-fix #7']]);
  });
});

describe('formatMergeNextItem', () => {
  test('names the issue, its PR and the blocker', () => {
    expect(formatMergeNextItem({ issue: 2, pr: 12, kind: 'child', blocker: 'waits on #1 (stacked on)' })).toBe(
      '#2 (PR #12) — waits on #1 (stacked on)',
    );
  });
});
