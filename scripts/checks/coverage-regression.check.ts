import { read, type CheckResult } from './check-utils.ts';
import { findMissingGateMarkers } from '../lib/check-common.ts';

// PM-028 (issue #306) — coverage-regression.check.ts (V-TEST-09): mercure parity adoption of the
// coverage-regression gate. Validates three source artifacts carry the gate:
//   1. src/references/blackhole-vcodes.md holds the V-TEST-09 BLOCK row (exact row text, so the
//      code, description, and BLOCK severity are all asserted in one substring match).
//   2. src/agents/implementer.md § 6 "Verify & Open PR" carries the coverage-delta sub-step,
//      reusing hunt/coverage.md's runner-detection heuristic (no invented runner invocation;
//      no-runner degrades to a logged no-op, never a false pass).
//   3. (issue #457) src/agents/reviewer.md carries § 23 Test Integrity Audit — the coverage-delta
//      gate above catches the *number* regressing; it does not catch a diff that adds `.skip()`,
//      removes an assertion, or loosens a validation rule without moving that number. Extends
//      this same V-TEST-09 gate with a third source-file check rather than a parallel one
//      (V-INT-02) — one CheckResult, three markers arrays.

// The V-TEST-09 row, verbatim per issue #306's requested wording. Matching the full row (down to
// the trailing "| BLOCK") asserts code + description + severity together — a bare ".includes('BLOCK')"
// would be satisfied by any of the table's many other BLOCK rows.
export const VCODES_TEST09_REQUIRED_MARKERS = [
  'V-TEST-09 | Coverage regression on changed files — line/function coverage vs. pre-change baseline must not drop | BLOCK',
];

// The § 6 coverage-delta sub-step. Markers are distinctive substrings of the added bullet — the
// gate name (with severity), the before/after capture instruction, the reused heuristic source,
// and the no-runner degradation contract that keeps a missing runner from reading as a clean pass.
export const IMPLEMENTER_COVERAGE_GATE_REQUIRED_MARKERS = [
  'Coverage-regression gate (`V-TEST-09`, BLOCK)',
  'capture touched-file line/function',
  "hunt/coverage.md`'s runner-detection heuristic",
  'degrades to a logged no-op',
];

// issue #457 — reviewer.md § 23 Test Integrity Audit markers: detection scope (added-lines-only,
// diff-scoped per V-SCOPE-01), the three detected patterns (skip markers, removed assertions,
// weakened validation), and the paired-severity rule (BLOCK only when the guard-weakening lands
// in the same diff as the production change it covered; WARN otherwise).
export const REVIEWER_TEST_INTEGRITY_REQUIRED_MARKERS = [
  'Test Integrity Audit (`V-TEST-09`)',
  'newly introduced by this diff',
  'Removed assertions',
  'Weakened validation rules',
  'lands in the same diff as the production change',
  'only newly-added lines count',
];

// Extracted so the missing-marker → error-string mapping is directly unit-testable without
// needing to fake a stale real source file — the success-path integration test below always maps
// over empty arrays (nothing missing in the real tree), which would otherwise leave this
// formatting step permanently unexercised.
export const formatMissingMarkerErrors = (missing: string[], sourceFile: string): string[] =>
  missing.map((m) => `${sourceFile} missing "${m}"`);

const checkCoverageRegressionGate = (): CheckResult => {
  const vcodesMissing = findMissingGateMarkers(read('src/references/blackhole-vcodes.md'), VCODES_TEST09_REQUIRED_MARKERS);
  const implementerMissing = findMissingGateMarkers(
    read('src/agents/implementer.md'),
    IMPLEMENTER_COVERAGE_GATE_REQUIRED_MARKERS,
  );
  const reviewerMissing = findMissingGateMarkers(
    read('src/agents/reviewer.md'),
    REVIEWER_TEST_INTEGRITY_REQUIRED_MARKERS,
  );

  const errors = [
    ...formatMissingMarkerErrors(vcodesMissing, 'blackhole-vcodes.md'),
    ...formatMissingMarkerErrors(implementerMissing, 'implementer.md'),
    ...formatMissingMarkerErrors(reviewerMissing, 'reviewer.md'),
  ];

  if (errors.length) return { id: 'V-TEST-09', ok: false, detail: errors.join('; ') };
  return { id: 'V-TEST-09', ok: true };
};

// ADR-007 T5/R2': domain entrypoint — see agents.check.ts's runChecks doc comment for the shared
// contract (pure, no side effects, glob-discovered by scripts/verify.ts).
export const runChecks = (): CheckResult[] => [checkCoverageRegressionGate()];
