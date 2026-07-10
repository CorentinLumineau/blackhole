# Decision Index

| path | summary | type | status | review_trigger |
|------|---------|------|--------|----------------|
| ADR-001-five-phase-lifecycle.md | Five-phase campaign lifecycle (Handle → Plan → Implement → Review → Loop) | adr | Accepted | on protocol change |
| ADR-002-synthesizer-extraction.md | Dedicated LLM synthesizer agent after reviewer | adr | Superseded (by ADR-003) | on protocol change |
| ADR-003-synthesizer-removal.md | Synthesizer removed in favor of deterministic review-aggregate.ts | adr | Accepted | on protocol change |
| ADR-004-adaptive-phase-routing.md | Router-agent adaptive phase routing — single-pass flag contract with re-route checkpoints, flag-derived execution chain (amends ADR-001) | adr | Proposed | on protocol change |
| ADR-005-pr-merge-gate-dependency-ordering.md | PR merge-gate (`merge_hold`) and dependency-ordering (`merge_after`) for scoped, self-reviewed campaign batches | adr | Proposed | on protocol change |
| ADR-006-kaizen-hunt.md | Kaizen hunt — proactive improvement discovery: read-only hunter agent, 5 hunt kinds, V-PARETO-02-gated filing into the existing lifecycle, `kaizen` config block, complete launch form incl. `merge_mode: leave-open` (amends ADR-001, extends ADR-005's launch gate) | adr | Proposed | on protocol change |
