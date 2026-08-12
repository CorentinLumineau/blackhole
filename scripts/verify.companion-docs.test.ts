import { describe, expect, test } from 'bun:test';
import { COMPANION_FILE_REQUIRED_VCODES, findMissingCompanionVcodes } from './checks/companion-docs.check.ts';

describe('findMissingCompanionVcodes', () => {
  const fixture = `
| V-ADA-01 | ARCHITECTURE.md absent | WARN |
| V-ADA-02 | INDEX.md missing an Accepted ADR | WARN |
| V-ADA-03 | DESIGN.md absent | WARN |
| V-ADA-04 | DESIGN.md token staleness | WARN |
| V-ADA-05/06/07 | AGENTS.md absent or unindexed | WARN |
| V-ADA-08 | Superseded ADR INDEX lifecycle | WARN |
`;

  test('all required codes present in a synthetic fixture returns []', () => {
    expect(findMissingCompanionVcodes(fixture)).toEqual([]);
  });

  test('one code missing returns exactly that code', () => {
    const partial = `
| V-ADA-01 | ARCHITECTURE.md absent | WARN |
| V-ADA-03 | DESIGN.md absent | WARN |
| V-ADA-05/06/07 | AGENTS.md absent or unindexed | WARN |
`;
    expect(findMissingCompanionVcodes(partial)).toEqual(['V-ADA-02', 'V-ADA-04', 'V-ADA-08']);
  });

  test('COMPANION_FILE_REQUIRED_VCODES matches the literal 6-code list', () => {
    expect(COMPANION_FILE_REQUIRED_VCODES).toEqual([
      'V-ADA-01',
      'V-ADA-02',
      'V-ADA-03',
      'V-ADA-04',
      'V-ADA-05/06/07',
      'V-ADA-08',
    ]);
  });
});
