# Hunt Kind: UX Coherence

Scan heuristics, calibration table, and scoring rule for the `ux-coherence` hunt kind
(`kaizen.kinds`, [config-template.md](../config-template.md)). Ships the whole-app structural
audit named in issue #421: an ad hoc 12-agent audit on the `invest` campaign (2026-07-29)
surfaced 106 verified defects — a monthly routine living as a sidebar of a diagram editor, the
app's headline question having no owning surface, a dead component family — that 39 prior
locally-green merged PRs never detected, because nothing in the five-phase protocol ever walks
the product as its own user. This kind's territory is a campaign's **own live surfaces and user
journeys**, judged against `DESIGN.md`, the owner-rulings ledger
(`documentation/reference/product-principles.md`, #417 — soft dependency, degrades gracefully
per § Scan heuristics below), and `journeys.md` (the companion file this kind's Phase-0 scaffold
branch creates — see `templates/companion-files/README.md`). Like `parity`, this kind is a pure
additive extension: it reuses every existing kaizen mechanism verbatim — the `V-HUNT-01`
`CONFIRMED` verification gate, `V-PARETO-02` scoring, per-wave caps, ledger idempotency dedup,
and the `hunt_state` watermark (`bands_scanned`/`bands_done`). It introduces no new scoring
formula, no new ledger field, no new finding schema, and no orchestrator/hunter/`hunt_state`
mechanic beyond what every prior kind already uses (ADR-006 § Hunt kinds).

## Territory bands

`ux-coherence` bands by **product surface** — one band per detected top-level surface/route/view
(directory-glob banding, `coverage.md`-style) — **plus one dedicated `journeys` band** that is
never merged into a surface band. Both band styles are carried on the existing generic
`hunt_state.kinds.ux-coherence.bands_done` string-array field unmodified — no new field, no
prefix syntax (`findings-ledger.md`'s "no consumer parses `hunt_state` band content
structurally" note already establishes this is safe, and `parity.md` already established the
precedent for a kind mixing two banding styles under the one shared field). A wave scans one
band: either a surface band (surface-coherence heuristic) or the `journeys` band
(journeys heuristic) — the two heuristics are never run against the same band in the same wave.

## Scan heuristics

A `ux-coherence` wave walks the product as its own user, never a hunch about what "feels"
incoherent. Every candidate is read/trace-verified before it is reported (`hunter.md` §
Verification pass): for this kind specifically, `CONFIRMED` means the cited surface or journey
gap was actually navigated/read against current repo state — a plausible-sounding but unread
suspicion is `STALE`/not reported.

1. **Surface-coherence heuristic** (per surface band). For the surface currently being scanned,
   confirm the surface's structural placement, naming, and content fit the product's documented
   intent: cross-check against `DESIGN.md` (visual/structural tokens) and, when
   `documentation/reference/product-principles.md` exists, against every `active`-status ruling
   in it (`V-RULE-01`'s read-input contract — this kind reads the ledger the same way
   `reviewer.md` §19 does, but as a hunt-time input, not a merge gate). Concrete gap shapes:
   a feature living in a structurally unrelated surface (e.g. a monthly routine as a sidebar of
   an unrelated diagram editor), a dead/unreachable component family, or a surface whose content
   contradicts an `active` ruling. **Gated**: when
   `documentation/reference/product-principles.md` is absent, the ruling-ledger cross-check
   portion of this heuristic is skipped for the wave (structural/`DESIGN.md` checks still run) —
   logged as a `V-INT-01` WARN-worthy note, never a hard block on the whole heuristic or kind
   (this kind's soft dependency on #417, per the design note's own resolution).
2. **Journeys heuristic** (the dedicated `journeys` band only). Read
   `templates/companion-files/journeys.md.template`'s instantiated target,
   `journeys.md`, at the repo root. **First check its frontmatter `status` field**: when
   `status: template` (or the literal `<!-- STATUS: unfilled template` sentinel is still
   present), this heuristic is a **logged no-op for the wave** — `journeys.md` has not yet been
   filled in with owner-approved core user jobs, so auditing against placeholder content would
   produce noise rather than signal (mirrors `coverage.md`'s own "no test runner detected"
   no-op discipline; this is the plan's direct answer to the "who fills it in" critique against
   scaffolding a template). Only when `status: current` does this heuristic run: for each
   `## Job:` section, walk the click path a user would take to accomplish that job's
   **Statement** and confirm the job's **Owning surface** actually exists and actually serves
   that job end-to-end. `Owning surface: none` is itself a first-class finding — the exact shape
   of the issue's cited evidence (the app's headline question having no owning surface). A
   `## Job:` entry whose click path dead-ends, or whose named owning surface does not actually
   serve the job, is also a finding.

Every finding is read-verified before it is reported: the hunter re-reads the cited surface,
component, or `journeys.md` job entry and only reports `CONFIRMED` findings
([worker-schemas.md](../worker-schemas.md) § Hunter). A candidate whose gap cannot be confirmed
against current repo/app state is `STALE`, never rounded up to `CONFIRMED`. A `CONFIRMED`
`ux-coherence` finding that clears the `Priority >= 30` gate files through the same shared
[filing.md](filing.md) issue-body template every other kind uses — it does not invent its own
issue-body shape.

## Finding file/line convention

Like `parity.md` and `retrospective.md`, this kind's candidates are not naturally
single-file/single-line for every heuristic, so this section fixes a canonical convention per
heuristic — chosen so re-detecting the *same* gap across waves always yields the *same*
`(file, line)` pair and the ledger's dedup check (`findings-ledger.md` § Write protocol, step 3)
correctly collapses re-reports into one row:

| Heuristic | `file` | `line` | Rationale |
|-----------|--------|--------|-----------|
| Surface-coherence heuristic | The surface's primary file/dir (e.g. the top-level component/route file that owns the surface) | `0` | Whole-surface structural gap, not a line defect |
| Journeys heuristic | Sentinel `journey:<job-slug>` (verbatim reuse of `parity.md`'s and `retrospective.md`'s own sentinel convention) | `0` | The finding concerns a `## Job:` entry in `journeys.md`, not a code file — the sentinel keeps the value distinct from any real file path |

## Severity-term reconciliation note

Like every other hunt kind, the hunter's already-shipped output contract
(`worker-schemas.md` § Hunter, Finding shape) gives `severity` the enum
`LOW | MEDIUM | HIGH | BLOCK`. This kind **reuses that enum as-is** — it does not introduce a
new tier. Severity range is **MEDIUM–HIGH**: every gap this kind surfaces is a structural/UX
coherence defect, not a code-breaking one, so **this kind never assigns `severity: BLOCK`**
(matches `retrospective.md`'s and `parity.md`'s own choice not to introduce a severity floor —
no floor is introduced here). `ux-coherence` findings go through the normal `Priority >= 30`
gate like every kind other than `bug`'s severity-floor exception (precedent:
`src/references/hunt/bug.md` § Severity floor).

## Calibration table

| Heuristic | Trigger | Gain range | Effort range | Severity range | Worked example |
|-----------|---------|------------|---------------|-----------------|-----------------|
| Surface-coherence heuristic | A live surface's placement, naming, or content diverges from `DESIGN.md` or an `active`-status ruling, or the surface is a dead/unreachable component family | 3–7 | 3–6 | MEDIUM–HIGH | A recurring monthly-planning routine lives as a collapsed sidebar panel inside an unrelated diagram-editor surface, so users who need it must first open the diagram editor (illustrative, invented) → gain 6, effort 4, severity HIGH → Priority 6 × (11 − 4) = 6 × 7 = 42 (files above the floor) |
| Journeys heuristic | A `## Job:` entry's click path dead-ends, its named owning surface does not serve the job end-to-end, or `Owning surface: none` | 4–8 | 3–7 | MEDIUM–HIGH | `journeys.md`'s core job "answer the app's headline question" lists `Owning surface: none` — no page in the product actually surfaces that answer today (illustrative, invented, matches the issue's own cited evidence) → gain 7, effort 4, severity HIGH → Priority 7 × (11 − 4) = 7 × 7 = 49 (strong candidate) |

`gain` and `effort` are each 1–10, matching the hunter output contract (`worker-schemas.md` §
Hunter, Finding shape). Severity never reaches `BLOCK` for this kind, per the reconciliation
note above — the ranges above are per-heuristic calibration bands, not hard values; a hunter
agent picks the specific score within the listed range based on the concrete gap's actual scope.

## Scoring — V-PARETO-02 SSOT

`Priority = Gain * (11 - Effort)`; a finding must score `>= 30` to be filed as an issue, and
ready issues are sorted by Priority descending
([blackhole-vcodes.md](../blackhole-vcodes.md), `V-PARETO-02`). This is the **only** scoring
formula for the `ux-coherence` kind — no alternate or per-kind formula is introduced, and the
gating notes above (the ruling-ledger soft dependency, the `journeys.md` template degradation)
are input rules layered on top of the one formula, not a second formula or a second gating
mechanism (ADR-006 § Scoring model verdict: "the formula is sound and stays unchanged as the
single SSOT... mercure's mechanisms as input rules under the one formula, not as parallel
formulas"). Findings scoring below 30 are archived in the ledger and never filed, per the same
rule every other kind follows.
