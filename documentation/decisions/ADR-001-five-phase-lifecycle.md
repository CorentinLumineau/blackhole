---
type: adr
tracking_initiative: backlog-campaign-v2
status: accepted
scope: orchestration
---

# ADR-001: Five-Phase Lifecycle

## Context

Backlog Campaign must automate the SDLC for forge issues while keeping human gates for ambiguity. The system needs a clear, binding state machine that any agent can follow.

## Decision

Adopt a five-phase lifecycle for every campaign issue:

1. **Handle** — triage, clarify, split, dependency resolution
2. **Plan** — touch-paths, schema baseline, TDD task breakdown
3. **Implement** — isolated worktree, TDD, PR with `Closes #N`
4. **Review** — V-code audit via reviewer + synthesizer pipeline
5. **Loop** — merge, ledger cleanup, schedule next batch

State is persisted in `.bc-campaign/queue.json` with `phase` and `status` fields.

## Consequences

- Positive: Predictable orchestration; phase-only SKILL modes enable incremental adoption
- Positive: Queue DAG scheduling composes with wave computation
- Negative: Phase transitions must be documented in playbooks; drift caught by `verify.ts`

## Amendment

- Line 20 ("Review — V-code audit via reviewer + synthesizer pipeline") is superseded by
  [ADR-003](ADR-003-synthesizer-removal.md): the LLM synthesizer agent was removed in favor
  of deterministic `scripts/review-aggregate.ts`.
- Line 23 (`.bc-campaign/queue.json`) is superseded by the runtime-directory migration to
  `.blackhole/queue.json` — see `README.md` § "Migrating from bc-campaign".

Original decision text above is left unedited for historical accuracy; this section
records what has since changed.

## References

- `src/references/phase-*.md`
- `src/SKILL.md`
