---
type: review
summary: "Review artifact for issue #737 (LGTM)"
status: current
review_trigger: "on file change"
created: 2026-09-02
last_updated: 2026-09-02
issue: 737
---

# Review: `blackhole/issue-737` (d47449f)

**Verdict: LGTM** — 0 BLOCK, 1 deferred WARN at merge-readiness.

Diff: PR #755, branch `blackhole/issue-737`.

## Quality gates — campaign review aggregate

| Gate | Result |
|---|---|
| Findings ledger | 2 WARN row(s) for issue #737 — 1 deferred, 1 fixed in this PR; 0 unresolved BLOCK/WARN |

## Findings

_No BLOCK findings, and no unresolved WARN findings, at merge-readiness._

This PR went through one review iteration (iteration 0, full audit — no recheck cycle).
One WARN finding was raised against this PR and fixed inline rather than deferred:

| # | file:line | V-code | Severity | Finding | Fixed by |
|---|---|---|---|---|---|
| 1 | `scripts/lib/promote-review-artifact.ts:43` | V-DOC-01 | **WARN** | `ReviewPromotionOutput.findingsCount` changed meaning from all-selected-rows to blocking-only with nothing at the symbol saying so. | `d47449f5` (one-line docstring added at the field) |

One further WARN finding was raised against this PR and deferred rather than fixed inline:

| # | file:line | V-code | Severity | Finding | Deferred to |
|---|---|---|---|---|---|
| 1 | `scripts/lib/promote-review-artifact.ts:117` | V-DOC-06 | **WARN** | Comment ends with "(issue #737)" — incident archaeology. Sixth PR this campaign turn flagged for this rule. The surrounding sentence is load-bearing (it states why deferred rows stay visible while excluded from the count); #736's normalization must keep the rationale and drop only the citation. | #736 |

F-00287 is deferred, not unaddressed: #736 carries the evidence table for a repo-wide
normalization pass across the campaign's V-DOC-06 instances this turn, rather than fixing this
one site in isolation. It does not block this PR's merge readiness. F-00288's ledger row still
reads `status: "open"` at the time of this promotion — the fix landed on this branch after the
finding was raised, and this artifact records that true post-fix state rather than the ledger's
stale snapshot, the same correction protocol used for PR #740's review artifact.

Three things were verified to make sure this fix is trustworthy rather than merely green:
`selectReviewFindings()` is byte-for-byte unchanged from `main` (the #754 boundary held — no
coercion added at selection); both new fixtures use the declared numeric `issue_ref`/`pr_ref`
ledger schema, so their rows are genuinely selected rather than silently dropped by the #754
drift; and the new tests assert the deferred row appears in the rendered disclosure table, not
merely that the verdict reads LGTM — distinguishing "correctly excluded from the count" from
"never matched at all".

Issue #737's AC 1 ("`selectReviewFindings()` excludes deferred rows") and AC 2 ("the deferred
row still appears in the disclosure section") are mutually contradictory as written — a row
excluded at selection cannot be disclosed downstream. The fix instead keeps
`selectReviewFindings()` passing deferred rows through untouched and excludes them from the
counted verdict inside `renderReviewMarkdown()`. The orchestrator verified this reading and
sanctioned the deviation; AC 1 as literally written does not describe the merged code, and this
is not unmet scope.

This artifact is itself the first live exercise of the fix it documents: running this PR's own
`promote-review-artifact.ts` against the true ledger state correctly excluded F-00287 (deferred)
from the verdict and rendered it in the disclosure table above. One observation on one ledger,
not a proof, but the intended behavior held on its first real input.
