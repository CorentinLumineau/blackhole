import { describe, expect, test } from 'bun:test';
import type { GitRun, GitRunner } from './stack-merge.ts';
import { describeTip, resolveParentTip, type TipInput } from './parent-tip.ts';

// A commit graph as `commit -> parents`; the fake runner answers the three queries the resolver makes.
const graph = (parents: Record<string, string[]>): GitRunner => {
  const ancestors = (rev: string): string[] => [rev, ...(parents[rev] ?? []).flatMap(ancestors)];
  const result = (ok: boolean, stdout = ''): GitRun => ({ ok, code: ok ? 0 : 1, stdout, stderr: '' });
  return (_root, args) => {
    if (args[0] === 'rev-parse') {
      const rev = String(args[args.length - 1]).replace('^{commit}', '');
      return rev in parents ? result(true, rev) : result(false);
    }
    if (args[0] === 'merge-base' && args[1] === '--is-ancestor') return result(ancestors(args[3]).includes(args[2]));
    if (args[0] === 'merge-base') {
      const mine = new Set(ancestors(args[1]));
      const common = ancestors(args[2]).filter((c) => mine.has(c));
      return common.length === 0 ? result(false) : result(true, common[0]);
    }
    throw new Error(`unexpected git ${args.join(' ')}`);
  };
};

// B0 <- P1 <- P2 (parent PR head); the child was cut at P1; main holds the squash S.
const LINEAR = { B0: [], P1: ['B0'], P2: ['P1'], C: ['P1'], S: ['B0'], 'origin/main': ['S'] } as Record<string, string[]>;

const input = (overrides: Partial<TipInput> = {}): TipInput => ({
  captured: null,
  head: 'P2',
  parentPr: 41,
  branch: 'C',
  target: 'origin/main',
  ...overrides,
});
const fetches = (ok: boolean) => {
  const asked: number[] = [];
  return { asked, fetchPrHead: (pr: number) => (asked.push(pr), ok) };
};

describe('resolveParentTip: captured tip', () => {
  test('a captured tip is used as-is when the head is unreadable, and says it was not cross-checked', () => {
    const f = fetches(true);
    const r = resolveParentTip('/r', input({ captured: 'P1', head: null, parentPr: null }), { git: graph(LINEAR), fetchPrHead: f.fetchPrHead });
    expect(r).toMatchObject({ tip: 'P1', source: 'captured' });
    expect(f.asked).toEqual([]);
    expect(JSON.stringify(r)).toContain('not cross-checked');
  });

  test('a captured tip behind the head stays the tip (captured is preferred over the head)', () => {
    const r = resolveParentTip('/r', input({ captured: 'P1' }), { git: graph(LINEAR), fetchPrHead: () => true });
    expect(r).toMatchObject({ tip: 'P1', source: 'captured' });
  });

  test('a captured tip equal to the head agrees', () => {
    const r = resolveParentTip('/r', input({ captured: 'P2' }), { git: graph(LINEAR), fetchPrHead: () => true });
    expect(r).toMatchObject({ tip: 'P2', source: 'captured' });
  });

  test('a captured tip that is not an ancestor of the fetched head is refused, naming both SHAs', () => {
    const git = graph({ ...LINEAR, X: ['B0'] });
    const r = resolveParentTip('/r', input({ captured: 'X' }), { git, fetchPrHead: () => true });
    expect('refusal' in r && r.refusal).toContain('X');
    expect('refusal' in r && r.refusal).toContain('P2');
  });

  test('a head that does not fetch (Gitea has no refs/pull/N/head) leaves the captured tip uncross-checked, never refused', () => {
    const r = resolveParentTip('/r', input({ captured: 'P1' }), { git: graph(LINEAR), fetchPrHead: () => false });
    expect(r).toMatchObject({ tip: 'P1', source: 'captured' });
  });
});

describe('resolveParentTip: derived from the merged parent PR head', () => {
  test('the base is the last commit child and head share, which is earlier than the head', () => {
    const f = fetches(true);
    const r = resolveParentTip('/r', input(), { git: graph(LINEAR), fetchPrHead: f.fetchPrHead });
    expect(r).toMatchObject({ tip: 'P1', source: 'derived' });
    expect(f.asked).toEqual([41]);
  });

  test('a parent rebased and force-pushed before the squash is refused, naming the stale base and the head', () => {
    // The child still holds the old P1/P2; the head is P2' on a newer trunk, so the shared commit is B0.
    const git = graph({ B0: [], T1: ['B0'], P1: ['B0'], P2: ['P1'], C: ['P2'], P1r: ['T1'], P2r: ['P1r'], S: ['T1'], 'origin/main': ['S'] });
    const r = resolveParentTip('/r', input({ head: 'P2r' }), { git, fetchPrHead: () => true });
    expect('refusal' in r).toBe(true);
    const text = 'refusal' in r ? r.refusal : '';
    expect(text).toContain('B0');
    expect(text).toContain('P2r');
  });

  test('a parent merged with a merge commit keeps the head as base, since the head is reachable from the target', () => {
    const git = graph({ B0: [], P1: ['B0'], P2: ['P1'], C: ['P2'], M: ['B0', 'P2'], 'origin/main': ['M'] });
    const r = resolveParentTip('/r', input(), { git, fetchPrHead: () => true });
    expect(r).toMatchObject({ tip: 'P2', source: 'derived' });
  });

  test('a head that does not fetch is refused with a reason (Gitea keeps this refusal)', () => {
    const r = resolveParentTip('/r', input(), { git: graph(LINEAR), fetchPrHead: () => false });
    expect('refusal' in r && r.refusal).toContain('refs/pull/41/head');
  });

  test('a child sharing no commit with the head is refused', () => {
    const git = graph({ ...LINEAR, C: [] });
    const r = resolveParentTip('/r', input(), { git, fetchPrHead: () => true });
    expect('refusal' in r && r.refusal).toContain('shares no commit');
  });

  test('no captured tip and no readable head or parent PR is refused', () => {
    const r = resolveParentTip('/r', input({ head: null, parentPr: null }), { git: graph(LINEAR), fetchPrHead: () => true });
    expect('refusal' in r).toBe(true);
  });
});

describe('describeTip', () => {
  test('names the recorded tip and its source', () => {
    expect(describeTip({ captured: 'abc', head: 'def', parentPr: 41 })).toBe('parent tip abc (recorded in queue.json)');
  });
  test('names the derived head and PR when nothing was recorded', () => {
    expect(describeTip({ captured: null, head: 'def', parentPr: 41 })).toBe(
      'parent PR #41 head def (derived; the merge base is resolved from it at --apply)',
    );
  });
});
