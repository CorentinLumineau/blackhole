import { describe, expect, test } from 'bun:test';
import {
  runChecks,
  VCODES_TEST09_REQUIRED_MARKERS,
  IMPLEMENTER_COVERAGE_GATE_REQUIRED_MARKERS,
  REVIEWER_TEST_INTEGRITY_REQUIRED_MARKERS,
  formatMissingMarkerErrors,
} from './checks/coverage-regression.check.ts';
import { expectMarkersMissing, expectMarkersPresent } from './lib/marker-fixture-test.ts';

// PM-028 (issue #306): mercure-parity adoption of the V-TEST-09 coverage-regression gate. blackhole's
// implementer.md § 6 previously checked only lint + test pass with no coverage-delta gate. These
// tests guard that (a) blackhole-vcodes.md carries the V-TEST-09 BLOCK row and (b) implementer.md § 6
// carries the coverage-delta sub-step reusing hunt/coverage.md's runner detection. Modeled on
// verify.single-writer.test.ts's findMissingGateMarkers usage (required-markers-present shape).
//
// Issue #457: coverage-delta alone doesn't catch a diff that adds `.skip()`/removes assertions/
// loosens validation without moving the coverage number. Extends this same V-TEST-09 gate (rather
// than a parallel one, per V-INT-02) with a third source-file check: reviewer.md § 23 Test
// Integrity Audit.

// A fixed vcodes fixture (row present) vs. a stale one (pre-adoption table, no V-TEST-09 row).
const VCODES_FIXTURE_FIXED = `
| V-TEST-01/02 | All new logic tested, tests FIRST | BLOCK |
| V-TEST-05 | Meaningful assertions (not existence checks) | WARN |
| V-TEST-09 | Coverage regression on changed files — line/function coverage vs. pre-change baseline must not drop | BLOCK |
| V-SEC-01/02 | No injection; no auth bypass | BLOCK |
`;

const VCODES_FIXTURE_STALE = `
| V-TEST-01/02 | All new logic tested, tests FIRST | BLOCK |
| V-TEST-05 | Meaningful assertions (not existence checks) | WARN |
| V-SEC-01/02 | No injection; no auth bypass | BLOCK |
`;

const IMPLEMENTER_FIXTURE_FIXED = `
6.  **Verify & Open PR**:
    *   Ensure both the project lint command and test suite pass locally.
    *   **Coverage-regression gate (\`V-TEST-09\`, BLOCK)**: capture touched-file line/function
        coverage at the § 1 baseline pass, then again after the final incremental step; a drop
        vs. the pre-change baseline on any file this diff touched blocks the PR. Reuse
        \`hunt/coverage.md\`'s runner-detection heuristic (§ Scan heuristics step 1 + § No-runner
        degradation) — do not invent a runner invocation; when no runner is detected the gate
        degrades to a logged no-op (never a false pass, per § No-runner degradation).
`;

const IMPLEMENTER_FIXTURE_STALE = `
6.  **Verify & Open PR**:
    *   Ensure both the project lint command and test suite pass locally.
    *   Commit, push, and open a PR with \`Closes #N\`.
`;

// Issue #457: reviewer.md § 23 Test Integrity Audit fixture. Short excerpt carrying the same
// distinctive substrings the real section uses — detection scope (added-lines-only), the three
// detected patterns, and the paired-severity rule.
const REVIEWER_FIXTURE_FIXED = `
### 23. Test Integrity Audit (\`V-TEST-09\`)
*   **Added test-skip markers**: scan the diff's added lines only — never context or pre-existing
    lines — for a skip/disable/exclusive marker newly introduced by this diff.
*   **Removed assertions**: scan the diff's removed lines for an assertion call inside a test body
    that is not replaced by an equivalent assertion on an adjacent added line.
*   **Weakened validation rules**: a diff line loosens a runtime constraint with no accompanying
    comment, commit message, or PR-body rationale explaining why.
*   **Severity logic**: \`BLOCK\` when the change lands in the same diff as the production change
    it covers; \`WARN\` when it lands alone.
*   **Diff-scoped only (\`V-SCOPE-01\`)**: a marker already present before this diff is never
    flagged — only newly-added lines count.
`;

const REVIEWER_FIXTURE_STALE = `
### 22. Visual Evidence Audit (\`V-VIS-01/02\`, ADR-018)
*   No test-integrity checks here.

---

## Output Format
`;

describe('VCODES_TEST09_REQUIRED_MARKERS', () => {
  test('fixed vcodes fixture (V-TEST-09 BLOCK row present) has all markers present', () => {
    expectMarkersPresent(VCODES_FIXTURE_FIXED, VCODES_TEST09_REQUIRED_MARKERS);
  });

  test('stale vcodes fixture (no V-TEST-09 row) is missing all markers', () => {
    expectMarkersMissing(VCODES_FIXTURE_STALE, VCODES_TEST09_REQUIRED_MARKERS);
  });
});

describe('IMPLEMENTER_COVERAGE_GATE_REQUIRED_MARKERS', () => {
  test('fixed implementer.md fixture (coverage-delta sub-step present) has all markers present', () => {
    expectMarkersPresent(IMPLEMENTER_FIXTURE_FIXED, IMPLEMENTER_COVERAGE_GATE_REQUIRED_MARKERS);
  });

  test('stale implementer.md fixture (lint+test only, no coverage gate) is missing all markers', () => {
    expectMarkersMissing(IMPLEMENTER_FIXTURE_STALE, IMPLEMENTER_COVERAGE_GATE_REQUIRED_MARKERS);
  });
});

describe('REVIEWER_TEST_INTEGRITY_REQUIRED_MARKERS', () => {
  test('fixed reviewer.md fixture (§ 23 Test Integrity Audit present) has all markers present', () => {
    expectMarkersPresent(REVIEWER_FIXTURE_FIXED, REVIEWER_TEST_INTEGRITY_REQUIRED_MARKERS);
  });

  test('stale reviewer.md fixture (no § 23, coverage-delta only) is missing all markers', () => {
    expectMarkersMissing(REVIEWER_FIXTURE_STALE, REVIEWER_TEST_INTEGRITY_REQUIRED_MARKERS);
  });
});

describe('formatMissingMarkerErrors', () => {
  test('maps each missing marker to a "<sourceFile> missing \\"<marker>\\"" string', () => {
    expect(formatMissingMarkerErrors(['a', 'b'], 'reviewer.md')).toEqual([
      'reviewer.md missing "a"',
      'reviewer.md missing "b"',
    ]);
  });

  test('returns an empty array when nothing is missing', () => {
    expect(formatMissingMarkerErrors([], 'reviewer.md')).toEqual([]);
  });
});

describe('runChecks — V-TEST-09 gate against the real source tree', () => {
  test('returns a single V-TEST-09 CheckResult that passes once all three source files carry the gate', () => {
    const results = runChecks();
    expect(results).toHaveLength(1);
    expect(results[0].id).toBe('V-TEST-09');
    expect(results[0].ok).toBe(true);
  });
});
