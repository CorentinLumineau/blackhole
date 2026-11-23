---
type: review
summary: "Review artifact for issue #1390 (LGTM)"
status: current
review_trigger: "on file change"
created: 2026-11-23
last_updated: 2026-11-23
issue: 1390
---

# Review: `blackhole/issue-1390` (1637d0b)

**Verdict: LGTM** — 0 BLOCK, 1 WARN at merge-readiness.

Diff: PR #1418, branch `blackhole/issue-1390`.

## Quality gates — campaign review aggregate

| Gate | Result |
|---|---|
| Findings ledger | 2 BLOCK/WARN row(s) for issue #1390, 2 deferred |

## Findings

| # | file:line | V-code | Severity | Finding |
|---|---|---|---|---|
| 1 | `scripts/lib/check-common.ts:324` | V-DRY-02 | **WARN** | isSeparatorRow repeats the separator test inside findTableBlock, and the link regexp in parseAdrFragment repeats canonicalIndexPath link stripping (both under 10 lines). Low confidence (65), no Pareto score: ledger only. |
| 2 | `scripts/lib/check-common.test.ts:556` | V-TEST-05 | **INFO** | Test gaps, no defect by execution: no test pins ADR-1 vs ADR-10 matching, mixed-width sort (byte order: ADR-2 after ADR-10), an empty table, a padded or mixed-case header. The check-common red-first evidence was an import SyntaxError, not a behavioural red. |

### Deferred (not counted toward verdict)

| # | file:line | V-code | Severity | Finding | Deferred to |
|---|---|---|---|---|---|
| 1 | `scripts/lib/check-common.ts:355` | V-PARETO-02 | WARN | Executed probe, confidence 70: parseAdrFragment splits on every pipe including an escaped one in the title; the row is appended corrupted (title cut, cells shifted) with no error, though the plan says an unclassifiable fragment must throw. | #1419 |
| 2 | `src/references/doc-governance.md:213` | V-PARETO-02 | WARN | Out-of-diff prose now partly stale: doc-governance.md Row order and gates/10-carry-staged-artifacts.md:43 describe the decisions-index append as path-keyed only; line 215 still says localeCompare (older drift). | #1420 |
