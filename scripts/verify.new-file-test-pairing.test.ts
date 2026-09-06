import { describe, expect, test } from 'bun:test';
import {
  checkNewFileTestPairingGrounding,
  deriveTestPairingConvention,
  findUnpairedNewSourceFiles,
  NEW_FILE_TEST_PAIRING_GROUNDING_MARKERS,
  runChecks,
} from './checks/new-file-test-pairing.check.ts';
import { expectMarkersMissing, expectMarkersPresent } from './lib/marker-fixture-test.ts';

// Issue #876 (follow-up to #805/PR #850) — review-time mechanical backstop for "new file, no
// test, weak rationalization accepted." #850 already fixed the production-side cause; this
// module gives the reviewer a computable fact instead of a remembered judgment. See
// src/references/audits/23-test-integrity-audit.md § Severity logic — test-to-source linking
// heuristic for the prose this module codifies (derive the pairing from 2+ existing sibling
// pairs in the same directory; never guess upward when no consistent transform is derivable).

// V-UNFALSIFIABLE-01 (plan § Falsifiability): this issue is about a control that failed to
// fire — the #805 shape below must be shown flagged (red before the detector exists, green
// after) rather than assumed to work. Both fixtures ship permanently, not deleted after
// implementation.

const SIBLING_BASE_TREE = [
  'dirX/foo1.ts',
  'dirX/tests/foo1.test.ts',
  'dirX/foo2.ts',
  'dirX/tests/foo2.test.ts',
];

describe('findUnpairedNewSourceFiles — #805 shape', () => {
  test('a new file with a decidable convention and no added test is flagged', () => {
    const addedFiles = ['dirX/bar.ts'];
    const touchedFiles = ['dirX/bar.ts'];
    expect(findUnpairedNewSourceFiles(addedFiles, touchedFiles, SIBLING_BASE_TREE)).toEqual([
      'dirX/bar.ts',
    ]);
  });

  test('the same shape, but the diff also adds the derived test path — not flagged', () => {
    const addedFiles = ['dirX/bar.ts'];
    const touchedFiles = ['dirX/bar.ts', 'dirX/tests/bar.test.ts'];
    expect(findUnpairedNewSourceFiles(addedFiles, touchedFiles, SIBLING_BASE_TREE)).toEqual([]);
  });
});

describe('deriveTestPairingConvention', () => {
  test('derives a directory-move + suffix-swap convention from 2+ consistent sibling pairs', () => {
    expect(deriveTestPairingConvention('dirX', SIBLING_BASE_TREE)).toEqual({
      testDir: 'dirX/tests',
      prefix: '',
    });
  });

  test('derives this repo\'s own scripts/checks -> scripts/verify.*.test.ts convention', () => {
    const baseTree = [
      'scripts/checks/aaa.check.ts',
      'scripts/verify.aaa.test.ts',
      'scripts/checks/bbb.check.ts',
      'scripts/verify.bbb.test.ts',
    ];
    expect(deriveTestPairingConvention('scripts/checks', baseTree)).toEqual({
      testDir: 'scripts',
      prefix: 'verify.',
    });
  });

  test('returns null when fewer than 2 consistent pairs exist in the directory', () => {
    const baseTree = ['dirX/foo1.ts', 'dirX/tests/foo1.test.ts', 'dirX/onlyone.ts'];
    expect(deriveTestPairingConvention('dirX', baseTree)).toBeNull();
  });

  test('returns null for a directory with no existing files at all', () => {
    expect(deriveTestPairingConvention('dirY', SIBLING_BASE_TREE)).toBeNull();
  });
});

describe('findUnpairedNewSourceFiles — no decidable convention never flags', () => {
  test('a new file in a directory with no derivable convention is never flagged', () => {
    const addedFiles = ['dirY/brand-new.ts'];
    const touchedFiles = ['dirY/brand-new.ts'];
    expect(findUnpairedNewSourceFiles(addedFiles, touchedFiles, SIBLING_BASE_TREE)).toEqual([]);
  });

  test('a new test file itself is never treated as an unpaired source', () => {
    const addedFiles = ['dirX/tests/new.test.ts'];
    const touchedFiles = ['dirX/tests/new.test.ts'];
    expect(findUnpairedNewSourceFiles(addedFiles, touchedFiles, SIBLING_BASE_TREE)).toEqual([]);
  });
});

describe('findUnpairedNewSourceFiles — co-located fallback', () => {
  test('a same-directory <stem>.test.ts sibling counts as paired even off the dominant convention', () => {
    // scripts/checks-shaped corpus where the dominant convention is scripts/verify.<name>.test.ts,
    // but one file (the "legacy outlier", cf. pareto-filing-gate.check.ts in the live repo) is
    // instead paired with a co-located <name>.check.test.ts sibling. The co-located fallback
    // must resolve it without the dominant-convention derivation ever needing to know about it.
    const baseTree = [
      'scripts/checks/aaa.check.ts',
      'scripts/verify.aaa.test.ts',
      'scripts/checks/bbb.check.ts',
      'scripts/verify.bbb.test.ts',
    ];
    const addedFiles = ['scripts/checks/legacy.check.ts'];
    const touchedFiles = ['scripts/checks/legacy.check.ts', 'scripts/checks/legacy.check.test.ts'];
    expect(findUnpairedNewSourceFiles(addedFiles, touchedFiles, baseTree)).toEqual([]);
  });
});

describe('NEW_FILE_TEST_PAIRING_GROUNDING_MARKERS', () => {
  const FIXTURE_FIXED = `
*   **New-File Test-Pairing Backstop (\`V-TEST-01/02\`, issue #876)**: run
    \`scripts/new-file-test-pairing.ts\` and treat a non-empty \`detail\` as evidence for a
    \`BLOCK\` finding unless the PR names a specific test. Anti-rationalization row:
    | "The existing black-box/integration suite covers this indirectly." | see above |
`;

  const FIXTURE_STALE = `
*   **TDD Workflow (\`V-TEST-01/02\`)**: Audit the tests. Verify that new logic is covered by
    unit/widget/integration tests, and that tests were written first (TDD workflow).
`;

  test('fixed fixture (row + bullet present) has all markers present', () => {
    expectMarkersPresent(FIXTURE_FIXED, NEW_FILE_TEST_PAIRING_GROUNDING_MARKERS);
  });

  test('stale fixture (row + bullet absent) is missing all markers', () => {
    expectMarkersMissing(FIXTURE_STALE, NEW_FILE_TEST_PAIRING_GROUNDING_MARKERS);
  });
});

describe('checkNewFileTestPairingGrounding — against the real source tree', () => {
  test('passes once reviewer.md and module 02 carry the backstop wiring', () => {
    const result = checkNewFileTestPairingGrounding();
    expect(result.id).toBe('V-TEST-01');
    expect(result.ok).toBe(true);
  });
});

describe('runChecks — glob-discovery contract', () => {
  test('returns at least one V-TEST-01 CheckResult (the grounding check)', () => {
    const results = runChecks();
    expect(results.length).toBeGreaterThan(0);
    expect(results.every((r) => r.id === 'V-TEST-01')).toBe(true);
    expect(results.every((r) => r.ok === true)).toBe(true);
  });
});
