---
type: review
summary: "Review artifact for issue #1380 (CHANGES REQUESTED)"
status: current
review_trigger: "on file change"
created: 2026-11-20
last_updated: 2026-11-20
issue: 1380
---

# Review: `blackhole/issue-1380` (7e085b3)

**Verdict: CHANGES REQUESTED** — 1 BLOCK, 1 WARN at merge-readiness.

Diff: PR #1382, branch `blackhole/issue-1380`.

## Quality gates — campaign review aggregate

| Gate | Result |
|---|---|
| Findings ledger | 3 BLOCK/WARN row(s) for issue #1380, 1 deferred |

## Findings

| # | file:line | V-code | Severity | Finding |
|---|---|---|---|---|
| 1 | `pr:1382:0` | V-FIX-01 | **BLOCK** | The plan frontmatter has task_type: bugfix (.blackhole/plans/issue-1380.md:5), but the PR body has no Root-Cause Decision Record. Its headings are Summary, Reuse Check, Improvement Record, Proof and Sprint Contract, so it never states the root cause, the alternatives considered or why this fix. gates/04-bugfix-gate.md requires that record in the PR description, and the Decision Record Audit's condition (b) is BLOCK. The carried plan explains the cause (ForgeCheck carries no job graph; rule D was dropped), but the gate needs the record in the PR body plus a decision_records[] row with kind root-cause. Fix: add the three-line record to the PR body. No code change. |
| 2 | `scripts/lib/merge-gate/ci-verdict.ts:91` | UNCODED-OBJECTIVE | **WARN** | unconfiguredPendingMessage builds its text from result.pending, not from the skipped checks, so it labels queued or running checks as SKIPPED. A probe on the head commit, unconfigured, with [build IN_PROGRESS, docs SKIPPED, lint SUCCESS] printed: 'pending, merge_ready.required_checks is not configured and 2 gating check(s) were SKIPPED: build, docs'. build was running, not skipped. The missing_config JSDoc at line 15 says it is set when the verdict is pending 'only because' no list is configured, which is also false in this mixed shape. The verdict and exit code are still correct (pending, exit 3), so this is not fail-open, but the owner-facing message misreports which checks were gated out. This is the normal state of any unconfigured PR while CI is still running. Fix: build the message from the skippedGating names (expose them, or filter checks for COMPLETED+SKIPPED), and add a mixed in-progress plus skipped test case. |
| 3 | `documentation/plans/plan-merge-gate-unconfigured-civerdict-still-reads-detect-passed-everything-else-skip.md:100` | V-PARETO-02 | **INFO** | The Threat Model's Denial of Service row gives '20 min poll cap hands over to the retry/needs-chef path' as the bound on the pending-forever consequence. That cap applies only to ci_wait: poll. Under ci_wait: pr-events (project-thread-mode.md:51-53, 63-64) a PR in an unconfigured repo gets one 20-minute check-in. That check-in re-runs ci-verdict, gets pending (exit 3) again and ends the turn. The only place merge_ready.required_checks is surfaced is a stderr line in a turn transcript. The owner accepted the pending outcome. A follow-up could have the orchestrator surface missing_config to the owner (for example as a parked decision) on exit 3. Does not block. [gain/effort estimated by orchestrator: reviewer return omitted them] |

### Deferred (not counted toward verdict)

| # | file:line | V-code | Severity | Finding | Deferred to |
|---|---|---|---|---|---|
| 1 | `scripts/lib/merge-gate/ci-verdict.ts:32` | V-PARETO-02 | WARN | Pre-existing, outside the diff, rerouted from a fail-open probe. Low confidence, verify before acting. checksFromSnapshot ignores the snapshot's total_count. If a saved check_runs page is truncated (REST and MCP list check runs 30 per page by default), a SKIPPED or FAILURE check on an unfetched page is never seen, and the gate can return green in both configured and unconfigured mode. Suggested fix: when total_count exceeds the check_runs length, return pending (fail closed). Scenario: a consumer repo with 40 or more matrix jobs. [gain/effort estimated by orchestrator: reviewer return omitted them] | #1383 |
