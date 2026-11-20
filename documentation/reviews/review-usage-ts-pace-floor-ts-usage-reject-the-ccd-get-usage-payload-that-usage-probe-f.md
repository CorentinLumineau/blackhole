---
type: review
summary: "Review artifact for issue #1361 (LGTM)"
status: current
review_trigger: "on file change"
created: 2026-11-20
last_updated: 2026-11-20
issue: 1361
---

# Review: `blackhole/issue-1361` (d238ae4)

**Verdict: LGTM** — 0 BLOCK, 4 WARN at merge-readiness.

Diff: PR #1373, branch `blackhole/issue-1361`.

## Quality gates — campaign review aggregate

| Gate | Result |
|---|---|
| Findings ledger | 4 BLOCK/WARN row(s) for issue #1361 |

## Findings

| # | file:line | V-code | Severity | Finding |
|---|---|---|---|---|
| 1 | `documentation/plans/plan-usage-file-readers-accept-desktop-get-usage-payload.md:1` | V-GIT-01 | **WARN** | CI check pr-lint is red on head d238ae4: 'closing issue(s) #1361 lack the ready label'. This is an issue-label gate, not a code defect; apply the 'ready' label to #1361 (via gh api REST) and re-run the check. The PR body itself carries 'Closes #1361'. |
| 2 | `scripts/lib/usage-normalize.ts:90` | V-FIX-01 | **WARN** | low-confidence, verify before acting: plan frontmatter has task_type: bugfix, and the PR body carries a 'Root cause (V-FIX-01)' paragraph but no heading literally named Root-Cause Decision Record. The worker JSON decision_records[] was not visible to this review. Confirm it holds a kind: root-cause row, otherwise this escalates under the Decision Record Audit. [low-confidence finding: verify before acting — confidence 60] |
| 3 | `scripts/lib/usage-normalize.ts:92` | V-API-01 | **WARN** | low-confidence, verify before acting: the new desktop branch is selected whenever plan is an object with a windows array and takes precedence over collectWindows. A payload that also carries top-level normalized windows is read from plan.windows only, and the top-level rows are silently ignored. Probed: top-level five_hour 5% plus plan.windows 5-hour 90% yields five_hour 90. Before the change the top-level rows were used. Contrived shape, no real host emits both, and it errs toward the higher usage, but it is a narrowing of 'existing branches stay first-class and unchanged'. A plan given as a string (plan:'Max' with top-level windows) is unaffected (probed, parsed as before). [low-confidence finding: verify before acting — confidence 55] |
| 4 | `scripts/usage.test.ts:94` | V-PARETO-02 | **WARN** | AC6 reads 'a desktop payload with no current window ... exits 2'; the spec substitutes 'no mapped row'. An expired desktop window is dropped by fileProvider (usage-source.ts:100) and the chain falls through to the rate-limit cache, exit 0 (probed: expired.json returned the statusline cache reading). That matches every other already-accepted shape, so it is pre-existing and consistent, and the malformed cases (101, unparseable resetsAt, empty or unmapped rows) all exit 2 naming the row (probed: empty.json exit 2 'get_usage carries no 5-hour or weekly all-models window'). Improvement: add one spec for an expired desktop file through the file readers so the behaviour is pinned. |
