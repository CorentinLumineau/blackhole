---
type: review
summary: "x-review of catchup-mode M4 (lane claim, 1a80fca1...1ce5fb39): 0 CRITICAL, 0 HIGH, 1 MEDIUM, 2 LOW; focused tests green"
status: current
review_trigger: "on file change"
created: 2026-11-17
last_updated: 2026-11-17
---

# Review: catchup-mode M4 "Lane claim" (1ce5fb39)

**Verdict: PASS with warnings** — 0 CRITICAL, 0 HIGH, 1 MEDIUM, 2 LOW. Diff boundary `1a80fca1...HEAD`.

Evidence: `bun test` on lane, claim CLI, adapter claim, forge-sync, lane-claim-docs and blocked-classes specs:
81 pass, 0 fail. `generate-doc-index.ts --check` OK. CI on the pushed head remains the full-suite evidence.

## Findings

| # | Sev | Where | Finding |
|---|-----|-------|---------|
| 1 | MEDIUM (WARN) | `scripts/lib/forge-sync.ts` `openPrIndex` | A stale foreign claim whose open PR is also inactive still blocks: the PR is classed foreign from the unfiltered lane labels, so `open.foreign` re-blocks the issue after the stale label is dropped. Objective 4 says such an issue stays `ready`; `claim` would reclaim it, `forge-sync` will not. Fix: pass the stale-filtered labels to `openPrIndex`, or skip foreign PRs older than the lease. |
| 2 | LOW | `src/references/orchestrator-dispatch.md` | `CLOSED` verdict maps to the note `another lane: in-progress:<held_by>` but carries no `held_by`. Give `CLOSED` its own note. |
| 3 | LOW | `scripts/lib/forge-adapter/claim.ts` | Race rollback removes the own label even when it pre-existed the claim (`hasOwn`); harmless but drops an earlier own claim. |

No SOLID or duplication violations; the claim flow is shared once (`claimIssue`) across three adapters.
