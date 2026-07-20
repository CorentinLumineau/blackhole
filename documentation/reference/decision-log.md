---
type: reference
status: current
review_trigger: "on file change"
created: 2026-07-20
last_updated: 2026-07-20
related:
  - documentation/decisions/ADR-012-shared-artifact-substrate.md
---

# Decision Log

Durable, greppable record of implementation decisions — Root-Cause Decision Records,
Refactoring Verification Decision Records, Reuse Check entries, and Improvement Records —
banked by the orchestrator from `decision_records[]` (ADR-012 E4). **Append-only. Written
solely by the orchestrator**, serially, post-barrier — see `src/agents/orchestrator.md` §
Decision Record Append. No worker writes this file directly.

## Rotation

When this table exceeds 500 rows, the orchestrator moves the oldest rows to
`documentation/reference/_archive/decision-log-{first-issue}-{last-issue}.md`, mirroring the
`findings-ledger.json` archive convention (`src/references/blackhole-state.md`). This file
itself is never deleted, only trimmed.

## Records

| PR/Issue | Kind | Touch Paths | Decision | Why |
|---|---|---|---|---|
