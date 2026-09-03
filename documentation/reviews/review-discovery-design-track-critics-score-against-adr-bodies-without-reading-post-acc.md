---
type: review
status: current
review_trigger: "on file change"
created: 2026-09-03
last_updated: 2026-09-03
issue: 775
---

# Review: `blackhole/issue-775` (d54ca3d)

**Verdict: LGTM** — 0 BLOCK, 0 WARN at merge-readiness.

Diff: PR #785, branch `blackhole/issue-775`.

## Quality gates — campaign review aggregate

| Gate | Result |
|---|---|
| Findings ledger | 0 BLOCK/WARN row(s) for issue #775, 2 deferred |

## Findings

_No BLOCK/WARN findings at merge-readiness._


### Deferred (not counted toward verdict)

| # | file:line | V-code | Severity | Finding | Deferred to |
|---|---|---|---|---|---|
| 1 | `scripts/design-aggregate.ts:26` | V-DOC-06 | WARN | [turn 18, review-775] New JSDoc on AdrCitation embeds issue #775, incident archaeology in a source comment, also at :313. Distinguishing evidence the reviewer supplied rather than asserting: this file had ZERO issue-number citations before the diff, verified against merge-base, so this PR introduces the pattern fresh rather than following an established local convention. That is the discriminator that separates it from the #783 case, where the same reviewer argued V-INT-01 pulled the other way because the file already carried the convention. Eleventh consecutive PR to fire V-DOC-06. | #779 |
| 2 | `scripts/design-aggregate.ts:26` | V-DOC-05 | WARN | [turn 18, review-775] The rationale that has_amendment is ground truth resolved by the CLI layer and never self-reported, because a scorer mistaken self-report would silently pass the gate, is substantively restated at three sites: AdrCitation JSDoc at :24-29 (the definition, and therefore the canonical home), hasUnverifiedCitation JSDoc at :243-247, and resolveAdrAmendmentTruth JSDoc at :322-327. Remedy is to anchor once at AdrCitation and have the other two reference it by symbol name plus only their locally-new detail. Reviewer separately noted the same duplication shape in planner.md prose between subsection 2 and §4.3 but deliberately did NOT file it, because the plan Design Decision reasons explicitly that critics are separately spawned, never read subsection 2, and so need a self-contained operational instruction at their spawn-construction site — a defensible second canonical site rather than a clear violation. | #779 |
