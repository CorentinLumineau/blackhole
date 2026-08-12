import { describe, expect, test } from 'bun:test';
import * as fs from 'fs';
import * as path from 'path';
import {
  ADR_STATUS_ENUM,
  extractAdrNumber,
  extractBodyStatusLeadingToken,
  extractFrontmatterStatus,
  extractSupersessionCitation,
  findAdrIndexMismatches,
  findAdrNumberingCollisions,
  findBodyStatusMismatches,
  findInvalidAdrStatuses,
  findSupersededLifecycleViolations,
  parseIndexStatusMap,
} from './checks/adr-status.check.ts';

// Issue #324: ADR status enum across frontmatter, INDEX, and body § Status (V-ADR-01..03).

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

describe('extractSupersessionCitation (V-ADA-08)', () => {
  test('reads superseded_by frontmatter', () => {
    const content = `---
status: superseded
superseded_by: ADR-003
---
`;
    expect(extractSupersessionCitation(content)).toBe('ADR-003');
  });

  test('reads supersedes ADR reference', () => {
    const content = `---
status: accepted
supersedes: ADR-002
---
`;
    expect(extractSupersessionCitation(content)).toBe('ADR-002');
  });

  test('fixture superseded-without-citation returns null', () => {
    const fixture = fs.readFileSync(
      path.join(import.meta.dirname, '..', 'fixtures', 'adr-status', 'superseded-without-citation.md'),
      'utf-8',
    );
    expect(extractSupersessionCitation(fixture)).toBeNull();
  });
});

describe('findSupersededLifecycleViolations (V-ADA-08)', () => {
  test('passes when INDEX and citation agree', () => {
    const files = [
      {
        filename: 'ADR-002-synthesizer-extraction.md',
        frontmatterStatus: 'superseded',
        indexStatus: 'superseded',
        supersessionCitation: 'ADR-003',
      },
    ];
    expect(findSupersededLifecycleViolations(files)).toEqual([]);
  });

  test('fails superseded without citation', () => {
    const files = [
      {
        filename: 'ADR-999-fixture.md',
        frontmatterStatus: 'superseded',
        indexStatus: 'superseded',
        supersessionCitation: null,
      },
    ];
    expect(findSupersededLifecycleViolations(files)).toEqual(['ADR-999-fixture.md']);
  });
});

describe('findAdrNumberingCollisions', () => {
  test('duplicate ADR-009 fixture numbers fail', () => {
    const fixture = JSON.parse(
      fs.readFileSync(path.join(import.meta.dirname, '..', 'fixtures', 'adr-status', 'duplicate-numbering.json'), 'utf-8'),
    ) as { filenames: string[] };
    const numbers = fixture.filenames.map((f) => extractAdrNumber(f)).filter((n): n is number => n !== null);
    const { duplicates } = findAdrNumberingCollisions(numbers);
    expect(duplicates).toEqual([9]);
  });

  test('live tree has no duplicate numbers', () => {
    const decisionsDir = path.join(import.meta.dirname, '..', 'documentation', 'decisions');
    const numbers = fs
      .readdirSync(decisionsDir)
      .filter((f) => /^ADR-\d+-.*\.md$/.test(f))
      .map((f) => extractAdrNumber(f))
      .filter((n): n is number => n !== null);
    expect(findAdrNumberingCollisions(numbers).duplicates).toEqual([]);
  });
});
