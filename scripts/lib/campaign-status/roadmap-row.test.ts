import { describe, expect, test } from 'bun:test';
import { MAX_CONSEQUENCE_CHARS } from './launch-summary.ts';
import { rescoredCount, roadmapRow, ROADMAP_TOP } from './roadmap-row.ts';
import type { QueueIssue, QueueJson } from './types.ts';

const SYNC = '2026-11-26T09:00:00.000Z';
const BEFORE = '2026-11-25T09:00:00.000Z';
const AFTER = '2026-11-26T09:05:00.000Z';

const scored = (priority: number, effort: number, scored_at: string, extra: Partial<QueueIssue> = {}): QueueIssue => ({
  status: 'ready',
  pareto: { gain: Math.round(priority / (11 - effort)), effort, priority, scored_at },
  ...extra,
});
const queue = (issues: Record<string, QueueIssue>, refreshed_at: string | null = SYNC): QueueJson => ({ ...(refreshed_at ? { refreshed_at } : {}), issues });

describe('rescoredCount', () => {
  test('counts the scores written at or after the bootstrap sync, not earlier ones', () => {
    const q = queue({ '1': scored(56, 4, AFTER), '2': scored(40, 3, SYNC), '3': scored(30, 5, BEFORE), '4': { status: 'ready' } });
    expect(rescoredCount(q)).toBe(2);
  });

  test('is zero when the queue records no sync time, rather than counting every score', () => {
    expect(rescoredCount(queue({ '1': scored(56, 4, AFTER) }, null))).toBe(0);
  });

  test('ignores a score with no scored_at and one with an unparseable stamp', () => {
    const q = queue({ '1': { status: 'ready', pareto: { gain: 8, effort: 4, priority: 56 } }, '2': scored(56, 4, 'not-a-date') });
    expect(rescoredCount(q)).toBe(0);
  });
});

describe('roadmapRow', () => {
  test('lists the top five ready issues by wave, priority desc, effort asc, oldest', () => {
    const q = queue({
      '10': scored(30, 5, BEFORE),
      '11': scored(56, 4, AFTER),
      '12': scored(56, 2, BEFORE),
      '13': scored(56, 2, BEFORE),
      '14': scored(24, 6, BEFORE),
      '15': scored(80, 2, BEFORE),
      '16': scored(8, 9, BEFORE),
      '17': { status: 'merged', pareto: { gain: 9, effort: 1, priority: 90 } },
    });
    const row = roadmapRow(q);
    expect(row.key).toBe('roadmap');
    expect(row.label).toBe('Roadmap');
    expect(row.adjustable).toBe(false);
    expect(row.value).toBe('#15 P80 · #12 P56 · #13 P56 · #11 P56 · #10 P30 · 1 re-scored this run · 2 more ready');
  });

  test('puts an issue behind an unmet dependency after the wave-0 issues whatever its priority', () => {
    const q = queue({ '1': scored(10, 5, BEFORE), '2': scored(90, 1, BEFORE, { depends_on: [1] }) });
    expect(roadmapRow(q).value).toBe('#1 P10 · #2 P90 · 0 re-scored this run');
  });

  test('names an unscored ready issue instead of hiding it', () => {
    const q = queue({ '1': scored(56, 4, BEFORE), '2': { status: 'ready' } });
    expect(roadmapRow(q).value).toBe('#1 P56 · #2 unscored · 0 re-scored this run');
  });

  test('shows at most ROADMAP_TOP issues and counts the rest', () => {
    const issues = Object.fromEntries(Array.from({ length: 8 }, (_, i) => [String(i + 1), scored(50 - i, 4, BEFORE)]));
    const value = roadmapRow(queue(issues)).value;
    expect(ROADMAP_TOP).toBe(5);
    expect(value.match(/#\d+/g)).toHaveLength(ROADMAP_TOP);
    expect(value).toContain('3 more ready');
  });

  test('an empty ready set says so and still reports the re-score count', () => {
    const q = queue({ '1': { status: 'merged' }, '2': scored(56, 4, AFTER, { status: 'in-flight' }) });
    expect(roadmapRow(q).value).toBe('no ready issue · 1 re-scored this run');
  });

  test('a missing queue reads as empty', () => {
    expect(roadmapRow(undefined).value).toBe('no ready issue · 0 re-scored this run');
  });

  test('the consequence fits a card line', () => {
    expect(roadmapRow(queue({})).consequence.length).toBeLessThanOrEqual(MAX_CONSEQUENCE_CHARS);
  });
});
