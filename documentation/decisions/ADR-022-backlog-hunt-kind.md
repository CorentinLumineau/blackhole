---
type: adr
status: accepted
created: 2026-08-12
last_updated: 2026-08-12
review_trigger: "on ADR acceptance"
related:
  - documentation/decisions/ADR-006-kaizen-hunt.md
  - documentation/decisions/ADR-013-mercure-parity-program.md
  - documentation/decisions/ADR-019-ux-coherence-hunt-kind.md
---

# ADR-022: Backlog Hunt Kind

**Decision**: Add a tenth kaizen hunt kind `backlog` that scans **scoped open forge issues**
(not code) for duplicate overlap, stale referents, and low-information bodies — closing mercure
parity gap PM-089 (`mercure-parity-surface.md` §5b Priority 48, issue #452).

The autonomous `scripts/design-aggregate.ts` path returned `ready` with winner **Option A** (new
`backlog` kind) — all three scorers agreed with dominance margins ≥31% (`design_dominance_delta:
30`). Campaign `autonomy.mode: full` applies; `design_autonomy` defaults `true` per
`config-template.md` § autonomy contract.

## Context

Blackhole's kaizen loop (`ADR-006`) ships nine default kinds, all scanning code, documentation,
merged output, or campaign metadata. None compares two open issues for semantic overlap, verifies
that paths cited in an issue still exist, or enriches sparse bodies before Handle routing. Mercure's
`git-issue` mode-triage Phases 2–4 remain the documented parity target.

Investigator research (`.blackhole/plans/issue-452-research.md`, turn 9) confirmed the gap.
`retrospective` reads campaign history but explicitly avoids live open-issue triage.

## Decision

1. **New kind `backlog`** — `src/references/hunt/backlog.md` defines territory (issue-number
   bands over scoped open issues), three heuristics, and finding `file`/`line` sentinels
   (`issue:<n>`, `line: 0` or pair line numbers).
2. **Duplicate similarity rule** — normalized title+body Jaccard ≥ 0.55 **and** touch_path or
   cited-path-prefix overlap; file `[Kaizen]` consolidation proposals only (never auto-close).
3. **Stale referent** — Glob/Grep backtick-quoted paths and symbols from issue bodies; CONFIRMED
   only on re-read verification (`V-HUNT-01`).
4. **Low-information enrichment** — hunter proposes draft AC/touch paths in `rationale`; orchestrator
   post-wave pass posts `gh issue comment` (delimited `<!-- blackhole:enrichment -->`) and mirrors
   into `queue.json` `notes` before Handle dispatch.
5. **Dispatch** — participates in existing `phase-loop.md` § Next batch step 0 round-robin (before
   ready-set build); no new orchestrator dispatch signature.
6. **Vocabulary** — append `backlog` to `HUNT_KINDS` (`facts.ts`) and default `kaizen.kinds`
   (`config-template.md`).

## Alternatives rejected

| Option | Why rejected |
|--------|--------------|
| B — extend `retrospective` | Violates that kind's merged-history contract (`retrospective.md:50-54`); couples unrelated heuristics |
| C — orchestrator-only script | Fails AC1 (not a hunt kind); bypasses `hunt_state` watermarks and kaizen dedup |

## Consequences

- Positive: closes PM-089; reduces duplicate PR collisions and stale-referent plan waste.
- Negative: Jaccard threshold may need calibration tuning; enrichment adds orchestrator write surface.
- Neutral: kaizen remains opt-in (`kaizen.enabled`); kind ships in defaults for future campaigns.

## Promotion

Promoted from `.blackhole/plans/issue-452-design.md` (design track, turn 10).
