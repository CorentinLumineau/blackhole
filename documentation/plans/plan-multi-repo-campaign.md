---
type: plan
summary: "Plan for ADR-061: slice 1 of first-class multi-repo campaigns, the model decision (one orchestrator, many repos) and a pure account-wide worker allocator with a 3-repo budget test; five follow-up issues carry the other acceptance criteria"
status: current
review_trigger: "on file change"
created: 2026-11-24
last_updated: 2026-11-24
related:
  - documentation/decisions/ADR-061-multi-repo-campaign-model.md
---

# Plan - Multi-repo campaign, slice 1 (ADR-061)

Track: Standard. One PR; issue #1372 stays open for slices 2-6.

## Tasks

| # | Task | Files | Acceptance criteria |
|---|------|-------|---------------------|
| 1 | Failing allocator test first | `scripts/lib/multi-repo-budget.test.ts` | Fails with a missing module before task 2 |
| 2 | Allocator | `scripts/lib/multi-repo-budget.ts` | 3 repos under a 2-worker verdict total 2; 1-worker budget totals 1; non-GO verdict totals 0 with empty `perRepo`; a bug outranks a higher-priority non-bug across repos; a repo without candidates is present with 0; total never exceeds the verdict over 20 generated cases |
| 3 | ADR and index row | `documentation/decisions/ADR-061-multi-repo-campaign-model.md`, `documentation/decisions/INDEX.md` | ADR shape and status checks pass; Alternatives names B with its strongest case; the allocator is named as the kernel under either model |
| 4 | Follow-up issues | forge | #1509 to #1513 filed, each linking #1372 |

## Follow-up slices

| Issue | Slice | Covers |
|-------|-------|--------|
| #1509 | `campaign.repos[]` scope input, allocator wired into the spawn round | scope input |
| #1510 | Per-repo Merge row in the launch gate | merge row |
| #1511 | Per-repo doctor and bootstrap, park a failing repo | doctor and park |
| #1512 | State-store kind per repo, tracked-state-behind-origin refusal | state store |
| #1513 | Bootstrap refusal inside a session worktree (links #1370) | worktree guard |

## Out of scope

Any change to `usage-budget.ts` semantics, the launch gate, config template, dashboard, per-repo
doctor, merge or state-store logic, a coordination transport for model B, per-repo slot floors.
