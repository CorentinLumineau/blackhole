import { describe, expect, test } from 'bun:test';
import * as fs from 'fs';
import * as path from 'path';
import { expandIncludes } from './lib/build/content.ts';

// Guards the ADR-004 step 5b safety invariant: the local-analyze confidence-boost
// mechanism's security_review_required update must be a monotonic union
// (base_security OR scan_raises_security), never an overwrite. router.md is a
// prose behavioral spec (no executable TS logic ships with this issue — see
// .blackhole/plans/issue-119.md § Execution Strategy item 9), so this test
// guards the spec TEXT itself: it fails if a future edit silently swaps the
// union formula for an overwrite assignment.

const root = path.resolve(import.meta.dirname, '..');
// Expands `{{INCLUDE:<dir>/*}}` (ADR-034) so a reviewer.md assertion keeps measuring the agent's
// whole compiled prose, not just what stayed in the shell file.
const read = (rel: string) =>
  expandIncludes(fs.readFileSync(path.join(root, rel), 'utf-8'), path.join(root, rel));

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

describe('blackhole-vcodes.md / reviewer.md — V-DOCFACT-01 registration (#335)', () => {
  test('vcodes table has a V-DOCFACT-01 (WARN) row', () => {
    const vcodes = read('src/references/blackhole-vcodes.md');
    expect(vcodes).toMatch(/\| V-DOCFACT-01 \|.*\| WARN \|/);
  });

  test('reviewer.md audits V-DOCFACT-01 by cross-referencing § 10/§ 8 detection, not restating keyword lists', () => {
    const reviewer = read('src/agents/reviewer.md');
    expect(reviewer).toContain('Documentation Prose Factual Accuracy (`V-DOCFACT-01`)');
    // Guards V-INT-02: the new audit must cross-reference § 10's companion-file surface and
    // § 8's documentation path patterns rather than restating keyword lists.
    expect(reviewer).toMatch(/§ 10's companion-file surface and § 8's documentation path patterns/);
  });
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

describe('blackhole-vcodes.md / reviewer.md — V-SOLID-02/04/05 registration (#455)', () => {
  test('vcodes table has V-SOLID-02 (BLOCK), V-SOLID-04 (WARN), and V-SOLID-05 (BLOCK) rows', () => {
    const vcodes = read('src/references/blackhole-vcodes.md');
    expect(vcodes).toMatch(/\| V-SOLID-02 \|.*\| BLOCK \|/);
    expect(vcodes).toMatch(/\| V-SOLID-04 \|.*\| WARN \|/);
    expect(vcodes).toMatch(/\| V-SOLID-05 \|.*\| BLOCK \|/);
  });

  test('reviewer.md §3 SOLID audit cites each new V-SOLID code', () => {
    const reviewer = read('src/agents/reviewer.md');
    expect(reviewer).toContain('(`V-SOLID-02`)');
    expect(reviewer).toContain('(`V-SOLID-04`, `WARN`)');
    expect(reviewer).toContain('(`V-SOLID-05`)');
  });
});

describe('blackhole-vcodes.md — V-AUTO-01/V-AUTO-02 registration', () => {
  test('vcodes table has V-AUTO-01 (BLOCK) and V-AUTO-02 (BLOCK) rows', () => {
    const vcodes = read('src/references/blackhole-vcodes.md');
    expect(vcodes).toMatch(/\| V-AUTO-01 \|.*\| BLOCK \|/);
    expect(vcodes).toMatch(/\| V-AUTO-02 \|.*\| BLOCK \|/);
  });

  test('V-AUTO-02 row names reviewer.md §25 as its enforcement site', () => {
    const vcodes = read('src/references/blackhole-vcodes.md');
    const row = vcodes.split('\n').find((line) => line.startsWith('| V-AUTO-02 |'));
    expect(row).toBeDefined();
    expect(row).toContain('reviewer.md §25');
  });
});

describe('reviewer.md — § Staged Artifact Carry Audit content (ADR-021 D4, #468)', () => {
  const section = read('src/references/audits/25-staged-artifact-carry-audit.md');
  const reviewer = section;

  test('has a named Staged Artifact Carry Audit heading naming V-AUTO-02', () => {
    expect(reviewer).toMatch(/### Staged Artifact Carry Audit.*V-AUTO-02/);
  });

  test('states V-AUTO-02 severity as its own literal BLOCK token, not a cross-reference', () => {
    // Guards the #441-class defect: a severity raised in blackhole-vcodes.md must be restated
    // literally at its enforcement site, never inferred by pointing at a sibling section/code.
    expect(section.length).toBeGreaterThan(0);
    expect(section).toMatch(/`V-AUTO-02`[^\n]*`BLOCK`|`BLOCK`[^\n]*`V-AUTO-02`/);
  });

  test('re-checks docs_governance.write_governance directly from config, not inferred from manifest absence', () => {
    expect(reviewer).toContain('docs_governance.write_governance');
    expect(section).toMatch(/docs_governance\.enabled/);
    expect(section).toMatch(/docs_governance\.write_governance/);
  });

  test('treats an absent/empty manifest as a vacuous gate — a route that declared nothing is unaffected', () => {
    expect(section).toMatch(/vacuous/i);
    expect(section).toMatch(/declared nothing/i);
  });

  test('branches per-entry on new_file vs append_row target_kind', () => {
    expect(section).toContain('new_file');
    expect(section).toContain('append_row');
  });

  test('reuses the ARCHITECTURE.md citation-suffix discriminator from ac80755/implementer.md, not a reinvented one', () => {
    expect(section).toMatch(/ac80755/);
    expect(section).toMatch(/citation suffix/);
  });

  test('surfaces an undecidable manifest shape rather than silently passing it', () => {
    // Guards the #562/#564/#565/#580 defect class named in the delegation: a BLOCK-severity
    // audit that cannot evaluate a case must say so, never treat it as "carried".
    expect(section).toMatch(/undecidable|cannot (be )?evaluat/i);
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
    // Issue #325: the Plan Output File Template (all three sub-templates) was extracted
    // verbatim from src/agents/planner.md into src/references/plan-template.md, leaving a
    // thin pointer section in planner.md. This frontmatter field lives in the extracted file.
    const planTemplate = read('src/references/plan-template.md');
    expect(planTemplate).toContain('threat_screen_passed: true | null');
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

describe('blackhole-vcodes.md — documentation alignment registration (#446)', () => {
  const vcodes = () => read('src/references/blackhole-vcodes.md');

  test.each(['V-DOC-01', 'V-DOC-03', 'V-DOC-05', 'V-DOC-06', 'V-ADA-04', 'V-ADR-01', 'V-ADR-02', 'V-ADR-03'])(
    'registers %s with a WARN row',
    (code) => {
      expect(vcodes()).toMatch(new RegExp(`\\| ${code} \\|.*\\| WARN \\|`));
    },
  );

  test('V-DOC-GOV-02 row requires all five lifecycle frontmatter fields', () => {
    const row = vcodes().split('\n').find((line) => line.startsWith('| V-DOC-GOV-02 |'));
    expect(row).toBeDefined();
    expect(row).toContain('review_trigger');
    expect(row).toContain('created');
    expect(row).toContain('last_updated');
  });

  test('product-principles template uses retired ruling status enum', () => {
    const template = read('templates/companion-files/product-principles.md.template');
    expect(template).toContain('active | superseded | retired');
    expect(template).not.toContain('retracted');
  });
});
