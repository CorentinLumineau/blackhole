# Hunt Kind: Refactor

Scan heuristics, calibration table, and scoring rule for the `refactor` hunt kind
(`kaizen.kinds`, `config-template.md`). Ported from `x-rearchitect`'s cross-file structural
audit (ADR-006 § Hunt kinds).

## Scan heuristics

A `refactor` wave looks for cross-file/module-level structural debt — deliberately distinct
from `best-practices.md`'s single-file/class SOLID checks, which stop at one file's
boundary:

- **Duplicated pattern across modules** — the same logic (a parsing routine, a retry
  strategy, a validation sequence) is hand-rolled independently in 3 or more separate
  files/modules instead of sharing one implementation.
- **Missing shared abstraction** — N call sites each re-implement the same integration
  (e.g. each of 4+ callers builds its own HTTP client configuration, its own error-mapping
  table) with no shared module extracting the common shape.
- **Layering/boundary violation** — a lower layer (e.g. a data-access module) reaches
  upward and imports from a higher layer (e.g. a UI or orchestration module), or a module
  that should be a leaf dependency instead depends on several of its own consumers,
  spanning multiple modules.
- **God-module fan-in/fan-out cluster** — a single module is imported by a large number of
  consumer files (high fan-in) while itself importing from a large number of unrelated
  modules (high fan-out), making it a de facto hub no one can safely change.
- **Circular dependency between modules** — module A imports from module B and module B
  (directly or transitively) imports back from module A, forming an import cycle that
  cannot be broken without editing both sides — distinct from the one-directional
  layering/boundary violation above.
- **Mid-migration old/new pattern coexistence** — an old approach and its replacement
  (e.g. a legacy callback-style API alongside a newer promise-based one) coexist across
  files, with some callers on the old path and others on the new one, indicating an
  incomplete migration spanning the corpus.

Every finding is read-verified before it is reported: the hunter re-reads the cited
`file:line` and only reports `CONFIRMED` findings (`worker-schemas.md` § Hunter).

## Calibration table

`effort` for this kind is **not** raw implementation time — it is derived from **blast
radius**: the count of files and downstream consumers a structural fix would touch
(ADR-006 § Scoring model item 2). A fix touching one or two files stays at the low end of
the range even if the code itself is gnarly; a fix rippling across many files/consumers
climbs toward the high end regardless of how mechanical each individual edit is. The
ranges below are consistent with the already-landed size-label bands in
`phase-loop.md` § Kaizen hunt dispatch step 3: effort 1–2 → `size:xs`; effort 3 → `size:s`;
effort 4–6 → `size:m`; effort 7–8 → `size:l`; effort 9–10 **or** a `multi-file blast
radius` flag (any numeric effort) → `size:xl`.

| Heuristic | Trigger | Gain range | Effort range | Worked example |
|-----------|---------|------------|---------------|-----------------|
| Duplicated pattern across modules | Same logic hand-rolled independently in 3+ files/modules | 4–7 | 3–6 | A bespoke retry-with-backoff loop hand-rolled in 3 separate service modules, no shared helper → gain 6, effort 4 → Priority 6 × (11 − 4) = 6 × 7 = 42 (moderate) |
| Missing shared abstraction | N call sites each re-implement the same integration with no shared module | 5–7 | 4–7 | 5 callers each build their own HTTP client + error-mapping table for the same upstream API, no shared client module → gain 6, effort 5 → Priority 6 × (11 − 5) = 6 × 6 = 36 (borderline) |
| Layering/boundary violation | Lower layer imports from a higher layer, or a leaf module depends on its own consumers | 5–8 | 5–7 | A data-access module imports and calls into 3 separate UI-layer formatting modules for display strings, inverting the intended layering → gain 7, effort 6 → Priority 7 × (11 − 6) = 7 × 5 = 35 (borderline) |
| God-module fan-in/fan-out cluster | Single module imported by many consumers while itself importing from many unrelated modules | 8–9 | 7–8 (or multi-file flag) | A shared `utils.ts` imported by 22 consumer files across the whole corpus, itself importing from 9 unrelated subsystems — any structural change ripples across all 22 consumers (illustrative, invented) → gain 8, effort 7 → Priority 8 × (11 − 7) = 8 × 4 = 32 (borderline, clears the `V-PARETO-02` floor and files). Effort 7 maps to `size:l` under the blast-radius mapping above; this is the AC3 anchor — a filed `size:l` refactor issue routes into the design track (`needs_design`) via the already-merged ADR-004 router. A wider version of this same finding (e.g. 40+ consumers, cross-cutting rename) would push effort to 9–10 and trip the `multi-file blast radius` flag instead, forcing `size:xl` regardless of the numeric effort value. |
| Circular dependency between modules | Module A imports from module B and module B (directly or transitively) imports back from module A | 5–8 | 4–7 | Two service modules each import a helper from the other to share a validation routine, forming a two-file import cycle that breaks on any bundler with strict cycle detection → gain 6, effort 5 → Priority 6 × (11 − 5) = 6 × 6 = 36 (borderline) |
| Mid-migration old/new pattern coexistence | Old and new approaches to the same concern coexist across files, incomplete migration | 4–6 | 4–6 | A legacy callback-style event API still called from 4 older modules while 6 newer modules use the replacement promise-based API, migration left half-finished → gain 5, effort 5 → Priority 5 × (11 − 5) = 5 × 6 = 30 (borderline, files at the floor) |

`gain` and `effort` are each 1–10, matching the hunter output contract
(`worker-schemas.md` § Hunter, Finding shape). The ranges above are per-heuristic
calibration bands, not hard values — a hunter agent picks the specific score within the
listed range based on the concrete finding's actual blast radius (e.g. a duplicated
pattern spanning 8 files scores toward the top of its heuristic's effort range, not the
bottom).

## Scoring — V-PARETO-02 SSOT

`Priority = Gain * (11 - Effort)`; a finding must score `>= 30` to be filed as an issue, and
ready issues are sorted by Priority descending (`src/references/blackhole-vcodes.md`,
`V-PARETO-02`). This is the **only** scoring formula for the `refactor` kind — no alternate
or per-kind formula is introduced. The blast-radius-derived `effort` semantics above are an
input rule under the one formula (ADR-006 § Scoring model item 2), not a second formula.
The calibration table anchors this kind's `gain`/`effort` inputs to the shared 1–10 scale;
it does not replace the formula (ADR-006 § Scoring model verdict: "the formula is sound and
stays unchanged as the single SSOT").
