---
type: review
status: current
review_trigger: "on file change"
created: 2026-09-02
last_updated: 2026-09-02
issue: 728
---

# Review: `blackhole/issue-728` (6998d06)

**Verdict: LGTM** — 0 BLOCK, 2 deferred WARN at merge-readiness.

Diff: PR #735, branch `blackhole/issue-728`.

## Quality gates — campaign review aggregate

| Gate | Result |
|---|---|
| Findings ledger | 2 WARN rows for issue #728, both deferred |
| `scripts/review-aggregate.ts` | `lgtm: true`, `blockers_count: 0`, `unresolved_recheck: []` |

## Findings

_No BLOCK findings, and no unresolved WARN findings, at merge-readiness._

Two WARN findings were raised against this PR and deferred rather than fixed inline:

| # | file:line | V-code | Severity | Finding | Deferred to |
|---|---|---|---|---|---|
| 1 | `scripts/lib/check-common.ts:112` | V-DOC-06 | **WARN** | Production comments at `check-common.ts:112`, `doc-health.check.ts:94`, and `companion-file-sync.ts:185` embed the issue number. The orchestrator verified the pattern is pre-existing and pervasive on `main` (`check-common.ts` already cites issues at lines 8, 22, 64, 88), so this PR continues rather than originates it. | #736 |
| 2 | `scripts/checks/doc-health.check.ts:94` | V-DOC-05 | **WARN** | The relocation rationale for `RootIndexRow`/`appendIndexRowIfAbsent` is restated near-verbatim at the re-export site instead of citing the canonical definition at `check-common.ts:112-117` by symbol name. Genuinely fixable in two lines; folded into #736 so one coherent pass covers every affected file rather than a scattered fix. | #736 |

`F-00273` and `F-00274` are deferred, not unaddressed: #736 normalizes the issue-numbered
comment pattern and the duplicated rationale across all affected files at once, rather than
fixing them here in isolation and leaving the rest of the codebase inconsistent (V-INT-01).
Neither finding blocks this PR's merge readiness.
