---
tracking_initiative: backlog-campaign-v2
status: accepted
scope: review
---

# ADR-002: Synthesizer Extraction

## Context

The orchestrator previously aggregated reviewer findings inline. This duplicated logic, made deduplication inconsistent, and increased orchestrator cognitive load during parallel batches.

Mercure's `x-synthesizer` pattern demonstrates value in a dedicated read-only aggregation agent (ADR-026 in mercure).

## Decision

Extract post-review aggregation into `backlog-synthesizer`:

- **Reviewer** returns raw findings JSON
- **Synthesizer** deduplicates, cross-correlates, Pareto-ranks, and emits `lgtm`
- **Orchestrator** appends synthesizer output to `findings-ledger.json` — never aggregates inline

Shared infrastructure lives in `src/references/review-core.md`.

## Consequences

- Positive: Stable finding ranking across review iterations
- Positive: Orchestrator focuses on scheduling and ledger writes
- Positive: `quick` mode on iteration 2+ reduces cost
- Negative: Additional subagent spawn per review (latency trade-off)

## Alternatives considered

- **6-agent review swarm** (mercure x-review): Rejected — backlog-campaign stays lean with one reviewer + synthesizer

## References

- `src/agents/backlog-synthesizer.md`
- `src/references/review-core.md`
- `src/references/worker-schemas.md`
