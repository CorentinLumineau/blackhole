import { describe, expect, test } from 'bun:test';
import {
  runChecks,
  VCODES_TEST10_REQUIRED_MARKERS,
  REVIEWER_TEST_INTEGRITY_REQUIRED_MARKERS,
} from './checks/test-integrity.check.ts';
import { expectMarkersMissing, expectMarkersPresent } from './lib/marker-fixture-test.ts';

// Issue #518: reviewer.md § 23 "Test Integrity Audit" was minted under V-TEST-09 (a prior wave
// reused it for file-lock-avoidance, not semantic fit — V-TEST-09's canonical meaning is a
// measurable, build-verified coverage delta; § 23's checks are review-time diff-pattern judgment
// that never touch a coverage number). This split gives § 23 its own code, V-TEST-10, and this
// check module its own file — mirrors coverage-regression.check.ts's shape (vcodes row +
// agent-file markers) but scoped to blackhole-vcodes.md + reviewer.md only.

// A fixed vcodes fixture (row present) vs. a stale one (pre-split table, no V-TEST-10 row).
const VCODES_FIXTURE_FIXED = `
| V-TEST-09 | Coverage regression on changed files — line/function coverage vs. pre-change baseline must not drop | BLOCK |
| V-TEST-10 | Test integrity — a diff adds a test-skip marker, removes an assertion with no replacement, or loosens a validation rule with no stated reason; review-time diff-pattern judgment, distinct from V-TEST-09's measurable coverage-delta metric | BLOCK |
| V-SEC-01/02 | No injection; no auth bypass | BLOCK |
`;

const VCODES_FIXTURE_STALE = `
| V-TEST-09 | Coverage regression on changed files — line/function coverage vs. pre-change baseline must not drop | BLOCK |
| V-SEC-01/02 | No injection; no auth bypass | BLOCK |
`;

// Short excerpt carrying the same distinctive substrings the real § 23 uses: heading pointing at
// V-TEST-10, the skip-marker escape hatch, the decidable BLOCK/WARN heuristic, and the closed
// Go/Python/RSpec skip-syntax gaps (#518 findings 2-4).
const REVIEWER_FIXTURE_FIXED = `
### 23. Test Integrity Audit (\`V-TEST-10\`)
*   **Added test-skip markers**: \`t.Skip(\`, \`t.Skipf(\`, \`t.SkipNow()\` (Go);
    \`@pytest.mark.skip\`, \`@pytest.mark.skipif(\`, \`pytest.skip(\` (Python) — scan the diff's
    added lines only, for a skip/disable/exclusive marker newly introduced by this diff. A stated
    reason takes the marker out of scope for this check.
*   **Removed assertions**: scan the diff's removed lines for an assertion call.
*   **Weakened validation rules**: a diff line loosens a runtime constraint.
*   **Severity logic — test-to-source linking heuristic**: \`BLOCK\` only when the test file's name
    maps to a production file by the repo's stem-pairing convention. \`WARN\` in every other case,
    e.g. \`xcontext\` blocks in an RSpec suite with no paired production file.
`;

const REVIEWER_FIXTURE_STALE = `
### 22. Visual Evidence Audit (\`V-VIS-01/02\`, ADR-018)
*   No test-integrity checks here.

---

## Output Format
`;

describe('VCODES_TEST10_REQUIRED_MARKERS', () => {
  test('fixed vcodes fixture (V-TEST-10 BLOCK row present) has all markers present', () => {
    expectMarkersPresent(VCODES_FIXTURE_FIXED, VCODES_TEST10_REQUIRED_MARKERS);
  });

  test('stale vcodes fixture (no V-TEST-10 row) is missing all markers', () => {
    expectMarkersMissing(VCODES_FIXTURE_STALE, VCODES_TEST10_REQUIRED_MARKERS);
  });
});

describe('REVIEWER_TEST_INTEGRITY_REQUIRED_MARKERS', () => {
  test('fixed reviewer.md fixture (§ 23 pointed at V-TEST-10, gaps closed) has all markers present', () => {
    expectMarkersPresent(REVIEWER_FIXTURE_FIXED, REVIEWER_TEST_INTEGRITY_REQUIRED_MARKERS);
  });

  test('stale reviewer.md fixture (no § 23 content) is missing all markers', () => {
    expectMarkersMissing(REVIEWER_FIXTURE_STALE, REVIEWER_TEST_INTEGRITY_REQUIRED_MARKERS);
  });
});

describe('runChecks — V-TEST-10 gate against the real source tree', () => {
  test('returns a single V-TEST-10 CheckResult that passes once both source files carry the gate', () => {
    const results = runChecks();
    expect(results).toHaveLength(1);
    expect(results[0].id).toBe('V-TEST-10');
    expect(results[0].ok).toBe(true);
  });
});
