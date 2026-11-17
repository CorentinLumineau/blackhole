import { describe, expect, test } from 'bun:test';
import type { DependencyRef } from './forge-adapter/types.ts';
import { planPrDependencies, syncPrDependencies, type PlanInput, type PrDepsIssue } from './pr-dependencies.ts';

const REPO = 'acme/app';
const ref = (number: number, kind: 'pr' | 'issue' = 'pr', repo = REPO): DependencyRef => ({ repo, number, kind });
const open = (pr: number, extra: Partial<PrDepsIssue> = {}): PrDepsIssue => ({ status: 'in-flight', pr, ...extra });

/** Issues 1..4 with open PRs 101..104 on branches blackhole/issue-N; issue 5 has no PR yet. */
const base = (issues: Record<string, PrDepsIssue>, rest: Partial<PlanInput> = {}): PlanInput => ({
  repo: REPO,
  forge: 'github',
  issues: { '1': open(101), '2': open(102), '3': open(103), '4': open(104), '5': { status: 'ready' }, ...issues },
  openPrs: [1, 2, 3, 4].map((n) => ({ number: 100 + n, headRefName: `blackhole/issue-${n}` })),
  reads: {},
  crossRepoBody: {},
  ...rest,
});
const planOf = (input: PlanInput, issue: number) => planPrDependencies(input).find((p) => p.issue === issue)!;

describe('the stack expresses a single open-PR dependency', () => {
  test('B depends on exactly one open PR A and is not stacked yet: restack onto A, no blocked_by edge', () => {
    const p = planOf(base({ '4': open(104, { depends_on: [1] }) }, { reads: { '4': { blockedBy: [], baseRefName: 'main' } } }), 4);
    expect(p.restack).toEqual({ parent: 1, parentPr: 101, parentBranch: 'blackhole/issue-1' });
    expect(p.blockedBy).toEqual([]);
    expect(p.dependsOn).toEqual([1]);
  });

  test('a PR already based on A has the edge on the forge: nothing to write, the base reads back as a DAG edge', () => {
    const input = base({ '4': open(104, { depends_on: [1] }) }, { reads: { '4': { blockedBy: [], baseRefName: 'blackhole/issue-1' } } });
    const p = planOf(input, 4);
    expect(p).toMatchObject({ restack: null, blockedBy: [], write: false, stackedOn: 1, dependsOn: [1] });
  });

  test('a base a human set on the forge becomes a depends_on edge', () => {
    const p = planOf(base({ '4': open(104) }, { reads: { '4': { blockedBy: [], baseRefName: 'blackhole/issue-2' } } }), 4);
    expect(p.dependsOn).toEqual([2]);
    expect(p.stackedOn).toBe(2);
    expect(p.blockedBy).toEqual([]);
  });
});

describe('native blocked_by only where a stack cannot express the dependency', () => {
  test('two or more open PRs: every one is a blocked_by edge, no restack', () => {
    const p = planOf(base({ '4': open(104, { depends_on: [1, 2] }) }, { reads: { '4': { blockedBy: [], baseRefName: 'main' } } }), 4);
    expect(p.restack).toBeNull();
    expect(p.blockedBy).toEqual([ref(101), ref(102)]);
    expect(p.write).toBe(true);
  });

  test('stacked on one of several: the base carries that one, blocked_by the rest', () => {
    const p = planOf(base({ '4': open(104, { depends_on: [1, 2] }) }, { reads: { '4': { blockedBy: [], baseRefName: 'blackhole/issue-1' } } }), 4);
    expect(p.blockedBy).toEqual([ref(102)]);
  });

  test('an issue with no PR yet is a blocked_by edge on the issue itself', () => {
    const p = planOf(base({ '4': open(104, { depends_on: [5] }) }, { reads: { '4': { blockedBy: [], baseRefName: 'main' } } }), 4);
    expect(p.restack).toBeNull();
    expect(p.blockedBy).toEqual([ref(5, 'issue')]);
  });

  test('a cross-repo dependency from the issue body is a blocked_by edge on the other repo PR', () => {
    const input = base({ '4': open(104) }, {
      reads: { '4': { blockedBy: [], baseRefName: 'main' } },
      crossRepoBody: { '4': [{ repo: 'other/lib', number: 185 }] },
    });
    const p = planOf(input, 4);
    expect(p.blockedBy).toEqual([ref(185, 'pr', 'other/lib')]);
    expect(p.forgeDeps).toEqual({ synced: ['other/lib#185'], body_cross: ['other/lib#185'] });
    expect(p.dependsOn).toEqual([]);
  });
});

describe('two-way, idempotent sync', () => {
  test('an edge a human adds on the forge (a PR number) becomes a depends_on edge on its issue', () => {
    const input = base({ '4': open(104, { depends_on: [1, 2], forge_deps: { synced: ['#1', '#2'], body_cross: [] } }) }, {
      reads: { '4': { blockedBy: [ref(101), ref(102), ref(103)], baseRefName: 'main' } },
    });
    expect(planOf(input, 4)).toMatchObject({ dependsOn: [1, 2, 3], write: false });
  });

  test('an edge a human removes on the forge is removed from the queue', () => {
    const input = base({ '4': open(104, { depends_on: [1, 2, 3], forge_deps: { synced: ['#1', '#2', '#3'], body_cross: [] } }) }, {
      reads: { '4': { blockedBy: [ref(101), ref(102)], baseRefName: 'main' } },
    });
    expect(planOf(input, 4)).toMatchObject({ dependsOn: [1, 2], blockedBy: [ref(101), ref(102)], write: false });
  });

  test('an edge the campaign adds since the last sync is pushed, not dropped', () => {
    const input = base({ '4': open(104, { depends_on: [1, 2, 3], forge_deps: { synced: ['#1', '#2'], body_cross: [] } }) }, {
      reads: { '4': { blockedBy: [ref(101), ref(102)], baseRefName: 'main' } },
    });
    expect(planOf(input, 4)).toMatchObject({ dependsOn: [1, 2, 3], blockedBy: [ref(101), ref(102), ref(103)], write: true });
  });

  test('replanning from the written state changes nothing (no duplicate edge, no write)', () => {
    const first = planOf(base({ '4': open(104, { depends_on: [1, 5] }) }, { reads: { '4': { blockedBy: [ref(101)], baseRefName: 'main' } } }), 4);
    const again = planOf(
      base({ '4': open(104, { depends_on: first.dependsOn, forge_deps: first.forgeDeps }) }, { reads: { '4': { blockedBy: first.blockedBy, baseRefName: 'main' } } }),
      4,
    );
    expect(again).toEqual({ ...first, write: false });
    // One open PR (#1) goes through the stack, the issue with no PR (#5) through blocked_by.
    expect(again.blockedBy).toEqual([ref(5, 'issue')]);
    expect(again.restack?.parent).toBe(1);
  });

  test('a merged dependency stays in depends_on and is not mirrored', () => {
    const input = base({ '1': { status: 'merged', pr: 101 }, '4': open(104, { depends_on: [1, 2, 3] }) }, { reads: { '4': { blockedBy: [], baseRefName: 'main' } } });
    expect(planOf(input, 4)).toMatchObject({ dependsOn: [1, 2, 3], blockedBy: [ref(102), ref(103)] });
  });

  test('a GitLab merge request outside the queue is kept on the forge but is not a DAG edge', () => {
    const input = base({ '4': open(104) }, { forge: 'gitlab', reads: { '4': { blockedBy: [ref(900)], baseRefName: 'main' } } });
    expect(planOf(input, 4)).toMatchObject({ dependsOn: [], blockedBy: [ref(900)], unresolved: [ref(900)], write: false });
  });

  test('only open-PR issues whose forge state was read are planned', () => {
    const none = { blockedBy: [], baseRefName: 'main' };
    const reads = { '1': none, '2': none, '4': none, '5': none };
    expect(planPrDependencies(base({}, { reads })).map((p) => p.issue)).toEqual([1, 2, 4]);
  });
});

describe('Merge next reads forge-declared cross-repo blockers', () => {
  test('forge_deps.synced cross-repo keys join the body lines, each once, and name the blocker the same way', async () => {
    const { crossRepoBlockers, crossRepoBlockerText } = await import('../forge-deps.ts');
    const { forgeDeclaredCrossRepo } = await import('./pr-dependencies.ts');
    const declared = forgeDeclaredCrossRepo({
      '4': open(104, { forge_deps: { synced: ['#1', 'other/lib#185', 'other/cli#7'], body_cross: ['other/lib#185'] } }),
      '2': open(102),
    });
    expect([...declared]).toEqual([[4, [{ repo: 'other/lib', number: 185 }, { repo: 'other/cli', number: 7 }]]]);
    const blockers = crossRepoBlockers([{ number: 4, body: 'Depends on other/lib#185' }], () => ({ state: 'open' }) as never, declared);
    expect(blockers.map(crossRepoBlockerText)).toEqual([
      'waits on other/lib#185 (cross-repo, not merged yet)',
      'waits on other/cli#7 (cross-repo, not merged yet)',
    ]);
  });
});

describe('syncPrDependencies (fake adapter)', () => {
  /** A forge with open PRs 101 and 102 on issue branches, and PR 102's native blockers. */
  function fakeAdapter(opts: { failSet?: boolean } = {}) {
    let blockers: DependencyRef[] = [];
    const writes: DependencyRef[][] = [];
    const adapter = {
      forge: 'github',
      repo: REPO,
      prList: async () => [
        { number: 101, headRefName: 'blackhole/issue-1', baseRefName: 'main', state: 'OPEN' },
        { number: 102, headRefName: 'blackhole/issue-2', baseRefName: 'main', state: 'OPEN' },
      ],
      issueList: async () => [{ number: 2, body: 'Depends on other/lib#185' }],
      getDependencies: async (n: number) => ({ native: true, blockedBy: n === 102 ? blockers : [] }),
      setDependencies: async (_n: number, refs: DependencyRef[]) => {
        writes.push(refs);
        if (!opts.failSet) blockers = refs;
        return { native: true, blockedBy: blockers };
      },
    };
    return { adapter: adapter as never, writes };
  }
  const queue = () => ({ issues: { '1': open(101), '2': open(102, { depends_on: [5] }), '5': { status: 'ready' } } });

  test('a dry run plans and writes nothing', async () => {
    const f = fakeAdapter();
    const r = await syncPrDependencies(f.adapter, queue(), { apply: false, repo: REPO, queuePath: 'q.json' });
    expect(r.queue).toBeNull();
    expect(f.writes).toEqual([]);
    expect(r.rows.find((x) => x.issue === 2)).toMatchObject({ blocked_by: ['acme/app#5', 'other/lib#185'], write: true, applied: false });
  });

  test('apply writes the forge, then a second sync from the new queue writes nothing', async () => {
    const f = fakeAdapter();
    const first = await syncPrDependencies(f.adapter, queue(), { apply: true, repo: REPO, queuePath: 'q.json', now: 't' });
    expect(first.errors).toEqual([]);
    expect(first.queue!.issues!['2']).toMatchObject({ depends_on: [5], forge_deps: { synced: ['#5', 'other/lib#185'], body_cross: ['other/lib#185'] } });
    const second = await syncPrDependencies(f.adapter, first.queue!, { apply: true, repo: REPO, queuePath: 'q.json' });
    expect(f.writes).toHaveLength(1);
    expect(second.queue!.issues!['2']).toEqual(first.queue!.issues!['2']);
  });

  test('a write that does not read back keeps the old queue state and reports it', async () => {
    const f = fakeAdapter({ failSet: true });
    const r = await syncPrDependencies(f.adapter, queue(), { apply: true, repo: REPO, queuePath: 'q.json' });
    expect(r.queue!.issues!['2']).toEqual(queue().issues['2']);
    expect(r.errors[0]).toContain('not as planned');
  });
});
