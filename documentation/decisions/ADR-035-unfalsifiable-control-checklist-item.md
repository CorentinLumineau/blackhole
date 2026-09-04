---
status: accepted
---

# ADR-035: Add a `reviewer.md` checklist item requiring new controls to demonstrate they can fail

## Status

Accepted

## Context

Issue #808: this session produced 6 independent instances of a control (a check, a gate, a
wiring) that reports success while structurally incapable of detecting the failure case it exists
to catch — #782 (`V-AUTO-02` diffing against a manifest never written), #787 (`V-TEST-09`
unmeasurable for subprocess-executed hooks), #767 (Decision Record Append wired since #717,
invoked zero times), #798 (`./lib` resolving against cwd, silently running stale library code —
merged, PR #837), #800 (the enforcing guard is the installed plugin, lacking merged security
fixes at the same version string — merged as ADR-030), #806 (`check-review-artifact` requiring a
manifest written by the party being checked — merged). A three-way taxonomy emerged: **never
wired** (#782/#787/#767), **wired to the wrong artifact** (#798/#800), **wired correctly but
structurally blind** (#806). Issue #795, filed independently by a sibling campaign from the
test-integrity side, reached the same principle and was already resolved this session as
ADR-032/`V-TEST-11`. AC5 explicitly frames this ADR as non-blocking documentation — the 6
underlying instances are separately tracked, most already merged.

Design Track evaluation (`.blackhole/plans/issue-808-design.md`) scored three options against an
`architecture-choice` rubric and invoked `scripts/design-aggregate.ts`:

```json
{
  "status": "blocked",
  "winner": null,
  "reasons": ["dominance"],
  "scorer_results": [
    { "scorer": "primary",  "winner": "Option B", "margin": 2.44 },
    { "scorer": "critic_a", "winner": "Option B", "margin": 19.23 },
    { "scorer": "critic_b", "winner": "Option B", "margin": 8.97 }
  ]
}
```

All three scorers (primary + 2 independent blind critics) agree on the winner (Option B) with no
disagreement, no critical finding against the winner, and zero BREAKING consumers under
append-only placement. The sole block reason is `dominance`: every scorer's margin over its
runner-up falls short of the 30% threshold, even though the winner is unanimous — the same shape
as ADR-029/030/031/033, not ADR-032's genuine disagreement case.

## Decision

Adopt **Option B**: keep the standalone ADR (this document) as the historical record, plus append
one new, narrow, diff-pattern-detectable checklist item to `reviewer.md` as a new `§31` (after the
current last section, `§30`) and a new V-code, **`V-UNFALSIFIABLE-01`**, in
`src/references/blackhole-vcodes.md`. The check fires **only when a diff introduces a new
check/gate/control mechanism** (a new `scripts/checks/*.check.ts` file, a new `reviewer.md`
section, a new hook validator, a new V-code row) — not on every PR — and asks: does this control
demonstrate it can fail? Specifically: (1) has the failing input actually been run against it
(red-before-green, mirroring `V-TEST-11`'s own standard), (2) does it name the environment it
runs in and fail loudly rather than pass vacuously where its inputs are absent, and (3) is the
party producing its input independent of the party the control checks — a control whose only
input comes from the entity it is meant to police is circular and must be redesigned or demoted.

**This decision overrides `design-aggregate.ts`'s `blocked` verdict** (reason: `dominance`) —
approved under this campaign's `autonomy.mode: full` grant, the sixth such override this session
(after #804/ADR-029, #800/ADR-030, #811/ADR-031, #807/ADR-033, and #795/ADR-032 — the last being a
critics-over-primary case rather than a margin override). Like ADR-029/030/031/033, this is not a
disagreement case: all three scorers independently reached Option B, including both blind critics
raising the same unprompted, convergent, self-referential CRITICAL finding against Option A —
that a narrative-only ADR is itself an instance of the taxonomy it documents, since nothing
demonstrates anyone reads it, no environment is named where its guidance is exercised, and it
fails silently rather than loudly when the pattern recurs. The override consists of treating a
unanimous-winner result with three sub-30%-but-real margins (2.4%, 19.2%, 8.97%) as sufficient
confidence to proceed, since the shortfall is a difference of degree on an undisputed winner, not
a genuine split.

## Alternatives Considered

- **Option A — standalone ADR, narrative record only.** No `reviewer.md` change, no new V-code.
  Rejected: both blind critics independently and unprompted identified this option as
  self-refuting — the ADR about unfalsifiable controls would itself be an unfalsifiable control,
  protected only insofar as an engineer happens to read it before authoring the next check.
- **Option C — ADR plus a broad retrospective audit mandate** to re-review all ~102 existing
  V-codes/checks/gates against this principle. Rejected: both critics independently flagged this
  as disproportionate to the evidentiary base (6 confirmed instances, all separately already
  fixed per AC5) and in tension with the campaign's own Pareto discipline (`V-PARETO-03`) — an
  open-ended, unowned, untimeboxed audit risks becoming a permanent backlog item, and even if it
  surfaced more instances among existing checks, it would do nothing to catch a brand-new control
  authored after the audit completes (backward-looking only, unlike Option B's standing forward
  mechanism).

## Consequences

**Positive**: closes the loop from retrospective record to forward-looking, bounded-cost
mechanism — exactly the same shape this session's own ADR-032/`V-TEST-11` established for the
closely-analogous issue #795, so no new response pattern is invented (DRY, Consistency).
Append-only placement (new `reviewer.md` §31, new vcodes-table row) means zero BREAKING consumers
per the design note's Refactoring Impact Analysis.

**Negative / accepted gap**: both critics independently flagged a residual, domain-inherent risk —
even a correctly-wired reviewer check can itself land in the taxonomy's third bucket ("wired
correctly but structurally blind," per #806) unless its own wording forces a demonstrated failing
run at authoring time. The design note's Assumption Audit also honestly flags that "a diff
introduces a new check/gate/control mechanism" is a more heterogeneous detection surface than
`V-TEST-11`'s "a test file changed" trigger — implementation must enumerate the concrete diff
shapes this fires on (new check file, new reviewer.md section, new hook validator, new V-code
row) rather than leave the trigger implicit.

**Operational**: new `## V-UNFALSIFIABLE-01` entry in `src/references/blackhole-vcodes.md`
(row-count bump, mechanical, single line, live-re-derived per issue #769's lesson — never a
hand-arithmetic literal); new `reviewer.md` §31, placed after §30 per the same append-only
convention ADR-032 already used for the identical reason.
