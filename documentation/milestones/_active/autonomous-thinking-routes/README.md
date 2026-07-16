---
type: milestone
status: current
created: 2026-07-15
last_updated: 2026-07-15
review_trigger: "on milestone completion"
related:
  - documentation/decisions/ADR-010-autonomous-thinking-routes.md
  - documentation/audits/autonomous-workflow-parity.md
---

# Initiative: Autonomous Thinking Routes (ADR-010)

Port mercure's full workflow catalog into blackhole as an autonomous backlog cleaner:
four thinking routes (analyze, autonomous design, brainstorm, retrospective), one
confidence-based escalation contract, and one durable `documentation/` artifact contract —
all behind an opt-in `autonomy` config block (absent/off = exact current behavior).

**Source**: `documentation/decisions/ADR-010-autonomous-thinking-routes.md` (Proposed) ·
`documentation/audits/autonomous-workflow-parity.md` (gap analysis, 4 evidence sources)

## Milestones

| # | Name | Value% | Effort% | Status | Deployable | Depends on |
|---|------|--------|---------|--------|------------|-----------|
| M1 | Confidence kernel + artifact contract + `autonomy` config + V-AUTO codes | 40 | 20 | pending | Yes (inert while disabled) | — |
| M2 | Design autonomy: fixed rubric, blind critics, `design-aggregate.ts` verdict, ADR promotion in-PR | 30 | 30 | pending | Yes (config-gated) | M1 |
| M3 | Analyze route: investigator `analyze` sub-mode, `needs_analysis`, `analysis-landed` checkpoint | 15 | 20 | pending | Yes (config-gated) | M1 |
| M4 | Brainstorm route: planner `brainstorm` track, `needs_brainstorm`, child-issue terminal, docs-only PR | 10 | 15 | pending | Yes (config-gated) | M1 (soft: M2 conventions) |
| M5 | Retrospective hunter kind (ledger + merged-PR synthesis → `needs_design` candidates) | 5 | 15 | pending | Yes (kaizen-gated) | M1 |

## Dependency graph

```
M1 ──┬── M2 ──(soft)── M4
     ├── M3
     └── M5
```

M2, M3, M5 are parallelizable after M1; M4 prefers M2's rubric conventions but only hard-requires M1.

## Current focus

**M1** — foundation; all plans quality-gated 8/8 with `plan_base_commit: d4d978b`.

## Notable plan findings (cross-milestone)

- M3 & M4: `scripts/validate-worker-json.ts` owns the `SUB_MODES`/`TRACKS`/route enum
  enforcement — both plans add it to Touch-Paths (initiative brief had omitted it).
- M3 carries one `[NEEDS CLARIFICATION]`: which route fields the `analysis-landed`
  checkpoint re-validates (defaulted to mirroring `research-landed`).
- M4 Hard Choice: brainstorm artifact ships via the existing `execution_mode: docs-only`
  PR path (reuses review/governance machinery), artifact PR merges before children file.
- M5: review-round counts must come from `gh pr view --json reviews`, NOT queue.json's
  `review_iteration` (reset to 0 on merge); phase-loop.md/SKILL.md need zero edits
  (kind roster is data-driven).
