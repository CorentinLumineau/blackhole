---
type: plan
summary: "Catchup-mode initiative: bootstrap version check, host-agnostic usage reading, /blackhole catchup with the full-config launch gate, and lane claims (ADR-054)"
status: current
review_trigger: "on milestone completion"
created: 2026-11-17
last_updated: 2026-11-17
related:
  - documentation/decisions/ADR-054-catchup-mode-quota-pacing.md
  - documentation/brainstorms/weekly-quota-pacing.md
  - documentation/milestones/_active/catchup-mode/discovery.md
---

# Initiative: catchup mode

Spend the weekly plan quota up to a 17.5%-per-weekday pace floor with `/blackhole catchup`. The
5h window must never go above 80%, and a run must never take an issue another session, colleague
or account holds. Source: ADR-054 and the weekly-quota-pacing brainstorm.

## Milestones

| # | Name | Value | Status | Deployable |
|---|------|-------|--------|------------|
| M1 | Bootstrap version check (#1271) + launch-gate doc Sleep row | 20% | planned | Yes |
| M2 | Usage reading everywhere: break the #1272 cycle, `bun run usage` provider chain, `pace-floor.ts` | 35% | planned | Yes |
| M3 | `catchup` mode: `usage-budget --floor`, config block, SKILL row + playbook, launch gate for catchup with the full config and pacing defaults | 30% | planned | Yes (single account) |
| M4 | Lane claim: adapter claim/release, `lane` config replacing `OWN_LANES`, lease | 15% | planned | Yes |

## Dependencies

M3 depends on M2. M1 and M4 are independent. The loop runs them in table order on the shared
branch `design/catchup-mode`.

## Outside this initiative

- C5: the mercure `git-issue` claim convention gets its own session in the mercure repo after M4.
- Scheduled-task rollout on each account happens after merge, using the template in `phase-catchup.md`.

## Current focus

M1
