---
tracking_initiative: backlog-campaign-v2
status: accepted
scope: review
supersedes: ADR-002
---

# ADR-003: Synthesizer Removal — Deterministic Review Aggregation

## Context

`bc-synthesizer` was introduced in [ADR-002](ADR-002-synthesizer-extraction.md) as a dedicated LLM aggregation hop after `bc-reviewer`. The [YAGNI audit](../audits/analysis-bc-synthesizer-yagni.md) found:

- No demonstrated ledger benefit from LLM cross-correlation or `multi_source` promotion
- Pass-through behavior on most reviews (reviewer already emits structured JSON)
- Extra subagent latency and cost per PR with no parallel multi-reviewer swarm in bc-campaign v1

## Decision

Remove `bc-synthesizer` and replace mandatory LLM aggregation with deterministic `scripts/review-aggregate.ts`:

```
bc-reviewer (raw findings JSON)
        ↓
scripts/review-aggregate.ts (exact dedup, blockers_count, lgtm, Pareto rank)
        ↓
orchestrator (ledger append, phase routing, merge gate)
```

- **LGTM:** reviewer `status: complete` + `blockers_count === 0` after dedup (+ existing unresolved-ledger BLOCK rule)
- **Dedup key:** `(vcode, file, line, issue_ref)` — same as ledger append
- **No cross-correlation** in v1 (YAGNI)

## Consequences

- Positive: One fewer subagent spawn per review; predictable, testable aggregation
- Positive: `bun test scripts/review-aggregate.test.ts` covers dedup and gating
- Negative: No semantic dedup or root-cause merging until a future multi-reviewer design

## Revisit condition

Re-introduce a dedicated aggregation agent if bc-campaign adopts parallel multi-reviewer swarms (2+ independent reviewers per PR).
