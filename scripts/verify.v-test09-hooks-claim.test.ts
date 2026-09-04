import { describe, expect, test } from 'bun:test';
import {
  runChecks,
  isDiffEntirelyUnderHooks,
  claimsCoverageRegressionPass,
  checkHooksOnlyClaimAdvisory,
  checkReviewerHooksClaimAuditGrounding,
  REVIEWER_HOOKS_CLAIM_AUDIT_REQUIRED_MARKERS,
} from './checks/v-test09-hooks-claim.check.ts';
import { expectMarkersPresent, expectMarkersMissing } from './lib/marker-fixture-test.ts';

// issue #787 — V-TEST-09 reporting-accuracy backstop. Coverage-regression gate (V-TEST-09, BLOCK)
// is structurally unmeasurable for templates/hooks/** files (subprocess-executed, never
// instrumented by `bun test --coverage`). This module's advisory half (checkHooksOnlyClaimAdvisory)
// flags a hooks-only diff whose worker-return/PR-body claims a coverage-regression PASS instead of
// `unmeasurable`; its grounding half (checkReviewerHooksClaimAuditGrounding) verifies reviewer.md
// § 30 carries the judgment audit these advisory detectors backstop.

describe('isDiffEntirelyUnderHooks', () => {
  test('all-hooks file list returns true', () => {
    expect(
      isDiffEntirelyUnderHooks([
        'templates/hooks/pretooluse/bash-guard.js',
        'templates/hooks/pretooluse/patterns/file-patterns.json',
      ]),
    ).toBe(true);
  });

  test('mixed file list (one non-hooks file) returns false', () => {
    expect(
      isDiffEntirelyUnderHooks(['templates/hooks/pretooluse/bash-guard.js', 'src/agents/implementer.md']),
    ).toBe(false);
  });

  test('empty file list returns false', () => {
    expect(isDiffEntirelyUnderHooks([])).toBe(false);
  });
});

describe('claimsCoverageRegressionPass', () => {
  test('matches "V-TEST-09: pass"', () => {
    expect(claimsCoverageRegressionPass('V-TEST-09: pass')).toBe(true);
  });

  test('matches "V-TEST-09 passed"', () => {
    expect(claimsCoverageRegressionPass('Coverage-regression gate V-TEST-09 passed for this diff')).toBe(true);
  });

  test('matches "Coverage-regression gate: PASS" case-insensitively', () => {
    expect(claimsCoverageRegressionPass('Coverage-regression gate: PASS')).toBe(true);
  });

  test('does not match "V-TEST-09: unmeasurable"', () => {
    expect(claimsCoverageRegressionPass('V-TEST-09: unmeasurable')).toBe(false);
  });

  test('does not match unrelated prose with no gate mention', () => {
    expect(claimsCoverageRegressionPass('All tests pass and lint is clean.')).toBe(false);
  });
});

describe('checkHooksOnlyClaimAdvisory', () => {
  test('flagged case: hooks-only diff + pass claim returns ok:true with a detail', () => {
    const result = checkHooksOnlyClaimAdvisory(['templates/hooks/pretooluse/bash-guard.js'], 'V-TEST-09: pass');
    expect(result.ok).toBe(true);
    expect(result.detail).toBeDefined();
    expect(result.detail!.length).toBeGreaterThan(0);
  });

  test('unflagged case: hooks-only diff + unmeasurable claim returns ok:true with no detail', () => {
    const result = checkHooksOnlyClaimAdvisory(['templates/hooks/pretooluse/bash-guard.js'], 'V-TEST-09: unmeasurable');
    expect(result.ok).toBe(true);
    expect(result.detail).toBeUndefined();
  });

  test('unflagged case: mixed diff + pass claim returns ok:true with no detail (trigger did not fire)', () => {
    const result = checkHooksOnlyClaimAdvisory(
      ['templates/hooks/pretooluse/bash-guard.js', 'src/agents/implementer.md'],
      'V-TEST-09: pass',
    );
    expect(result.ok).toBe(true);
    expect(result.detail).toBeUndefined();
  });

  test('ok is never false for any input — structurally advisory-only', () => {
    expect(checkHooksOnlyClaimAdvisory([], '').ok).toBe(true);
    expect(checkHooksOnlyClaimAdvisory(['templates/hooks/x.js'], 'V-TEST-09: pass').ok).toBe(true);
  });
});

describe('REVIEWER_HOOKS_CLAIM_AUDIT_REQUIRED_MARKERS', () => {
  const FIXTURE_FIXED = `
### 30. V-TEST-09 Hooks-Claim Audit (\`V-TEST-09\`, issue #787)
*   **Trigger**: fires when the PR diff's only changed source files are under \`templates/hooks/**\`.
*   **Finding (\`V-TEST-09\`, \`BLOCK\`)**: reports \`pass\` instead of \`unmeasurable\`.
*   **Mechanical backstop**: structurally \`ok: true\` always (never blocking on its own).
`;

  const FIXTURE_STALE = `
### 29. Plugin Cache Version-Bump Audit
*   **Trigger**: the diff touches any path under templates/hooks/**.
`;

  test('fixed reviewer.md fixture (§ 30 present) has all markers present', () => {
    expectMarkersPresent(FIXTURE_FIXED, REVIEWER_HOOKS_CLAIM_AUDIT_REQUIRED_MARKERS);
  });

  test('stale reviewer.md fixture (no § 30) is missing all markers', () => {
    expectMarkersMissing(FIXTURE_STALE, REVIEWER_HOOKS_CLAIM_AUDIT_REQUIRED_MARKERS);
  });
});

describe('checkReviewerHooksClaimAuditGrounding — against the real source tree', () => {
  test('passes once reviewer.md § 30 carries the judgment audit', () => {
    const result = checkReviewerHooksClaimAuditGrounding();
    expect(result.id).toBe('V-TEST-09');
    expect(result.ok).toBe(true);
  });
});

describe('runChecks — glob-discovery contract', () => {
  test('returns at least one V-TEST-09 CheckResult (the grounding check)', () => {
    const results = runChecks();
    expect(results.length).toBeGreaterThan(0);
    expect(results.every((r) => r.id === 'V-TEST-09')).toBe(true);
    expect(results.every((r) => r.ok === true)).toBe(true);
  });
});
