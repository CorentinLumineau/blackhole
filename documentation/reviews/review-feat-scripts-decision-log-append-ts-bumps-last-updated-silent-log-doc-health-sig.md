---
type: review
summary: "Review artifact for issue #717 (LGTM)"
status: current
review_trigger: "on file change"
created: 2026-09-02
last_updated: 2026-09-02
issue: 717
---

# Review: `blackhole/issue-717` (690495a)

**Verdict: LGTM** — 0 BLOCK, 2 deferred WARN at merge-readiness (1 BLOCK fixed in this PR).

Diff: PR #750, branch `blackhole/issue-717`.

## Quality gates — campaign review aggregate

| Gate | Result |
|---|---|
| Findings ledger | 2 WARN row(s) for issue #717, both deferred; 0 unresolved BLOCK |
| `scripts/review-aggregate.ts` | `lgtm: true`, `blockers_count: 0`, `unresolved_recheck: []` |

## Findings

_No BLOCK findings, and no unresolved WARN findings, at merge-readiness._

This PR went through two review iterations.

### Iteration 0 (full audit) — one BLOCK, fixed

| # | file:line | V-code | Severity | Finding |
|---|---|---|---|---|
| 1 | `scripts/decision-log-append.ts:75` | V-TEST-01 | **BLOCK** (fixed) | `appendDecisionRecords` shared one dedup `Set` between the existing-rows scan and the append loop, mutating it inside the loop, so a second record with the same `(pr, kind)` in one batch was dropped silently. Live evidence: the decision log already carried repeated `(pr, kind)` pairs, and this PR's own return carried two `{pr: 750, kind: "approach"}` records — the defect would have dropped one of its own records. No test covered the same-batch case. |

Everything else in the full audit passed.

### Iteration 1 (recheck) — BLOCK fixed, two new WARNs deferred

`F-00281` verdict: **fixed**. Commit `690495a0` freezes the dedup set from the log body
at call start and never mutates it inside the loop; a new test uses this PR's own two
`{pr: 750, kind: "approach"}` records to cover the same-batch case (red before the fix,
green after — verified by the implementer and confirmed by the orchestrator). The
pre-existing cross-run idempotency test is unchanged (33 insertions / 0 deletions in the
test file diff — no assertion was loosened).

| # | file:line | V-code | Severity | Finding | Deferred to |
|---|---|---|---|---|---|
| 1 | `scripts/decision-log-append.ts:67` | V-DOC-06 | **WARN** | The fix comment embeds `(issue #717 review finding: ...)` — incident archaeology in a source comment. Fourth PR this campaign turn flagged for the same rule (#734, #735, #740, now #750). The comment is load-bearing — it explains why the dedup set must not be mutated, the exact invariant a future refactorer would otherwise undo — so the rationale stays; only the issue-number archaeology is at issue. | #736 |
| 2 | `scripts/decision-log-append.test.ts:51` | V-DOC-06 | **WARN** | The new test's comment reads `// Review finding (issue #717, V-TEST-01): ...` rather than carrying the number in the test's function name only. Same class as the row above. | #736 |

Both `F-00283` and `F-00284` are deferred, not unaddressed: #736 normalizes this class of
comment-archaeology finding across the campaign rather than fixing each PR's instance in
isolation. Neither blocks this PR's merge readiness.
