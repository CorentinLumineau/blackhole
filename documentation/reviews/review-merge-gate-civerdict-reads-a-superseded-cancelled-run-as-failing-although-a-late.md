---
type: review
summary: "Review artifact for issue #1381 (LGTM)"
status: current
review_trigger: "on file change"
created: 2026-11-23
last_updated: 2026-11-23
issue: 1381
---

# Review: `blackhole/issue-1381` (ba04044)

**Verdict: LGTM** — 0 BLOCK, 3 WARN at merge-readiness.

Diff: PR #1385, branch `blackhole/issue-1381`.

## Quality gates — campaign review aggregate

| Gate | Result |
|---|---|
| Findings ledger | 4 BLOCK/WARN row(s) for issue #1381, 3 deferred |

## Findings

| # | file:line | V-code | Severity | Finding |
|---|---|---|---|---|
| 1 | `documentation/plans/plan-merge-gate-civerdict-reads-a-superseded-cancelled-run-as-failing-although-a-late.md:null` | V-DOCFACT-01 | **WARN** | Not determined whether GitHub reports a job whose job-level if: is false as CANCELLED or SKIPPED when its run is cancelled (decides how often the accepted cost of the must-have-executed rule bites on the tag-only Release Notes Gate). The PR body quotes CI on 6a30c057; head ba04044b only edits the carried plan. |
| 2 | `scripts/lib/forge-adapter/github-rest.ts:224` | V-INT-05 | **WARN** | PR-body blast-radius line is reasoned, not executed. Accurate for the CI judgment, but prChecks -> listChecks now makes a third REST call (actions/runs?head_sha=) on every pr-signals refresh and prints a stderr line each time when the token lacks actions: read. |
| 3 | `scripts/lib/merge-gate/ci-verdict.ts:98` | V-KISS-01 | **WARN** | ciVerdict failing[] is not deduplicated: two kept CANCELLED runs of one name give failing [pr-lint, pr-lint]. Existing behaviour, now reachable for [CANCELLED, newer CANCELLED]; test expectation updated rather than the output. Priority 2 x (11 - 2) = 18, below the filing floor: ledger only. |
| 4 | `scripts/lib/forge-adapter/github-rest.ts:126` | V-DOC-01 | **INFO** | The mapRestCheckRun docstring says status is upper-cased, but only in_progress and completed map to IN_PROGRESS and COMPLETED; every other status becomes QUEUED. Wording only; behaviour fails closed. |

### Deferred (not counted toward verdict)

| # | file:line | V-code | Severity | Finding | Deferred to |
|---|---|---|---|---|---|
| 1 | `scripts/lib/campaign-status/pr-signals.ts:17` | V-PARETO-02 | WARN | ciOf judges every check entry, the same way ciVerdict did before this PR. The PR body and plan decision 7 say it is 'left for a follow-up', but `gh issue list --search` finds no follow-up issue (the newest issues are #1383 and #1381), so the finding would be dropped. File it, and have ciOf reuse latestPerName once the BLOCK finding on its grouping key is fixed. | #1386 |
| 2 | `scripts/lib/campaign-status/pr-signals.ts:17` | V-INT-03 | WARN | ciOf still reads every check entry; reuse the exported latestPerName (same concern as F-00751, tracked as #1386). Also: the #1381 plan stated matrix rows 7 and 8 pass on both baselines, but row 7 and row 8 required-list assertion fail on 5da2611 (plan prose inaccuracy, implementer note). | #1386 |
| 3 | `scripts/lib/forge-adapter/github-rest.ts:216` | V-PARETO-02 | WARN | Pre-existing, outside the diff (verification leg, reasoned, confidence 65): listChecks reads one page of 100 check runs with no pagination or total_count comparison, so a failing run past index 100 never reaches ciVerdict. Same concern as #1383. | #1383 |
