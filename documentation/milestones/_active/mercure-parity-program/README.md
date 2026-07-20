---
type: plan
status: current
initiative: mercure-parity-program
review_trigger: "on milestone completion"
created: 2026-07-20
last_updated: 2026-07-20
related:
  - documentation/decisions/ADR-013-mercure-parity-program.md
  - documentation/audits/mercure-parity-surface.md
  - documentation/brainstorms/mercure-parity-program.md
  - documentation/milestones/_active/companion-substrate-closure/README.md
---

# Initiative: Mercure Parity Program

Blackhole as the fully-standalone autonomous mercure — measurable enforcement/artifact parity
via a living parity matrix, a parity-first Adoption Lens v2, dual-mode prj-mercure-sync v2,
gap closures (threat/perf machinery, merge/delivery hardening), a campaign self-audit hunt
kind, and matrix-driven backlog sweeps.

**Source**: ADR-013 (`documentation/decisions/ADR-013-mercure-parity-program.md`) ·
Evidence: `documentation/audits/mercure-parity-surface.md` ·
Requirements: `documentation/brainstorms/mercure-parity-program.md`

**Execution mode**: mercure initiative (NOT a blackhole self-campaign) — milestones edit the
sync skill, reviewer/planner/implementer contracts, and enforcement machinery itself; same
rationale as companion-substrate-closure.

**Relationship**: priority 2, related to (no hard dependency on) `companion-substrate-closure`
— ADR-011/012 ground enters the matrix as `in-flight` rows.

## Milestones

| # | Name | Value% | Wave | Depends | Status | Deployable |
|---|------|--------|------|---------|--------|------------|
| M1 | Sync v2 + Lens v2 + verify check (ADR-013 D2/D3) | 30 | 1 | — | pending | Yes |
| M2 | Parity matrix seed (~70 rows, ADR-013 D1) | 25 | 2 | M1 | pending | Yes |
| M3 | GAP-1: V-THREAT/V-PERF machinery (46→50 V-codes) | 20 | 3 | M2 | pending | Yes |
| M4 | Merge/delivery hardening (GAP-2/3/8 — all verified real) | 10 | 3 | M2 | pending | Yes |
| M5 | `parity` campaign self-audit hunt kind (F6) | 10 | 3 | M2 | pending | Yes |
| M6 | First matrix-driven backlog sweep (GAP-6 first) | 5 | 4 | M1, M2 | pending | Yes |

## Dependency graph

```
M1 ──> M2 ──> M3 ─┐
        ├──> M4 ──┼──> (done)
        ├──> M5 ──┘
        └──> M6 (also needs M1)
```

Wave 3 (M3/M4/M5) milestones are mutually independent and parallelizable.

## Current focus

M1 — Sync v2 + Lens v2 + verify check. Binding order (ADR-013 Migration Plan): the Lens v2
posture must be live before any matrix row is seeded (M2).

## Notes

- M4 planning already confirmed all three of its gaps as real against current source, plus a
  doc-drift bonus finding: `worker-schemas.md` documents `ac_mapping` as a `failing_checks`
  value with zero implementation.
- M3 could not cite PM-row ids (matrix doesn't exist until M2 lands) — backfill its References
  when M2 merges.
- D4 (consumer-repo doc-layout extension) rides inside M1's sync rewrite scope only as far as
  artifact-contract.md rows; it is config-gated by `docs_governance.write_governance`.
