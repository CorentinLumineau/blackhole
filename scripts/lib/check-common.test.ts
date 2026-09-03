import { describe, expect, test } from 'bun:test';
import { appendIndexRowIfAbsent, findMissingGateMarkers, parseIndexTableRows, parseVcodeTableRows } from './check-common.ts';

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
});
