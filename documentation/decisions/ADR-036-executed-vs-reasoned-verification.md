---
status: accepted
---

# ADR-036: Disclose executed-vs-reasoned verification on reviewer findings and investigation legs

## Status

Accepted

## Context

Issue #815: the reviewer return schema has no field distinguishing **executed** verification (a
probe or test actually ran) from **reasoned** verification (static analysis / code-reading,
typically a fallback when the global `with-test-lock` is contended). The sharpest form of the gap
is the negative-result case: a clean investigation leg — "I found no symlink escape" — produces
no `Finding` object today, so there is nothing in the JSON to attach a disclosure to even when the
reviewer states the caveat correctly in prose (as happened once this session, `review-784` on PR
#810). A merge decision that treats a probed absence and a reasoned absence identically cannot
weigh them differently, and a security finding's absence is exactly the kind of claim where that
distinction is load-bearing. This sits in the same family as issue #808 (six controls reporting
success while structurally unable to detect their own failure case, resolved this session as
ADR-035/`V-UNFALSIFIABLE-01`) and issue #795 (resolved as ADR-032/`V-TEST-11`) — three findings
converging on the same root concern (self-report trust) from three different angles.

Design Track evaluation (`.blackhole/plans/issue-815-design.md`) scored three options against a
`data-model-change` rubric and invoked `scripts/design-aggregate.ts`:

```json
{
  "status": "blocked",
  "winner": null,
  "reasons": ["dominance"],
  "scorer_results": [
    { "scorer": "primary",  "winner": "Option A", "margin": 3.70 },
    { "scorer": "critic_a", "winner": "Option A", "margin": 6.49 },
    { "scorer": "critic_b", "winner": "Option A", "margin": 0 }
  ]
}
```

All three scorers (primary + 2 independent blind critics) unanimously picked Option A, with no
disagreement and no CRITICAL finding raised against the winner itself. The sole block reason is
`dominance`: every margin falls short of the 30% threshold, and critic B's own numeric score is an
exact tie between Option A and Option C (3.60 vs 3.60). That tie is weaker evidence than this
session's five prior overrides (ADR-029/030/031/033/035), all of which had a nonzero margin on
every scorer — this is addressed directly below rather than treated as an identical case.

## Decision

Adopt **Option A**: add an optional `verification_mode: "executed" | "reasoned"` field to the
shared `Finding` shape, plus a new, distinctly-named optional top-level array sibling to the
existing `recheck[]`/`verification[]` arrays: `verification_legs: [{direction, mode, evidence}]` —
the structural home for a clean/negative investigation leg that produces no `Finding` object,
which a per-finding-only field cannot cover. Both are additive and optional (absence = legacy, no
claim made — fully backward compatible, zero BREAKING consumers per the design note's Refactoring
Impact Analysis). `scripts/checks/ledger-schema.check.ts` (`V-LEDGER-01`) is extended to validate
`verification_mode`'s enum when present on a ledgered finding; `verification_legs[]` itself is
investigation metadata, not a defect record, and is not ledgered — it is surfaced directly to the
merge decision. `review-core.md` gains one new documented merge-gate step, mirroring the existing
`V-SEC-08` "surface, never auto-block" shape exactly: when `route.security_review_required`
resolves true, any `verification_legs[]` entry with `mode: "reasoned"` is surfaced at the merge
decision point (AC3), never used as grounds to bypass `with-test-lock` (AC4, unchanged by this
decision — no option here touches `resource-frugal-testing.md`).

**This decision overrides `design-aggregate.ts`'s `blocked` verdict** (reason: `dominance`) —
approved under this campaign's `autonomy.mode: full` grant, the seventh such override this
session. Unlike the prior five dominance-only overrides (ADR-029/030/031/033/035), this one has a
literal 0%-margin tie on one scorer, which is addressed on its own terms rather than pattern-matched
away: critic B's numeric tie between Option A and Option C is not a substantive endorsement of
Option C, because that same critic (like critic A, independently and unprompted) rated Option C a
**CRITICAL, discriminating finding** — status quo does not satisfy AC1-AC3 at all, since it
provides no schema field, no disclosure path for a clean/negative leg, and nothing for the
orchestrator to surface at merge. A rubric that scores a CRITICALLY-disqualified option as a
numeric tie with the winner is a rubric blind to a binary, structural requirement (the option
either has a JSON home for the negative-result case or it does not) — the same shape of rubric
gap ADR-033 identified for its own dominance override ("the rubric had no column for that
distinction"). The override consists of trusting the qualitative CRITICAL disqualification over
the tied numeric score, on a rubric neither critic disputed for any other reason, combined with
genuine unanimity on the winner and zero disagreement.

The thin evidence base (exactly one documented instance this session, `review-784`, versus
issue #808's six) is weighed honestly rather than glossed over: it is real, and it is why Option A
was not simply rubber-stamped. It does not change the decision because — per both critics,
independently — the gap Option A closes is structural (a clean/negative leg has no JSON home to
disclose into) rather than frequency-dependent, and `route.security_review_required: true` means
the cost of a silent miss on this specific axis is asymmetric: a security finding's correctly-
disclosed absence and its merely-assumed absence are indistinguishable today, and the one instance
observed happened to be disclosed correctly only because a diligent reviewer chose to volunteer it
in free prose — nothing in the process required it.

## Alternatives Considered

- **Option B — prose convention, no schema change.** A fixed, greppable prose marker (e.g.
  `[reasoning-only: <leg>]`), backstopped by one new regex constant in `review-aggregate.ts`.
  Rejected: both critics independently identified that this inherits exactly the fragility the
  problem statement names as most acute — prose is "the part most likely to be truncated in
  transit," and the mechanism is weakest precisely for the negative/clean-leg case it exists to
  cover. It also still requires a real (if JSON-undeclared) structural obligation — a mandated
  "Investigation Directions" prose section on every review — narrowing its claimed Effort
  advantage over Option A.
- **Option C — status quo / defer.** Continue relying on reviewer prose discipline as demonstrated
  once, correctly, in `review-784`. Rejected: both critics independently and unprompted scored
  this CRITICAL non-conformant against AC1-AC3 regardless of the thin evidence base — the schema
  gap is structural (there is no Finding object for a clean leg to disclose through), not a
  function of how often the gap has been observed to bite.

## Consequences

**Positive**: gives a security-relevant negative result ("I found nothing") a JSON home to
disclose its own confidence basis, closing the same class of gap issue #808/ADR-035 targets for
controls in general, applied here specifically to reviewer investigation legs. Additive-only
shape (zero BREAKING consumers) reuses the codebase's existing `recheck[]`/`verification[]`
sibling-array precedent and `V-SEC-08`'s "surface, never block" merge-gate framing exactly — no
new response pattern invented.

**Negative / accepted gap**: highest implementation surface of the three options (Finding field +
new array + two validator files + `ledger-schema.check.ts` + a `review-core.md` doc step), and the
only option adding a (light) authoring obligation to every review, not only ones with findings.
Both critics independently flagged, as a domain-inherent limitation shared by all three options,
that none of them structurally prevents a reviewer from mislabeling a reasoned check as
`executed` — this remains a self-report trust model, the same ceiling already tracked by
ADR-032/`V-TEST-11`; only independent re-verification (out of scope here) would close it further.

**Operational**: `verification_mode` avoids the name `verification`, already claimed twice in this
codebase for two different meanings (the reviewer's own top-level `verification[]` recheck array,
and the hunter's per-finding `CONFIRMED | STALE` field) — a third, distinctly-named field/array
prevents a schema-reader conflation risk both critics flagged. `ledger-schema.check.ts`'s existing
"absent key is legacy, not drift" precedent (already established for `pr_ref`) applies identically
to `verification_mode` — no backfill obligation for existing ledger rows.
