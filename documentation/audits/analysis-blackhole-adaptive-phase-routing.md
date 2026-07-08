---
type: analysis
status: draft
review_trigger: "on ADR acceptance"
created: 2026-07-07
last_updated: 2026-07-07
related:
  - documentation/decisions/ADR-001-five-phase-lifecycle.md
  - documentation/architecture.md
---

# Blackhole Adaptive Phase Routing — Comparison Against mercure's `x-auto`

## Executive Summary

Blackhole's orchestrator enforces one fixed pipeline for every issue — **Handle → Plan →
Implement → Review → Loop** — with Plan as a hard, automatically-verified gate
(`V-PLAN-01`) regardless of issue size or clarity. This is [ADR-001](../decisions/ADR-001-five-phase-lifecycle.md),
accepted and unamended since inception. mercure's `x-auto` solves a parallel problem —
routing a request to the right workflow — with a genuinely adaptive design: two
independent classification axes (intent, complexity tier) feeding a lookup table that can
skip planning entirely for trivial work, insert a design step for architecturally
significant work, and escalate multi-session work to a separate tracking mechanism — all
while keeping human approval gates at the specific edges that commit scope or cross
workflow boundaries, not at every phase transition.

The two systems are not solving identical problems (`x-auto` routes a single interactive
request to one of five *different* workflows; blackhole runs one workflow across a
*queue* of issues in the background), but the underlying **routing primitives** transfer
cleanly: independent classification axes, a lookup table instead of a fixed sequence, an
ambiguity/confidence threshold with a "default to cautious" tie-break, and a strict
separation between what the *router* decides (advisory, cheap, fast) and what actually
*gates* human approval (narrow, expensive, only at scope-committing edges).

The core finding: **blackhole is missing a schema-level and enforcement-level hook for
variable phase sequencing.** `queue.json`'s `phase` enum is fixed
(`handle|plan|implement|review|done`) and the orchestrator's Plan gate is enforced by an
automated check with no exception path. Any adaptive-routing feature has to be built at
three levels together — schema, orchestrator gate logic, and `bun run verify` — or it
will either not compose with existing tooling or silently violate the audit trail
`V-PLAN-01` exists to guarantee. This document proposes a design that adds this
flexibility while preserving blackhole's core identity (autonomous, background,
issue-queue orchestration) and its `V-PLAN-01` audit guarantee in a relaxed form.

**Recommendation**: this changes an accepted ADR's phase model — it should go through
`/x-design` next, not straight to `/x-plan`, to produce an ADR (superseding or amending
ADR-001) with real trade-off analysis before any implementation plan is written.

## Scope & Method

Two parallel read-only research sweeps (Explore agents), reconciled against this repo's
own `documentation/` (`ADR-001`, `architecture.md`, `architecture-coherence.md`):

1. Blackhole's current orchestration architecture: `AGENTS.md`, `.claude/skills/blackhole/SKILL.md`
   and its phase references, `.claude/agents/orchestrator.md` and `planner.md`,
   `queue-dag.md`/`findings-ledger.md` schemas, `.blackhole/config.json`.
2. mercure's `x-auto` router: `x-auto/SKILL.md`, `workflow-init/SKILL.md`, `x-plan`'s
   complexity-track logic, `x-fix`/`x-troubleshoot` escalation boundary, `WORKFLOWS.md`
   (canonical chain SSOT), the human-in-loop gate rules, and headless/`--auto` mode.

**Correction to the research sweep**: agent 1 read blackhole's files under `.claude/`,
which per `documentation/architecture.md` is a **compiled build-output mirror**, not the
edit surface. The actual source of truth for every quote below is the corresponding
`src/agents/*.md` / `src/references/phase-*.md` / `src/SKILL.md` file — content is
identical (mirrors are generated verbatim by `bun run build`), but any future
implementation work from this analysis must edit `src/`, never `.claude/` or the other
platform mirrors (`bun run verify`'s build-in-sync check will otherwise reject the PR).

## Current State: Blackhole's Fixed Five-Phase Pipeline

Per [ADR-001](../decisions/ADR-001-five-phase-lifecycle.md) (Accepted, unamended for the
phase model itself):

> "Adopt a five-phase lifecycle for every campaign issue: 1. Handle ... 2. Plan ...
> 3. Implement ... 4. Review ... 5. Loop"

Rigidity is enforced at three independent layers, not just prose:

| Layer | Enforcement | Citation |
|-------|-------------|----------|
| Orchestrator gate | "Planner gate (MUST NOT skip): Do not spawn implementer until both conditions are met: 1. Plan artifact exists on disk ... 2. Planner worker JSON returned status: ready" | `src/agents/orchestrator.md` |
| Automated CI-style check | `bun run verify` `V-PLAN-01` fails any queue entry in `plan/implement/review` with `status: in-flight` and no on-disk plan artifact | `scripts/verify.ts` (`checkPlanArtifacts`) |
| Schema | `queue.json`'s `phase` enum is `handle\|plan\|implement\|review\|done` — no value exists for a skipped or reordered phase | `src/references/queue-dag.md` |

The **only** existing adaptive-sounding mechanism is the planner's Quick/Standard
**complexity track**, but it only changes plan *document verbosity* (Quick: Objective/
Touch-Paths/Task Steps only; Standard: adds Critical Files, Conventions, Schema Changes,
Stop Conditions, Sprint Contract) — a plan artifact is still mandatory either way, so it
never satisfies "skip planning for a one-line fix."

Existing `clarify-gates.md` / `issue-splitting.md` flexibility operates on a different
axis entirely: whether to *ask the human* and whether to *split into multiple PRs* —
never on *which phases run*. Quote: "Size label does not waive clarification. size:xs
with clear AC may proceed after handle; size:xs with ambiguity still blocks." This is a
genuinely good pattern (see below) but it is scope/confirmation flexibility, not
phase-sequence flexibility.

`.blackhole/config.json` has no complexity-tier, track, or phase-sequence field at all —
adaptive routing has no schema home today; it would be new surface, not a toggle of
something that already exists.

## Reference Model: mercure's `x-auto` Adaptive Router

`x-auto` decomposes routing into two **independent, cheap, fast classification axes**
before any expensive reasoning:

1. **Intent** — keyword-matched against a fixed table (APEX/ONESHOT/DEBUG/BRAINSTORM/GIT/CAMPAIGN).
2. **Complexity tier** — an ordered-checklist algorithm (check CRITICAL signals first,
   then LOW, then HIGH, default MEDIUM), each tier with its own keyword-detection table
   (e.g. "breaking change", "security vulnerability", "CVE" → CRITICAL; "typo", "missing
   import" → LOW).

These combine via a **2D lookup table**, not a fixed sequence:

```
APEX + LOW           -> x-implement directly (no plan)
APEX + MEDIUM         -> x-plan -> x-implement
APEX + HIGH/CRITICAL  -> x-initiative -> full multi-session flow
DEBUG + LOW           -> direct fix
DEBUG + MEDIUM        -> investigate first (x-troubleshoot)
DEBUG + HIGH/CRITICAL -> initiative + security review
```

Below the 70%-confidence threshold, `x-auto` asks a small fixed set of clarifying
questions rather than guessing, and its tie-break rule is explicit: **"If complexity is
ambiguous, default to the MORE cautious workflow."**

Critically, `x-plan`'s own Quick/Standard/Enterprise track (files/layers/dependencies/
breaking-changes signals) genuinely **skips the plan document and its quality gate** on
Quick — not just shrinks it. This is the one place mercure has more flexibility than
blackhole's Quick/Standard planner track today.

Human-in-loop gates are attached **per edge**, not per phase, with an explicit taxonomy:
`suggest` (agent recommends, human picks from an `AskUserQuestion` menu) / `approval`
(explicit confirmation required, e.g. Design→Plan, "commits to implementation") /
`terminal` (workflow ends). This is the mechanism that lets `x-auto` be adaptive without
becoming reckless: only scope-committing or workflow-boundary-crossing edges are
hard-gated; same-workflow phase advances are soft.

Headless mode (`--auto`, prefix-anchored to defend against prompt injection from
untrusted forge text) collapses this into a **pure deterministic function of
(workflow, tier) → terminal skill**, with an internal, non-user-suppliable marker telling
the destination skill to skip its own interactive chaining. This is the direct analog for
blackhole's constraint of running unattended in the background — but mercure's own docs
admit headless + BRAINSTORM intent is a "degenerate/unsupported case," i.e. mercure has
not fully solved "adaptive routing with truly no human available." Blackhole's own
`clarify-gates.md` pattern (`AskQuestion` + `status: blocked`, resolved whenever a human
next engages, not requiring a live synchronous turn) is actually a **more complete
answer** to this than anything in mercure — it should be reused, not replaced.

## Comparison Table

| Dimension | Blackhole (current) | mercure `x-auto` | Transfers? |
|-----------|---------------------|-------------------|------------|
| Phase sequence | Fixed, schema-enforced, CI-checked | Variable, lookup-table-driven | Yes — needs new schema field |
| Classification axes | None (only size label, forge-provided, coarse) | Two independent axes (intent × complexity tier), computed | Yes — adapt to one axis (risk tier) + one boolean (needs-design) |
| Plan skip | Never — `V-PLAN-01` hard gate | Yes, on Quick track | Yes — but must preserve an audit artifact, see below |
| Design-first insertion | None | Yes, via Enterprise Scope Assessment / BRAINSTORM→APEX approval edge | Yes — new insertion point before Plan |
| Ambiguity handling | `AskQuestion` + `status: blocked`, async-safe | `AskUserQuestion`, confidence <70%, synchronous | Blackhole's version is already better-suited to background operation |
| Human gate granularity | Coarse (clarify gate covers Handle/Plan boundary only) | Per-edge taxonomy (suggest/approval/terminal) | Yes — adopt per-edge tagging |
| Escalation-by-attempts | Present (review iteration budget 1–3 auto-fix, 4+ escalate, ceiling 5) | Present (2 failed hypotheses → escalate) | Parity already — no gap |
| Headless/autonomous operation | Native (background orchestrator is the default topology) | Bolt-on (`--auto` flag), admittedly incomplete for BRAINSTORM | Blackhole's starting position is stronger here |
| Enforcement of tier-based behavior | N/A (no tiers exist yet) | Explicitly marked advisory-only, "future M2 enhancement" | Caution — mercure hasn't solved automated enforcement either |

## Gap Analysis

1. **No independent risk/complexity classification at Handle time.** Blackhole relies on
   forge-provided `size:xs`..`size:xl` labels, which `clarify-gates.md` already
   acknowledges are unreliable signals for whether clarification is needed — the same
   unreliability applies to whether planning depth is needed. A computed classification
   (title/body keyword scan, file-touch estimate, security-path match, cross-issue
   dependency count) independent of the label is the missing primitive.
2. **No schema slot for a variable phase sequence or route decision.** `queue.json`'s
   `phase` enum and `V-PLAN-01`'s existence check assume every issue transits all four
   phases. Any router output needs a durable, auditable home.
3. **No design-first insertion point.** Architecturally significant issues (new external
   dependency, cross-cutting change spanning N+ modules, ADR-worthy language in the issue
   body) go straight to Plan today with no ADR step, unlike mercure's BRAINSTORM→APEX
   approval edge.
4. **No per-edge human-gate taxonomy.** Today there is one clarify gate (Handle) and one
   review-loop cap (Review); there is no explicit "this edge always needs approval, that
   edge is a soft suggestion" model that a new skip/insert edge could plug into cleanly.

## Proposed Adaptive Routing Model

This section is descriptive of a *design direction*, not an implementation plan — a
follow-on `/x-design` should produce the actual ADR (see recommendation below). Sketched
here to make the comparison concrete and testable against the user's stated constraints:
keep blackhole's autonomous, four-phase orchestrating identity; keep the human as final
arbiter of product decisions; delegate routing decisions to the model wherever it can
reliably make them itself.

### 1. New Handle-time classification step (additive to `phase-handle.md`)

Compute two independent signals, alongside — not replacing — the existing size-label
triage:

- **`risk_tier`**: `low | medium | high`, from an ordered-checklist algorithm mirroring
  `x-auto`'s complexity-tier detector, adapted to blackhole's signals: keyword scan of
  title/body (typo/rename/doc-only → low; multi-file/schema/API → medium; security-path
  match, per `mercure-security-owasp`-style patterns, or breaking-change language →
  high), estimated file-touch count from the issue body/AC, and whether the issue
  declares itself part of an epic/split.
- **`needs_design`**: boolean, true when ≥N of: new external dependency, cross-cutting
  change across 3+ modules, issue body contains "architecture"/"redesign"/"which
  approach"/"trade-off" language, or a prior plan for a related issue was rejected at
  review for a design-level reason.

Both are **advisory, not enforced**, in the first iteration — mirroring mercure's own
admission that tier-based enforcement is still an open problem there. Store as a
`route` object on the queue entry (see schema below); do not gate anything on it until
the classifier's accuracy has been observed over a canary window.

### 2. Schema addition — `queue.json`

Add a `route` object per issue, additive to (not replacing) the existing `phase`/`status`
fields:

```json
"route": {
  "risk_tier": "low",
  "needs_design": false,
  "plan_mode": "full",
  "confidence": 82,
  "computed_at_phase": "handle"
}
```

`plan_mode` is the actual routing decision: `"full"` (current default, unchanged
behavior), `"quick"` (plan artifact still required but the Quick planner track is forced
rather than left to the planner's own judgement), or `"skip"` (new — see below). This is
directly analogous to mercure's advisory routing-context contract (intent, tier,
recommended agent, confidence — "advisory, overridable").

### 3. Conditional Plan skip, preserving the `V-PLAN-01` audit guarantee

`plan_mode: "skip"` is only reachable when `risk_tier: "low"` AND `confidence >= 70`
(mirroring `x-auto`'s threshold and cautious-default tie-break) AND `needs_design:
false`. When skipped, the orchestrator does **not** bypass `V-PLAN-01` outright — instead
it writes a minimal, schema-validated **direct-fix rationale record**
(`.blackhole/plans/issue-N.md` with a fixed 4-line shape: Objective, Touch-Paths, Why no
plan needed, Rollback note) that satisfies "plan artifact exists on disk" as currently
checked. This mirrors mercure's Quick track, which still produces an artifact (inline
task list) even while skipping the formal document and quality gate. `bun run verify`'s
`checkPlanArtifacts` needs no relaxation — it can keep asserting "an artifact exists,"
just with a second valid minimal shape recognized alongside the full plan template.

### 4. Design-first insertion

When `needs_design: true`, insert a lightweight design step between Handle and Plan:
either a new thin agent role or (cheaper, reusing existing infrastructure) a `planner`
invocation in a new `design` sub-mode that produces a short ADR-style decision note
(Context/Options/Chosen approach/Rejected approaches, 1 page) before the full plan is
written. This is blackhole's analog to mercure's Design→Plan edge, which is explicitly
tagged `approval` (human confirmation required) in `WORKFLOWS.md` because it "commits to
implementation" — the design note should route to `status: blocked` with an
`AskQuestion`-equivalent (blackhole's async, non-blocking-turn version) before Plan
proceeds, exactly matching the "human still decides product direction" constraint.

### 5. Confidence gate reuses existing infrastructure, does not need a new one

Blackhole's `clarify-gates.md` (`AskQuestion` + `status: blocked`, resolved async) is
already a better fit for a background orchestrator than mercure's synchronous
`AskUserQuestion` — no new human-interaction primitive is needed, only a new *trigger*
for it: low classifier confidence (`< 70`, mirroring `x-auto`'s own threshold) routes to
the existing clarify gate with the classification itself as the question payload ("this
looks like a low-risk fix but I'm not fully confident — proceed direct-to-implement, or
plan first?").

### 6. Rollout — canary, not big-bang

Given mercure's own tier-enforcement is still advisory/unenforced, and this changes an
accepted ADR's core state machine: gate the new `plan_mode: "skip"` path behind a
`.blackhole/config.json` flag (e.g. `adaptive_routing: false` default), canary it on
`size:xs`-labeled issues only for an initial window, and require the classifier's actual
routing decisions to be visible in `findings-ledger.json` or the dashboard for human spot
review before widening scope.

## Risks & Mitigations

| Risk | Mitigation |
|------|------------|
| Classifier misjudges a risky issue as low-tier, skips planning, ships a bad change autonomously | Confidence threshold + cautious-default tie-break (mirrors `x-auto`); canary rollout on `size:xs` only initially; `route` object logged to ledger for spot audit |
| `V-PLAN-01` / `bun run verify` silently stops enforcing anything meaningful once a second "artifact shape" is accepted | Direct-fix rationale record is itself schema-validated (fixed 4-line shape) — `checkPlanArtifacts` still fails on missing/malformed artifacts, just recognizes two valid shapes |
| Feature edited in `.claude/agents/*.md` (mirror) instead of `src/agents/*.md` (SSOT), silently dropped on next build | Explicitly called out above; any implementation plan must list `src/` paths only in Touch-Paths |
| Design-first step becomes a second rigid mandatory phase, reintroducing the same rigidity one level up | Keep `needs_design` gate itself advisory + confidence-thresholded, not unconditional; review after canary window whether false-positive rate is acceptable |
| This changes ADR-001, an accepted decision, without formal record | Route to `/x-design` next (see below), not directly to `/x-plan` |

## Priority Ranking (Pareto)

1. **Handle-time `risk_tier` classification + `route` schema field** (highest leverage,
   lowest risk — purely additive, advisory-only, no behavior change until acted on)
2. **Conditional Plan skip for `risk_tier: low` + `confidence >= 70`** (the actual
   efficiency win the user is after — direct-fix path for trivial issues)
3. **Design-first insertion for `needs_design: true`** (addresses the "design before plan
   when needed" half of the ask — lower frequency than #2, so lower aggregate impact)
4. **Per-edge human-gate taxonomy documentation** (clarifies existing behavior, unlocks
   #2/#3 without ambiguity about which transitions need `AskQuestion`)

## Open Decisions (for the human — product-level, not delegable)

- Is a confidence threshold of 70% (mercure's own number) the right bar for blackhole's
  risk tolerance, or should the canary window use a stricter bar given fully-autonomous
  background operation with no live human watching each transition?
- Should the direct-fix rationale record still require a `reviewer` pass (current Review
  phase is untouched by this proposal — only Plan becomes conditional), or should
  `risk_tier: low` also lighten the Review phase (e.g. skip the full V-code audit, do the
  docs-only-PR "orchestrator direct review" pattern already used for docs changes)?
  This proposal deliberately did **not** touch Review — that's a separate, higher-risk
  decision the user should weigh in on separately.
- Should `needs_design` ever be allowed to auto-proceed without a human gate (i.e. can the
  model both decide a design is needed AND write it without approval), or should it always
  route to `status: blocked` regardless of confidence, given design decisions are
  explicitly the category ADR-001 and the user's own framing single out as "human still
  handles the best decisions for the product"?

## Recommendation

This is a change to an accepted architectural decision (ADR-001), not a bug fix or a
straightforward feature. Per this repo's own doc-governance conventions, the next step
should be **`/x-design`** — producing a new ADR (superseding or amending ADR-001) with a
formal trade-off matrix on the open decisions above — before any `/x-plan` implementation
work begins.
