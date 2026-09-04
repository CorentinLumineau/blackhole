---
status: accepted
---

# ADR-031: Generate `documentation/INDEX.md` from a tree walk + frontmatter

## Status

Accepted

## Context

Issue #811: `documentation/INDEX.md` is a serialization point for the whole campaign — every
merged PR appends two rows to it (one for its plan artifact, one for its review artifact), so N
concurrently in-flight PRs each invalidate the other N-1 the moment one merges, forcing a
rebase. Measured this session: 13 commits touched `documentation/INDEX.md` in the last 6 hours
(higher than the issue's own 10/6h figure), the file carries 108 rows (not the issue's stale
77), and the orchestrator's own PR #819 and PR #824 each hit exactly this conflict this
session — both sole-file, both resolved "keep both rows, re-sort," both costing a full
rebuild+retest+re-verify cycle before re-merge. PR #790 (issue #743) already fixed row
*ordering* (sorted insert instead of append-at-end) but measurably did not reduce *contention* —
rebases continued at the same rate afterward.

Design Track evaluation (`.blackhole/plans/issue-811-design.md`) scored three options
(generate, status quo, per-folder split) against a `refactor-strategy` rubric and invoked
`scripts/design-aggregate.ts`:

```json
{
  "status": "blocked",
  "winner": null,
  "reasons": ["dominance", "breaking-consumer"],
  "scorer_results": [
    { "scorer": "primary",  "winner": "Option B", "margin": 7.5 },
    { "scorer": "critic_a", "winner": "Option B", "margin": 29.6 },
    { "scorer": "critic_b", "winner": "Option B", "margin": 22.6 }
  ]
}
```

All three scorers nominally rank **Option B (status quo)** first, but no scorer clears the 30%
dominance margin, and Option A (generate) additionally carries a declared `BREAKING` classification
against 2 production consumers — both legitimate, mechanized block reasons per ADR-010 D4.

Both independent blind critics, unprompted, converged on the same structural critique of the
rubric itself: its fixed columns (Effort/Complexity/Reversibility, 65% combined weight) trivially
max out for a zero-change option regardless of whether the status quo actually solves anything,
so a `refactor-strategy` rubric applied to a "should we act at all" decision structurally
advantages inaction. Both critics scored Option B's own Risk column at the floor (1/5) and it
still won nominally by rubric mechanics.

## Decision

Adopt **Option A**: generate `documentation/INDEX.md` from a tree walk over `documentation/`
(excluding `decisions/`, which keeps its own separately-governed per-folder index, and
`milestones/_archived/`) plus a new `summary:` frontmatter field on every doc — reusing this
repo's own already-established `src/ → generated target + drift check` pattern (`bun run build`
+ `bun run verify`, the same shape as every platform build target). The committed file carries a
`<!-- GENERATED — do not hand-edit -->` marker; `bun run verify` regenerates it in-memory and
fails when the committed file differs. A one-time migration copies each of the 108
(re-measured live at implementation time, never hardcoded) existing hand-written summary-column
values into their respective files' new `summary:` field.

**This decision overrides `design-aggregate.ts`'s `blocked` verdict.** Justification: unlike
this campaign's two prior autonomy overrides (#804/#800, where all three scorers agreed on the
*same* winning option and were merely short of the dominance margin), here the scorers'
mechanical answer genuinely differs from the recommendation — a materially closer call. The
override is nonetheless warranted because: (1) both blind critics independently identified a
concrete, named flaw in the rubric itself (cost-only columns structurally favor inaction on a
"should we act" decision) rather than merely disagreeing on Option A's merits; (2) the
`breaking-consumer` flag is fully scoped and small — exactly 2 production call sites
(`carry-staged-artifacts.ts`'s root-INDEX branch, `companion-file-sync.ts`'s journeys-row
append), both becoming no-ops/frontmatter-only rather than removed entirely; (3) the alternative
(Option B, do nothing) has a real, already-quantified, compounding cost — recurring rebase-agent
dispatches at campaign merge velocity — that a cost-only rubric cannot see because "zero cost
today" is not the same as "zero cost." Approved under this campaign's standing `autonomy.mode:
full` grant.

**Honest scope correction, disclosed by the design note, preserved here**: this decision does
**not** deliver literal zero git-level conflicts as scoped. If PR branches continue to commit
their own regenerated snapshot of `documentation/INDEX.md`, a rebase against a newer `main`
still produces a git-level conflict on that file. What generation actually buys is converting
conflict *resolution* from judgment-requiring ("read both diffs, decide the merge") to fully
mechanical ("discard my branch's snapshot, re-run the generator against the rebased tree,
done") — a real, measurable reduction in the *cost* of each conflict, not an elimination of
conflicts. Literal zero-conflict would require moving generation to a post-merge/main-only step
so PR branches never touch the file at all; that is a distinct, larger workflow change, out of
scope for this ADR and left as a documented follow-up if the mechanical-resolution win proves
insufficient in practice.

## Alternatives Considered

- **Option B — status quo** (the rubric's nominal, non-dominant winner) — rejected despite
  winning the mechanized score, for the reasons in Decision above. Its strongest honest case:
  zero cost today, with a real, already-quantified, non-catastrophic ongoing tax (roughly one
  rebase per two merges at current campaign velocity) — not that it solves the measured problem.
- **Option C — split into per-folder indexes** (e.g. `plans/INDEX.md`, `reviews/INDEX.md`) —
  disproven by direct observation, independent of scoring: both real collisions this campaign
  has hit were review-row-vs-review-row **within the same folder** (`reviews/`, the
  highest-frequency writer — every merged PR produces exactly one review artifact). Splitting by
  folder would not relieve the actual hot spot; it would still collide on `reviews/INDEX.md` at
  the same rate while adding N new artifact files and consumers to maintain.

## Consequences

**Positive**: `V-DOCHEALTH-01`/`V-DOCHEALTH-02` (every doc has a row; every row resolves to a
real file) become true-by-construction rather than checks that can silently drift; every future
PR's carry-step stops writing a root-INDEX row entirely, so the serialization point this issue
exists to close is genuinely closed for the class of conflict this campaign has actually
measured; reuses an already-proven repo convention (generated-target + drift-check) rather than
inventing a new mechanism.

**Negative / accepted cost**: a one-time migration diff touching all 108 (re-measure live)
documentation files to add `summary:` frontmatter — mechanical and scriptable, but a large
review surface in a single PR; two production call sites (`carry-staged-artifacts.ts`,
`companion-file-sync.ts`) require a breaking change to stop writing rows for the root-INDEX
target specifically (the same functions continue serving `documentation/decisions/INDEX.md`
unchanged — a target-path branch, not a function removal); several protocol-prose surfaces
(`blackhole-state.md`, `doc-governance.md`, `artifact-contract.md`, and the `plan`/`analyze`/
`investigate` route staging conventions in `planner.md`/`investigator.md`/`implementer.md`)
describe today's hand-append mechanism and must be updated in the same PR to avoid `V-DOC-04`
staleness the moment this ships; adds a genuinely new moving part (a doc-tree build step) to a
repo that did not previously build `documentation/`, a real KISS cost traded for eliminated
hand-maintenance, not a free lunch. Does not deliver literal zero git conflicts as scoped (see
Decision's honest scope correction) — only mechanical, judgment-free resolution.

**Operational**: new `scripts/generate-doc-index.ts` (pure function: tree walk → frontmatter
read → sorted table render, reusing `check-common.ts`'s existing `byPathByteOrder` comparator —
already locale-independent, already in production for `documentation/decisions/INDEX.md`'s own
sorted insert, so no new nondeterminism risk); `doc-health.check.ts`'s `V-DOCHEALTH-01/02`
retargeted to diff committed-vs-regenerated content rather than checking row existence.
Implementation must re-measure the live summary-migration count at dispatch time rather than
trusting this ADR's or the issue's own cited figures (both were already stale by the time this
design was scored — 77 → 108 in one campaign). Full task breakdown, TDD test list, and the 6-row
Assumption Audit: `.blackhole/plans/issue-811-design.md`.
