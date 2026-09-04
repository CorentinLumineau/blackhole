---
status: accepted
---

# ADR-037: Dispose of the three `ADR_WATCH_ITEMS` trips flagged by `V-WATCH-01` (R-19)

## Status

Accepted

## Context

Issue #802 (a follow-up to #710, which shipped `V-WATCH-01`): three `ADR_WATCH_ITEMS` entries in
`scripts/lib/build/facts.ts` are tripped — `worker-schemas.md` file_loc (958/700, 1.37x),
`worker-schemas.md` § Implementer section_loc (179/80, 2.24x, and separately exactly 100% of the
independent, hard, build-blocking `CONTENT_GATE_BUDGETS.maxSectionLoc=179` ceiling), and
`phase-implement.md` max section_loc (49/15, 3.3x — but the section actually tripping this today,
`## Git operations must not depend on inherited cwd` (#528), is not the section the watch item's
own justification note names, `## Worker prompt must include` at 36 LOC — the note's target
identity has drifted). An `analyze`-mode investigation (`.blackhole/plans/issue-802-analysis.md`)
confirmed all three measurements live and unchanged since filing, confirmed the two threshold
systems (`ADR_WATCH_ITEMS` advisory vs. `CONTENT_GATE_BUDGETS` hard gate) are intentionally
independent but share a measurement for item 2, and confirmed `#473`'s `hook-schemas.md`
extraction from this same file as a direct, already-proven split precedent.

Design Track evaluation (`.blackhole/plans/issue-802-design.md`) evaluated each item
independently (the issue itself asks for three separate judgment calls) and invoked
`scripts/design-aggregate.ts` three times:

| Item | Winner | Scorer margins | Reasons blocked |
|---|---|---|---|
| 1 — file_loc, Accept | No consensus (2-of-3: Accept) | Primary→Accept 14.1%, Critic A→**Split** 5.6%, Critic B→Accept 10.8% | `dominance`, `disagreement` |
| 2 — Implementer section_loc, Split | Unanimous: Split | 31.7% / 25.3% / 13.7% | `dominance`, `breaking-consumer` |
| 3 — phase-implement.md section_loc, Raise | Unanimous: Raise | 7.5% / 22.9% / 6.9% | `dominance` |

## Decision

Adopt all three of the design note's recommended dispositions as one coordinated change:

1. **Item 1 — accept with expiry.** No file change to `worker-schemas.md`'s overall LOC in
   response to this item alone; log a dated `## Post-acceptance amendments` entry on ADR-007
   recording the decision and its expiry condition (revisit when the file next approaches 850
   lines, or at the next `ADR_WATCH_ITEMS` audit). Item 2's split (below) relieves this file's
   proximity to the hard 970-line ceiling as a side effect (958→~779, 98.8%→~80.3%) in the same
   change — the acceptance is conditioned on that side effect actually landing together with it,
   not on a separate promise.
2. **Item 2 — split now.** Extract `worker-schemas.md` § Implementer to a new
   `src/references/implementer-schemas.md`, mirroring `#473`'s `hook-schemas.md` extraction
   exactly. Update, in the same change: `CONTENT_GATE_BUDGETS` (new row for the extracted file,
   re-measured/tightened row for `worker-schemas.md` itself), `ADR_WATCH_ITEMS` item 2 (re-pointed
   to the new file or retired), `inline-schema-drift.check.ts`'s `EXCLUDED_REFERENCE_FILES` (add
   the new filename), `verify.content-gates.test.ts`'s hardcoded 11-key assertion (→12), and the
   four stale prose citations in `implementer.md` (lines 535/645/686/689 as of this design's
   read). Log the split itself as a dated `## Post-acceptance amendments` entry on ADR-007 — a
   disclosed decision record, even though `#473`'s own precedent split was not itself recorded
   this way, closing the same under-disclosure gap this issue exists to prevent.
3. **Item 3 — raise the threshold and correct the drifted note.** Raise
   `phase-implement.md`'s `ADR_WATCH_ITEMS` threshold from 15 to ~40, recalibrated to the file's
   actually-observed section-size distribution (12-49 LOC across all sections), and rewrite the
   item's `note` field to describe the check's real whole-file-max-section semantics instead of
   naming a specific section (`"## Worker prompt must include"`) that is no longer the one
   tripping it. Log via a dated `## Post-acceptance amendments` entry on ADR-021 (the watch item's
   origin), in ADR-007's bullet format per the `#712` citation-discipline precedent — coexisting
   with, not replacing, ADR-021's existing `### A1`-`### A4` critique-tagged entries, since the
   two shapes record different provenances.

**This decision overrides `design-aggregate.ts`'s `blocked` verdict on all three items** —
approved under this campaign's `autonomy.mode: full` grant, the eighth such override this
session. Items 2 and 3 match the now-established pattern (unanimous winner, margin-only block);
item 2's additional `breaking-consumer` reason is an anticipated, fully-scoped consequence (4
dependent surfaces enumerated in the design note's Refactoring Impact Analysis, all listed above)
rather than a surprise, the same shape as ADR-033's `V-STAGE-04` reversal. **Item 1 is the one
genuine departure from the established pattern**: it blocked on `disagreement`, not dominance
alone. That disagreement is addressed on its own terms, not pattern-matched away: 2 of 3 scorers
(the primary and Critic B) independently picked Accept; only Critic A preferred an independent
Split, and even then by a thin 5.6% margin over an Accept/Raise tie — meaning Critic A's own data
did not strongly distinguish Split from Accept either. Both critics, including the dissenting one,
agreed Raise was the weakest option. The substantive case for the majority position — that an
independent split for item 1 would be a second, redundant fragmentation of a file item 2's split
already substantially de-risks as a side effect (V-KISS-01/V-YAGNI-01) — is accepted as decisive,
while the minority's coupling-risk concern (Assumption Audit #1: what if item 2's relief doesn't
land) is addressed by conditioning item 1's acceptance explicitly on item 2 landing in the same
change, and by making the acceptance an accept-with-expiry rather than a silent, unconditional
close.

## Alternatives Considered

- **Item 1 — Raise the 700-LOC threshold**, or **an independent Split** (Critic A's pick).
  Rejected: Raise was rated weakest by all three scorers including the dissenting critic — it
  edits only the advisory `ADR_WATCH_ITEMS` number, does nothing about the file's 98.8% proximity
  to the separate hard `maxFileLoc=970` gate, and casually raising ADR-007's original baseline
  undermines the one thing this watch item exists to be: a stable historical marker
  (`facts.ts:73`'s own comment). An independent Split was Critic A's preferred alternative to the
  chosen Accept, addressed above rather than dismissed.
- **Item 2 — Accept or Raise.** Rejected: both are cheap, but neither touches the actual
  load-bearing constraint. The Implementer section sits at exactly 100% of `CONTENT_GATE_BUDGETS`'s
  hard, build-blocking `maxSectionLoc=179` — under Accept or Raise, the very next legitimate line
  added to the Implementer schema fails CI outright with zero warning runway. Both critics
  independently named Raise as the option that "most misleadingly appears to resolve the item"
  without doing so, since it edits only the separate advisory threshold.
- **Item 3 — Split** (extract the section currently tripping the check). Rejected: this is a
  short, ~190-line file whose sections already range 12-49 LOC even before the outlier — a 15-LOC
  ceiling sits below nearly every section that already exists. Splitting off today's single worst
  offender does not stop the next-largest section (36 LOC) from tripping the same miscalibrated
  threshold immediately after — a whack-a-mole outcome the analysis note itself calls
  unsustainable. The file's own evidence shows the *threshold*, not any one section, is
  miscalibrated.

## Consequences

**Positive**: closes all three trips `V-WATCH-01`/R-19 flagged, using item 2's `#473`-precedented
split to passively relieve item 1 in the same change (no redundant second split), and correcting
item 3's drifted justification note so a future reader isn't misled about which section the
threshold was actually calibrated against.

**Negative / accepted gap**: item 2's split is a genuinely multi-surface change — 4 dependent
files/sections must move in lockstep (already fully enumerated in the design note's Blast Radius
list) — the implementer must treat this as one coordinated PR, not a partial split. Item 1's
acceptance is explicitly conditional on item 2 landing in the same change; if a future
implementation defers or drops item 2, item 1's rationale no longer holds and must be re-reviewed
(the expiry condition exists precisely for this case).

**Operational**: three `## Post-acceptance amendments` entries land across two existing ADRs
(ADR-007 for items 1 and 2, ADR-021 for item 3) rather than a single new amendment target, per
each item's actual origin — no new ADR content-record mechanism is invented, this reuses the
`#712`-established discipline exactly.
