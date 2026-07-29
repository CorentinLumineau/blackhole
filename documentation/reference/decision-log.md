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
| PR #428 / #421 | reuse | src/references/hunt/ux-coherence.md | Reused parity.md structure + kaizen-parity-kind.test.ts test shape for the 8th hunt kind | One-file-per-kind is the established extracted pattern; rule-of-three N/A |
| PR #428 / #421 | improvement | src/references/config-template.md | No improvement needed beyond plan's registration edits | Touched lines already clean; formatting convention preserved |
| PR #430 / #422 | reuse | scripts/lib/worker-json/validators/planner.ts | Reused validateBrainstormChild local-helper shape for validateRulingConflictEntry/validateRulingConflicts instead of extracting a shared combinator | 5 bespoke occurrences now exist (past rule-of-three) but extraction is out of #422 scope — filed as #431 |
| PR #430 / #422 | improvement | src/references/clarify-gates.md | Replaced stale forward-reference ("#422 owns...not that classifier") with live pointer to the new fork + coordinator disposition wiring | Prose promised future work this PR delivers; leaving it would be a stale claim |
