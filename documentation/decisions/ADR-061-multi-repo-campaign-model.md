---
type: adr
summary: "A multi-repo campaign runs as one orchestrator over many repos (model A), not one session per repo coordinated through usage_budget.coordination (model B); the account-wide budget is computed once with workersAllowed and split by a pure allocator (scripts/lib/multi-repo-budget.ts) that ranks candidates globally, bugs first then priority, so the total never exceeds the verdict; the allocator is the reusable kernel under either model"
status: accepted
review_trigger: "on a change to allocateWorkers(), the campaign.repos[] input, usage_budget.coordination, or a multi-repo launch gate"
created: 2026-11-24
last_updated: 2026-11-24
related:
  - scripts/lib/multi-repo-budget.ts
  - scripts/lib/usage-budget.ts
  - src/references/claude-code-native.md
  - documentation/plans/plan-multi-repo-campaign.md
---

# ADR-061: Multi-repo campaign model

## Status

Accepted - 2026-11-24, issue #1372 slice 1 of 6.

## Context

A campaign spanning several repos today runs as one session per repo. The usage budget is one
account-wide quantity, so each session's own `workersAllowed` call counts the same headroom again:
three repos can spawn three times the budget. The issue defers the model choice to a design pass:

- **A**: one orchestrator drives many repos.
- **B**: one session per repo, coordinated through `usage_budget.coordination`.

## Decision

**Model A.** One orchestrator computes the account-wide verdict once per round with
`workersAllowed`, then splits `verdict.workers` across repos with `allocateWorkers`
(`scripts/lib/multi-repo-budget.ts`). Candidates are ranked globally: bugs first, then higher
priority, then input order. The top `verdict.workers` candidates get a slot; a repo with none is
present with 0; a non-GO verdict allocates nothing and passes its reasons through. The total never
exceeds the verdict.

Slice 1 delivers this ADR and the allocator only. The structured scope input, per-repo merge row,
per-repo doctor and park, state-store kind and the worktree refusal are separate slices.

## Alternatives Considered

**B, one session per repo with `coordination`.** The strongest case for B: isolation is strong by
construction (a crash or park decision in one repo never touches another), no new state model is
needed, and each session starts inside its own repo, so no cross-repo write is ever attempted
(the confinement #1370 describes does not arise). It reuses an existing config block.

Rejected because its budget correctness rests on the least built part. `coordination` today only
sets a role and a `peer_floor`; no transport divides one verdict across repos. It needs a
cross-session message tool (`claude-code-native.md`), and peer detection only sees sessions on the
same clone. It also gives the owner N launch gates and N dashboards.

## Consequences

- One launch gate and one dashboard; budget exactness is by construction, with no host dependency.
- Cost: isolation is weaker, and the orchestrator is confined in every repo it does not own (#1370).
  Slice 6 (#1513) turns that into an up-front refusal.
- The allocator is a pure function over one verdict, so it is the reusable kernel under B too: a
  manager session would divide its verdict the same way. This ADR does not foreclose B.
- Follow-up slices: #1509 (`campaign.repos[]` and wiring the allocator into the spawn round),
  #1510 (per-repo merge row), #1511 (per-repo doctor and park), #1512 (state-store kind and the
  tracked-state-behind-origin refusal), #1513 (worktree refusal, links #1370).
