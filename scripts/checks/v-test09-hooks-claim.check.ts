import { read, type CheckResult } from './check-utils.ts';
import { findMissingGateMarkers } from '../lib/check-common.ts';

// issue #787 — V-TEST-09 reporting-accuracy backstop. The Coverage-regression gate (V-TEST-09,
// BLOCK, implementer.md § 6) is structurally unmeasurable for any file under `templates/hooks/**`
// — those modules execute only inside a subprocess spawned by `runPreToolUseHook`, never
// instrumented by `bun test --coverage`. implementer.md § 6 requires `unmeasurable` (never
// `pass`) for a diff whose only changed source lives under that path; reviewer.md § 30 is the
// judgment audit that blocks a PR violating that requirement. No new V-code — this module reuses
// V-TEST-09 throughout.
//
// Two independent halves:
//   1. isDiffEntirelyUnderHooks / claimsCoverageRegressionPass / checkHooksOnlyClaimAdvisory —
//      pure, PR-scoped detectors invoked by the CLI wrapper (scripts/v-test09-hooks-claim.ts),
//      wired into reviewer.md § 30's "Mechanical backstop" bullet. Structurally advisory-only
//      (`ok` is always `true`) — a flagged result is a signal to look closer, never a substitute
//      for, or downgrade of, the review-time judgment finding itself.
//   2. checkReviewerHooksClaimAuditGrounding — a static grounding check verifying reviewer.md
//      § 30 carries the judgment audit, mirroring coverage-regression.check.ts's existing
//      grounding pattern (blocking if the source markers go missing). Wired into runChecks() so
//      verify.ts's glob-discovery is satisfied without needing PR-scoped input (the changed-file
//      list and claim text aren't available at verify-time).

export const isDiffEntirelyUnderHooks = (files: string[]): boolean =>
  files.length > 0 && files.every((f) => f.startsWith('templates/hooks/'));

// Case-insensitive match on a V-TEST-09 / "Coverage-regression gate" mention within ~40 chars of
// a pass/passed/passing token. Narrow enough to never match an `unmeasurable` report; wide enough
// to catch "V-TEST-09: pass", "V-TEST-09 passed", and "Coverage-regression gate: PASS".
export const claimsCoverageRegressionPass = (text: string): boolean =>
  /(v-test-09|coverage-regression gate)[\s\S]{0,40}?\b(pass|passed|passing)\b/i.test(text);

export const checkHooksOnlyClaimAdvisory = (files: string[], claimText: string): CheckResult => {
  const flagged = isDiffEntirelyUnderHooks(files) && claimsCoverageRegressionPass(claimText);
  return {
    id: 'V-TEST-09',
    ok: true,
    ...(flagged
      ? {
          detail:
            'Diff changed source is entirely under templates/hooks/** and the claim text reports the Coverage-regression gate as pass — implementer.md § 6 requires `unmeasurable` (never `pass`) for a hooks-only diff; see reviewer.md § 30.',
        }
      : {}),
  };
};

export const REVIEWER_HOOKS_CLAIM_AUDIT_REQUIRED_MARKERS = [
  'V-TEST-09 Hooks-Claim Audit (`V-TEST-09`, issue #787)',
  '`templates/hooks/**`',
  'unmeasurable',
  'never blocking on its own',
];

export const checkReviewerHooksClaimAuditGrounding = (): CheckResult => {
  const missing = findMissingGateMarkers(read('src/agents/reviewer.md'), REVIEWER_HOOKS_CLAIM_AUDIT_REQUIRED_MARKERS);
  if (missing.length) {
    return { id: 'V-TEST-09', ok: false, detail: missing.map((m) => `reviewer.md missing "${m}"`).join('; ') };
  }
  return { id: 'V-TEST-09', ok: true };
};

// ADR-007 T5/R2': domain entrypoint — see agents.check.ts's runChecks doc comment for the shared
// contract (pure, no side effects, glob-discovered by scripts/verify.ts). Only the grounding
// check runs here — checkHooksOnlyClaimAdvisory needs PR-scoped input (changed files, claim
// text) that isn't available at verify-time; it's invoked directly by the CLI wrapper instead.
export const runChecks = (): CheckResult[] => [checkReviewerHooksClaimAuditGrounding()];
