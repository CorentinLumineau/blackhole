import { describe, expect, test } from 'bun:test';
import * as fs from 'fs';
import * as path from 'path';
import {
  appendIndexRowIfAbsent,
  assertNoEmbeddedNewline,
  byPathByteOrder,
  findAdrFileByNumber,
  findMissingGateMarkers,
  findPipeTableViolations,
  findTableBlock,
  parseIndexTableRows,
  parseVcodeTableRows,
  renderIndexRowLine,
} from './check-common.ts';
import { withTempDir } from './test-fixtures.ts';
import { root } from '../checks/check-utils.ts';

describe('findMissingGateMarkers', () => {
  test('returns the subset of required markers absent from content', () => {
    const content = '5-step gate\n**IDENTIFY** — what needs verification?\n**RUN** — execute now.';
    const required = ['5-step gate', '**IDENTIFY**', '**RUN**', '**READ**', '**VERIFY**', '**CLAIM**'];
    expect(findMissingGateMarkers(content, required)).toEqual(['**READ**', '**VERIFY**', '**CLAIM**']);
  });

  test('returns [] when all required markers are present', () => {
    const content = '5-step gate\n**IDENTIFY**\n**RUN**\n**READ**\n**VERIFY**\n**CLAIM**';
    const required = ['5-step gate', '**IDENTIFY**', '**RUN**', '**READ**', '**VERIFY**', '**CLAIM**'];
    expect(findMissingGateMarkers(content, required)).toEqual([]);
  });
});

// Issue #570/#567/#565 batch: shared `{code, severity, site}[]` parser reused by both
// vcode-severity-sync.check.ts and vcode-citation.check.ts (V-INT-02 — one parser, not two
// divergent ones). Same pipe-table row idiom as adr-status.check.ts's parseIndexStatusMap and
// ground-truth.check.ts's parseVcodeEnforcementSites.
describe('parseVcodeTableRows', () => {
  const FIXTURE_TABLE = `| Code | Rule | Severity | Primary enforcement site |
|------|------|----------|--------------------------|
| V-FAKE-01 | Test rule one | BLOCK | fake.md §1 |
| V-FAKE-02 / V-FAKE-03 | Combined rule | WARN | fake.md §2 (Fake Section) |
`;

  test('parses code/severity/site triples, skipping header and separator rows', () => {
    expect(parseVcodeTableRows(FIXTURE_TABLE)).toEqual([
      { code: 'V-FAKE-01', severity: 'BLOCK', site: 'fake.md §1' },
      { code: 'V-FAKE-02 / V-FAKE-03', severity: 'WARN', site: 'fake.md §2 (Fake Section)' },
    ]);
  });

  test('returns [] for content with no V- rows', () => {
    expect(parseVcodeTableRows('# No table here\n\nJust prose.\n')).toEqual([]);
  });

  test('ignores non-table prose lines interleaved with real rows', () => {
    const content = `Some prose before.\n${FIXTURE_TABLE}Some prose after.\n`;
    expect(parseVcodeTableRows(content)).toEqual([
      { code: 'V-FAKE-01', severity: 'BLOCK', site: 'fake.md §1' },
      { code: 'V-FAKE-02 / V-FAKE-03', severity: 'WARN', site: 'fake.md §2 (Fake Section)' },
    ]);
  });
});

// Issue #573: shared `documentation/**/INDEX.md` 5-column row parser reused by
// doc-health.check.ts's parseRootIndexRows (root INDEX.md, folder-prefixed path) and
// adr-status.check.ts's parseIndexStatusMap (decisions/INDEX.md, bare ADR filename) — this
// helper parses the row shape only; path interpretation and any content filter (e.g. the
// `ADR-` prefix) stay with each caller (V-INT-02).
describe('parseIndexTableRows', () => {
  const FIXTURE_TABLE = `| path | summary | type | status | review_trigger |
|------|---------|------|--------|----------------|
| decisions/ADR-001-x.md | ADR one | adr | current | on ADR acceptance |
| audits/foo.md | Some audit | audit | current | on release |
`;

  test('parses all 5 fields, including a folder-prefixed path', () => {
    expect(parseIndexTableRows(FIXTURE_TABLE)).toEqual([
      { path: 'decisions/ADR-001-x.md', summary: 'ADR one', type: 'adr', status: 'current', reviewTrigger: 'on ADR acceptance' },
      { path: 'audits/foo.md', summary: 'Some audit', type: 'audit', status: 'current', reviewTrigger: 'on release' },
    ]);
  });

  test('skips header and separator rows via the generic path/dash-only filters', () => {
    const rows = parseIndexTableRows(FIXTURE_TABLE);
    expect(rows.some((r) => r.path.toLowerCase() === 'path')).toBe(false);
    expect(rows.some((r) => /^:?-+:?$/.test(r.path))).toBe(false);
  });

  test('returns [] for content with no valid rows', () => {
    expect(parseIndexTableRows('# No table here\n\nJust prose.\n')).toEqual([]);
  });

  test('returns a row whose path does not start with ADR- (ADR- filter is caller-side, not baked in)', () => {
    expect(parseIndexTableRows(FIXTURE_TABLE)).toContainEqual({
      path: 'audits/foo.md',
      summary: 'Some audit',
      type: 'audit',
      status: 'current',
      reviewTrigger: 'on release',
    });
  });
});

// Issue #887 (V-DRY-01 fix): findTableBlock is the schema-agnostic block-boundary primitive
// shared by appendIndexRowIfAbsent below and decision-log-append.ts's insertRecordRowsSorted —
// it never inspects row content, only table structure, so both row schemas can reuse it.
describe('findTableBlock', () => {
  test('locates the separator row and the row block in a normal table', () => {
    const lines = [
      '# Doc',
      '',
      '| path | summary |',
      '|------|---------|',
      '| a.md | A |',
      '| b.md | B |',
      '',
      'Trailing prose.',
    ];
    expect(findTableBlock(lines)).toEqual({ separatorIdx: 3, blockEnd: 6 });
  });

  test('returns separatorIdx: -1 for content with no separator row', () => {
    const lines = ['# Doc', '', 'Just prose, no table at all.'];
    expect(findTableBlock(lines)).toEqual({ separatorIdx: -1, blockEnd: -1 });
  });

  test('a row block that runs to end-of-file reports blockEnd === lines.length', () => {
    const lines = ['| path | summary |', '|------|---------|', '| a.md | A |', '| b.md | B |'];
    const result = findTableBlock(lines);
    expect(result.separatorIdx).toBe(1);
    expect(result.blockEnd).toBe(lines.length);
  });

  // Issue #941 invariance pin — findPipeTableViolations (below) is a sibling function built on
  // top of findTableBlock, not a modification of it. This is a regression pin, not a red/green
  // TDD test: it re-runs the three well-formed fixtures above and asserts the exact same
  // {separatorIdx, blockEnd} values those tests already pin, proving findTableBlock's own
  // contract for a well-formed table is byte-for-byte unchanged by this plan.
  test('issue #941: findTableBlock result is unchanged for well-formed tables (invariance pin)', () => {
    expect(
      findTableBlock(['# Doc', '', '| path | summary |', '|------|---------|', '| a.md | A |', '| b.md | B |', '', 'Trailing prose.']),
    ).toEqual({ separatorIdx: 3, blockEnd: 6 });
    expect(findTableBlock(['# Doc', '', 'Just prose, no table at all.'])).toEqual({ separatorIdx: -1, blockEnd: -1 });
    const endOfFileLines = ['| path | summary |', '|------|---------|', '| a.md | A |', '| b.md | B |'];
    expect(findTableBlock(endOfFileLines)).toEqual({ separatorIdx: 1, blockEnd: endOfFileLines.length });
  });
});

// Issue #743: appendIndexRowIfAbsent inserts each row in path-sorted position instead of
// appending at the end, so concurrent carry/promotion PRs touching the same INDEX.md land at
// different offsets and merge cleanly in the common case. Built on parseIndexTableRows above
// (V-INT-02) for row enumeration.
describe('appendIndexRowIfAbsent — sorted insert', () => {
  const HEADER = `| path | summary | type | status | review_trigger |
|------|---------|------|--------|----------------|
`;

  const row = (p: string) => ({
    path: p,
    summary: `Summary for ${p}`,
    type: 'audit',
    status: 'current',
    reviewTrigger: 'on release',
  });

  const rowLine = (r: ReturnType<typeof row>) =>
    `| ${r.path} | ${r.summary} | ${r.type} | ${r.status} | ${r.reviewTrigger} |`;

  test('(a) insert into an empty table lands the single row correctly', () => {
    const result = appendIndexRowIfAbsent(`# Doc Index\n\n${HEADER}`, row('audits/b.md'));
    expect(result.appended).toBe(true);
    expect(parseIndexTableRows(result.content)).toEqual([row('audits/b.md')]);
  });

  test('(b) insert a row that sorts before an existing row lands it first', () => {
    const content = `# Doc Index\n\n${HEADER}${rowLine(row('audits/m.md'))}\n`;
    const result = appendIndexRowIfAbsent(content, row('audits/a.md'));
    expect(result.appended).toBe(true);
    expect(parseIndexTableRows(result.content).map((r) => r.path)).toEqual([
      'audits/a.md',
      'audits/m.md',
    ]);
  });

  test('(c) insert a row that sorts between two existing rows lands it in the middle, neighbors unchanged', () => {
    const content = `# Doc Index\n\n${HEADER}${rowLine(row('audits/a.md'))}\n${rowLine(row('audits/z.md'))}\n`;
    const result = appendIndexRowIfAbsent(content, row('audits/m.md'));
    expect(result.appended).toBe(true);
    const rows = parseIndexTableRows(result.content);
    expect(rows.map((r) => r.path)).toEqual(['audits/a.md', 'audits/m.md', 'audits/z.md']);
    // Neighbor rows are byte-identical to their original line, not just semantically equal.
    expect(result.content).toContain(rowLine(row('audits/a.md')));
    expect(result.content).toContain(rowLine(row('audits/z.md')));
  });

  test('(d) insert a row that sorts after all existing rows lands it last (parity with old append)', () => {
    const content = `# Doc Index\n\n${HEADER}${rowLine(row('audits/a.md'))}\n`;
    const result = appendIndexRowIfAbsent(content, row('audits/z.md'));
    expect(result.appended).toBe(true);
    expect(parseIndexTableRows(result.content).map((r) => r.path)).toEqual([
      'audits/a.md',
      'audits/z.md',
    ]);
  });

  test('(e) idempotent — re-running the same insert on its own output is a no-op', () => {
    const content = `# Doc Index\n\n${HEADER}${rowLine(row('audits/a.md'))}\n`;
    const first = appendIndexRowIfAbsent(content, row('audits/m.md'));
    expect(first.appended).toBe(true);

    const second = appendIndexRowIfAbsent(first.content, row('audits/m.md'));
    expect(second.appended).toBe(false);
    expect(second.content).toBe(first.content);
  });

  test('(f) a 4-row full-resort case rebuilds the entire block in sorted order, not just local neighbors', () => {
    // Existing rows are deliberately out of path order (simulates the pre-migration
    // append/chronological files described in the plan's Decision Record).
    const content = `# Doc Index\n\n${HEADER}${rowLine(row('audits/z.md'))}\n${rowLine(row('audits/a.md'))}\n${rowLine(row('audits/n.md'))}\n`;
    const result = appendIndexRowIfAbsent(content, row('audits/g.md'));
    expect(result.appended).toBe(true);
    expect(parseIndexTableRows(result.content).map((r) => r.path)).toEqual([
      'audits/a.md',
      'audits/g.md',
      'audits/n.md',
      'audits/z.md',
    ]);
  });

  test('(h) sorts by byte order, not locale-collation — a "_" vs "-" case distinguishes them', () => {
    // "-" (U+002D) < "_" (U+005F) in byte/UTF-16-code-unit order, so
    // "audits/review-fix.md" sorts before "audits/review_fix.md". The runtime's default-locale
    // localeCompare disagrees (ICU collation treats "_" and "-" as near-equivalent separators
    // and falls back to case/other tie-breaks), which would put them in the opposite order —
    // exactly the cross-machine nondeterminism this comparator must avoid (mixed-case and
    // underscored paths already exist in-tree, e.g. `milestones/_archived/`).
    const content = `# Doc Index\n\n${HEADER}${rowLine(row('audits/review-fix.md'))}\n`;
    const result = appendIndexRowIfAbsent(content, row('audits/review_fix.md'));
    expect(result.appended).toBe(true);
    expect(parseIndexTableRows(result.content).map((r) => r.path)).toEqual([
      'audits/review-fix.md',
      'audits/review_fix.md',
    ]);
  });

  test('(g) content with no parseable table still appends at the end rather than throwing', () => {
    const content = '# No table here\n\nJust prose.\n';
    let result: ReturnType<typeof appendIndexRowIfAbsent> | undefined;
    expect(() => {
      result = appendIndexRowIfAbsent(content, row('audits/a.md'));
    }).not.toThrow();
    expect(result?.appended).toBe(true);
    expect(result?.content.startsWith(content)).toBe(true);
    expect(result?.content).toContain(rowLine(row('audits/a.md')));
  });

  // Issue #871 Defect 1: the naive `line.split('|')` used by parseIndexTableRows does not
  // respect GFM's `\|` escape, so a pre-existing row with an escaped pipe in its summary cell
  // misparses into an extra cell, shifting every later column right by one and dropping the
  // final `review_trigger` cell. Re-rendering that misparsed row from its shifted fields then
  // corrupts a row this operation never intended to touch. Byte-for-byte survival of untouched
  // rows is the fix; this fixture pins the exact corrupted output unfixed code produces.
  test('(i) a pre-existing row with an escaped pipe survives byte-for-byte (Defect 1)', () => {
    const escapedRow = '| decisions/ADR-025-validation-idiom.md | `string \\| null` | adr | current | on ADR acceptance |';
    const content = `# Doc Index\n\n${HEADER}${escapedRow}\n`;
    const result = appendIndexRowIfAbsent(content, row('plans/unrelated.md'));
    expect(result.appended).toBe(true);
    expect(result.content).toContain(escapedRow);
    expect(result.content).not.toContain('string \\ | null');
  });

  // Issue #871 Defect 2: when some rows are rendered as bare paths and others as
  // self-referential markdown links (`[path](path)`, mercure schema per a target repo's own
  // convention), raw byte-order comparison sorts `[` (0x5B) ahead of every lowercase path
  // segment (`a`-`z` start at 0x61) — bracket-wrapped rows cluster before bare-path rows
  // regardless of the two paths' true alphabetical order. Canonicalizing the path extraction
  // (unwrapping the markdown link before comparing) restores true path order.
  test('(j) a markdown-link-wrapped row sorts by its unwrapped path, not raw byte order (Defect 2)', () => {
    const linkRow = '| [plans/zzz.md](plans/zzz.md) | Zzz summary | plan | current | on release |';
    const content = `# Doc Index\n\n${HEADER}${linkRow}\n`;
    const result = appendIndexRowIfAbsent(content, row('audits/a.md'));
    expect(result.appended).toBe(true);
    expect(parseIndexTableRows(result.content).map((r) => r.path)).toEqual([
      'audits/a.md',
      '[plans/zzz.md](plans/zzz.md)',
    ]);
  });

  // Issue #871 idempotency check: the dedup guard (line ~210) must canonicalize the same way
  // the sort key does, or a row already present in link-wrapped form is not recognized as
  // present when the bare-path equivalent is offered — the carry-step would then double-insert
  // it on a re-spawn against a repo using mercure's link-wrapped rendering convention.
  test('(k) a row already present in link-wrapped form is not re-inserted when offered bare (Defect 2 dedup)', () => {
    const linkRow = '| [plans/zzz.md](plans/zzz.md) | Zzz summary | plan | current | on release |';
    const content = `# Doc Index\n\n${HEADER}${linkRow}\n`;
    const result = appendIndexRowIfAbsent(content, row('plans/zzz.md'));
    expect(result.appended).toBe(false);
    expect(result.content).toBe(content);
  });

  // An excluded-character href group (`[^)]*`) cannot span a literal `)` inside the href
  // itself, so a self-referential link whose path contains parens (e.g. `notes(final).md`) is
  // never unwrapped at all — the dedup guard and sort key then compare the whole bracketed
  // markdown instead of the underlying path, reintroducing a double-insert/mis-sort failure.
  // Table-driven over the degenerate matrix that surfaces this, so the regression can't slip
  // back in silently.
  test.each([
    // [label, existing row's raw path-cell text, offered path expected to canonicalize to
    //  the same string (so appendIndexRowIfAbsent must treat it as already present)]
    ['text differs from href — href wins', '[abc](def)', 'def'],
    ['nested brackets in link text — unparseable, falls back to raw text', '[[a]](x)', '[[a]](x)'],
    ['unclosed bracket — unparseable, falls back to raw text', '[abc', '[abc'],
    ['bare path containing a bracket, not link-shaped — falls back to raw text', 'abc[def].md', 'abc[def].md'],
    ['empty link — both groups empty, canonicalizes to the empty string', '[]()', ''],
    ['bare path with parens, not link-shaped — falls back to raw text', 'docs/report(v2).md', 'docs/report(v2).md'],
    [
      'a link immediately followed by a stray closing paren — degenerate, canonicalizes past its true boundary',
      '[a](b))',
      'b)',
    ],
    [
      'two links folded into one cell — degenerate, greedy backtrack garbles across both',
      '[a](b) [c](d)',
      'b) [c](d',
    ],
    [
      'self-referential link whose path contains parens (the reported regression)',
      '[docs/notes(final).md](docs/notes(final).md)',
      'docs/notes(final).md',
    ],
  ])('canonicalizes %s', (_label, existingCell, offeredPath) => {
    const content = `# Doc Index\n\n${HEADER}| ${existingCell} | Summary | ref | current | quarterly |\n`;
    const result = appendIndexRowIfAbsent(content, row(offeredPath));
    expect(result.appended).toBe(false);
    expect(result.content).toBe(content);
  });

  // Same case as the table above, isolated as its own test so the red-before-green evidence
  // is unambiguous: against the pre-fix regex (`[^)]*` for the href group) this fails because
  // the parenthetical href is never unwrapped, so `appended` comes back `true` and a duplicate
  // row is inserted alongside the original instead of being recognized as the same path.
  test('a parenthetical self-referential link is recognized as a duplicate of its bare path (regression)', () => {
    const linkRow = '| [docs/notes(final).md](docs/notes(final).md) | Notes | ref | current | quarterly |';
    const content = `# Doc Index\n\n${HEADER}${linkRow}\n`;
    const result = appendIndexRowIfAbsent(content, row('docs/notes(final).md'));
    expect(result.appended).toBe(false);
    expect(result.content).toBe(content);
  });

  // Mirrors test (j) above but with a parenthetical path: the link-wrapped row must sort by
  // its unwrapped path ('docs/notes(final).md'), landing between 'audits/z.md' and
  // 'plans/aaa.md' — not by its raw bracket text (which would sort before every bare path,
  // since '[' is 0x5B, ahead of the lowercase range).
  test('a parenthetical self-referential link sorts by its unwrapped path, not raw byte order', () => {
    const linkRow = '[docs/notes(final).md](docs/notes(final).md)';
    const content = `# Doc Index\n\n${HEADER}${rowLine(row('audits/z.md'))}\n${rowLine(row('plans/aaa.md'))}\n`;
    const withLink = appendIndexRowIfAbsent(content, row(linkRow));
    expect(withLink.appended).toBe(true);

    const result = appendIndexRowIfAbsent(withLink.content, row('docs/mmm.md'));
    expect(result.appended).toBe(true);
    expect(parseIndexTableRows(result.content).map((r) => r.path)).toEqual([
      'audits/z.md',
      'docs/mmm.md',
      linkRow,
      'plans/aaa.md',
    ]);
  });

  // Judgment call on the `[]()` empty-link degenerate case (both groups empty, per the matrix
  // above): two distinct empty-link rows would canonicalize to the same "" path and the second
  // would be treated as a duplicate of the first. An empty markdown link is not a shape any
  // real INDEX.md row-generator produces (every row carries a non-empty repo-relative path —
  // `doc-governance.md` § Lifecycle Frontmatter), so this is accepted as a non-issue rather
  // than special-cased: fixing it would add a rejection path for a malformed input the schema
  // already rules out, for a case that cannot occur in practice (YAGNI).
  //
  // The same judgment extends to the two further degenerate shapes pinned above —
  // `[a](b))` (a stray closing paren immediately after a well-formed link) and
  // `[a](b) [c](d)` (two links folded into one cell, greedy-backtracking across both) —
  // both accepted unspecified-input behaviour rather than defects, on the same footing as
  // `[]()`. None of today's `RootIndexRow` producers can emit either shape: one walks real
  // files on disk, one renders a hardcoded literal, and one copies a staged `target_path` —
  // none constructs a cell by string-concatenating multiple links or trailing punctuation.
  // That is a claim about today's producers, though, not an invariant the parser enforces —
  // `parseIndexTableRows` only filters a literally-empty raw cell, not a link that
  // *canonicalizes* to empty or to a garbled substring, so a malformed row entering by some
  // other route (a hand edit, a foreign repo's file, a future producer) is not structurally
  // ruled out. That gap is self-limiting — a resulting path collision would surface as a
  // dangling or duplicate INDEX row, not silent corruption — but it is a real gap between
  // what this comment claims and what the code enforces, not a guarantee.
  //
  // Given that, `canonicalIndexPath` keeps its current best-effort unwrap rather than
  // rejecting a cell outside the two schema-supported row shapes (a bare path, or an exact
  // `[path](path)`) outright: no current consumer is affected by the degenerate cases, and a
  // stricter regex risks re-breaking the parenthetical self-referential-link case above,
  // which is exactly what the widening exists to keep working. A stricter regex is a
  // separate trade with its own evidence, not something to fold in here.
  test('two distinct empty-link rows would collide on canonicalization, by design (documented, not fixed)', () => {
    const content = `# Doc Index\n\n${HEADER}| []() | First | ref | current | quarterly |\n`;
    const result = appendIndexRowIfAbsent(content, row(''));
    expect(result.appended).toBe(false);
  });
});

// Issue #811 (ADR-031 Phase 1, Task 1/2): `byPathByteOrder` and `renderIndexRowLine` were
// private helpers inside appendIndexRowIfAbsent's implementation above; the new generator
// (scripts/lib/doc-index-generate.ts) needs to reuse the exact same comparator and row-render
// logic rather than re-implementing a second sort/render (V-INT-02). These tests assert the
// exported behavior matches what appendIndexRowIfAbsent already exercises indirectly above.
describe('byPathByteOrder (exported)', () => {
  const row = (p: string) => ({ path: p, summary: '', type: 'audit', status: 'current', reviewTrigger: 'on release' });

  test('sorts by byte order on the path field', () => {
    const rows = [row('audits/z.md'), row('audits/a.md'), row('audits/m.md')];
    expect(rows.sort(byPathByteOrder).map((r) => r.path)).toEqual(['audits/a.md', 'audits/m.md', 'audits/z.md']);
  });

  test('returns 0 for equal paths, negative when a < b, positive when a > b', () => {
    expect(byPathByteOrder(row('a.md'), row('a.md'))).toBe(0);
    expect(byPathByteOrder(row('a.md'), row('b.md'))).toBeLessThan(0);
    expect(byPathByteOrder(row('b.md'), row('a.md'))).toBeGreaterThan(0);
  });

  test('sorts by byte order, not locale-collation, on "-" vs "_"', () => {
    const rows = [row('audits/review_fix.md'), row('audits/review-fix.md')];
    expect(rows.sort(byPathByteOrder).map((r) => r.path)).toEqual(['audits/review-fix.md', 'audits/review_fix.md']);
  });
});

describe('renderIndexRowLine (exported)', () => {
  test('renders the exact "| p | s | t | st | rt |" line shape', () => {
    const row = { path: 'audits/foo.md', summary: 'Some audit', type: 'audit', status: 'current', reviewTrigger: 'on release' };
    expect(renderIndexRowLine(row)).toBe('| audits/foo.md | Some audit | audit | current | on release |');
  });

  test('output round-trips through parseIndexTableRows', () => {
    const row = { path: 'audits/foo.md', summary: 'Some audit', type: 'audit', status: 'current', reviewTrigger: 'on release' };
    const line = renderIndexRowLine(row);
    const header = '| path | summary | type | status | review_trigger |\n|------|---------|------|--------|----------------|\n';
    expect(parseIndexTableRows(`${header}${line}\n`)).toEqual([row]);
  });
});

// Issue #941: check-common.ts shares the exact silent-row-split class issue #940 fixed in
// decision-log-append.ts (see that file's assertNoEmbeddedNewline definition-site comment) —
// renderIndexRowLine wrote a pipe-table row with no check that a cell value carries an embedded
// \n/\r, silently splitting the row across two physical lines. Guarding here covers both of this
// file's row-construction paths (appendIndexRowIfAbsent's two write branches, plus
// doc-index-generate.ts's direct calls) for free, since all of them render through this one
// function.
describe('renderIndexRowLine — embedded newline/carriage-return rejection (issue #941)', () => {
  test('throws naming the field and the row path when summary contains an embedded newline', () => {
    const row = { path: 'audits/foo.md', summary: 'Contains a\nnewline', type: 'audit', status: 'current', reviewTrigger: 'on release' };
    expect(() => renderIndexRowLine(row)).toThrow(/summary/);
    try {
      renderIndexRowLine(row);
      throw new Error('expected renderIndexRowLine to throw');
    } catch (err) {
      expect((err as Error).message).toContain('audits/foo.md');
    }
  });

  test('throws naming the field when path contains an embedded carriage-return', () => {
    const row = { path: 'audits/a\rb.md', summary: 'Fine', type: 'audit', status: 'current', reviewTrigger: 'on release' };
    expect(() => renderIndexRowLine(row)).toThrow(/path/);
  });

  test('appendIndexRowIfAbsent throws rather than inserting a row with an embedded newline', () => {
    const table = `| path | summary | type | status | review_trigger |
|------|---------|------|--------|----------------|
| audits/a.md | A | audit | current | on release |
`;
    const badRow = { path: 'audits/b.md', summary: 'Bad\nsummary', type: 'audit', status: 'current', reviewTrigger: 'on release' };
    expect(() => appendIndexRowIfAbsent(table, badRow)).toThrow();
  });
});

// Issue #941 leg 2: findPipeTableViolations is a passive, exported structural-violation check —
// a sibling function built on the unmodified findTableBlock (see the invariance pin above) — that
// reports a pipe-table row found after findTableBlock's own detected block end, the exact
// signature of an already-corrupted table (mirrors decision-log-append.ts's
// findRecordsTableViolations, issue #940). Schema-agnostic: it never inspects row content, only
// "does a |-prefixed line appear past the block end", so one function serves both the INDEX
// 5-column schema and the vcodes 4-column schema (V-DRY-01).
describe('findPipeTableViolations (issue #941 regression guard)', () => {
  test('returns [] for a well-formed table followed by ordinary trailing prose', () => {
    const content = `| Code | Rule | Severity | Primary enforcement site |
|------|------|----------|--------------------------|
| V-FAKE-01 | Test rule one | BLOCK | fake.md §1 |
| V-FAKE-02 | Test rule two | WARN | fake.md §2 |

**BLOCK** = must fix before merge (or escalate to user with justification).
**WARN** = fix or document deferral in PR and ledger.
`;
    expect(findPipeTableViolations(content)).toEqual([]);
  });

  test('flags a pipe-table row found after the detected block end (orphaned-continuation split)', () => {
    // Shaped exactly like the live #940 incident: a row's middle cell is split by a raw \n
    // across two physical lines, followed by at least one further well-formed row — the tail
    // and the further row both land past findTableBlock's blockEnd.
    const content = `| path | summary | type | status | review_trigger |
|------|---------|------|--------|----------------|
| audits/a.md | A
split summary | audit | current | on release |
| audits/b.md | B | audit | current | on release |
`;
    const violations = findPipeTableViolations(content);
    expect(violations.length).toBeGreaterThan(0);
    expect(violations.some((v) => v.includes('audits/b.md'))).toBe(true);
  });
});

// Live-file regression guard (issue #941): asserts today's committed files carry zero pipe-table
// structural corruption. Runs on every `bun test`, same "sufficient to catch recurrence" posture
// #940 established for decision-log.md's own live-file test.
describe('documentation/**/INDEX.md and blackhole-vcodes.md structural integrity (issue #941 regression guard)', () => {
  test('documentation/INDEX.md has no orphaned pipe-table rows', () => {
    const content = fs.readFileSync(path.join(root, 'documentation/INDEX.md'), 'utf-8');
    expect(findPipeTableViolations(content)).toEqual([]);
  });

  test('documentation/decisions/INDEX.md has no orphaned pipe-table rows', () => {
    const content = fs.readFileSync(path.join(root, 'documentation/decisions/INDEX.md'), 'utf-8');
    expect(findPipeTableViolations(content)).toEqual([]);
  });

  test('src/references/blackhole-vcodes.md has no orphaned pipe-table rows', () => {
    const content = fs.readFileSync(path.join(root, 'src/references/blackhole-vcodes.md'), 'utf-8');
    expect(findPipeTableViolations(content)).toEqual([]);
  });
});

// Issue #903 — extracted from design-aggregate.ts / adr-supersession.check.ts (rule-of-two
// duplicate, F-00097). Direct unit-test pin, alongside the indirect characterization tests
// added at both call sites (design-aggregate.test.ts, verify.adr-supersession.test.ts).
describe('findAdrFileByNumber', () => {
  test('a not-found ADR reference resolves null, never throws', () => {
    withTempDir('check-common-adr-', (dir) => {
      expect(findAdrFileByNumber(dir, 'ADR-042')).toBeNull();
    });
  });

  test('prefix-match discriminator: ADR-007 resolves only ADR-007-foo.md, never ADR-0071-bar.md', () => {
    withTempDir('check-common-adr-', (dir) => {
      fs.writeFileSync(path.join(dir, 'ADR-007-foo.md'), 'foo');
      fs.writeFileSync(path.join(dir, 'ADR-0071-bar.md'), 'bar');
      expect(findAdrFileByNumber(dir, 'ADR-007')).toBe(path.join(dir, 'ADR-007-foo.md'));
    });
  });

  test('a missing decisionsDir resolves null, never an ENOENT throw', () => {
    withTempDir('check-common-adr-', (dir) => {
      const missingDir = path.join(dir, 'does-not-exist');
      expect(findAdrFileByNumber(missingDir, 'ADR-007')).toBeNull();
    });
  });
});
