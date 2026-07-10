import { describe, expect, test } from 'bun:test';
import { COMPANION_FILE_REQUIRED_VCODES, findMissingCompanionVcodes } from './verify.ts';

describe('findMissingCompanionVcodes', () => {
  test('all 4 required codes present in a synthetic fixture returns []', () => {
    const fixture = `
| V-ADA-01 | ARCHITECTURE.md absent | WARN |
| V-ADA-02 | INDEX.md missing an Accepted ADR | WARN |
| V-ADA-03 | DESIGN.md absent | WARN |
| V-ADA-05/06/07 | AGENTS.md absent or unindexed | WARN |
`;
    expect(findMissingCompanionVcodes(fixture)).toEqual([]);
  });

  test('one code missing returns exactly that code', () => {
    const fixture = `
| V-ADA-01 | ARCHITECTURE.md absent | WARN |
| V-ADA-03 | DESIGN.md absent | WARN |
| V-ADA-05/06/07 | AGENTS.md absent or unindexed | WARN |
`;
    expect(findMissingCompanionVcodes(fixture)).toEqual(['V-ADA-02']);
  });

  test('COMPANION_FILE_REQUIRED_VCODES matches the literal 4-code list', () => {
    expect(COMPANION_FILE_REQUIRED_VCODES).toEqual(['V-ADA-01', 'V-ADA-02', 'V-ADA-03', 'V-ADA-05/06/07']);
  });
});
