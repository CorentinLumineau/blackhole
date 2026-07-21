---
type: implementation
status: archived
review_trigger: "on reference"
created: 2026-07-21
last_updated: 2026-07-21
related:
  - documentation/decisions/ADR-013-mercure-parity-program.md
  - documentation/audits/mercure-parity-surface.md
  - documentation/audits/mercure-parity-matrix.md
---

# Archived — Mercure Parity Program (ADR-013)

**Status:** COMPLETE — all 6 milestones merged to main and pushed. Duration: 2026-07-20 → 2026-07-21
(one `/x-initiative implement-all` run). Priority 2, related to companion-substrate-closure. Execution
mode: mercure initiative (edits the sync skill + enforcement contracts themselves).

**Goal delivered:** blackhole as the standalone autonomous mercure — measurable enforcement/artifact
parity via a **living, self-validating parity matrix**, a parity-first Adoption Lens v2, dual-mode
`prj-mercure-sync` v2, gap closures, and the first matrix-driven backlog sweep.

## Milestones

| M | Title | Merge | Notes |
|---|-------|-------|-------|
| M1 | Sync v2 + Lens v2 + verify check | `8d0842b` | Tiered Lens v2 (ADOPT/ADAPT-async/N/A), dual-mode sync; new `V-PMATRIX-01` check (checks 28→29) |
| M2 | Parity matrix seed | `3a87aba` | `mercure-parity-matrix.md`: 82 rows (75 mechanism + 7 in-flight), all 10 GAP-N; V-PMATRIX-01 green |
| M3 | GAP-1 V-THREAT/V-PERF machinery | `bf875a4` | 4 V-codes (46→50), conditional planner sections, reviewer §16/§17 audits |
| M4 | Merge/delivery hardening (GAP-2/3/8) | `a808875` | Spec-drift-at-merge check, delivery-boundary evidence, BLOCKING `ac_mapping` gate — no new V-code |
| M5 | `parity` self-audit hunt kind | `4e20a79` | New `hunt/parity.md` (3 heuristics, never-BLOCK), registered as 7th kaizen kind |
| M6 | First matrix-driven backlog sweep | `001d8da` | Read-only-first then applied: filed #306, PM-028→in-flight(#306), fixed stale PM-010/045 |

## Key decisions
- **Lens v2 live before matrix seeding** (ADR-013 acceptance-order hazard) — M1 shipped the posture and
  the (skipping) verify check before M2 seeded a single row.
- **`prj-mercure-sync` is the sole matrix writer**; all consumers cite `PM-NNN` row ids read-only.
- **HITL is ambiguity-only** — user rejected sync gates, runtime delegation to mercure, benchmark runs.
- **Rejected with critic evidence (do not revisit):** two-ADR split, sync-owned matrix, matrix-less reports.

## Lessons learned
- **The matrix is only as current as its last sweep.** M6's read-only pass found two `gap` rows
  (PM-010/PM-045) that M3 — a *sibling milestone in the same initiative* — had already closed. A living
  matrix needs a re-verify pass after each enforcement milestone lands, not just at seed time.
- **The plan's own target can be stale by execution time.** M6 expected GAP-6 as the top gap; the live
  matrix had folded GAP-6 into PM-004 (`covered`). Deferring to the live artifact (Entry-Gate row 5 /
  Risk R1) over the plan's memo was correct and pre-authorized.
- **Read-only-first is the right shape for outward actions.** M6 drafted the issue + matrix diff for
  approval before any `gh issue create` — the filing was a deliberate gate, not a side effect.

## Key deliverables
`prj-mercure-sync` v2 (Lens v2 + release/backlog modes), `mercure-parity-matrix.md` (self-validating via
`V-PMATRIX-01`), V-THREAT/V-PERF machinery (V-codes 46→50), GAP-2/3/8 hardening, `hunt/parity.md` kind,
GitHub **#306** (V-TEST-09 coverage-regression gate — open, to implement later).
End state: `bun run verify` 29/29, `bun test` 529/0, build clean.
