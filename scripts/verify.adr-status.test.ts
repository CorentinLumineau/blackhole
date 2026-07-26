import { describe, expect, test } from 'bun:test';
import {
  ADR_STATUS_ENUM,
  extractBodyStatusLeadingToken,
  extractFrontmatterStatus,
  findAdrIndexMismatches,
  findBodyStatusMismatches,
  findInvalidAdrStatuses,
  parseIndexStatusMap,
} from './checks/adr-status.check.ts';

// Issue #324: declares and enforces the ADR-specific `status` enum
// (`accepted | superseded | deprecated`) across three surfaces — frontmatter (V-ADR-01),
// documentation/decisions/INDEX.md (V-ADR-02), and the in-body `## Status` section carried by
// 6/14 ADRs (V-ADR-03, discovered during #321's review, ledger F-00006). Modeled on
// verify.design-track.test.ts / verify.single-writer.test.ts's synthetic-fixture shape — pure
// helper functions are imported and exercised directly, independent of runChecks() reading real
// repo files.

const FRONTMATTER_ACCEPTED = `---
type: adr
status: accepted
created: 2026-07-20
---

# ADR-999: Fixture
`;

const FRONTMATTER_NO_STATUS = `---
type: adr
created: 2026-07-20
---

# ADR-999: Fixture
`;

describe('extractFrontmatterStatus', () => {
  test('extracts a bare enum token', () => {
    expect(extractFrontmatterStatus(FRONTMATTER_ACCEPTED)).toBe('accepted');
  });

  test('returns null when status key absent', () => {
    expect(extractFrontmatterStatus(FRONTMATTER_NO_STATUS)).toBeNull();
  });

  test('returns null when no frontmatter block exists', () => {
    expect(extractFrontmatterStatus('# No frontmatter here\n')).toBeNull();
  });
});

describe('ADR_STATUS_ENUM', () => {
  test('is exactly the three ADR-specific tokens, in this order', () => {
    expect(ADR_STATUS_ENUM).toEqual(['accepted', 'superseded', 'deprecated']);
  });
});

describe('findInvalidAdrStatuses (V-ADR-01)', () => {
  test('a fixture with a non-conforming status value fails', () => {
    const files = [{ filename: 'ADR-999-fixture.md', status: 'Accepted' }];
    expect(findInvalidAdrStatuses(files)).toEqual(['ADR-999-fixture.md']);
  });

  test('a fixture with all three conforming values passes', () => {
    const files = [
      { filename: 'ADR-001-a.md', status: 'accepted' },
      { filename: 'ADR-002-b.md', status: 'superseded' },
      { filename: 'ADR-003-c.md', status: 'deprecated' },
    ];
    expect(findInvalidAdrStatuses(files)).toEqual([]);
  });

  test('a missing status (null) fails', () => {
    const files = [{ filename: 'ADR-999-fixture.md', status: null }];
    expect(findInvalidAdrStatuses(files)).toEqual(['ADR-999-fixture.md']);
  });
});

describe('parseIndexStatusMap', () => {
  test('parses status cells keyed by filename, skipping header/separator rows', () => {
    const index = `# Decision Index

| path | summary | type | status | review_trigger |
|------|---------|------|--------|----------------|
| ADR-001-a.md | Fixture A | adr | accepted | on protocol change |
| ADR-002-b.md | Fixture B | adr | superseded | on protocol change |
`;
    const map = parseIndexStatusMap(index);
    expect(map.get('ADR-001-a.md')).toBe('accepted');
    expect(map.get('ADR-002-b.md')).toBe('superseded');
    expect(map.size).toBe(2);
  });
});

describe('findAdrIndexMismatches (V-ADR-02)', () => {
  test('a matching frontmatter/INDEX-row pair passes', () => {
    const files = [{ filename: 'ADR-001-a.md', frontmatterStatus: 'accepted' }];
    const indexMap = new Map([['ADR-001-a.md', 'accepted']]);
    expect(findAdrIndexMismatches(files, indexMap)).toEqual([]);
  });

  test('a mismatched frontmatter/INDEX-row pair fails', () => {
    const files = [{ filename: 'ADR-001-a.md', frontmatterStatus: 'accepted' }];
    const indexMap = new Map([['ADR-001-a.md', 'superseded']]);
    expect(findAdrIndexMismatches(files, indexMap)).toEqual(['ADR-001-a.md']);
  });

  test('a file absent from INDEX.md fails', () => {
    const files = [{ filename: 'ADR-999-fixture.md', frontmatterStatus: 'accepted' }];
    const indexMap = new Map<string, string>();
    expect(findAdrIndexMismatches(files, indexMap)).toEqual(['ADR-999-fixture.md']);
  });
});

describe('extractBodyStatusLeadingToken (V-ADR-03)', () => {
  test('extracts the leading token from an evidence-bearing prose line', () => {
    const content = `---
status: accepted
---

## Status

Accepted — 2026-07-21 (shipped in v0.15.0: \`companion-substrate-closure\` M0 (T1-T5) D1-D4 merged)
`;
    expect(extractBodyStatusLeadingToken(content)).toBe('Accepted');
  });

  test('extracts the leading token from a bare one-word body status', () => {
    const content = `---
status: accepted
---

## Status

Accepted
`;
    expect(extractBodyStatusLeadingToken(content)).toBe('Accepted');
  });

  test('returns null when no in-body Status section exists', () => {
    const content = `---
status: accepted
---

# ADR-999: Fixture

## Context

No Status section here.
`;
    expect(extractBodyStatusLeadingToken(content)).toBeNull();
  });
});

describe('findBodyStatusMismatches (V-ADR-03)', () => {
  test('agreeing leading token (case-insensitive) passes', () => {
    const files = [{ filename: 'ADR-011-x.md', frontmatterStatus: 'accepted', bodyLeadingToken: 'Accepted' }];
    expect(findBodyStatusMismatches(files)).toEqual([]);
  });

  test('disagreeing leading token fails', () => {
    const files = [{ filename: 'ADR-011-x.md', frontmatterStatus: 'accepted', bodyLeadingToken: 'Superseded' }];
    expect(findBodyStatusMismatches(files)).toEqual(['ADR-011-x.md']);
  });

  test('absent body Status section (null token) is tolerated, never fails', () => {
    const files = [{ filename: 'ADR-001-a.md', frontmatterStatus: 'accepted', bodyLeadingToken: null }];
    expect(findBodyStatusMismatches(files)).toEqual([]);
  });

  test('evidence prose after the leading token is irrelevant to the comparison', () => {
    const files = [
      { filename: 'ADR-011-x.md', frontmatterStatus: 'accepted', bodyLeadingToken: 'Accepted' },
      { filename: 'ADR-012-y.md', frontmatterStatus: 'accepted', bodyLeadingToken: 'Accepted' },
    ];
    expect(findBodyStatusMismatches(files)).toEqual([]);
  });
});
