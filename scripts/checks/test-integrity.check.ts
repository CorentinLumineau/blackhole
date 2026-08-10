import { read, type CheckResult } from './check-utils.ts';
import { findMissingGateMarkers } from '../lib/check-common.ts';

// issue #518 — test-integrity.check.ts (V-TEST-10): split out of coverage-regression.check.ts's
// prior overload of V-TEST-09. reviewer.md § 23 "Test Integrity Audit" is review-time diff-pattern
// judgment (added skip markers, removed assertions, weakened validation) — it never touches a
// coverage number, so it gets its own code instead of sharing V-TEST-09's build-verified
// coverage-delta meaning (a prior wave reused V-TEST-09 here for file-lock-avoidance, not
// semantic fit). Validates two source artifacts carry the gate:
//   1. src/references/blackhole-vcodes.md holds the V-TEST-10 BLOCK row (exact row text).
//   2. src/agents/reviewer.md § 23 carries the escape hatch for justified skips, the decidable
//      BLOCK/WARN test-to-source heuristic, and the closed Go/Python/RSpec skip-syntax gaps.

export const VCODES_TEST10_REQUIRED_MARKERS = [
  "V-TEST-10 | Test integrity — a diff adds a test-skip marker, removes an assertion with no replacement, or loosens a validation rule with no stated reason; review-time diff-pattern judgment, distinct from V-TEST-09's measurable coverage-delta metric | BLOCK",
];

export const REVIEWER_TEST_INTEGRITY_REQUIRED_MARKERS = [
  'Test Integrity Audit (`V-TEST-10`)',
  'newly introduced by this diff',
  'takes the marker out of scope for this check',
  'Removed assertions',
  'Weakened validation rules',
  'stem-pairing convention',
  't.Skipf(',
  '@pytest.mark.skipif(',
  'xcontext',
];

const checkTestIntegrityGate = (): CheckResult => {
  const vcodesMissing = findMissingGateMarkers(
    read('src/references/blackhole-vcodes.md'),
    VCODES_TEST10_REQUIRED_MARKERS,
  );
  const reviewerMissing = findMissingGateMarkers(
    read('src/agents/reviewer.md'),
    REVIEWER_TEST_INTEGRITY_REQUIRED_MARKERS,
  );

  const errors = [
    ...vcodesMissing.map((m) => `blackhole-vcodes.md missing "${m}"`),
    ...reviewerMissing.map((m) => `reviewer.md missing "${m}"`),
  ];

  if (errors.length) return { id: 'V-TEST-10', ok: false, detail: errors.join('; ') };
  return { id: 'V-TEST-10', ok: true };
};

// ADR-007 T5/R2': domain entrypoint — see agents.check.ts's runChecks doc comment for the shared
// contract (pure, no side effects, glob-discovered by scripts/verify.ts).
export const runChecks = (): CheckResult[] => [checkTestIntegrityGate()];
