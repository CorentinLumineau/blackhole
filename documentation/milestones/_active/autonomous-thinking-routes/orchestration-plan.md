---
initiative: autonomous-thinking-routes
computed-at: 2026-07-16T00:00:00Z
status: done
concurrency: "M=3 T=5"
---

# Orchestration Plan: autonomous-thinking-routes

M1 already completed (merged to main as PR #295, commit 36b41b1) — skipped.

## Wave Schedule

| Wave | Milestones | Tasks | Parallel Cap |
|------|-----------|-------|--------------|
| W1 (done) | M2, M3, M5 | 9 + 9 + 7 | min(3, 3) milestones × 5 tasks |
| W2 (done) | M4 | 10 | min(1, 3) milestones × 5 tasks |

## Known cross-milestone file overlaps

- M2 ↔ M3: both edit `src/agents/planner.md`, `src/references/worker-schemas.md`
- M3 ↔ M4: both edit `scripts/validate-worker-json.ts(.test.ts)`, `src/references/queue-dag.md`, `src/agents/router.md`, `src/references/worker-schemas.md`, `src/references/config-template.md`
- All PRs branch from main; conflicts reconciled at merge time (M4's plan §Out-of-scope states this explicitly).

## Milestone Details

### Wave 1
| Milestone | Status | Tasks |
|-----------|--------|-------|
| M2 — Design autonomy: blind critics + deterministic design-aggregate verdict | merged — PR #298 (da03b04) | T1-T2 design-aggregate TDD, T3 design-rubric.md, T4 worker-schemas critic schema, T5 planner.md §4.3/§4.8, T6 orchestrator.md dispatch, T7 phase-plan.md gate row, T8 V-DESIGN-02 check, T9 full regression |
| M3 — Per-issue analyze route (investigator `analyze` sub-mode) | merged — PR #297 (7787b4b) | T1 investigator.md, T2 router.md + G9 fix, T3 queue-dag.md, T4 phase-handle.md, T5 config-template.md, T6 worker-schemas.md, T7 validate-worker-json.ts, T8 fixtures + tests, T9 planner.md consumption |
| M5 — Campaign retrospective: hunter `retrospective` kind | merged — PR #296 (4bbc827) | T1 hunt/retrospective.md, T2-T4 config/fixture/hunter kind registration, T5-T6 zero-edit verification, T7 build + verify + test |

### Wave 2
| Milestone | Status | Tasks |
|-----------|--------|-------|
| M4 — Brainstorm route: planner `track: brainstorm` + child-issue terminal | merged — PR #299 (453468a, after main-reconcile 55e057a) | T1 validator TDD, T2 fixtures, T3 queue-dag.md, T4 router.md, T5 planner.md brainstorm track, T6 config-template.md, T7 orchestrator.md dispatch + terminal, T8 phase-plan.md gate row, T9 worker-schemas.md, T10 regression |
