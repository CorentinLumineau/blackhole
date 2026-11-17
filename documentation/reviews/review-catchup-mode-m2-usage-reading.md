---
type: review
summary: "Readiness review of catchup-mode M2 (usage provider chain, bun run usage, pace-floor, #1272 cache-reader extraction): LGTM with three LOW notes"
status: current
review_trigger: "on file change"
created: 2026-11-17
last_updated: 2026-11-17
related:
  - documentation/milestones/_active/catchup-mode/milestone-2.md
  - documentation/decisions/ADR-054-catchup-mode-quota-pacing.md
---

# Review: catchup-mode M2 "Usage reading everywhere"

Diff boundary `4658feed...dcd1dd1` (2 commits, 46 files, mostly rebuilt output). Read-only review.

## Verdict

No CRITICAL, no HIGH. Ready to push; CI runs the full suite.

## Evidence

| Check | Result |
|-------|--------|
| Focused tests (rate-limit-cache, pace-gate, usage-source, usage-normalize, usage-budget, pace-floor, usage, argv-flags-adoption) | 220 pass, 0 fail |
| Importers of moved symbols still pointing at `pace-gate.ts` (`git grep`) | none |
| `usage-source` referenced from `pace-gate.ts` or `rate-limit-cache.ts` | none; `rate-limit-cache.ts` has no local import |
| `generate-doc-index.ts --check` | OK |
| Plan Critical Files vs diff | all present |

## Findings

| # | Severity | Finding |
|---|----------|---------|
| 1 | LOW | `mapPlan` matches by substring, so a free-text plan such as "nonexistent" maps to `none`, which lets a window-less file pass as the no-plan-limits case. Anchor the match on word boundaries when M3 starts gating on `plan`. |
| 2 | LOW | `epochSeconds` accepts a millisecond epoch silently (a `resets_at` in ms is far in the future, so the window never expires). Reject values above about 1e11 when the first real desktop payload is captured. |
| 3 | LOW | `read()` on a failed chain with `--usage` set reports `source: usage-file` although the cache was also tried; the reason lists both failures, so no verdict changes. |

D1 (no provider 4) and D2 (desktop hand-off) are deferred by design and respected: no stub exists.
