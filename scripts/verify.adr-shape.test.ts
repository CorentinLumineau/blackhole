import { describe, expect, test } from 'bun:test';
import { ADR_SHAPES } from './lib/build/facts.ts';
import { DESIGN_TRACK_REQUIRED_HEADINGS } from './checks/design-track.check.ts';
import { classifyAdrShape, extractAdrHeadings, findMalformedAdrShapes } from './checks/adr-shape.check.ts';

// Issue #711: ADR heading-shape conformance. `ADR_SHAPES` (facts.ts) declares the two shapes
// once; this file exercises the pure classification functions against literal fixtures, per
// this plan's Codebase Conventions (no fs/tmpdir — `checkAdrShapeConformance()`'s file I/O is
// the one untested thin-checker layer, matching adr-status.check.ts's own split).

const CLASSIC_FIXTURE = `---
type: adr
status: accepted
---

# ADR-999: Fixture

## Status

Accepted.

## Context

Some context.

## Decision

The decision.

## Alternatives Considered

- Option A — rejected because X.

## Consequences

Some consequences.
`;

const DESIGN_TRACK_FIXTURE = `# Design note

## Requirements Framing

...

## Options + Trade-off Matrix

...

## Adversarial Evaluation

...

## Component Decomposition

...

## Design Principles Validation

...

## Refactoring Impact Analysis

...

## Assumption Audit

...

## Gate

status: blocked
`;

const MALFORMED_FIXTURE = `# ADR-998: Fixture

## Context

Some context, no Status/Alternatives/Consequences sections.

## Decision

The decision.
`;

describe('DESIGN_TRACK_REQUIRED_HEADINGS (re-exported from design-track.check.ts)', () => {
  test('still equals the 8 designTrack headings verbatim, sourced from ADR_SHAPES', () => {
    expect(DESIGN_TRACK_REQUIRED_HEADINGS).toEqual(ADR_SHAPES.designTrack);
    expect(DESIGN_TRACK_REQUIRED_HEADINGS).toEqual([
      '## Requirements Framing',
      '## Options + Trade-off Matrix',
      '## Adversarial Evaluation',
      '## Component Decomposition',
      '## Design Principles Validation',
      '## Refactoring Impact Analysis',
      '## Assumption Audit',
      '## Gate',
    ]);
  });
});

describe('ADR_SHAPES.classic', () => {
  test('is exactly the 5 narrative-decision headings verbatim', () => {
    expect(ADR_SHAPES.classic).toEqual(['## Status', '## Context', '## Decision', '## Alternatives Considered', '## Consequences']);
  });
});

describe('extractAdrHeadings', () => {
  test('extracts every ## heading verbatim, in document order', () => {
    expect(extractAdrHeadings(CLASSIC_FIXTURE)).toEqual([
      '## Status',
      '## Context',
      '## Decision',
      '## Alternatives Considered',
      '## Consequences',
    ]);
  });

  test('returns [] when no ## headings are present', () => {
    expect(extractAdrHeadings('# Title\n\nSome prose, no ## headings.\n')).toEqual([]);
  });
});

describe('classifyAdrShape', () => {
  test('classic fixture headings classify as classic', () => {
    expect(classifyAdrShape(extractAdrHeadings(CLASSIC_FIXTURE))).toBe('classic');
  });

  test('designTrack fixture headings classify as designTrack', () => {
    expect(classifyAdrShape(extractAdrHeadings(DESIGN_TRACK_FIXTURE))).toBe('designTrack');
  });

  test('malformed fixture headings classify as null (matches neither shape)', () => {
    expect(classifyAdrShape(extractAdrHeadings(MALFORMED_FIXTURE))).toBeNull();
  });

  test('extra headings beyond a shape\'s required set do not break the match', () => {
    const withExtra = extractAdrHeadings(CLASSIC_FIXTURE + '\n## Related Work\n\nSee also X.\n');
    expect(classifyAdrShape(withExtra)).toBe('classic');
  });
});

describe('findMalformedAdrShapes', () => {
  test('a mixed file list returns an entry only for the malformed one, naming its closest shape', () => {
    const files = [
      { filename: 'ADR-100-classic.md', headings: extractAdrHeadings(CLASSIC_FIXTURE) },
      { filename: 'ADR-101-design-track.md', headings: extractAdrHeadings(DESIGN_TRACK_FIXTURE) },
      { filename: 'ADR-998-fixture.md', headings: extractAdrHeadings(MALFORMED_FIXTURE) },
    ];
    const malformed = findMalformedAdrShapes(files);
    expect(malformed).toHaveLength(1);
    expect(malformed[0].filename).toBe('ADR-998-fixture.md');
    expect(malformed[0].closest).toBe('classic');
    expect(malformed[0].missing).toEqual(['## Status', '## Alternatives Considered', '## Consequences']);
  });

  test('an empty malformed list when every file classifies', () => {
    const files = [{ filename: 'ADR-100-classic.md', headings: extractAdrHeadings(CLASSIC_FIXTURE) }];
    expect(findMalformedAdrShapes(files)).toEqual([]);
  });
});
