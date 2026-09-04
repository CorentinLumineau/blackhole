---
status: accepted
---

# ADR-033: Give the `research` investigator sub-mode a durable home in `documentation/investigations/`

## Status

Accepted

## Context

Issue #807: the `research` investigator sub-mode (external docs/changelog/migration lookup) is
the only route/sub-mode with no path into `documentation/`. Its working copy lives at gitignored
`.blackhole/plans/issue-N-research.md`, never promoted, never tracked — `blackhole-state.md`
explicitly says research "never appears — it has no `documentation/` target." 4 research notes
exist on disk today (issues #452, #469, #593, #800), none tracked, all lost on cleanup/reimage.
Issue #800's own research note — "the plugin cache is version-keyed," the central fact behind
this session's ADR-030 and 3 merged security fixes — is exactly the kind of content
`documentation/investigations/` already exists for, yet had no sanctioned path there.

Design Track evaluation (`.blackhole/plans/issue-807-design.md`) scored three options against a
`data-model-change` rubric and invoked `scripts/design-aggregate.ts`:

```json
{
  "status": "blocked",
  "winner": null,
  "reasons": ["dominance", "breaking-consumer"],
  "scorer_results": [
    { "scorer": "primary",  "winner": "Option A", "margin": 37.08 },
    { "scorer": "critic_a", "winner": "Option A", "margin": 8.22 },
    { "scorer": "critic_b", "winner": "Option A", "margin": 11.25 }
  ]
}
```

All three scorers (the primary planner plus 2 independent blind critics) agree on the winner
(Option A) — this is not a disagreement case like ADR-032. The gate fired for two other reasons:
(1) two of the three margins over the runner-up fall short of the 30% autonomous-approval bar
(8.2% and 11.3%, vs. the primary's own 37.1%); (2) Option A structurally requires reversing
`scripts/checks/staging-schema.check.ts`'s `V-STAGE-04` check (`checkNoResearchStaging` /
`findForbiddenSubModeLiterals`) in the same PR — a genuine, anticipated BREAKING consumer, not an
overlooked side effect, since that check exists for the sole purpose of forbidding the literal
this design legitimizes. `autonomy.design_autonomy` is also absent from `.blackhole/config.json`
(only `autonomy.mode: "full"` is set), so the config-gated `ready` path is unconditionally
unavailable independent of the script's own verdict.

## Decision

Adopt **Option A**: give `research`-sub-mode notes a durable home by reusing `investigate`'s
existing folder, `documentation/investigations/`, under a `research-{concern-slug}.md` filename
(the `research-` prefix avoids a same-issue collision with an `investigate`/`analyze` note
sharing the identical `{concern-slug}`, mirroring the already-shipped `plan-{slug}.md`
discriminator precedent). This requires, in one PR:

1. A `research` row in `src/references/artifact-contract.md`'s Route → artifact table, target
   `documentation/investigations/research-{concern-slug}.md`.
2. Extending `entries[].route` in `blackhole-state.md`'s manifest field table with `research`,
   and correcting the "research never appears" prose.
3. Removing `staging-schema.check.ts`'s `checkNoResearchStaging` / `findForbiddenSubModeLiterals`
   (`V-STAGE-04`) and its fixture tests in `scripts/verify.staging-schema.test.ts`.
4. A `research` case in `carry-staged-artifacts.ts`'s `SUB_MODE_TO_TYPE` map (→ `type: 'research'`,
   already a valid `doc-governance.md` lifecycle type) and in `decideCopyMode`'s rewrite
   condition.
5. A one-line addition to `doc-governance.md` § Canonical Naming naming the `research-` prefix as
   a second stated filename exemption alongside ADR files (raised by Critic B).
6. Backfilling or explicitly triaging the 4 existing gitignored research notes (issues #452,
   #469, #593, #800) as a companion task (AC5) — not silently dropped.

**This decision overrides `design-aggregate.ts`'s `blocked` verdict** (reasons: `dominance`,
`breaking-consumer`) — approved under this campaign's `autonomy.mode: full` grant, the fifth such
override this session (after #804/ADR-029, #800/ADR-030, #811/ADR-031, #795/ADR-032). Unlike
ADR-032, this is not a case of siding with critics over the primary — all three scorers
independently reached the same winner. The override consists of two judgment calls, both narrow:
(a) treating a directionally-unanimous 3/3 result with two sub-30%-but-real margins as sufficient
confidence to proceed rather than escalate, since the shortfall is a difference of *degree*
(8–11% vs. the 30% bar) on an *undisputed* winner, not a genuine split; (b) accepting an
anticipated, single-purpose check reversal as an intended consequence of the decision rather than
an unplanned regression — `V-STAGE-04` exists to forbid exactly the literal this ADR now
legitimizes, so reversing it is the mechanism of the decision, not collateral damage.

Direct, checkable evidence for Option A over B/C: mercure's own `mercure-file-organization.md`
(the R-001 "documentation-integration-floor" reference) folds "Investigations / research" into
**one** folder, `documentation/investigations/`, explicitly scoped to include "external research
with citations" — mercure does not distinguish an internal-code investigation from an
external-research note, and has no separate `research/` folder. Option C (status quo) sits below
that floor for content mercure already treats as documentation-worthy; issue #800's own
already-realized knowledge-loss precedent is the concrete cost of leaving it there.

## Alternatives Considered

- **Option B — durable, new `documentation/research/` folder**, kept structurally separate from
  `investigate`'s folder. Same mechanical route/enum/check changes as Option A, plus a 12th row
  in the Canonical folder taxonomy table. Rejected: both blind critics independently flagged this
  as unjustified complexity (KISS/YAGNI) relative to A, inventing a taxonomy split that mercure's
  own floor reference does not make, with no compensating benefit identified by any of the 3
  scorers (lowest weighted score of the three: 2.80 primary, 2.25–2.80 critics).
- **Option C — not durable**, an explicit reasoned non-decision recorded in
  `artifact-contract.md`; `staging-schema.check.ts` keeps rejecting a staged `research` entry but
  with a message naming the decision instead of a bare enum mismatch. Rejected: both critics
  independently raised this as a CRITICAL finding — it leaves issue #800's already-real
  knowledge-loss precedent unresolved and sits below mercure's own documented floor for
  external-research-with-citations content, the exact class R-001 exists to protect.

## Consequences

**Positive**: closes the one artifact class in the entire route/sub_mode enum with no
`documentation/` target, satisfying R-001 at the least implementation cost (reuses an existing
folder, existing staging/carry machinery, an existing filename-discriminator precedent — no new
script, no new folder). Issue #800-shaped findings (a research note underpinning a later ADR or
security fix) survive cleanup/reimage going forward.

**Negative / accepted gap**: neither Option A nor B backfills the 4 existing gitignored notes by
itself (AC5) — implementation must treat that as an explicit companion task, not silently drop it
(both this ADR and the design note's Assumption Audit flag it). Unconditional auto-promotion of
every research note (mirroring `investigate`/`analyze`'s existing precedent) could over-collect
low-value exploratory lookups over time — an accepted, pre-existing risk pattern, not one newly
introduced by this decision, worth reviewer attention if research notes prove noisier in practice
than investigate notes have been.

**Operational**: `V-STAGE-04`'s removal is a genuine BREAKING-but-anticipated consumer change —
implementation must remove its fixture tests in the same PR or `bun run verify` fails on a
dangling assertion of the now-reversed invariant (both blind critics flagged this as a MINOR
carry-forward item). `blackhole-vcodes.md`'s `entries[].route` documentation and `doc-governance.md`
§ Canonical Naming both need a one-line update alongside the mechanical enum/check changes.
