import { describe, expect, test } from 'bun:test';
import {
  extractManifestExampleJson,
  extractProducerFieldValueLiterals,
  findManifestExampleEnumViolations,
  findManifestFieldNameMismatch,
  findMissingMandatoryPairing,
  findProducerEnumViolations,
  parseManifestFieldTable,
  runChecks,
} from './checks/staging-schema.check.ts';

// Issue #482: pins the ADR-021 D1 staging contract (`.blackhole/staged/<issue>/manifest.json`'s
// field names and enum values, documented in `blackhole-state.md` § Staging) against silent
// drift across its two in-repo normative surfaces — the doc's own JSON example + field table
// (V-STAGE-01), and the `planner`/`investigator` producer prompts' literal declarations
// (V-STAGE-02). Modeled on verify.adr-status.test.ts's synthetic-fixture shape — pure helper
// functions are exercised directly, independent of runChecks() reading real repo files.

const FIELD_TABLE = `| Field | Values | Notes |
|---|---|---|
| \`entries[].route\` | \`analyze\` \\| \`investigate\` \\| \`design\` \\| \`brainstorm\` \\| \`plan\` \\| \`review\` | Matches the route table |
| \`entries[].produced_by\` | \`planner\` \\| \`investigator\` \\| \`implementer\` | Producer agent |
| \`entries[].sub_mode\` | \`research\` \\| \`investigate\` \\| \`analyze\` \\| \`null\` | Set by investigator entries |
| \`issue\` | number | Matches the issue directory name |
`;

describe('parseManifestFieldTable', () => {
  test('parses an enum row into {field, enumValues}', () => {
    const rows = parseManifestFieldTable(FIELD_TABLE);
    const route = rows.find((r) => r.field === 'entries[].route');
    expect(route).toBeDefined();
    expect(route!.enumValues).toEqual(['analyze', 'investigate', 'design', 'brainstorm', 'plan', 'review']);
  });

  test('parses a nullable-enum row, including the literal null token', () => {
    const rows = parseManifestFieldTable(FIELD_TABLE);
    const subMode = rows.find((r) => r.field === 'entries[].sub_mode');
    expect(subMode).toBeDefined();
    expect(subMode!.enumValues).toEqual(['research', 'investigate', 'analyze', 'null']);
  });

  test('parses a bare-type row with enumValues null', () => {
    const rows = parseManifestFieldTable(FIELD_TABLE);
    const issue = rows.find((r) => r.field === 'issue');
    expect(issue).toBeDefined();
    expect(issue!.enumValues).toBeNull();
  });

  test('skips header and separator rows', () => {
    const rows = parseManifestFieldTable(FIELD_TABLE);
    expect(rows.some((r) => r.field === 'Field')).toBe(false);
    expect(rows.length).toBe(4);
  });
});

describe('extractManifestExampleJson', () => {
  test('parses the first fenced json block', () => {
    const content = [
      'prose before',
      '```json',
      '{ "issue": 465, "entries": [{ "route": "design" }] }',
      '```',
      'prose after',
    ].join('\n');
    const parsed = extractManifestExampleJson(content);
    expect(parsed.issue).toBe(465);
    expect(parsed.entries[0].route).toBe('design');
  });
});

describe('findManifestFieldNameMismatch (V-STAGE-01)', () => {
  const tableFieldNames = ['issue', 'updated_at', 'entries[].route', 'entries[].sub_mode'];

  test('a matching example/table field set passes (returns null)', () => {
    const example = {
      issue: 465,
      updated_at: '2026-08-06T18:00:00.000Z',
      entries: [{ route: 'design', sub_mode: null }],
    };
    expect(findManifestFieldNameMismatch(example, tableFieldNames)).toBeNull();
  });

  test('an example field absent from the table names the mismatch', () => {
    const example = {
      issue: 465,
      updated_at: '2026-08-06T18:00:00.000Z',
      entries: [{ route: 'design', sub_mode: null, extra_field: 'x' }],
    };
    const mismatch = findManifestFieldNameMismatch(example, tableFieldNames);
    expect(mismatch).not.toBeNull();
    expect(mismatch).toContain('entries[].extra_field');
  });
});

describe('findManifestExampleEnumViolations (V-STAGE-01)', () => {
  const rows = parseManifestFieldTable(FIELD_TABLE);

  test('a passing fixture — every entries[] value is a member of its field enum', () => {
    const example = { entries: [{ route: 'design', sub_mode: null }] };
    expect(findManifestExampleEnumViolations(example, rows)).toEqual([]);
  });

  test('a drifted fixture — a route value absent from the field table enum fails', () => {
    const example = { entries: [{ route: 'unpublished', sub_mode: null }] };
    const violations = findManifestExampleEnumViolations(example, rows);
    expect(violations.length).toBeGreaterThan(0);
    expect(violations[0]).toContain('route');
    expect(violations[0]).toContain('unpublished');
  });
});

describe('extractProducerFieldValueLiterals', () => {
  test('extracts a quoted literal', () => {
    const content = 'append a manifest entry (`route: "analyze"`, `sub_mode: "analyze"`)';
    const literals = extractProducerFieldValueLiterals(content);
    expect(literals).toContainEqual({ field: 'route', value: 'analyze' });
    expect(literals).toContainEqual({ field: 'sub_mode', value: 'analyze' });
  });

  test('extracts a bare (unquoted) literal', () => {
    const content = '`route: investigate`, `sub_mode: investigate`, `produced_by: investigator`';
    const literals = extractProducerFieldValueLiterals(content);
    expect(literals).toContainEqual({ field: 'route', value: 'investigate' });
    expect(literals).toContainEqual({ field: 'produced_by', value: 'investigator' });
  });

  test('matches a literal whose backtick span is broken by a hard-wrapped newline', () => {
    const content = 'append a manifest entry (`route: "analyze"`, `sub_mode: "analyze"`, `produced_by:\n"planner"`, `target_kind: "append_row"`';
    const literals = extractProducerFieldValueLiterals(content);
    expect(literals).toContainEqual({ field: 'produced_by', value: 'planner' });
  });
});

describe('findProducerEnumViolations (V-STAGE-02)', () => {
  const rows = parseManifestFieldTable(FIELD_TABLE);

  test('a passing fixture — every producer literal is a member of its field enum', () => {
    const literals = [
      { field: 'route', value: 'analyze', source: 'planner.md' },
      { field: 'sub_mode', value: 'investigate', source: 'investigator.md' },
    ];
    expect(findProducerEnumViolations(literals, rows)).toEqual([]);
  });

  test('a drifted fixture — an undocumented route value names the field, value, and source file', () => {
    const literals = [{ field: 'route', value: 'made_up_route', source: 'planner.md' }];
    const violations = findProducerEnumViolations(literals, rows);
    expect(violations.length).toBe(1);
    expect(violations[0]).toContain('route');
    expect(violations[0]).toContain('made_up_route');
    expect(violations[0]).toContain('planner.md');
  });
});

// Issue #782: pins the mandatory-pairing prose callout to each producer staging-obligation
// site (V-STAGE-03) — see .blackhole/plans/issue-782.md for the full root-cause writeup
// (non-uniform execution of a present instruction, not an absent one).

describe('findMissingMandatoryPairing (V-STAGE-03)', () => {
  const anchors = ['ANCHOR_A', 'ANCHOR_B', 'ANCHOR_C', 'ANCHOR_D'];
  const phrase = 'does not satisfy ADR-021 D3';

  test('all anchors present, each followed by the phrase before the next anchor — []', () => {
    const content = [
      'prefix',
      'ANCHOR_A ... does not satisfy ADR-021 D3 ...',
      'ANCHOR_B ... does not satisfy ADR-021 D3 ...',
      'ANCHOR_C ... does not satisfy ADR-021 D3 ...',
      'ANCHOR_D ... does not satisfy ADR-021 D3 ...',
      'suffix',
    ].join('\n');
    expect(findMissingMandatoryPairing(content, anchors, phrase)).toEqual([]);
  });

  test("one anchor's window is missing the phrase — array of length 1 naming that anchor", () => {
    const content = [
      'prefix',
      'ANCHOR_A ... does not satisfy ADR-021 D3 ...',
      'ANCHOR_B ... no callout here at all ...',
      'ANCHOR_C ... does not satisfy ADR-021 D3 ...',
      'ANCHOR_D ... does not satisfy ADR-021 D3 ...',
      'suffix',
    ].join('\n');
    const missing = findMissingMandatoryPairing(content, anchors, phrase);
    expect(missing.length).toBe(1);
    expect(missing[0]).toContain('ANCHOR_B');
  });

  test('an anchor string absent from the content entirely — "anchor not found: ..."', () => {
    const content = [
      'ANCHOR_A ... does not satisfy ADR-021 D3 ...',
      'ANCHOR_C ... does not satisfy ADR-021 D3 ...',
      'ANCHOR_D ... does not satisfy ADR-021 D3 ...',
    ].join('\n');
    const missing = findMissingMandatoryPairing(content, anchors, phrase);
    expect(missing.length).toBe(1);
    expect(missing[0]).toContain('anchor not found');
    expect(missing[0]).toContain('ANCHOR_B');
  });

  test('document-order windowing: a later anchor\'s phrase must not satisfy an earlier anchor', () => {
    // ANCHOR_A's window is [posA, posB) — it has no phrase in that span, so it must be
    // flagged missing even though the phrase does appear later, inside ANCHOR_B's own
    // window [posB, EOF). A naive fixed-size or anchor-array-order window could wrongly
    // let ANCHOR_B's phrase satisfy ANCHOR_A.
    const twoAnchors = ['ANCHOR_A', 'ANCHOR_B'];
    const content = 'prefix ANCHOR_A middle ANCHOR_B suffix does not satisfy ADR-021 D3 end';
    const missing = findMissingMandatoryPairing(content, twoAnchors, phrase);
    expect(missing.length).toBe(1);
    expect(missing[0]).toContain('ANCHOR_A');
    expect(missing.join(' ')).not.toContain('ANCHOR_B');
  });
});

describe('runChecks (real tree)', () => {
  test('returns exactly V-STAGE-01 through V-STAGE-03, in that order', () => {
    const results = runChecks();
    expect(results.map((r) => r.id)).toEqual(['V-STAGE-01', 'V-STAGE-02', 'V-STAGE-03']);
  });

  test('all three checks pass against the current, unmodified tree', () => {
    const results = runChecks();
    for (const r of results) {
      expect(r.ok).toBe(true);
    }
  });
});
