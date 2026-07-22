import { describe, expect, test } from 'bun:test';
import * as fs from 'fs';
import * as path from 'path';

// Guards the ADR-004 step 5b safety invariant: the local-analyze confidence-boost
// mechanism's security_review_required update must be a monotonic union
// (base_security OR scan_raises_security), never an overwrite. router.md is a
// prose behavioral spec (no executable TS logic ships with this issue — see
// .blackhole/plans/issue-119.md § Execution Strategy item 9), so this test
// guards the spec TEXT itself: it fails if a future edit silently swaps the
// union formula for an overwrite assignment.

const root = path.resolve(import.meta.dirname, '..');
const read = (rel: string) => fs.readFileSync(path.join(root, rel), 'utf-8');

describe('router.md local-analyze monotonicity invariant', () => {
  const router = read('src/agents/router.md');

  test('states the union (OR-combine) formula verbatim', () => {
    expect(router).toContain(
      'final_security_review_required = base_security OR scan_raises_security'
    );
  });

  test('the formula code block itself never overwrites security_review_required from the scan result alone', () => {
    // router.md legitimately *quotes* the illegal overwrite form in prose, as a
    // documented anti-example ("Assigning `security_review_required :=
    // scan_raises_security` ... is a V-SEC-09 BLOCK finding"). That prose is
    // exactly what closes the safety hole, so this test scopes the negative
    // assertion to the normative formula code block only — the fenced block
    // must never itself assign security_review_required from
    // scan_raises_security without the base_security union.
    const blockMatch = router.match(/```\n(base_security[\s\S]*?)\n```/);
    expect(blockMatch).not.toBeNull();
    const formulaBlock = blockMatch?.[1] ?? '';
    const bareOverwriteInBlock = /security_review_required\s*:?=\s*scan_raises_security\b/;
    expect(bareOverwriteInBlock.test(formulaBlock)).toBe(false);
    expect(formulaBlock).toContain('base_security OR scan_raises_security');
  });

  test('documents the monotonicity invariant as a BLOCK-severity V-SEC-09 finding', () => {
    expect(router).toContain('V-SEC-09');
  });

  test('Write protocol section explicitly instructs writing final_security_review_required, not the pre-scan value', () => {
    // Guards against the "computed correctly but not written" gap: an agent could
    // correctly compute final_security_review_required in the formula block and then
    // still persist the pre-scan base_security classification by omission. The Write
    // protocol section must name final_security_review_required explicitly so there is
    // no ambiguity about which value gets persisted to route.security_review_required.
    const writeProtocol = router.split('## Write protocol')[1] ?? '';
    expect(writeProtocol.length).toBeGreaterThan(0);
    expect(writeProtocol).toContain('final_security_review_required');
    expect(writeProtocol).toMatch(/security_review_required/);
  });

  test('never widens influence beyond plan_mode and security_review_required', () => {
    const section = router.split('## Local-analyze confidence-boost mechanism')[1] ?? '';
    expect(section.length).toBeGreaterThan(0);
    expect(section).not.toMatch(/needs_split\s*[:=]/);
    expect(section).not.toMatch(/needs_design\s*[:=]/);
    expect(section).not.toMatch(/task_type\s*[:=]/);
  });
});

describe('blackhole-vcodes.md — V-SEC-09/V-SEC-10 registration', () => {
  test('vcodes table has V-SEC-09 (BLOCK) and V-SEC-10 (WARN) rows', () => {
    const vcodes = read('src/references/blackhole-vcodes.md');
    expect(vcodes).toMatch(/\| V-SEC-09 \|.*\| BLOCK \|/);
    expect(vcodes).toMatch(/\| V-SEC-10 \|.*\| WARN \|/);
  });

  // The former "ground-truth vcode_table_rows matches the actual table row count" test was
  // removed here (ADR-007 T3/R1′): ground-truth.md no longer carries a hand-maintained
  // vcode_table_rows counter to drift against (its counter role is retired — see
  // src/references/ground-truth.md). The invariant this test guarded is now enforced at CI
  // time by scripts/verify.ts's V-GROUND-01 two-sided facts-conformance check, which compares
  // the same live row count against build.ts's § facts VCODE_TABLE_ROW_COUNT declaration —
  // strictly better coverage than this unit-level comparison against a doc counter.
});

describe('blackhole-vcodes.md / reviewer.md — V-UX-01 registration (#271)', () => {
  test('vcodes table has a V-UX-01 (WARN) row', () => {
    const vcodes = read('src/references/blackhole-vcodes.md');
    expect(vcodes).toMatch(/\| V-UX-01 \|.*\| WARN \|/);
  });

  test('reviewer.md audits V-UX-01 by reusing § 10\'s V-ADA-03 detection, not reimplementing it', () => {
    const reviewer = read('src/agents/reviewer.md');
    expect(reviewer).toContain('Information-Hierarchy Audit (`V-UX-01`)');
    // Guards V-INT-02: the new audit must cross-reference § 10's frontend-detection keyword
    // set rather than restating or reimplementing it.
    expect(reviewer).toMatch(/frontend-detection keyword set as § 10's `V-ADA-03` bullet/);
  });
});

describe('blackhole-vcodes.md — V-AUTO-01/V-AUTO-02 registration', () => {
  test('vcodes table has V-AUTO-01 (BLOCK) and V-AUTO-02 (WARN) rows', () => {
    const vcodes = read('src/references/blackhole-vcodes.md');
    expect(vcodes).toMatch(/\| V-AUTO-01 \|.*\| BLOCK \|/);
    expect(vcodes).toMatch(/\| V-AUTO-02 \|.*\| WARN \|/);
  });
});

describe('blackhole-vcodes.md — V-THREAT-02/03 and V-PERF-01/02 registration', () => {
  test('vcodes table has V-THREAT-02 (BLOCK), V-THREAT-03 (WARN), V-PERF-01 (BLOCK), and V-PERF-02 (WARN) rows', () => {
    const vcodes = read('src/references/blackhole-vcodes.md');
    expect(vcodes).toMatch(/\| V-THREAT-02 \|.*\| BLOCK \|/);
    expect(vcodes).toMatch(/\| V-THREAT-03 \|.*\| WARN \|/);
    expect(vcodes).toMatch(/\| V-PERF-01 \|.*\| BLOCK \|/);
    expect(vcodes).toMatch(/\| V-PERF-02 \|.*\| WARN \|/);
  });
});

describe('blackhole-vcodes.md / planner.md / reviewer.md — V-THREAT-01 registration (#311)', () => {
  test('vcodes table has a V-THREAT-01 (BLOCK) row, ordered before V-THREAT-02', () => {
    const vcodes = read('src/references/blackhole-vcodes.md');
    expect(vcodes).toMatch(/\| V-THREAT-01 \|.*\| BLOCK \|/);
    // Row ordering: V-THREAT-01 must precede V-THREAT-02 in the table.
    const idx01 = vcodes.indexOf('| V-THREAT-01 |');
    const idx02 = vcodes.indexOf('| V-THREAT-02 |');
    expect(idx01).toBeGreaterThan(-1);
    expect(idx02).toBeGreaterThan(-1);
    expect(idx01).toBeLessThan(idx02);
  });

  test('planner.md Quick Track reuses route.security_review_required — no new detection logic', () => {
    const planner = read('src/agents/planner.md');
    const quickTrack = planner.split('### 1. Quick Track')[1]?.split('### 2. Standard Track')[0] ?? '';
    expect(quickTrack.length).toBeGreaterThan(0);
    expect(quickTrack).toContain('Threat escalation check');
    expect(quickTrack).toContain('route.security_review_required');
    expect(quickTrack).toContain('threat_screen_passed: true');
    expect(quickTrack).toContain('V-THREAT-01');
    // Guards V-DRY-01/V-INT-02: reuse must be explicit, not a re-derivation.
    expect(quickTrack).toMatch(/reuses the router's already-computed flag/);
    expect(quickTrack).toMatch(/zero new pattern-matching or\s+detection logic/);
  });

  test('Plan Output File Template documents the threat_screen_passed frontmatter field', () => {
    const planner = read('src/agents/planner.md');
    expect(planner).toContain('threat_screen_passed: true | null');
  });

  test('reviewer.md audits V-THREAT-01 by reusing review-core.md security-mode injection and the plan-file stamp, not new detection logic', () => {
    const reviewer = read('src/agents/reviewer.md');
    expect(reviewer).toContain('Quick-track escalation check (`V-THREAT-01`, `BLOCK`)');
    expect(reviewer).toContain('threat_screen_passed: true');
    expect(reviewer).toMatch(/review-core\.md.*Security-mode\s+review/);
    // Conditional-omission fallback must be present, mirroring V-THREAT-02/03's discipline.
    expect(reviewer).toMatch(/Not security-mode, or plan track is not quick — no finding/);
  });
});
