---
type: review
summary: "Review artifact for issue #1369 (LGTM)"
status: current
review_trigger: "on file change"
created: 2026-11-20
last_updated: 2026-11-20
issue: 1369
---

# Review: `blackhole/issue-1369` (0235050)

**Verdict: LGTM** — 0 BLOCK, 3 WARN at merge-readiness.

Diff: PR #1375, branch `blackhole/issue-1369`.

## Quality gates — campaign review aggregate

| Gate | Result |
|---|---|
| Findings ledger | 3 BLOCK/WARN row(s) for issue #1369 |

## Findings

| # | file:line | V-code | Severity | Finding |
|---|---|---|---|---|
| 1 | `scripts/lib/test-fixtures.test.ts:197` | V-PARETO-02 | **WARN** | Low-confidence, verify before acting: the 1 ms floor is pinned only from below. The floor-removal mutation goes red (small 0.1, large 11 -> 110), but raising the floor (Math.max(tSmall, 1) to Math.max(tSmall, 2)) leaves every injected-clock test green: 11/2 = 5.5 still passes and every other case uses small cost 10. Suggestion: add a sibling case (small 0.1, large 13 must throw, since 13/1 = 13 >= 12) so the floor value is pinned two-sided. |
| 2 | `scripts/lib/test-fixtures.test.ts:221` | V-PARETO-02 | **WARN** | Low-confidence, verify before acting: the real-clock reject bar (first-pair ratio >= 24) is not scale-invariant. When the small run is under the 1 ms floor, the reported ratio equals the large run's milliseconds. The measured first ratio was 37.8 with a large run of about 53 ms, so a machine roughly 1.6-2x faster than the implementer's could report a first ratio near 24 and fail the test although the helper correctly rejects (it only throws after the retry also fails). Only the first pair's ratio is parsed. Suggestion: raise the spin constant for more headroom, or parse the larger of the two reported ratios. |
| 3 | `scripts/lib/test-fixtures.test.ts:199` | V-PARETO-02 | **WARN** | Low-confidence nit: the retry test declares a local `runs = 5` but never passes it to expectLinearTime, so it silently mirrors the helper's default of 5. A future default change turns the 2 * (runs + 1) call-count assertion red for the wrong reason (it still fails, so not unfalsifiable). Suggestion: pass `runs` explicitly in `measure`'s extra options. |
