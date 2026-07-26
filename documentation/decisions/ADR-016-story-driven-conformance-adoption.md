---
type: adr
status: accepted
created: 2026-07-26
last_updated: 2026-07-26
review_trigger: "on ADR acceptance"
related:
  - documentation/plans/story-driven-conformance.md
  - documentation/decisions/ADR-004-adaptive-phase-routing.md
  - documentation/decisions/ADR-006-kaizen-hunt.md
  - documentation/decisions/ADR-001-five-phase-lifecycle.md
---

# ADR-016: Story-Driven Conformance — blackhole Adoption

Adoption decision for the architecture defined in **mercure ADR-099** (*Feedback-Driven Intent
Layer — User-Story Catalog as a Shared Contract*). ADR-099 owns the cross-plugin architecture; this
ADR records what blackhole does about it and the policy choices that are blackhole's alone.
Implementation detail (hunt heuristics, calibration table, phasing) lives in
`documentation/plans/story-driven-conformance.md`.

## Context

blackhole's enforcement surface is entirely **implementation quality**: `V-SOLID`, `V-DRY`,
`V-KISS`, `V-SEC`, `V-TEST`, `V-INT`, `V-PARETO`. Every one answers *"is this well built?"* None
answers *"is this the right behaviour?"*

The consequence is structural rather than incidental:

- The `bug` hunt kind requires read/trace-verified reproduction — a traced path from an input to a
  wrong output or a crash. A feature that works exactly as coded but does the wrong thing produces
  neither, so it is invisible to every hunt kind we have.
- The reviewer audits a diff against a **plan**, derived from an **issue**. If the issue encoded the
  wrong intent, the whole chain faithfully validates the wrong thing.
- `V-FIX-01` demands a documented root cause, but the root cause of an intent defect is a mismatch
  against a specification blackhole has no representation of.

ADR-099 supplies the missing referent: a user-story catalog in the project's git tree, with
acceptance criteria that a diff can be checked against.

## Decision

### D1 — Adopt the shared catalog contract; do not own it

blackhole reads (and, for conformance findings, cites) the catalog defined by ADR-099. It does not
define the format, and it does not store the catalog.

The catalog stays in the project's git tree. `.blackhole/` holds **linkage only**:

```json
"story_links": { "US-PF-04": { "issues": [1841], "prs": [1856], "last_verified_wave": 3 } }
```

This preserves the agent-agnostic property (ADR-001): the specification is plain markdown readable
without blackhole installed; only the campaign linkage is blackhole-specific state.

### D2 — Gate policy: confidence-gated, HITL only when genuinely ambiguous

Per ADR-099 D4, gate policy is a host property. blackhole keeps **its own existing philosophy**
rather than importing mercure's always-ask contract: routing flags act autonomously above their
confidence threshold and fall back to a cautious default below it; only genuine ambiguity and
architecturally significant decisions raise an async `AskQuestion`. Intent reconciliation joins that
model as one more confidence-scored flag — it does not get a bespoke gate.

The cautious default below threshold is **`needs_story` / ask**, never a silent amendment.

### D3 — ADR-099 D5 is binding here without variation

Confidence gating decides *whether to ask*, never *whether to record*. Any `story-wrong` outcome
produces a committed criteria diff citing the feedback that motivated it. This is what keeps D2
safe: autonomy is bounded to *acting without asking*, never to *changing the specification
invisibly*. An agent that cannot express an amendment as a criteria diff must route it as
`no-story` instead.

### D4 — Extend the router rather than adding a phase

The `route{}` object (ADR-004) gains `story_ref`, `needs_story`, and `confidence.story`. Story
conformance is a property checked at existing phases, not a new stage — consistent with ADR-004's
derive-the-chain-from-classification principle, and avoiding a step most issues do not need.

### D5 — `story-conformance` as a kaizen hunt kind

Proactive discovery lands as one more entry in `kaizen.kinds` (ADR-006), not as new machinery. The
hunter is already read-only, already verifies findings before returning, and already emits
`gain`/`effort` for the orchestrator to Pareto-gate. Territory bands are epic files.

A finding requires an **evidence pair** — the criterion *and* the contradicting code, both quoted.
A candidate that cannot produce both is not `CONFIRMED` and is dropped. This is stricter than the
other kinds by necessity: prose-versus-code comparison is fuzzy, and without the pair requirement
this kind would flood the queue with "the code looks vaguely different from the sentence".

### D6 — `V-STORY-01..04`

| Code | Severity | Trigger |
|------|----------|---------|
| `V-STORY-01` | BLOCK | User-facing PR with no story reference on the issue's route |
| `V-STORY-02` | BLOCK | Diff contradicts an acceptance criterion of a story it claims to serve |
| `V-STORY-03` | WARN | New user-facing capability shipped without adding its story |
| `V-STORY-04` | WARN | Criteria changed with no corresponding test change |

`V-STORY-02` is the load-bearing one: the first blackhole gate that can block a merge for being
*wrong* rather than badly built. It reuses the reviewer's existing plan-conformance machinery,
pointed at criteria instead of Touch-Paths. Consistent with `V-SEC-07`'s adversarial posture, a
`V-STORY-02` block requires independent re-verification before it can stop a merge — a
model-confident misreading of prose must not be able to halt the campaign.

### D7 — `story_driven` config block, default off

```json
"story_driven": { "enabled": false, "catalog_dir": "documentation/user-stories", "require_trailer": true }
```

Same contract discipline as `kaizen`, `docs_governance` and `incident_mode`: absent block or
`enabled: false` ⇒ every dependent feature is a strict no-op and current behaviour is preserved
exactly. Default `false` because most repositories have no catalog, and a story gate on a repository
without stories would block every PR. `severity_overrides` may only escalate WARN→BLOCK.

## Consequences

- blackhole gains the ability to refuse work that is *incorrect*, not merely badly built.
- Campaign-load catalog maintenance becomes self-sustaining: `needs_story` forces work without a
  story to either find one or author one.
- False-positive risk is concentrated in D5; it is contained by the evidence pair, by
  `min_priority`/`max_issues_per_wave`, and by starting the kind at a raised `min_priority`.
- Catalog rot becomes visible: dangling `impl:`/`test:` references are themselves findings.
- Enabling D6 before the D5 false-positive rate is known would risk blocking merges on prose
  disagreements — hence the phasing in the plan document (enforcement lands after discovery).

## Alternatives considered

Recorded in full in mercure ADR-099 (single-plugin ownership, catalog as ledger state, derived
stories, sixth phase, uniform gate policy). blackhole-specific rejections:

**Extend the `bug` hunt kind instead of adding a kind.** Rejected: `bug` is defined by
reproduction-to-wrong-output, and intent defects have no such trace. Widening its definition would
weaken the reproduction standard that makes `bug` findings trustworthy.

**Make story conformance a reviewer-only concern.** Rejected: the reviewer sees one diff at a time
and cannot find a story that nothing implements. Discovery needs the hunt.

## Prerequisite

A project opting in must carry a catalog in the ADR-099 format, stable never-reused ids, and a
working rule that PRs name their story. `invest-portfolio` satisfies all three today
(`documentation/user-stories/`, `AGENTS.md` § Story-driven development,
`.github/pull_request_template.md`) and is the natural pilot.
