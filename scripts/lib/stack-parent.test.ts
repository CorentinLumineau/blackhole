import { describe, expect, test } from 'bun:test';
import {
  collectParentFiles,
  formatStackMergeOrder,
  globsMatchFiles,
  pickStackParent,
  planPackageRoot,
  planTouchPaths,
  underRoot,
  stackMergeOrder,
  touchPathsOverlap,
  withPlanTouchPaths,
} from './stack-parent.ts';

describe('touchPathsOverlap', () => {
  test('nested literal prefixes overlap', () => {
    expect(touchPathsOverlap(['src/a/**'], ['src/a/b.ts'])).toBe(true);
  });
  test('disjoint prefixes do not overlap', () => {
    expect(touchPathsOverlap(['src/a/**'], ['src/ab/**'])).toBe(false);
  });
  test('a root-only wildcard overlaps nothing', () => {
    expect(touchPathsOverlap(['**'], ['docs/x.md'])).toBe(false);
  });
});

describe('globsMatchFiles', () => {
  test('a glob matches only concrete files it covers', () => {
    expect(globsMatchFiles(['src/a/*.ts'], ['src/a/x.ts'])).toBe(true);
    expect(globsMatchFiles(['src/a/*.ts'], ['src/a/x.md'])).toBe(false);
  });
});

describe('pickStackParent', () => {
  const base = {
    '10': { status: 'in-flight', pr: 100, touch_paths: ['src/a/**'] },
    '11': { status: 'ready', pr: null, touch_paths: ['src/a/x.ts'] },
  };
  test('stacks on the open-PR overlapping issue', () => {
    expect(pickStackParent(base, 11)).toEqual({
      parent: 10,
      parentBranch: 'blackhole/issue-10',
      parentPr: 100,
      issueLinkKeyword: 'Part of',
    });
  });
  test('ignores merged parents and issues without a PR', () => {
    expect(pickStackParent({ ...base, '10': { ...base['10'], status: 'merged' } }, 11)).toBeNull();
    expect(pickStackParent({ ...base, '10': { ...base['10'], pr: null } }, 11)).toBeNull();
  });
  test('does not restack or form a cycle', () => {
    expect(pickStackParent({ ...base, '11': { ...base['11'], stacked_on: 5 } }, 11)).toBeNull();
    expect(pickStackParent({ ...base, '10': { ...base['10'], stacked_on: 11 } }, 11)).toBeNull();
  });
  test('A->B->C: the third overlapping issue stacks on the chain tip', () => {
    const q = {
      ...base,
      '11': { status: 'in-flight', pr: 101, touch_paths: ['src/a/x.ts'], stacked_on: 10 },
      '12': { status: 'ready', touch_paths: ['src/a/y.ts'] },
    };
    expect(pickStackParent(q, 12)?.parent).toBe(11);
  });
  test('build-output touch_paths stack only in the repo that owns the build', () => {
    const q = {
      '10': { status: 'in-flight', pr: 100, touch_paths: ['skills/blackhole/**', 'src/a.ts'] },
      '11': { status: 'ready', touch_paths: ['skills/blackhole/x.md'] },
    };
    expect(pickStackParent(q, 11)?.parent).toBe(10);
    expect(pickStackParent(q, 11, { buildOutput: true })).toBeNull();
    expect(pickStackParent(q, 11, { parentFiles: { '10': ['skills/blackhole/x.md'] }, buildOutput: true })).toBeNull();
    expect(pickStackParent(q, 11, { parentFiles: { '10': ['skills/blackhole/x.md'] } })?.parent).toBe(10);
  });
  test('default touch_paths never stack', () => {
    const d = ['src/**', 'scripts/**'];
    const q = {
      '10': { status: 'in-flight', pr: 100, touch_paths: d },
      '11': { status: 'ready', touch_paths: d },
    };
    expect(pickStackParent(q, 11, { defaultTouchPaths: d })).toBeNull();
    expect(pickStackParent({ ...q, '11': { status: 'ready', touch_paths: ['**'] } }, 11)).toBeNull();
  });
  test('narrowed overlap stacks, narrowed disjoint pair does not', () => {
    const q = {
      '10': { status: 'in-flight', pr: 100, touch_paths: ['src/a/**'] },
      '11': { status: 'ready', touch_paths: ['src/a/x.ts'] },
      '12': { status: 'ready', touch_paths: ['src/b/x.ts'] },
    };
    const o = { defaultTouchPaths: ['src/**'] };
    expect(pickStackParent(q, 11, o)?.parent).toBe(10);
    expect(pickStackParent(q, 12, o)).toBeNull();
  });
  test('parent PR changed files take precedence over declared globs', () => {
    const q = {
      '10': { status: 'in-flight', pr: 100, touch_paths: ['src/a/**'] },
      '11': { status: 'ready', touch_paths: ['src/a/x.ts'] },
    };
    expect(pickStackParent(q, 11, { parentFiles: { '10': ['docs/z.md'] } })).toBeNull();
    expect(pickStackParent(q, 11, { parentFiles: { '10': ['src/a/x.ts'] } })?.parent).toBe(10);
  });
  test('a parent that only adds rows to an append-only index is no overlap; any other shared file still is', () => {
    const IDX = 'documentation/decisions/INDEX.md';
    const q = {
      '10': { status: 'in-flight', pr: 100, touch_paths: [IDX] },
      '11': { status: 'ready', touch_paths: [IDX, 'documentation/decisions/ADR-070.md'] },
    };
    const parentFiles = { '10': [IDX] };
    expect(pickStackParent(q, 11, { parentFiles })?.parent).toBe(10);
    expect(pickStackParent(q, 11, { parentFiles, pureAdditions: { '10': [IDX] } })).toBeNull();
    expect(pickStackParent(q, 11, { parentFiles: { '10': [IDX, 'documentation/decisions/ADR-070.md'] }, pureAdditions: { '10': [IDX] } })?.parent).toBe(10);
  });
  test('each default or broad glob is dropped individually from a mixed list', () => {
    const q = {
      '10': { status: 'in-flight', pr: 100, touch_paths: ['src/a/x.ts'] },
      '11': { status: 'ready', touch_paths: ['src/a/x.ts', 'src/**', 'scripts/**'] },
      '12': { status: 'ready', touch_paths: ['src/**', 'scripts/**'] },
    };
    const o = { defaultTouchPaths: ['src/**', 'scripts/**'] };
    expect(pickStackParent(q, 11, o)?.parent).toBe(10);
    expect(pickStackParent(q, 12, o)).toBeNull();
  });
  test('broad globs are unknown even when no defaults are supplied', () => {
    for (const g of ['src/**', 'scripts/**', '**', '*.md']) {
      const q = {
        '10': { status: 'in-flight', pr: 100, touch_paths: [g] },
        '11': { status: 'ready', touch_paths: [g] },
      };
      expect(pickStackParent(q, 11)).toBeNull();
    }
  });
  test('an empty parentFiles list is unknown and falls back to the parent narrowed touch_paths', () => {
    const q = {
      '10': { status: 'in-flight', pr: 100, touch_paths: ['src/a/**'] },
      '11': { status: 'ready', touch_paths: ['src/a/x.ts'] },
    };
    expect(pickStackParent(q, 11, { parentFiles: { '10': [] } })?.parent).toBe(10);
  });
  test('a child glob must match a concrete parent file, not just share a prefix', () => {
    const q = {
      '10': { status: 'in-flight', pr: 100, touch_paths: ['src/a/**'] },
      '11': { status: 'ready', touch_paths: ['src/a/*.ts'] },
    };
    expect(pickStackParent(q, 11, { parentFiles: { '10': ['src/a/x.md'] } })).toBeNull();
  });
  test('#1303 a parent PR changing only documentation/INDEX.md is a known no-overlap', () => {
    const q = {
      '10': { status: 'in-flight', pr: 100, touch_paths: ['documentation/INDEX.md'] },
      '11': { status: 'ready', touch_paths: ['documentation/INDEX.md', 'scripts/x.ts'] },
    };
    expect(pickStackParent(q, 11, { parentFiles: { '10': ['documentation/INDEX.md'] } })).toBeNull();
  });
  test('#1303 touch_paths sharing only documentation/INDEX.md do not stack', () => {
    const q = {
      '10': { status: 'in-flight', pr: 100, touch_paths: ['documentation/INDEX.md'] },
      '11': { status: 'ready', touch_paths: ['documentation/INDEX.md', 'scripts/x.ts'] },
    };
    expect(pickStackParent(q, 11)).toBeNull();
  });
});

describe('stackMergeOrder', () => {
  const pr = (n: number, extra: Record<string, unknown> = {}) => ({ [String(n)]: { status: 'in-flight', pr: n + 1000, ...extra } });
  const fmt = (issues: Record<string, never>) => stackMergeOrder(issues).map(formatStackMergeOrder);

  test('linear chain', () => {
    const issues = { ...pr(1), ...pr(2, { stacked_on: 1 }), ...pr(3, { stacked_on: 2 }) } as never;
    expect(fmt(issues)).toEqual(['merge #1, then #2 (stacked on #1), then #3 (stacked on #2)']);
  });
  test('branching: lowest-numbered child first, depth-first', () => {
    const issues = { ...pr(1), ...pr(5, { stacked_on: 1 }), ...pr(2, { stacked_on: 1 }), ...pr(3, { stacked_on: 2 }) } as never;
    expect(fmt(issues)).toEqual([
      'merge #1, then #2 (stacked on #1), then #3 (stacked on #2), then #5 (stacked on #1)',
    ]);
  });
  test('independent PRs are not listed', () => {
    expect(stackMergeOrder({ ...pr(1), ...pr(2) } as never)).toEqual([]);
  });
  test('merged parent is dropped; child heads the remaining stack', () => {
    const issues = {
      '1': { status: 'merged', pr: 1001 },
      ...pr(2, { stacked_on: 1 }),
      ...pr(3, { stacked_on: 2 }),
    } as never;
    expect(fmt(issues)).toEqual(['merge #2, then #3 (stacked on #2)']);
  });
  test('empty queue yields no stacks', () => {
    expect(stackMergeOrder({})).toEqual([]);
  });
});

describe('pickStackParent with a broad child glob', () => {
  const q = {
    '10': { status: 'in-flight', pr: 100, touch_paths: ['src/**'] },
    '11': { status: 'ready', touch_paths: ['src/**'] },
  };
  test('stacks when it matches the parent PR real changed files', () => {
    expect(pickStackParent(q, 11, { parentFiles: { '10': ['src/a/x.ts'] } })?.parent).toBe(10);
  });
  test('does not stack when the real changed files lie elsewhere', () => {
    expect(pickStackParent(q, 11, { parentFiles: { '10': ['docs/x.md'] } })).toBeNull();
  });
  test('does not stack on declared globs alone', () => {
    expect(pickStackParent(q, 11)).toBeNull();
  });
  test('prefixless globs and defaults stay unknown against concrete files', () => {
    for (const g of ['**', '*.md']) {
      const p = { ...q, '11': { status: 'ready', touch_paths: [g] } };
      expect(pickStackParent(p, 11, { parentFiles: { '10': ['a.md'] } })).toBeNull();
    }
    expect(
      pickStackParent(q, 11, { parentFiles: { '10': ['src/a/x.ts'] }, defaultTouchPaths: ['src/**'] }),
    ).toBeNull();
  });
});

describe('collectParentFiles', () => {
  const q = {
    '10': { status: 'in-flight', pr: 100 },
    '11': { status: 'ready', pr: null },
    '12': { status: 'merged', pr: 102 },
    '13': { status: 'in-flight', pr: 103 },
    '14': { status: 'in-flight', pr: 104 },
  };
  test('reads open PRs other than the issue, leaving failed reads unknown', () => {
    const asked: number[] = [];
    const files = collectParentFiles(q, 13, (pr) => {
      asked.push(pr);
      return pr === 100 ? ['src/a.ts'] : null;
    });
    expect(asked).toEqual([100, 104]);
    expect(files).toEqual({ '10': ['src/a.ts'] });
  });
});

describe('stacked_on_pr edges (restack from a PR number)', () => {
  const q = {
    '7': { status: 'in-flight', pr: 70, touch_paths: ['src/a/**'] },
    '9': { status: 'in-flight', pr: 90, touch_paths: ['src/a/**'], stacked_on_pr: 70 },
  };
  test('stackMergeOrder sees the child of a stacked_on_pr edge', () => {
    expect(stackMergeOrder(q).map(formatStackMergeOrder)).toEqual(['merge #7, then #9 (stacked on #7)']);
  });
  test('pickStackParent does not stack an issue that already has a stacked_on_pr edge', () => {
    expect(pickStackParent(q, 9, { parentFiles: { '7': ['src/a/x.ts'] } })).toBeNull();
  });
});

describe('plan Touch-Paths replace the queue default globs', () => {
  const plan = [
    '# Plan for #1376',
    '',
    '## Touch-Paths',
    '',
    '- `scripts/lib/foo.test.ts`',
    '- `scripts/lib/foo.test.ts` (again)',
    '',
    '## Task Steps',
    '',
    '- edit `src/agents/planner.md`',
  ].join('\n');

  test('planTouchPaths reads only the Touch-Paths section', () => {
    expect(planTouchPaths(plan)).toEqual(['scripts/lib/foo.test.ts']);
  });
  test('planTouchPaths is empty for a plan without the section', () => {
    expect(planTouchPaths('# Plan\n\n## Objective\n\n- `src/a.ts`\n')).toEqual([]);
  });

  // Defaults `src/**`, `scripts/**`, `fixtures/**` overlap the open PR; the plan's one file does not.
  const q = {
    '1381': { status: 'in-flight', pr: 1385, touch_paths: ['scripts/lib/bar.ts'] },
    '1376': { status: 'ready', pr: null, touch_paths: ['src/**', 'scripts/**', 'fixtures/**'] },
  };
  const parentFiles = { '1381': ['scripts/lib/bar.ts', 'src/references/x.md'] };

  test('without the plan the default globs name an unrelated open PR as parent', () => {
    expect(pickStackParent(q, 1376, { parentFiles })?.parent).toBe(1381);
  });
  test('with the plan applied, the unrelated open PR is not a parent', () => {
    const planned = withPlanTouchPaths(q, (n) => (n === 1376 ? plan : null));
    expect(planned['1376']!.touch_paths).toEqual(['scripts/lib/foo.test.ts']);
    expect(planned['1381']!.touch_paths).toEqual(['scripts/lib/bar.ts']);
    expect(pickStackParent(planned, 1376, { parentFiles })).toBeNull();
  });
  test('a plan with no Touch-Paths keeps the queue touch_paths', () => {
    const planned = withPlanTouchPaths(q, () => '# Plan\n');
    expect(planned['1376']!.touch_paths).toEqual(['src/**', 'scripts/**', 'fixtures/**']);
  });
});

describe('plan Scope Amendments and heading match', () => {
  const amended = [
    '## Touch-Paths',
    '',
    '- `scripts/lib/foo.test.ts`',
    '- `scripts/lib/old.ts`',
    '',
    '## Scope Amendments',
    '',
    '- 2026-11-23 — widen — `scripts/lib/bar.ts` — needed for the fix',
    '- 2026-11-23 — narrow — `scripts/lib/old.ts` — out of scope',
  ].join('\n');

  test('widen adds a path and narrow drops one', () => {
    expect(planTouchPaths(amended)).toEqual(['scripts/lib/foo.test.ts', 'scripts/lib/bar.ts']);
  });
  test('a widened path stacks on the open PR touching it', () => {
    const q = {
      '1381': { status: 'in-flight', pr: 1385 },
      '1376': { status: 'ready', pr: null, touch_paths: ['src/**', 'scripts/**', 'fixtures/**'] },
    };
    const planned = withPlanTouchPaths(q, (n) => (n === 1376 ? amended : null));
    expect(pickStackParent(planned, 1376, { parentFiles: { '1381': ['scripts/lib/bar.ts'] } })?.parent).toBe(1381);
  });
  test('a Touch-Paths Completeness Advisory heading is not the Touch-Paths section', () => {
    expect(planTouchPaths('## Touch-Paths Completeness Advisory\n\n- `scripts/lib/build/facts.ts`\n')).toEqual([]);
  });
});

describe('plan package_root prefixes sub-package Touch-Paths (#1462)', () => {
  const pkgPlan = [
    '---',
    'issue: #1462',
    'package_root: apps/invest',
    '---',
    '',
    '## Touch-Paths',
    '',
    '- `lib/foo.ts`',
    '- `apps/invest/lib/already.ts`',
    '- `app/**/page.tsx`',
    '',
    '## Scope Amendments',
    '',
    '- 2026-11-23 — widen — `lib/bar.ts` — needed for the fix',
  ].join('\n');

  test('each path is joined to package_root unless already under it', () => {
    expect(planTouchPaths(pkgPlan)).toEqual([
      'apps/invest/lib/foo.ts',
      'apps/invest/lib/already.ts',
      'apps/invest/app/**/page.tsx',
      'apps/invest/lib/bar.ts',
    ]);
  });
  test('a quoted root with a trailing slash, or ./, is normalized', () => {
    expect(planTouchPaths(pkgPlan.replace('package_root: apps/invest', 'package_root: "./apps/invest/"'))[0]).toBe(
      'apps/invest/lib/foo.ts',
    );
  });
  test('an absent, null, empty or "." package_root leaves paths repo-relative', () => {
    for (const v of ['null', '', '.', '~']) {
      expect(planTouchPaths(pkgPlan.replace('package_root: apps/invest', `package_root: ${v}`))[0]).toBe('lib/foo.ts');
    }
    expect(planTouchPaths(pkgPlan.replace('package_root: apps/invest\n', ''))[0]).toBe('lib/foo.ts');
  });
  test('a sub-package path stacks on the open PR changing the repo-relative file', () => {
    const q = {
      '1381': { status: 'in-flight', pr: 1385 },
      '1376': { status: 'ready', pr: null, touch_paths: ['src/**'] },
    };
    const planned = withPlanTouchPaths(q, (n) => (n === 1376 ? pkgPlan : null));
    expect(pickStackParent(planned, 1376, { parentFiles: { '1381': ['apps/invest/lib/foo.ts'] } })?.parent).toBe(1381);
    // The same relative path in another package is not an overlap.
    expect(pickStackParent(planned, 1376, { parentFiles: { '1381': ['lib/foo.ts'] } })).toBeNull();
  });
});

describe('underRoot resolves one plan path (#1462 review)', () => {
  test('joins a package-relative path and normalizes it', () => {
    expect(underRoot('apps/invest', 'lib/foo.ts')).toBe('apps/invest/lib/foo.ts');
    expect(underRoot('apps/invest', 'lib//x/../foo.ts')).toBe('apps/invest/lib/foo.ts');
  });
  test('ignores a leading ./', () => {
    expect(underRoot('apps/invest', './lib/foo.ts')).toBe('apps/invest/lib/foo.ts');
    expect(underRoot('', './lib/foo.ts')).toBe('lib/foo.ts');
  });
  test('a path equal to or under the root is kept', () => {
    expect(underRoot('apps/invest', 'apps/invest')).toBe('apps/invest');
    expect(underRoot('apps/invest', 'apps/invest/lib/foo.ts')).toBe('apps/invest/lib/foo.ts');
  });
  test('a leading / is an explicit repo-root path: slash dropped, root not joined', () => {
    expect(underRoot('apps/invest', '/.github/workflows/ci.yml')).toBe('.github/workflows/ci.yml');
    expect(underRoot('', '/docs/a.md')).toBe('docs/a.md');
  });
});

describe('planPackageRoot rejects a non-directory value (#1462 review)', () => {
  const withRoot = (v: string) => `---\npackage_root: ${v}\n---\n`;
  test('the literal template placeholder is no root', () => {
    expect(planPackageRoot(withRoot('<repo-relative dir> | null  # monorepo sub-package'))).toBe('');
  });
  test('absolute, .. and whitespace roots are no root', () => {
    for (const v of ['/apps/invest', '../outside', 'apps/../x', '"apps/my pkg"', 'a|b']) {
      expect(planPackageRoot(withRoot(v))).toBe('');
    }
  });
  test('a plain directory is kept', () => {
    expect(planPackageRoot(withRoot('apps/invest'))).toBe('apps/invest');
  });
});

describe('Scope Amendments apply after the package_root join (#1462 review)', () => {
  const plan = (amendments: string[]) =>
    [
      '---',
      'package_root: apps/invest',
      '---',
      '',
      '## Touch-Paths',
      '',
      '- `lib/foo.ts`',
      '- `lib/old.ts`',
      '- `lib/gone.ts`',
      '- `/.github/workflows/ci.yml`',
      '',
      '## Scope Amendments',
      '',
      ...amendments,
    ].join('\n');
  test('a narrow in package- or repo-relative form drops the joined path', () => {
    expect(
      planTouchPaths(
        plan([
          '- 2026-11-23 — narrow — `lib/old.ts` — package form',
          '- 2026-11-23 — narrow — `apps/invest/lib/gone.ts` — repo form',
        ]),
      ),
    ).toEqual(['apps/invest/lib/foo.ts', '.github/workflows/ci.yml']);
  });
  test('a widen marked repo-root lands outside the package', () => {
    expect(planTouchPaths(plan(['- 2026-11-23 — widen — `/docs/guide.md` — doc'])).at(-1)).toBe('docs/guide.md');
  });
  test('a widen already in repo form is not duplicated', () => {
    const paths = planTouchPaths(plan(['- 2026-11-23 — widen — `apps/invest/lib/foo.ts` — same file']));
    expect(paths.filter((p) => p === 'apps/invest/lib/foo.ts')).toHaveLength(1);
  });
});

describe('a plan path normalizing above the repo root is dropped (#1462 review)', () => {
  test('underRoot returns null and planTouchPaths omits it', () => {
    expect(underRoot('apps/invest', '../../../etc/x')).toBeNull();
    expect(underRoot('', '../x.ts')).toBeNull();
    expect(planTouchPaths('---\npackage_root: apps/invest\n---\n## Touch-Paths\n- `lib/a.ts`\n- `../../../etc/x.ts`\n')).toEqual([
      'apps/invest/lib/a.ts',
    ]);
  });
});
