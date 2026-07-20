# Progress — implement-all: companion-substrate-closure + mercure-parity-program

## Current Status
- Branch: `main`. Executing two initiatives end-to-end via mercure `/x-initiative implement-all`.
- Model: sequential, merge-between-milestones. companion-substrate-closure (priority 1) fully,
  then mercure-parity-program (priority 2). Each milestone: branch → implement (per-milestone
  agent) → review → green `bun run verify` + `bun run build` + `bun test` → merge to main → next.
- Run as a **mercure initiative, NOT a blackhole self-campaign** (milestones edit blackhole's own
  agent contracts; a self-campaign would review changes to its own contract).
- Currently: starting **CSC-M0**.

## Green baseline (main @ 22a84bb)
- `bun run verify` → 28/28
- `bun run build` → clean, zero drift
- `bun test` → 490 pass / 0 fail / 25 files
This is the regression gate for every milestone.

## Execution order (task IDs in TaskList)
1. CSC-M0 accretion control (wave1)      ← in progress
2. CSC-M1 schema precedence (wave1)
3. CSC-M4 decision memory (wave1)
4. CSC-M2 promotion path (needs M1)
5. CSC-M3 Active Constraints (needs M2)
6. MPP-M1 sync/Lens v2 (wave1)
7. MPP-M2 matrix seed (needs M1)
8. MPP-M3 threat/perf (needs M2)
9. MPP-M4 merge/delivery hardening (needs M2)
10. MPP-M5 parity hunt kind (needs M2)

## Deferred (gated — hand to user)
- CSC-M5 autonomy.enabled flip — BREAKING; needs a real green campaign + human T3 sign-off.
- MPP-M6 first matrix-driven backlog sweep — runs prj-mercure-sync live; files real GitHub issues.

## Completed Milestones
(none yet)

## Failed Approaches
(none yet)

## Known Limitations / Constraints
- src/ is the only editable source; .claude/**, .agents/build/**, codex-*, plugins/* are `bun run
  build` output. Exception: `.claude/skills/prj-mercure-sync/` is edited directly (prj-* exempt).
- V-CONTENTGATE-01: orchestrator.md sections are grow-never; new content goes in a new ≤50 LOC
  section + one-line pointer.
- Planner never computes its own design-autonomy verdict (ADR-010).
- Single-writer invariant: only the orchestrator writes queue.json/findings-ledger.json/decision-log.md.
- Resource-frugal testing: one `bun test`/`bun run verify` at a time; check `free -m` before heavy runs.
