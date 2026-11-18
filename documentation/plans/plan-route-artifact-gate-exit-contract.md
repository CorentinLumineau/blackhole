---
type: plan
summary: "Make the V-AUTO-03 dispatch gate prose state that any non-zero route-artifacts exit blocks the spawn, and order the gate before the in-flight queue mutation"
status: current
review_trigger: "on file change"
created: 2026-11-18
last_updated: 2026-11-18
---

# Plan: route-artifact dispatch gate exit contract (issue #1304)

## Objective
The `V-AUTO-03` dispatch gate prose says only "exit 1 -> do not spawn", so an exit 2 (bad invocation, e.g. missing `--campaign-dir`) reads as "gate passed" and an implementer gets spawned with no artifacts checked. State the full contract (any non-zero exit blocks the spawn; exit 1 = stage the missing artifacts, exit 2 = fix the invocation) and order the gate before the `queue.json` phase-implement/in-flight mutation so a blocked dispatch never leaves the issue marked in-flight.

## Touch-Paths
- `src/references/phase-implement.md` (checklist line 9 wording; move gate above the "queue.json: phase implement, status in-flight" line)
- `src/references/claude-code-native.md` (line ~83 wording)
- `scripts/route-artifacts.test.ts` (only if a prose assertion is found; grep shows none, so likely untouched)
- plus all generated dist trees per `scripts/lib/build/targets.ts`

## Documentation Impact
None - the edited files are the protocol docs themselves; no companion or consumer doc restates the gate wording (grep of `scripts/**/*.test.ts` and `src/` finds the wording only in the two files above).

## Task Steps
1. Edit `phase-implement.md`: reorder checklist so "Route-artifact gate (V-AUTO-03)" precedes "queue.json: phase implement, status in-flight"; replace "exit 1 -> do not spawn the implementer, run the missing plan/investigator step first" with "any non-zero exit -> do not spawn; exit 1 = stage the missing plan/investigator artifacts, exit 2 = fix the invocation".
2. Edit `claude-code-native.md` sentence: "any non-zero exit means do not spawn the implementer; exit 1 = the route's artifact was never staged, run the missing step first; exit 2 = fix the invocation".
3. `bun run build` to regenerate copies (done by the implementer, not the planner).
4. Confirm no test asserts the old prose: `grep -rn "exit 1 .*do not spawn\|Route-artifact gate" scripts --include=*.test.ts` returns nothing (planner grep: none). If an assertion is found at implement time, update it in the same PR.

## Task Breakdown / Acceptance Criteria
- T1 phase-implement.md - **AC**: `grep -n "Route-artifact gate" src/references/phase-implement.md` line number is lower than `grep -n "phase implement, status in-flight"` line number; the gate line contains "non-zero", "exit 1" and "exit 2".
- T2 claude-code-native.md - **AC**: `grep -c "exit 2" src/references/claude-code-native.md` >= 1 and the line contains "non-zero".
- T3 build - **AC**: `bun run build` exits 0 and `grep -rl "exit 1 means the route" <generated trees per targets.ts>` returns no stale copy (no old "exit 1 -> do not spawn the implementer" wording remains in `src/` or generated trees).
- T4 test guard - **AC**: no `scripts/**/*.test.ts` references the old gate prose; if one does, it passes after update.

## Test Strategy
Prose-only change; no new behavioral test (the exit-code contract itself is already covered by `scripts/route-artifacts.test.ts`). Verification: the grep ACs above plus `bun run build` and the repo's drift check (`bun run verify`) in CI per ci-first-verification.

## Track / Classification
Quick; `task_type: bugfix`; size xs; no security or UI gate (`route.ui` false, no auth/data/endpoint touched).

## Pareto
Gain 5, Effort 1, Priority = 5 x 10 = 50 (>= 30).
