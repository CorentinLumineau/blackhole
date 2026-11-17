import { describe, expect, test } from 'bun:test';
import type { DependencyRef } from './forge-adapter/types.ts';
import { planPrDependencies, syncPrDependencies, type PlanInput, type PrDepsIssue } from './pr-dependencies.ts';

const REPO = 'acme/app';
const ref = (number: number, kind: 'pr' | 'issue' = 'issue', repo = REPO): DependencyRef => ({ repo, number, kind });
/** An edge as a native read returns it: GitHub/Gitea blocked_by joins issues only. */
const nat = (number: number, kind: 'pr' | 'issue' = 'issue', repo = REPO): DependencyRef => ({ repo, number, kind, via: 'native' });
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
const onMain = { blockedBy: [], baseRefName: 'main' };

describe('the stack expresses a single open-PR dependency', () => {
  test('B depends on exactly one open PR A, not stacked yet: restack onto A, plus an interim issue-level edge so the forge shows it now', () => {
    const p = planOf(base({ '4': open(104, { depends_on: [1] }) }, { reads: { '4': onMain } }), 4);
    expect(p.restack).toEqual({ parent: 1, parentPr: 101, parentBranch: 'blackhole/issue-1' });
    expect(p.blockedBy).toEqual([ref(1)]);
    expect(p.dependsOn).toEqual([1]);
  });

  test('once the base really moves onto A the interim edge is removed; the base reads back as the DAG edge', () => {
    const input = base({ '4': open(104, { depends_on: [1], forge_deps: { synced: ['#1'], body_cross: [] } }) }, {
      reads: { '4': { blockedBy: [nat(1)], baseRefName: 'blackhole/issue-1' } },
    });
    expect(planOf(input, 4)).toMatchObject({ restack: null, blockedBy: [], write: true, stackedOn: 1, dependsOn: [1] });
  });

  test('a base a human set on the forge becomes a depends_on edge', () => {
    const p = planOf(base({ '4': open(104) }, { reads: { '4': { blockedBy: [], baseRefName: 'blackhole/issue-2' } } }), 4);
    expect(p).toMatchObject({ dependsOn: [2], stackedOn: 2, blockedBy: [], write: false });
  });
});

describe('native blocked_by only where a stack cannot express the dependency', () => {
  test('two or more open PRs: each is an issue-to-issue edge (issue 4 blocked by issues 1 and 2), no restack', () => {
    const p = planOf(base({ '4': open(104, { depends_on: [1, 2] }) }, { reads: { '4': onMain } }), 4);
    expect(p.restack).toBeNull();
    expect(p.blockedBy).toEqual([ref(1), ref(2)]);
    expect(p.write).toBe(true);
  });

  test('stacked on one of several: the base carries that one, blocked_by the rest', () => {
    const p = planOf(base({ '4': open(104, { depends_on: [1, 2] }) }, { reads: { '4': { blockedBy: [], baseRefName: 'blackhole/issue-1' } } }), 4);
    expect(p.blockedBy).toEqual([ref(2)]);
  });

  test('an issue with no PR yet is a blocked_by edge on that issue', () => {
    const p = planOf(base({ '4': open(104, { depends_on: [5] }) }, { reads: { '4': onMain } }), 4);
    expect(p.restack).toBeNull();
    expect(p.blockedBy).toEqual([ref(5)]);
  });

  test('a cross-repo dependency from the issue body is pushed (the adapter writes it as a PR-body line)', () => {
    const input = base({ '4': open(104) }, { reads: { '4': onMain }, crossRepoBody: { '4': [{ repo: 'other/lib', number: 185 }] } });
    const p = planOf(input, 4);
    expect(p.blockedBy).toEqual([ref(185, 'pr', 'other/lib')]);
    expect(p.forgeDeps).toEqual({ synced: ['other/lib#185'], body_cross: ['other/lib#185'] });
    expect(p.dependsOn).toEqual([]);
  });

  test('GitLab blocks merge requests: an open-PR dependency is its MR, an issue with no PR stays an issue', () => {
    const p = planOf(base({ '4': open(104, { depends_on: [1, 2, 5] }) }, { forge: 'gitlab', reads: { '4': onMain } }), 4);
    expect(p.blockedBy).toEqual([ref(101, 'pr'), ref(102, 'pr'), ref(5)]);
  });
});

describe('two-way, idempotent sync', () => {
  test('an issue edge a human adds on the forge becomes a depends_on edge', () => {
    const input = base({ '4': open(104, { depends_on: [1, 2], forge_deps: { synced: ['#1', '#2'], body_cross: [] } }) }, {
      reads: { '4': { blockedBy: [nat(1), nat(2), nat(3)], baseRefName: 'main' } },
    });
    expect(planOf(input, 4)).toMatchObject({ dependsOn: [1, 2, 3], write: false });
  });

  test('a body line naming a queue PR number resolves to its issue', () => {
    const input = base({ '4': open(104, { depends_on: [1, 2] }) }, {
      reads: { '4': { blockedBy: [nat(1), nat(2), { ...ref(103), via: 'body' }], baseRefName: 'main' } },
    });
    expect(planOf(input, 4).dependsOn).toEqual([1, 2, 3]);
  });

  test('an edge a human removes on the forge is removed from the queue', () => {
    const input = base({ '4': open(104, { depends_on: [1, 2, 3], forge_deps: { synced: ['#1', '#2', '#3'], body_cross: [] } }) }, {
      reads: { '4': { blockedBy: [nat(1), nat(2)], baseRefName: 'main' } },
    });
    expect(planOf(input, 4)).toMatchObject({ dependsOn: [1, 2], blockedBy: [ref(1), ref(2)], write: false });
  });

  test('an edge the campaign adds since the last sync is pushed, not dropped', () => {
    const input = base({ '4': open(104, { depends_on: [1, 2, 3], forge_deps: { synced: ['#1', '#2'], body_cross: [] } }) }, {
      reads: { '4': { blockedBy: [nat(1), nat(2)], baseRefName: 'main' } },
    });
    expect(planOf(input, 4)).toMatchObject({ dependsOn: [1, 2, 3], blockedBy: [ref(1), ref(2), ref(3)], write: true });
  });

  test('replanning from the written state changes nothing (no duplicate edge, no write)', () => {
    const first = planOf(base({ '4': open(104, { depends_on: [1, 5] }) }, { reads: { '4': { blockedBy: [nat(1)], baseRefName: 'main' } } }), 4);
    const written = first.blockedBy.map((r) => ({ ...r, via: 'native' as const }));
    const again = planOf(
      base({ '4': open(104, { depends_on: first.dependsOn, forge_deps: first.forgeDeps }) }, { reads: { '4': { blockedBy: written, baseRefName: 'main' } } }),
      4,
    );
    expect(again).toEqual({ ...first, write: false });
    expect(again.blockedBy).toEqual([ref(1), ref(5)]);
  });

  test('a merged dependency stays in depends_on and is not mirrored', () => {
    const input = base({ '1': { status: 'merged', pr: 101 }, '4': open(104, { depends_on: [1, 2, 3] }) }, { reads: { '4': onMain } });
    expect(planOf(input, 4)).toMatchObject({ dependsOn: [1, 2, 3], blockedBy: [ref(2), ref(3)] });
  });

  test('a body line naming a number outside the queue may be a PR: kept where it is, never a DAG edge', () => {
    const line: DependencyRef = { ...ref(900), via: 'body' };
    const input = base({ '4': open(104) }, { reads: { '4': { blockedBy: [line], baseRefName: 'main' } } });
    expect(planOf(input, 4)).toMatchObject({ dependsOn: [], blockedBy: [line], unresolved: [line], write: false });
  });

  test('a native edge to an issue outside the queue is a DAG edge (it can only be an issue)', () => {
    const input = base({ '4': open(104) }, { reads: { '4': { blockedBy: [nat(900)], baseRefName: 'main' } } });
    expect(planOf(input, 4)).toMatchObject({ dependsOn: [900], blockedBy: [ref(900)], write: false });
  });

  test('only open-PR issues whose forge state was read are planned', () => {
    const reads = { '1': onMain, '2': onMain, '4': onMain, '5': onMain };
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
  /** A forge with open PRs 101 and 102 on issue branches; native edges are keyed by ISSUE. */
  function fakeAdapter(opts: { failSet?: boolean } = {}) {
    let blockers: DependencyRef[] = [];
    const writes: Array<{ target: unknown; refs: DependencyRef[] }> = [];
    const reads: unknown[] = [];
    const adapter = {
      forge: 'github',
      repo: REPO,
      prList: async () => [
        { number: 101, headRefName: 'blackhole/issue-1', baseRefName: 'main', state: 'OPEN' },
        { number: 102, headRefName: 'blackhole/issue-2', baseRefName: 'main', state: 'OPEN' },
      ],
      issueList: async () => [{ number: 2, body: 'Depends on other/lib#185' }],
      getDependencies: async (target: { issue: number }) => {
        reads.push(target);
        return { native: true, blockedBy: target.issue === 2 ? blockers : [] };
      },
      setDependencies: async (target: unknown, refs: DependencyRef[]) => {
        writes.push({ target, refs });
        if (!opts.failSet) blockers = refs.map((r) => ({ ...r, via: r.repo === REPO ? ('native' as const) : ('body' as const) }));
        return { native: true, blockedBy: blockers };
      },
    };
    return { adapter: adapter as never, writes, reads };
  }
  const queue = () => ({ issues: { '1': open(101), '2': open(102, { depends_on: [5] }), '5': { status: 'ready' } } });

  test('a dry run reads each issue with its PR and writes nothing', async () => {
    const f = fakeAdapter();
    const r = await syncPrDependencies(f.adapter, queue(), { apply: false, repo: REPO, queuePath: 'q.json' });
    expect(r.queue).toBeNull();
    expect(f.writes).toEqual([]);
    expect(f.reads).toEqual([{ issue: 1, pr: 101 }, { issue: 2, pr: 102 }]);
    expect(r.rows.find((x) => x.issue === 2)).toMatchObject({ blocked_by: ['acme/app#5', 'other/lib#185'], write: true, applied: false, native: true });
  });

  test('apply writes on the issue target, then a second sync from the new queue writes nothing', async () => {
    const f = fakeAdapter();
    const first = await syncPrDependencies(f.adapter, queue(), { apply: true, repo: REPO, queuePath: 'q.json', now: 't' });
    expect(first.errors).toEqual([]);
    expect(f.writes[0]!.target).toEqual({ issue: 2, pr: 102 });
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
