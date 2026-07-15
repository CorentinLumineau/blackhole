import { describe, expect, test } from 'bun:test';
import { mergeDependsIntoBody, parseDependsFromBody } from './forge-deps';

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
