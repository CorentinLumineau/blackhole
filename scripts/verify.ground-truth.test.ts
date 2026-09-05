import { describe, expect, test } from 'bun:test';
import {
  findRosterScanMismatch,
  findRowCountMismatch,
  extractAgentRosterTableNames,
  findReadmeAgentCountMismatch,
  findVcodeNamespaceDrift,
  parseVcodeEnforcementSites,
  findMissingEnforcementSites,
  runChecks,
} from './checks/ground-truth.check.ts';
import { AGENT_NAMES, IMPLEMENTER_GATE_MODULE_COUNT, VCODE_TABLE_ROW_COUNT } from './lib/build/facts.ts';
import { read } from './checks/check-utils.ts';
import { listFiles } from './lib/check-common.ts';

// V-GROUND-01 (ADR-007 T3/R1′): two-sided facts-conformance — an independent filesystem scan is
// compared against build.ts's § facts declaration, never collapsed onto one derivation (the
// critics' binding rejection of single-source generation, ADR-007 Rejected Alternatives).
describe('findRosterScanMismatch', () => {
  test('returns null when the scanned set and the declared set match regardless of order', () => {
    expect(findRosterScanMismatch(['b.md', 'a.md'], ['a.md', 'b.md'])).toBeNull();
  });

  test('names only the symmetric difference (extra) when a fixture agent file is added without a matching AGENT_NAMES edit', () => {
    const declared = [...AGENT_NAMES].map((n) => `${n}.md`);
    const scanned = [...declared, 'stray-new-agent.md'];
    const mismatch = findRosterScanMismatch(scanned, declared);
    expect(mismatch).toBe('extra [stray-new-agent.md]');
  });

  test('names only the symmetric difference (missing) when a declared agent file is removed from disk', () => {
    const declared = [...AGENT_NAMES].map((n) => `${n}.md`);
    const scanned = declared.slice(1); // first agent's file missing from the scan
    const mismatch = findRosterScanMismatch(scanned, declared);
    expect(mismatch).toBe(`missing [${declared[0]}]`);
  });
});

describe('findRowCountMismatch', () => {
  test('returns null when declared count equals actual count', () => {
    expect(findRowCountMismatch('vcode table rows', 43, 43)).toBeNull();
  });

  test('names the label, declared count, and actual count on mismatch', () => {
    expect(findRowCountMismatch('vcode table rows', 43, 44)).toBe(
      'vcode table rows: declared 43, found 44',
    );
  });
});

// V-DOCTABLE-01 (ADR-007 T3/R1′): AGENTS.md's roster table and README.md's agent-count mention
// are hand-authored — checked against the build.ts declaration with a tolerant row-set parser,
// never generated/clobbered (ADR-007 Rejected Alternatives: no generation-in-place).
describe('extractAgentRosterTableNames', () => {
  test('extracts backtick-quoted names from the Agent roster table, tolerant of surrounding prose', () => {
    const content = [
      '# Blackhole',
      '',
      'Some intro prose that mentions `coordinator` in passing (must not be picked up).',
      '',
      '## Agent roster',
      '',
      '| Agent | Role | Trigger |',
      '|-------|------|---------|',
      '| `coordinator` | User intake | Multitask Mode entry |',
      '| `orchestrator` | Five-phase loop | Spawned by coordinator |',
      '',
      '## Installation',
      '',
      'Prose mentioning `orchestrator` again here must not be picked up.',
    ].join('\n');

    expect(extractAgentRosterTableNames(content)).toEqual(['coordinator', 'orchestrator']);
  });

  test('a deliberately-stale AGENTS.md fixture (one roster row missing) fails naming the exact missing row', () => {
    const declared = [...AGENT_NAMES].map((n) => `${n}.md`);
    const staleContent = [
      '## Agent roster',
      '',
      '| Agent | Role | Trigger |',
      '|-------|------|---------|',
      // every agent except the last one — a deliberately-stale fixture roster table
      ...AGENT_NAMES.slice(0, -1).map((n) => `| \`${n}\` | role | trigger |`),
    ].join('\n');

    const found = extractAgentRosterTableNames(staleContent).map((n) => `${n}.md`);
    const mismatch = findRosterScanMismatch(found, declared);
    expect(mismatch).not.toBeNull();
    expect(mismatch).toContain(`${AGENT_NAMES[AGENT_NAMES.length - 1]}.md`);
  });
});

describe('findReadmeAgentCountMismatch', () => {
  test('returns null when the README mentions "<count> agent prompts"', () => {
    const readme = 'Compiles `.agents/build/` (workspace customization — 8 agent prompts, rules, skills)';
    expect(findReadmeAgentCountMismatch(readme, 8)).toBeNull();
  });

  test('names the expected count when the README mentions a stale count', () => {
    const readme = 'Compiles `.agents/build/` (workspace customization — 7 agent prompts, rules, skills)';
    const mismatch = findReadmeAgentCountMismatch(readme, 8);
    expect(mismatch).not.toBeNull();
    expect(mismatch).toContain('8 agent prompts');
  });

  test('names the expected count when the README has no agent-count mention at all', () => {
    const mismatch = findReadmeAgentCountMismatch('no such mention here', 8);
    expect(mismatch).toContain('8 agent prompts');
  });
});

// ADR-021 D5 (issue #495): structural pin against reintroducing the retired V-DOC-02/04 /
// V-DOC-05 ids, or dropping/duplicating either replacement id, in blackhole-vcodes.md's table.
describe('findVcodeNamespaceDrift', () => {
  test('names the retired id when a row still carries V-DOC-02/04', () => {
    const content = [
      '| Code | Rule | Severity |',
      '|------|------|----------|',
      '| V-DOC-02/04 | Public-API and design docs updates in the same PR | BLOCK |',
      '| V-DOCFACT-01 | prose fact check | WARN |',
    ].join('\n');

    const mismatch = findVcodeNamespaceDrift(content);
    expect(mismatch).not.toBeNull();
    expect(mismatch).toContain('V-DOC-02/04');
  });

  test('reclaims V-DOC-05 for comment-discipline rationale duplication (#446)', () => {
    const content = [
      '| Code | Rule | Severity |',
      '|------|------|----------|',
      '| V-DOCSYNC-01 | docs sync | BLOCK |',
      '| V-DOC-05 | Rationale duplicated across definition/interface/call-site/test | WARN |',
      '| V-DOCFACT-01 | prose fact check | WARN |',
    ].join('\n');

    expect(findVcodeNamespaceDrift(content)).toBeNull();
  });

  test('names the missing replacement id when V-DOCSYNC-01 is absent', () => {
    const content = [
      '| Code | Rule | Severity |',
      '|------|------|----------|',
      '| V-DOCFACT-01 | prose fact check | WARN |',
    ].join('\n');

    const mismatch = findVcodeNamespaceDrift(content);
    expect(mismatch).not.toBeNull();
    expect(mismatch).toContain('V-DOCSYNC-01');
  });

  test('names the duplicated replacement id when V-DOCFACT-01 appears twice', () => {
    const content = [
      '| Code | Rule | Severity |',
      '|------|------|----------|',
      '| V-DOCSYNC-01 | docs sync | BLOCK |',
      '| V-DOCFACT-01 | prose fact check | WARN |',
      '| V-DOCFACT-01 | duplicate row | WARN |',
    ].join('\n');

    const mismatch = findVcodeNamespaceDrift(content);
    expect(mismatch).not.toBeNull();
    expect(mismatch).toContain('V-DOCFACT-01');
  });

  test('returns null for the current real blackhole-vcodes.md content', () => {
    const vcodes = read('src/references/blackhole-vcodes.md');
    expect(findVcodeNamespaceDrift(vcodes)).toBeNull();
  });
});

// Issue #508 (leg A of #438): `Primary enforcement site` column — every row must carry a
// non-empty 4th cell. An explicit `none` sentinel counts as non-empty (leg B, issue #509,
// resolves the six codes still marked `none` today) so leg A can go green before leg B lands.
describe('parseVcodeEnforcementSites', () => {
  test('extracts code and 4th-cell site for each V-code row, skipping header/separator rows', () => {
    const content = [
      '| Code | Rule | Severity | Primary enforcement site |',
      '|------|------|----------|--------------------------|',
      '| V-DRY-01 | No >10-line duplication | BLOCK | reviewer.md §3 |',
      '| V-SEC-10 | grep false-positive check | WARN | none |',
    ].join('\n');

    expect(parseVcodeEnforcementSites(content)).toEqual([
      { code: 'V-DRY-01', site: 'reviewer.md §3' },
      { code: 'V-SEC-10', site: 'none' },
    ]);
  });
});

describe('findMissingEnforcementSites', () => {
  test('returns empty array when every row has a non-empty site, including the literal "none" sentinel', () => {
    const rows = [
      { code: 'V-DRY-01', site: 'reviewer.md §3' },
      { code: 'V-SEC-10', site: 'none' },
    ];
    expect(findMissingEnforcementSites(rows)).toEqual([]);
  });

  test('names the code whose 4th cell is empty', () => {
    const rows = [
      { code: 'V-DRY-01', site: 'reviewer.md §3' },
      { code: 'V-CONFIG-01', site: '' },
    ];
    expect(findMissingEnforcementSites(rows)).toEqual(['V-CONFIG-01']);
  });

  test('the real blackhole-vcodes.md table has no row with an empty enforcement-site cell', () => {
    const vcodes = read('src/references/blackhole-vcodes.md');
    const rows = parseVcodeEnforcementSites(vcodes);
    expect(rows.length).toBe(VCODE_TABLE_ROW_COUNT);
    expect(findMissingEnforcementSites(rows)).toEqual([]);
  });
});

// The three check functions this module exports are only reachable through `runChecks` — the
// helpers above are unit-tested in isolation, but the assembly that decides which of them run
// against the live tree was not exercised at all, so a declared fact wired into the wrong
// comparison would pass every test here and still fail `bun run verify`.
describe('runChecks live tree', () => {
  test('all three checks pass against the live repo', () => {
    const results = runChecks();
    expect(results.map((r) => r.id)).toEqual(['V-GROUND-01', 'V-DOCTABLE-01', 'V-GROUND-02']);
    for (const r of results) expect(r, `${r.id}: ${r.detail ?? ''}`).toMatchObject({ ok: true });
  });

  test('IMPLEMENTER_GATE_MODULE_COUNT matches the live src/references/gates/ directory scan', () => {
    expect(listFiles('src/references/gates').length).toBe(IMPLEMENTER_GATE_MODULE_COUNT);
  });
});
