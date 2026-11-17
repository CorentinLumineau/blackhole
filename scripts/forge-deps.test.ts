import { describe, expect, test } from 'bun:test';
import type { PrLanding } from './lib/forge-adapter/pr-landing.ts';
import {
  crossRepoBlockers,
  formatCrossRepoBlocker,
  mergeDependsIntoBody,
  parseCrossRepoDepsFromBody,
  parseDependsFromBody,
} from './forge-deps';

describe('parseDependsFromBody', () => {
  test('parses Blocked by, Depends on, and After merges patterns', () => {
    const body = `
Some prose here.

Blocked by #11
Depends on #12
After #13 merges
Part of #298
`;
    expect(parseDependsFromBody(body)).toEqual([11, 12, 13]);
  });

  test('case-insensitive and dedupes', () => {
    const body = `blocked by #11\nBLOCKED BY #11\nDepends On #12`;
    expect(parseDependsFromBody(body)).toEqual([11, 12]);
  });
});

describe('mergeDependsIntoBody', () => {
  test('adds Blocked by lines under ## Dependencies when missing', () => {
    const body = '## Acceptance criteria\n- [ ] Do thing\n';
    const merged = mergeDependsIntoBody(body, [11]);
    expect(merged).toContain('## Dependencies');
    expect(merged).toContain('Blocked by #11');
    expect(merged).toContain('## Acceptance criteria');
  });

  test('idempotent when body already has Blocked by #11', () => {
    const body = `## Dependencies
Blocked by #11

## Acceptance criteria
- [ ] Do thing
`;
    const merged = mergeDependsIntoBody(body, [11]);
    expect(merged).toBe(body);
  });

  test('normalizes alias and adds missing deps', () => {
    const body = `## Acceptance criteria
- [ ] Do thing

## Dependencies
Depends on #11
`;
    const merged = mergeDependsIntoBody(body, [11, 12]);
    expect(merged).toContain('## Acceptance criteria');
    expect(merged).toContain('- [ ] Do thing');
    expect(merged).not.toContain('Depends on #11');
    expect(merged).toContain('Blocked by #11');
    expect(merged).toContain('Blocked by #12');
    const depLines = merged
      .split('\n')
      .filter((l) => /^Blocked by #\d+$/i.test(l.trim()));
    expect(depLines).toHaveLength(2);
  });

  test('removes dep lines when depends_on is empty', () => {
    const body = `## Acceptance criteria
- [ ] Do thing

## Dependencies
Blocked by #11
`;
    const merged = mergeDependsIntoBody(body, []);
    expect(merged).toContain('## Acceptance criteria');
    expect(merged).toContain('- [ ] Do thing');
    expect(merged).not.toMatch(/Blocked by #11/i);
    expect(merged).not.toMatch(/Depends on #/i);
  });

  test('preserves freeform prose under ## Dependencies when deps change', () => {
    const body = `## Dependencies
Blocked by #5

See tracking sheet for context.

## Acceptance criteria
- [ ] Do thing
`;
    const merged = mergeDependsIntoBody(body, [5, 9]);
    expect(merged).toContain('Blocked by #5');
    expect(merged).toContain('Blocked by #9');
    expect(merged).toContain('See tracking sheet for context.');
    expect(merged).toContain('## Acceptance criteria');
  });

  test('does not rewrite Part of #N lines', () => {
    const body = `Part of #298

## Acceptance criteria
- [ ] Do thing
`;
    const merged = mergeDependsIntoBody(body, [11]);
    expect(merged).toContain('Part of #298');
    expect(merged).toContain('Blocked by #11');
  });
});

describe('round-trip', () => {
  test('parse(merge(body, deps)) equals sorted unique deps', () => {
    const body = `## Acceptance criteria
- [ ] Thing

Depends on #11
Some other prose.
`;
    const deps = [11, 12, 13];
    const merged = mergeDependsIntoBody(body, deps);
    const parsed = parseDependsFromBody(merged);
    expect(parsed).toEqual([...deps].sort((a, b) => a - b));
  });
});

describe('parseCrossRepoDepsFromBody', () => {
  test('reads several cross-repo lines, mixed with same-repo ones, ignoring malformed lines', () => {
    const body = `
Depends on #12
Depends on acme/workflows#185
blocked by Acme.Org/infra-tools#7
After acme/workflows#190 merges
Depends on acme/workflows#185
Depends on acme#185
Depends on acme/workflows/extra#3
Depends on acme/workflows#
depends on acme/workflows#9 please
Part of acme/workflows#1
  Depends on   other/repo#4
`;
    expect(parseCrossRepoDepsFromBody(body)).toEqual([
      { repo: 'acme/workflows', number: 185 },
      { repo: 'Acme.Org/infra-tools', number: 7 },
      { repo: 'acme/workflows', number: 190 },
      { repo: 'other/repo', number: 4 },
    ]);
  });

  test('same-repo parsing is unchanged by cross-repo lines', () => {
    const body = 'Depends on #12\nDepends on acme/workflows#185\nBlocked by #13';
    expect(parseDependsFromBody(body)).toEqual([12, 13]);
  });

  test('a body with no cross-repo line is an empty list', () => {
    expect(parseCrossRepoDepsFromBody('Depends on #12\nprose')).toEqual([]);
  });

  test('the same-repo write-back keeps cross-repo lines', () => {
    const body = 'Intro\n\nDepends on acme/workflows#185\nDepends on #11';
    const merged = mergeDependsIntoBody(body, [11, 12]);
    expect(merged).toContain('Depends on acme/workflows#185');
    expect(parseCrossRepoDepsFromBody(merged)).toEqual([{ repo: 'acme/workflows', number: 185 }]);
    expect(parseDependsFromBody(merged)).toEqual([11, 12]);
  });
});

describe('crossRepoBlockers', () => {
  const landing = (state: PrLanding['state']): PrLanding => ({
    state,
    mergedAt: state === 'merged' ? '2026-11-16T10:00:00Z' : null,
    mergeCommitSha: state === 'merged' ? 'abc123' : null,
  });
  const issues = [
    { number: 6241, body: 'Depends on acme/workflows#185\nDepends on acme/infra#2\nDepends on acme/infra#3\nDepends on acme/infra#4' },
    { number: 6242, body: 'Depends on #6241' },
  ];

  test('only a merged PR in the other repo satisfies a dependency; unreadable is unmet', () => {
    const reads: string[] = [];
    const read = (repo: string, n: number): PrLanding | null => {
      reads.push(`${repo}#${n}`);
      if (repo === 'acme/workflows') return landing('merged');
      if (n === 2) return landing('open');
      if (n === 3) return landing('closed-unmerged');
      return null;
    };
    expect(crossRepoBlockers(issues, read)).toEqual([
      { issue: 6241, dep: { repo: 'acme/infra', number: 2 }, state: 'open' },
      { issue: 6241, dep: { repo: 'acme/infra', number: 3 }, state: 'closed-unmerged' },
      { issue: 6241, dep: { repo: 'acme/infra', number: 4 }, state: 'unreadable' },
    ]);
    expect(reads).toEqual(['acme/workflows#185', 'acme/infra#2', 'acme/infra#3', 'acme/infra#4']);
  });

  test('a reader that throws leaves the dependency unmet', () => {
    const read = (): PrLanding | null => {
      throw new Error('forge down');
    };
    expect(crossRepoBlockers([issues[0]], read).map((b) => b.state)).toEqual(['unreadable', 'unreadable', 'unreadable', 'unreadable']);
  });

  test('each blocker names the other repo PR and why it is unmet', () => {
    expect(formatCrossRepoBlocker({ issue: 6241, dep: { repo: 'acme/infra', number: 2 }, state: 'open' })).toBe(
      '#6241 — blocked by acme/infra#2 (not merged yet)',
    );
    expect(formatCrossRepoBlocker({ issue: 6241, dep: { repo: 'acme/infra', number: 3 }, state: 'closed-unmerged' })).toBe(
      '#6241 — blocked by acme/infra#3 (closed without merging)',
    );
    expect(formatCrossRepoBlocker({ issue: 6241, dep: { repo: 'acme/infra', number: 4 }, state: 'unreadable' })).toBe(
      '#6241 — blocked by acme/infra#4 (merged state unreadable, treated as unmet)',
    );
  });
});
