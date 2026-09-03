---
type: review
status: current
review_trigger: "on file change"
created: 2026-09-03
last_updated: 2026-09-03
issue: 782
---

# Review: `blackhole/issue-782` (ff4778a)

**Verdict: LGTM** — 0 BLOCK, 1 WARN at merge-readiness.

Diff: PR #812, branch `blackhole/issue-782`.

## Quality gates — campaign review aggregate

| Gate | Result |
|---|---|
| Findings ledger | 1 BLOCK/WARN row(s) for issue #782 |

## Findings

| # | file:line | V-code | Severity | Finding |
|---|---|---|---|---|
| 1 | `scripts/checks/staging-schema.check.ts:136` | V-PARETO-02 | **WARN** | [review-782] PRODUCER_LITERAL_RE matches only a field:"value" literal wrapped in a single INLINE backtick span; a fenced ```json/```yaml block declaring the same literal is invisible to both V-STAGE-02 and the new V-STAGE-04. Confirmed BY EXECUTION, not inspection: a fenced-JSON example containing "sub_mode": "research" extracts zero literals while the inline-backtick form is caught. Pre-existing code (issue #482, commit 362177bf), unmodified by this diff — but V-STAGE-04 now depends on it for its ENTIRE guarantee, and investigator.md already documents sub_mode values 4x in exactly the unscanned fenced style (lines 168/180/192/205). ORCHESTRATOR CORRECTION: I had examined the same regex and concluded the boundary was narrow-but-fine. The reviewer showed my reasoning was under-determined — investigator.md:148's non-match is OVER-DETERMINED, failing for two independent reasons (it is inside a fence AND its value is not a bare [A-Za-z_]+\|null token), so that non-match never evidenced deliberate intent. The boundary reads as an accidental byproduct of the regex's original inline enum-drift purpose. Gain 6 / effort 3 -> Priority 48, above the filing gate. Candidate seventh instance of the #808 pattern: a check that passes while structurally unable to see the case that matters. |
