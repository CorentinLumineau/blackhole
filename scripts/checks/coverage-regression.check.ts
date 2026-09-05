import { read, type CheckResult } from './check-utils.ts';
import { findMissingGateMarkers, readComposedAgentDoc } from '../lib/check-common.ts';

// PM-028 (issue #306) — coverage-regression.check.ts (V-TEST-09): mercure parity adoption of the
// coverage-regression gate. Validates two source artifacts carry the gate:
//   1. src/references/blackhole-vcodes.md holds the V-TEST-09 BLOCK row (exact row text, so the
//      code, description, and BLOCK severity are all asserted in one substring match).
//   2. src/agents/implementer.md § 6 "Verify & Open PR" carries the coverage-delta sub-step,
//      reusing hunt/coverage.md's runner-detection heuristic (no invented runner invocation;
//      no-runner degrades to a logged no-op, never a false pass).
//
// issue #457 originally bolted a third check onto this same module — src/agents/reviewer.md § 23
// Test Integrity Audit — reusing V-TEST-09 to cover added skip markers, removed assertions, and
// weakened validation. That reuse didn't hold semantically: § 23 is review-time diff-pattern
// judgment, never a coverage number. Issue #518 split it back out into its own module,
// test-integrity.check.ts, under its own code, V-TEST-10 — this file returns to its pre-#457
// scope (vcodes row + implementer.md only).

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
  'unmeasurable',
  '`templates/hooks/**`',
  'never `pass`',
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
    readComposedAgentDoc('src/agents/implementer.md'),
    IMPLEMENTER_COVERAGE_GATE_REQUIRED_MARKERS,
  );

  const errors = [
    ...formatMissingMarkerErrors(vcodesMissing, 'blackhole-vcodes.md'),
    ...formatMissingMarkerErrors(implementerMissing, 'implementer.md'),
  ];

  if (errors.length) return { id: 'V-TEST-09', ok: false, detail: errors.join('; ') };
  return { id: 'V-TEST-09', ok: true };
};

// ADR-007 T5/R2': domain entrypoint — see agents.check.ts's runChecks doc comment for the shared
// contract (pure, no side effects, glob-discovered by scripts/verify.ts).
export const runChecks = (): CheckResult[] => [checkCoverageRegressionGate()];
