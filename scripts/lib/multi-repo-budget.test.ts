import { describe, expect, test } from 'bun:test';
import type { RateLimits } from './rate-limit-cache.ts';
import { allocateWorkers, type RepoCandidate } from './multi-repo-budget.ts';
import { DEFAULT_USAGE_BUDGET, workersAllowed, type UsageBudgetConfig } from './usage-budget.ts';

const NOW = 1_800_000_000;
const HOUR = 3600;
const budget: UsageBudgetConfig = { ...DEFAULT_USAGE_BUDGET, enabled: true };
const usage = (five: number): RateLimits => ({ five_hour: { used_percentage: five, resets_at: NOW + 4 * HOUR } });
const verdict = (five: number, maxWorkers: number) =>
  workersAllowed(usage(five), NOW, { ...budget, max_workers: maxWorkers }, 8);

const cands = (repo: string, n: number, priority = 10): RepoCandidate[] =>
  Array.from({ length: n }, () => ({ repo, bug: false, priority }));
const sum = (perRepo: Record<string, number>) => Object.values(perRepo).reduce((a, b) => a + b, 0);

describe('allocateWorkers across repos', () => {
  test('three repos share one verdict and never exceed it (issue 1372)', () => {
    const v = verdict(10, 2);
    const a = allocateWorkers(v, [...cands('a', 4), ...cands('b', 4), ...cands('c', 4)]);
    expect(v.workers).toBe(2);
    expect(a.total).toBe(2);
    expect(sum(a.perRepo)).toBe(a.total);
    expect(Object.keys(a.perRepo).sort()).toEqual(['a', 'b', 'c']);
  });

  test('a single-worker budget yields one worker in total', () => {
    const a = allocateWorkers(verdict(10, 1), [...cands('a', 3), ...cands('b', 3), ...cands('c', 3)]);
    expect(a.total).toBe(1);
  });

  test('a non-GO verdict allocates nothing and keeps its reason', () => {
    const v = verdict(90, 4);
    expect(v.verdict).toBe('STOP-WORKERS');
    const a = allocateWorkers(v, cands('a', 3));
    expect(a.total).toBe(0);
    expect(a.perRepo).toEqual({});
    expect(a.reasons).toEqual(v.reasons);
  });

  test('a bug in one repo outranks a higher-priority non-bug in another', () => {
    const a = allocateWorkers(verdict(10, 1), [
      { repo: 'a', bug: false, priority: 99 },
      { repo: 'b', bug: true, priority: 1 },
    ]);
    expect(a.perRepo).toEqual({ a: 0, b: 1 });
  });

  test('higher priority wins among equal kinds, input order breaks ties', () => {
    const a = allocateWorkers(verdict(10, 2), [
      { repo: 'a', bug: false, priority: 5 },
      { repo: 'b', bug: false, priority: 9 },
      { repo: 'c', bug: false, priority: 5 },
    ]);
    expect(a.perRepo).toEqual({ a: 1, b: 1, c: 0 });
  });

  test('a repo with no candidates is present with zero', () => {
    const a = allocateWorkers(verdict(10, 3), [...cands('a', 1)]);
    expect(a.perRepo).toEqual({ a: 1 });
    const b = allocateWorkers(verdict(10, 3), [{ repo: 'a', bug: false, priority: 1 }, ...cands('b', 0)]);
    expect(b.total).toBe(1);
  });

  test('total is capped by the number of candidates', () => {
    const a = allocateWorkers(verdict(10, 4), cands('a', 1));
    expect(a.total).toBe(1);
  });

  test('property: total never exceeds the verdict over 20 generated cases', () => {
    let seed = 7;
    const rnd = (n: number) => {
      seed = (seed * 1103515245 + 12345) % 2147483648;
      return seed % n;
    };
    for (let i = 0; i < 20; i++) {
      const v = verdict(rnd(100), 1 + rnd(4));
      const list: RepoCandidate[] = [];
      for (let r = 0; r < 1 + rnd(4); r++) {
        for (let k = 0; k < rnd(6); k++) list.push({ repo: `r${r}`, bug: rnd(2) === 0, priority: rnd(100) });
      }
      const a = allocateWorkers(v, list);
      expect(a.total).toBeLessThanOrEqual(v.workers);
      expect(a.total).toBeLessThanOrEqual(list.length);
      expect(sum(a.perRepo)).toBe(a.total);
    }
  });
});
