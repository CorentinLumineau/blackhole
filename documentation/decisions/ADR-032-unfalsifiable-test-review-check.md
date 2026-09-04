---
status: accepted
---

# ADR-032: Add V-TEST-11 (structurally-unfalsifiable test detection) to the review checklist

## Status

Accepted

## Context

Issue #795: on a consumer repo, workers returned accurate, well-argued, CI-green reports across
roughly a dozen PRs, yet independent re-verification (checking claims against source rather than
the report) found approximately one real defect per PR anyway. Two of the cited instances share
a specific, mechanically-recognizable shape: a test whose own assertion could not have failed
even if the bug it claims to guard against were present — an a11y test suite that asserts DOM
structure but cannot see CSS positioning, and a shell-arg-parser test whose stub flattens argv
before the assertion runs, so a genuinely broken multi-word flag reads identically to an intact
one. This campaign independently reproduced the same shape twice this session (reviewer catches
on PR #818/#804 and PR #819/#788), both found because the review spawn prompt explicitly asked
for the underlying control flow to be traced rather than trusted.

Design Track evaluation (`.blackhole/plans/issue-795-design.md`) scored three options against an
`architecture-choice` rubric and invoked `scripts/design-aggregate.ts`:

```json
{
  "status": "blocked",
  "winner": null,
  "reasons": ["dominance", "disagreement"],
  "scorer_results": [
    { "scorer": "primary",  "winner": "Option A", "margin": 5.13 },
    { "scorer": "critic_a", "winner": "Option B", "margin": 22.78 },
    { "scorer": "critic_b", "winner": "Option B", "margin": 27.85 }
  ]
}
```

Unlike this campaign's three prior autonomy overrides this session (#804/ADR-029, #800/ADR-030,
#811/ADR-031, all resolved by the orchestrator siding with the primary planner's own
recommendation against a merely-short-of-margin mechanized block), here the primary planner's
own provisional pick (Option A — a comprehensive, unconditional protocolization mandate) is the
one that **lost** to both independent blind critics, who converged instead on the narrower
Option B. This is a case for accepting the critics' verdict over the primary's, not for
overriding the mechanized gate against a unanimous or majority planner recommendation.

## Decision

Adopt **Option B**: add a new mechanical, diff-pattern-detectable V-code, **`V-TEST-11`**, for a
test structurally incapable of failing even if the bug it claims to cover were present — placed
beside the existing `V-TEST-10` in `reviewer.md`'s Test Integrity Audit (§23), following that
section's established narrow-spot-check precedent. Do **not** adopt Option A's broader,
unconditional mandate (independently re-verify every load-bearing claim against source, plus an
uncapped "blast-surface" step applied to every future PR forever) or Option A's docs-grep leg
(folding a documented-deviation check into `V-DOCFACT-01`'s existing trigger).

**Rationale for siding with the critics over the primary**: both blind critics, independently
and using the same fixed rubric, identified the same decisive flaw in Option A — an
unconditional, narratively-judged "verify everything" mandate has no mechanical enforcement
criterion, so a review pass can self-report compliance with it without actually tracing control
flow, recreating **the exact self-report-trust failure this issue exists to close, one level
up**. This is not a marginal disagreement; both critics scored Option A's Risk and Consistency
columns low specifically for the property the primary scored favorably, and both converged on
the same critical finding about Option C (status quo) independently: the defect class is real
and currently caught only by ad-hoc orchestrator diligence that survives only as long as whoever
is orchestrating happens to keep asking for it — an unenforced, non-auditable discretion. Option
B is the one leg of Option A's four that is genuinely mechanizable (a diff-pattern check, not a
narrative judgment call) and matches this campaign's own established preference for mechanical
enforcement over prose obligations, demonstrated repeatedly this session (ADR-030's reviewer
gate over a self-attested manifest flag; issue #806's fix replacing a circular self-check with
an independent ledger re-render).

**This decision overrides `design-aggregate.ts`'s `blocked` verdict** (reasons: `dominance` and
`disagreement`) — approved under this campaign's `autonomy.mode: full` grant. The override
consists of accepting the critics' Option B over the primary's Option A, not of asserting either
option won cleanly; the note's own Assumption Audit (#1, #6) honestly flags that the evidenced
catch-rate is drawn from a small, unusually-scrutinized sample and that the cost of broader
verification was never measured — both are real limitations of the evidence base for *any*
option, appropriately narrowing this decision to the one leg (Option B) with the strongest,
least-contested case.

## Alternatives Considered

- **Option A — comprehensive protocolization** (the primary planner's own provisional pick,
  4.05% margin over B on the primary's own scoring before critique) — rejected specifically
  because it bundles one clearly good, narrow, mechanizable idea (identical to Option B) with
  three broader, costlier, harder-to-audit obligations: (i) an unconditional source-verification
  mandate with no mechanical enforcement; (ii) an uncapped "blast-surface" step with no stated
  detection criterion, applying to every future PR forever regardless of diff size; (iv) folding
  a docs-grep leg into `V-DOCFACT-01`'s trigger. Both critics independently found (i) and (ii)
  structurally recreate the issue's own thesis rather than closing it. Options (i)/(ii)/(iv)
  remain available as a future issue if this campaign later wants to revisit them with a
  narrower, mechanically-scoped formulation — this ADR does not foreclose that, it declines to
  adopt the unscoped version evaluated here.
- **Option C — status quo** (no `reviewer.md` change, source-verification stays
  orchestrator/spawn-prompt discretion) — both critics independently flagged this `CRITICAL`:
  the defect class is real and demonstrated twice over inside this very campaign, and leaving it
  to unenforced, non-auditable discretion means the catch rate depends entirely on whoever
  happens to be orchestrating remembering to ask for it in each spawn prompt.

## Consequences

**Positive**: closes the one leg of the four suggested remedies that is genuinely
diff-pattern-detectable rather than a narrative judgment call, matching `V-TEST-10`'s existing
enforcement shape exactly (append-only placement, zero renumbering, zero BREAKING consumers per
the design's own Refactoring Impact Analysis); gives reviewers a named, auditable check for
exactly the shape that bit twice this session (a test that cannot see the property it claims to
guard).

**Negative / accepted gap**: Option B, by design, mechanizes only one of roughly six defect
subclasses the issue's evidence names — the conflict-revert, no-DOM-allowlist, and
docs-instructing-the-reverse subclasses stay entirely dependent on prompt discretion, unchanged
from status quo, per both critics' own honest assessment of Option B's limits. This ADR does not
claim to have closed issue #795's full scope, only the narrowest, best-evidenced, most
mechanizable piece of it. A future issue may reasonably propose a second, narrower-than-Option-A
mechanism for one of the remaining subclasses, each evaluated on its own mechanizability rather
than bundled into a single blanket mandate again.

**Operational**: new `## V-TEST-11` entry in `src/references/blackhole-vcodes.md` (row count
bump, mechanical, single line), a new spot-check in `reviewer.md`'s existing §23 Test Integrity
Audit (not a new unconditional section — placement matters for the Refactoring Impact Analysis's
TRANSPARENT classification of every existing `reviewer.md §N` citation). Full detection
heuristic ("what would this assertion do if the bug were present") and its acknowledged limit
(works cleanly for a localized assertion, less clear for a multi-layer integration test) are
documented in `.blackhole/plans/issue-795-design.md` § Assumption Audit #4 — implementation
should carry that limitation into the check's own documentation rather than overclaiming
completeness.
