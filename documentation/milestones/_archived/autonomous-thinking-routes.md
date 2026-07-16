---
type: milestone
status: archived
created: 2026-07-15
last_updated: 2026-07-16
archivedAt: 2026-07-16
related:
  - documentation/decisions/ADR-010-autonomous-thinking-routes.md
  - documentation/audits/autonomous-workflow-parity.md
review_trigger: "on file change"
---

# Archived Initiative: autonomous-thinking-routes

**Status**: Complete — all 5 milestones merged to `main` (PRs #295–#299, squash)
**Type**: Feature (orchestration parity) | **Duration**: 2026-07-15 → 2026-07-16
**Source**: ADR-010 + gap analysis (`documentation/audits/autonomous-workflow-parity.md`, 4 evidence sources)

## Goal

Port mercure's full workflow catalogue into blackhole as an autonomous backlog cleaner — four
thinking routes (analyze, autonomous design, brainstorm, retrospective), one confidence-based
escalation contract, and one durable `documentation/` artifact contract — all behind an opt-in
`autonomy` config block (absent/off = byte-for-byte current behaviour).

## Milestones

| # | Name | Value/Effort | Delivery |
|---|------|--------------|----------|
| M1 | Confidence kernel + artifact contract + `autonomy` config + V-AUTO codes | 40/20 | PR #295 (36b41b1) |
| M2 | Design autonomy: fixed rubric, blind critics, `design-aggregate.ts` verdict, in-PR ADR promotion | 30/30 | PR #298 (da03b04) |
| M3 | Analyze route: investigator `analyze` sub-mode, `needs_analysis`, `analysis-landed` checkpoint | 15/20 | PR #297 (7787b4b) |
| M4 | Brainstorm route: planner `track: brainstorm`, `needs_brainstorm`, child-issue terminal, docs-only PR | 10/15 | PR #299 (453468a) |
| M5 | Retrospective hunter kind (ledger + merged-PR synthesis → `needs_design` candidates) | 5/15 | PR #296 (4bbc827) |

## Key Decisions

- **Config kill-switch throughout** — every route gates on `autonomy.enabled && autonomy.{sub_flag}`; absent block = unchanged behaviour, mirroring the `kaizen`/`docs_governance` precedent.
- **No self-graded homework (M2)** — the planner never scores its own axes nor certifies its own recommendation; a fixed `design-rubric.md` + blind critics + deterministic `design-aggregate.ts` produce the verdict, and the orchestrator applies only the script's `status` field (V-DESIGN-02 grounds the markers).
- **Additive-only schema growth** — new `route{}` flags and validator enums were purely additive, which is what let M2/M3/M4 be built in parallel off one base commit and reconciled at merge with union semantics.
- **Artifacts ship in-PR (merge = approval)** — durable `documentation/` outputs land inside the issue's PR rather than via an orchestrator file write, preserving the human review surface.

## Lessons Learned

- **What worked**: wave-parallel execution (M2+M3+M5 concurrently, then M4) cut wall-clock ~3×; every milestone plan was quality-gated 8/8 up front, so the implementation agents hit zero rework. Base-commit drift (plans written at d4d978b, main at 36b41b1) was absorbed cleanly because each agent was told to re-grep cited line numbers rather than trust the plan's literals.
- **Merge-order friction**: making `needs_analysis`/`needs_brainstorm` *required* route fields meant M3 and M4 touched the same fixtures/validator; a dedicated reconcile pass (union-keep both sides, regenerate mirrors via `bun run build`, never hand-edit) was needed for #299. A non-conflicted M3-only fixture still needed M4's fields — caught only by a test failure, confirming the suite is the real guard.
- **Governance caught real accretion**: the V-CONTENTGATE-01 grow-never gate blocked inline additions to `orchestrator.md`'s grandfathered section twice (M2, M4); the sanctioned fix (1-line pointer + new budgeted section registered in the baseline) kept SRP intact.
- **Deferred, never dropped**: 5 WARN findings from batch review were filed as issues #300/#301/#302 instead of blocking merge.

## Key Deliverables

`scripts/design-aggregate.ts` (+19 tests), `src/references/design-rubric.md`, `src/references/hunt/retrospective.md`, `src/references/{confidence-gates,artifact-contract}.md` (M1), investigator `analyze` sub-mode, planner `brainstorm` track, `autonomy` config block, V-AUTO-01/02 + V-DESIGN-02 enforcement. Final `main`: 486/486 tests, `bun run verify` 28/28. ADR-010 → Accepted.

## Follow-ups (open)

- #300 — retrospective kind: file/line semantics for cluster-level findings + tag illustrative examples
- #301 — brainstorm: enforce 5-children cap in validator, fix queue-dag cautious-default phrasing, config-template threshold docs
- #302 — findings-ledger.md: "three re-route checkpoints" now four (`analysis-landed`)
