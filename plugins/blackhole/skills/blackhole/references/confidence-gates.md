# Confidence Gates

Confidence-based escalation contract (ADR-010 D6). Ported verbatim from mercure's interview
skill (source: `mercure v9.6.0`, `skills/interview/references/confidence-model.md` and
`bypass-conditions.md`) and mapped onto blackhole's five autonomous routing surfaces: analyze,
brainstorm, design, implement, epic go/no-go. Consumed by router, planner, and orchestrator
gates as the single escalation mechanism — [clarify-gates.md](clarify-gates.md)'s categorical
triggers are not deleted, they become dimension inputs (see below).

**Kill switch**: this whole kernel is inert unless `.blackhole/config.json`
`autonomy.enabled: true`. Absent block or `enabled: false` preserves current behavior exactly
— every route falls back to the categorical [clarify-gates.md](clarify-gates.md) mechanism
with no confidence math involved.

## Dimensions

5 weighted dimensions, ported verbatim from mercure's confidence model:

| Dimension | Description |
|-----------|--------------|
| Problem Understanding | What the user wants to achieve |
| Context Completeness | Background, constraints, dependencies |
| Technical Clarity | Implementation details, edge cases |
| Scope Definition | Boundaries, in/out of scope |
| Risk Awareness | Consequences, alternatives, rollback plan |

## Per-Route Weight Profiles

Weights are tunable starting defaults — carried over from the mercure workflow whose shape is
closest to each blackhole route, then adjusted per-route as campaign data accumulates. Each row
cites its mercure source profile.

| Blackhole route | Problem | Context | Technical | Scope | Risk | Rationale |
|------------------|---------|---------|-----------|-------|------|-----------|
| brainstorm (planner `track: brainstorm`) | 40% | 30% | 10% | 15% | 5% | Problem-heavy, ported from mercure `x-brainstorm` (40/30/10/15/5) — brainstorm expands a vague idea into requirements before any technical commitment, so understanding intent dominates. |
| design (Design Track autonomy tier, D4) | 20% | 15% | 40% | 10% | 15% | Technical-heavy, ported from mercure `x-plan design` (20/15/40/10/15) — the blind-critic dominance verdict is a technical trade-off call between options, matching mercure's design-planning weight shape exactly. |
| analyze (investigator `analyze` sub-mode) | 30% | 30% | 25% | 5% | 10% | Ported from mercure `x-troubleshoot` (30/30/25/5/10) — analyze is evidence-gathering against blast radius, conventions, and architecture coherence: the same Problem+Context-heavy hypothesis-investigation shape as troubleshooting, not a scoping or execution activity, so Scope stays low. |
| implement (default plan/build path) | 25% | 20% | 30% | 15% | 10% | Ported from mercure `x-implement` (25/20/30/15/10) verbatim — the default TDD build path has the same balanced problem/technical weighting as mercure's implementation phase. |
| epic go/no-go † | 15% | 10% | 20% | 15% | 40% | Risk-heavy, ported from mercure `x-git release` (15/10/20/15/**40**) — an epic-level go/no-go decision carries release-grade consequence and reversal cost, so Risk Awareness dominates exactly as it does for mercure's release gate. |

> † **Never autonomous.** `epic-go-no-go` is on the never-bypass list below: it is structurally
> exempt from the two-band mapping and ALWAYS blocks for the user, regardless of composite
> score. Its weights are documentary only — they express how confidence in the *presentation*
> of the go/no-go question is scored (what evidence to gather before asking), never a proceed
> threshold. Implementers wiring routes in later milestones MUST NOT route epic go/no-go
> through the composite → proceed path.

## Composite Calculation

```
composite = sum(dimension_score * dimension_weight)
```

Compared against a single composite threshold: `autonomy.confidence_threshold`, default `80`.

## Async Two-Band Mapping

Two bands only — no interactive multi-turn interview loop (blackhole runs autonomously; the
issue thread is the audit surface, not a live chat):

- **composite ≥ threshold** → proceed. The reformulated understanding is posted as an **issue
  comment** — this is the audit trail and the asynchronous veto surface. The user can
  intervene via chat, `merge_hold`, or closing the PR; the orchestrator does not wait for a
  response before continuing.
- **composite < threshold** → at most 2 `[NEEDS CLARIFICATION]` markers if the ambiguity is
  deferrable (the issue proceeds to plan, and the markers block before implement — the
  existing planner marker convention). Otherwise `status: blocked` + `AskQuestion` (today's
  behavior, unchanged).

## Never-Bypass List

Always blocks regardless of composite score — checked **before** any confidence math runs.
Cross-references `.blackhole/config.json` `autonomy.never_bypass` exactly:

```json
"never_bypass": ["destructive", "credentials", "epic-go-no-go"]
```

| Value | Covers |
|-------|--------|
| `destructive` | Destructive or irreversible operations (migration `DROP`, data delete) |
| `credentials` | Credentials, KYC, or account-affecting actions |
| `epic-go-no-go` | Epic-level go/no-go decisions |

Plus anything matching the existing security-adjacent cautious defaults already documented in
[clarify-gates.md](clarify-gates.md) (destructive/irreversible row, product/UX/data-model row).
These categories are structurally exempt from the confidence gate — no composite score, however
high, waives them.

## Dimension Inputs from clarify-gates.md

[clarify-gates.md](clarify-gates.md)'s categorical triggers are not superseded as *signals* —
only as the *escalation mechanism*. Each trigger now caps a dimension score instead of firing an
unconditional `AskQuestion`:

| clarify-gates.md signal | Dimension capped |
|--------------------------|-------------------|
| Missing acceptance criteria | Problem Understanding |
| Product / UX / data model choice | Context Completeness |
| Multiple valid technical approaches with trade-offs | Technical Clarity |
| Touch paths unclear | Scope Definition |
| Destructive or irreversible | Risk Awareness (also never-bypass, see above) |
| Issue body vague or contradictory | Problem Understanding |
| User chat feedback ambiguous | Context Completeness |

A capped dimension still allows the composite to clear threshold if the route's other weighted
dimensions are strong enough — the two-band mapping decides the outcome, not the individual
trigger.
<!-- GENERATED by scripts/build.ts from src/references/confidence-gates.md — do not hand-edit -->
