# Hunt Kind: Docs

Scan heuristics, calibration table, and scoring rule for the `docs` hunt kind
(`kaizen.kinds`, [config-template.md](../config-template.md)). This kind is the **Scope-2**
enforcement site for `V-DOC-04` (doc-tree structural staleness — [blackhole-vcodes.md](../blackhole-vcodes.md)):
`scripts/checks/doc-health.check.ts` cannot serve this role because its `DOCS_DIR` is
`import.meta.dirname`-pinned to blackhole's own checkout (Scope 1) and therefore cannot reach
a consumer repo's `documentation/` tree during a campaign at all — this kind is the Scope-2
complement, reusing `doc-health.check.ts`'s `V-DOCHEALTH-01` dangling-row detection *rule* as
hunter-agent scan guidance rather than reimplementing a cross-repo-incapable script
(`V-INT-02`; ADR-021 D6, issue #496 design § Decision C). Like every prior kind, this is a
pure additive extension: it reuses every existing kaizen mechanism verbatim — the `V-HUNT-01`
`CONFIRMED` verification gate, `V-PARETO-02` scoring, per-wave caps, ledger idempotency dedup,
and the `hunt_state` watermark (`territory.bands_scanned`/`bands_done`). It introduces no new
scoring formula, no new ledger field, no new finding schema, and no change to
`V-HUNT-01`/`V-HUNT-02` gating logic.

## Territory bands

`docs` is a **mixed-territory** kind, the same shape `parity.md` and `ux-coherence.md` already
established: heuristic 1 (dangling INDEX rows) bands as a single dedicated `index` band — the
root `documentation/INDEX.md` (or a per-folder index, once the tree tiers) is one file checked
as a whole, not naturally split by directory — while heuristic 2 (unresolved `supersedes:`
chains) bands by `documentation/<folder>` directory globs, `coverage.md`-style. Both banding
styles are carried on the existing generic `hunt_state.kinds.docs.bands_done` string-array
field unmodified — no new field, no prefix syntax. A wave scans one band under whichever
banding style applies to the heuristic it is currently working; the two styles are never
merged into a single band identifier.

## Scan heuristics

A `docs` wave audits a consumer repo's own `documentation/` tree for structural staleness —
never a hunch, and never a diff-scoped check (the diff-scoped complement ADR-021 D6 also names
is explicitly out of scope for this kind, deferred to a future `reviewer.md` audit). Every
candidate is read/trace-verified before it is reported (`hunter.md` § Verification pass):
`CONFIRMED` means the cited INDEX row or `supersedes:` value was actually read and resolved
against current repo file-tree state — a plausible-sounding but unread suspicion is
`STALE`/not reported.

1. **Dangling INDEX row** (the dedicated `index` band). For the root `documentation/INDEX.md`
   (or a per-folder index, once the tree tiers per `mode-restructure.md` P4), confirm every
   row's `path` column resolves to an existing file relative to `documentation/`. A row whose
   target has been moved, renamed, or deleted without the index following is a finding.
   **Absent-INDEX degradation**: when the consumer repo has no `documentation/INDEX.md` yet,
   this heuristic is a **logged no-op** for the wave — there is nothing to check staleness
   against — mirroring `doc-health.check.ts`'s own absent-file SKIP convention; this is not a
   failure and not evidence the tree is healthy.
2. **Unresolved `supersedes:` chain** (per directory band). For each doc under
   `documentation/` whose frontmatter carries a `supersedes:` value, confirm the referenced
   path exists **and** is marked `status: deprecated`. A `supersedes:` value pointing at a
   file that does not exist, or at a file still marked `status: current`, is a finding.

**Explicitly deferred, not silently dropped**: the third mercure `V-DOC-04` leg — a folder
reorganized without its index following — is **out of scope for this kind** (mirrors mercure's
own carve-out: that leg applies only once the tree has tiered into per-folder indexes; a
consumer repo below the tiering threshold has nothing for it to check yet, and building it
speculatively would be premature generality, `V-YAGNI-01`). Named here so it isn't lost.

Every finding is read-verified before it is reported: the hunter re-reads the cited INDEX row
or `supersedes:` frontmatter block against current repo state and only reports `CONFIRMED`
findings ([worker-schemas.md](../worker-schemas.md) § Hunter). A `CONFIRMED` `docs` finding
that clears the `Priority >= 30` gate files through the same shared
[filing.md](filing.md) issue-body template every other kind uses — it does not invent its own
issue-body shape.

## Finding file/line convention

| Heuristic | `file` | `line` | Rationale |
|-----------|--------|--------|-----------|
| Dangling INDEX row | The index file itself (`documentation/INDEX.md`, or the relevant per-folder index) | The offending row's own line number within that file | The gap is a real, addressable line — no sentinel needed, unlike `parity.md`'s/`ux-coherence.md`'s non-file-shaped candidates |
| Unresolved `supersedes:` chain | The doc carrying the `supersedes:` frontmatter field | `1` | Frontmatter block convention — the gap lives at the top of the file, matching `parity.md`'s/`ux-coherence.md`'s own choice for frontmatter gaps |

Re-detecting the *same* gap across waves yields the *same* `(file, line)` pair, so the
ledger's dedup check (`findings-ledger.md` § Write protocol, step 3) correctly collapses
re-reports into one row.

## Severity-term reconciliation note

Like every other hunt kind, the hunter's already-shipped output contract
(`worker-schemas.md` § Hunter, Finding shape) gives `severity` the enum
`LOW | MEDIUM | HIGH | BLOCK`. This kind **reuses that enum as-is** — it does not introduce a
new tier. Unlike `parity.md` and `ux-coherence.md`, which never assign `severity: BLOCK`,
**every `docs` finding assigns `severity: BLOCK`**: this kind has exactly one detection
concern (`V-DOC-04`), declared `BLOCK` in `blackhole-vcodes.md` with no severity range —
unlike a brand-new code inheriting historical severity-without-teeth debt, `V-DOC-04` ships
with its enforcement site in this same issue, so setting it fixed `BLOCK` from day one is
proportionate (issue #496 design § Decision C). `docs` findings are **not** floor-bypassed
the way `bug` findings are (`bug.md` § Severity floor) — they go through the normal
`Priority >= 30` gate like every kind other than `bug`'s exception; declaring the vcode
`BLOCK` governs the review-time consequence once a filed finding is fixed, not the filing
gate itself.

## Calibration table

| Heuristic | Trigger | Gain range | Effort range | Severity | Worked example |
|-----------|---------|------------|---------------|----------|-----------------|
| Dangling INDEX row | A `documentation/INDEX.md` row's `path` resolves to no existing file | 4–7 | 1–3 | BLOCK | `documentation/INDEX.md` carries a row for `audits/old-name.md`, but that file was renamed to `audits/new-name.md` in a merged PR that never updated the index (illustrative, invented) → gain 5, effort 2, severity BLOCK → Priority 5 × (11 − 2) = 5 × 9 = 45 (moderate, files above the floor) |
| Unresolved `supersedes:` chain | A doc's `supersedes:` value resolves to no file, or to a file not marked `status: deprecated` | 4–7 | 1–3 | BLOCK | `documentation/decisions/ADR-014-new-approach.md` declares `supersedes: decisions/ADR-009-old-approach.md`, but `ADR-009` is still `status: current` — the supersession protocol (`doc-governance.md` § Supersede-on-Overwrite) was never completed on the old doc (illustrative, invented) → gain 6, effort 2, severity BLOCK → Priority 6 × (11 − 2) = 6 × 9 = 54 (strong candidate) |

`gain` and `effort` are each 1–10, matching the hunter output contract (`worker-schemas.md` §
Hunter, Finding shape). Severity is fixed `BLOCK` for both heuristics, per the reconciliation
note above — the ranges above are per-heuristic `gain`/`effort` calibration bands, not hard
values; a hunter agent picks the specific score within the listed range based on the concrete
gap's actual scope.

## Scoring — V-PARETO-02 SSOT

`Priority = Gain * (11 - Effort)`; a finding must score `>= 30` to be filed as an issue, and
ready issues are sorted by Priority descending
([blackhole-vcodes.md](../blackhole-vcodes.md), `V-PARETO-02`). This is the **only** scoring
formula for the `docs` kind — no alternate or per-kind formula is introduced, and the fixed
`BLOCK` severity above is an input rule layered on top of the one formula, not a second
formula or a second gating mechanism (ADR-006 § Scoring model verdict: "the formula is sound
and stays unchanged as the single SSOT... mercure's mechanisms as input rules under the one
formula, not as parallel formulas"). Findings scoring below 30 are archived in the ledger and
never filed, per the same rule every other kind follows.
<!-- GENERATED by scripts/build.ts from src/references/hunt/docs.md — do not hand-edit -->
