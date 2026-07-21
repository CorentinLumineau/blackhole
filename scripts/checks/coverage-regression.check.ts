import * as fs from 'fs';
import * as path from 'path';
import { findMissingGateMarkers } from './core.check.ts';

// PM-028 (issue #306) — coverage-regression.check.ts (V-TEST-09): mercure parity adoption of the
// coverage-regression gate. Validates two source artifacts carry the gate:
//   1. src/references/blackhole-vcodes.md holds the V-TEST-09 BLOCK row (exact row text, so the
//      code, description, and BLOCK severity are all asserted in one substring match).
//   2. src/agents/implementer.md § 6 "Verify & Open PR" carries the coverage-delta sub-step,
//      reusing hunt/coverage.md's runner-detection heuristic (no invented runner invocation;
//      no-runner degrades to a logged no-op, never a false pass).
//
// findMissingGateMarkers is the shared substring-presence helper (core.check.ts), reused here
// exactly as single-writer.check.ts reuses it — one definition, no local reimplementation
// (V-INT-02).
export { findMissingGateMarkers };

const root = path.resolve(import.meta.dirname, '..', '..');

export type CheckResult = { id: string; ok: boolean; detail?: string };

const read = (rel: string) => fs.readFileSync(path.join(root, rel), 'utf-8');

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

const checkCoverageRegressionGate = (): CheckResult => {
  const vcodesMissing = findMissingGateMarkers(read('src/references/blackhole-vcodes.md'), VCODES_TEST09_REQUIRED_MARKERS);
  const implementerMissing = findMissingGateMarkers(
    read('src/agents/implementer.md'),
    IMPLEMENTER_COVERAGE_GATE_REQUIRED_MARKERS,
  );

  const errors = [
    ...vcodesMissing.map((m) => `blackhole-vcodes.md missing "${m}"`),
    ...implementerMissing.map((m) => `implementer.md missing "${m}"`),
  ];

  if (errors.length) return { id: 'V-TEST-09', ok: false, detail: errors.join('; ') };
  return { id: 'V-TEST-09', ok: true };
};

// ADR-007 T5/R2': domain entrypoint — see core.check.ts's runChecks doc comment for the shared
// contract (pure, no side effects, glob-discovered by scripts/verify.ts).
export const runChecks = (): CheckResult[] => [checkCoverageRegressionGate()];
