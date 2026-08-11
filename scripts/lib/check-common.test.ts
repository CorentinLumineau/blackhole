import { describe, expect, test } from 'bun:test';
import { findMissingGateMarkers, parseVcodeTableRows } from './check-common.ts';

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
