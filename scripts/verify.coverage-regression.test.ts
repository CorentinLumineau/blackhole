import { describe, expect, test } from 'bun:test';
import {
  runChecks,
  VCODES_TEST09_REQUIRED_MARKERS,
  IMPLEMENTER_COVERAGE_GATE_REQUIRED_MARKERS,
  formatMissingMarkerErrors,
} from './checks/coverage-regression.check.ts';
import { expectMarkersMissing, expectMarkersPresent } from './lib/marker-fixture-test.ts';

// PM-028 (issue #306): mercure-parity adoption of the V-TEST-09 coverage-regression gate. blackhole's
// implementer.md § 6 previously checked only lint + test pass with no coverage-delta gate. These
// tests guard that (a) blackhole-vcodes.md carries the V-TEST-09 BLOCK row and (b) implementer.md § 6
// carries the coverage-delta sub-step reusing hunt/coverage.md's runner detection. Modeled on
// verify.single-writer.test.ts's findMissingGateMarkers usage (required-markers-present shape).
//
// Issue #457 temporarily bolted a third check onto this module (reviewer.md § 23 Test Integrity
// Audit, reusing V-TEST-09). Issue #518 split that back out into verify.test-integrity.test.ts
// under its own code, V-TEST-10 — this file returns to its pre-#457 scope.

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
  test('returns a single V-TEST-09 CheckResult that passes once both source files carry the gate', () => {
    const results = runChecks();
    expect(results).toHaveLength(1);
    expect(results[0].id).toBe('V-TEST-09');
    expect(results[0].ok).toBe(true);
  });
});
