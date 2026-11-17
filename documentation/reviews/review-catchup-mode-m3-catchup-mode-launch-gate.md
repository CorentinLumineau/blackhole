---
type: review
summary: "Readiness review of catchup-mode M3 (usage-budget --floor, catchup config block, catchup mode and playbook, full-config launch gate with Pacing row): no CRITICAL or HIGH, two MEDIUM and three LOW notes"
status: current
review_trigger: "on file change"
created: 2026-11-17
last_updated: 2026-11-17
related:
  - documentation/milestones/_active/catchup-mode/milestone-3.md
  - documentation/decisions/ADR-054-catchup-mode-quota-pacing.md
---

# Review: catchup-mode M3 "Catchup mode with the full-config launch gate"

Diff boundary `f1d2afc3...e9587fb5` (2 commits, 119 files, mostly rebuilt output). Read-only review.

## Verdict

No CRITICAL, no HIGH. Ready to push; CI runs the full suite. Two MEDIUM findings should be fixed before the
scheduled-task flow is relied on (M4 is a natural home).

## Evidence

| Check | Result |
|-------|--------|
| Focused tests (catchup, usage-budget CLI, pace-floor CLI, pace-log) | 92 pass, 0 fail |
| Focused tests (launch-summary, campaign-status CLI, config-gate, stop-mode, argv-flags, status-coverage) | all pass |
| `verify.config-registration.test.ts` live-tree case | 1 fail, environmental: the gitignored local `.blackhole/config.json` carries `merge_mode_note`; unrelated to the diff, absent in CI |
| Targeted checks config-gate, stop-mode, playbook, ground-truth, argv-flags-adoption | ok |
| `generate-doc-index.ts --check` | OK |
| Plan Critical Files vs diff | all present; `orchestrator-runtime.md` and `budget.test.ts` untouched by design (D1, conditional) |

## Findings

| # | Severity | Finding |
|---|----------|---------|
| 1 | MEDIUM | Floor 0 breaks the gate. `pace-floor` returns `floor_pct` 0 (status ok) from each weekly reset until that weekday's day end (e.g. Monday noon, week 3%), but `usage-budget.ts --floor 0` exits 2 ("must be a number in (0, 100]") instead of returning `STOP-CAMPAIGN`. The playbook step 3 only stops on `unreadable` or `no-weekly`, so step 4 errors on a normal path. Fix: stop on `shortfall_pct` 0 in step 3, or accept 0 in the gate. |
| 2 | MEDIUM | The usage-file hand-off does not reach the gate. `phase-catchup.md` step 2 says to pass `--usage <file>` to `usage`, `pace-floor` "and the gate below", and the scheduled-task template does the same, but `usage-budget.ts --usage` takes inline JSON (and `--floor` builds its source without `usageFile`). On an app-only host every spawn-round gate call reads no cache and returns `SKIP`, so the scheduled catchup never runs there. Fix: add `--usage-file` to `usage-budget.ts`, or document the JSON route and how the pinned spawn text carries it. |
| 3 | LOW | `--lane` cannot be reset to unset for one invocation (`null` is not reachable from the flag). |
| 4 | LOW | `launch-gate.md` Print-only paragraph now splits mid-sentence ("... then the `--floor` gate decides. The gate then prints ..."), reading as two gates. |
| 5 | LOW | `'a number in (0, 100]'` and the lane message are repeated five times across `resolveCatchup` and `applyOverrides`; one constant each would remove the drift risk. |

D1 and D2 are deferred by design and respected.
