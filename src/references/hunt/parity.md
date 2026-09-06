# Hunt Kind: Parity

Scan heuristics, calibration table, and scoring rule for the `parity` hunt kind
(`kaizen.kinds`, [config-template.md](../config-template.md)). Ships the F6 self-audit hunt
kind named as future scored work in ADR-013 Migration Plan step 5 (`mercure-parity-program`
initiative, brainstorm F6). Unlike every other kind, this kind's territory is **a campaign's
own produced output** — merged PRs, their `documentation/` artifacts, and their bodies —
**never** the maintainer parity matrix (`documentation/audits/mercure-parity-matrix.md`,
read-only, `prj-mercure-sync`'s sole write privilege per ADR-013 D1 single-writer rule) and
**never** blackhole's own conformance to mercure (that comparison is
`mercure-parity-surface.md` + the matrix's own job, run by the maintainer skill, not a
per-campaign hunt wave). `parity` is a pure additive extension: it reuses every existing
kaizen mechanism verbatim — the `V-HUNT-01` `CONFIRMED` verification gate, `V-PARETO-02`
scoring formula (`V-PARETO-03` filing gate), per-wave caps, ledger idempotency dedup, and the `hunt_state` watermark
(`territory.bands_scanned` / `bands_done`). It introduces no new scoring formula, no new
ledger field, no new finding schema, and no change to `V-HUNT-01`/`V-HUNT-02` gating logic —
every candidate passes through the existing CONFIRMED verification pass (`hunter.md` §
Verification pass) and the existing `phase-loop.md` § Kaizen hunt dispatch 5-step wave
protocol unmodified.

Each scan heuristic below cites the `PM-NNN` id(s) of the live matrix row(s) it is derived
from — never the row's full prose, only the stable id, so the maintainer matrix itself stays
unshipped in substance even though this file ships to every consumer repo (`src/` builds to
every distributable tree; `documentation/` never does — `ARCHITECTURE.md`'s Active
Constraints already guarantee this separation structurally, no new mechanism needed). Where
no live matrix row exists for a category, the heuristic cites
[mercure-parity-surface.md](../../../documentation/audits/mercure-parity-surface.md) directly
instead of fabricating an id — never invent a `PM-NNN`.

## Territory bands

`parity` is the first **mixed-territory** kind: heuristics 1–2 (artifact set, frontmatter
governance) band by `documentation/<folder>` directory globs — the same codebase-band
mechanic `coverage.md` already uses — while heuristic 3 (PR enforcement evidence) bands by
PR-number windows, `retrospective.md`-style (e.g. `"PRs 1-100"`). Both banding styles fit the
shared `territory.bands_scanned` string-array field unmodified — no new field, no prefix
syntax (`findings-ledger.md`'s "no consumer parses `hunt_state` band content structurally"
note already establishes this is safe). A wave scans one band under whichever banding style
applies to the heuristic it is currently working; the two styles are not merged into a single
band identifier.

## Scan heuristics

A `parity` wave audits a campaign's own merged output for conformance to obligations the
campaign's own machinery already commits to — never a hunch, and never a comparison against
the maintainer matrix's prose. Every candidate is read/trace-verified before it is reported
(`hunter.md` § Verification pass): for this kind specifically, `CONFIRMED` means the cited
merged PR, artifact path, or frontmatter block was actually read and the gap demonstrated
against real repo state — a plausible-sounding but unread suspicion is `STALE`/not reported.

1. **Artifact set per route** (per `PM-` provenance: no live matrix row currently cites
   `artifact-contract.md` directly — this heuristic is derived from the audit evidence base
   directly, per `mercure-parity-surface.md` §2a, "Doc governance + artifact contract (ADR-010
   D5): per-route durable artifacts, config-gated," rather than a fabricated id, per this
   kind's Entry Gate fallback rule above). For a merged issue whose route flags
   (`queue.json`'s `route{}` object, ADR-004 — `needs_analysis`/`needs_brainstorm`/
   `needs_design`/`needs_investigation`) indicate a thinking-route that
   [../artifact-contract.md](../artifact-contract.md)'s Route → artifact table requires a
   `documentation/` artifact for (including unconditional `plan` and `review` rows per ADR-021
   D3, issue #445), confirm the artifact exists at the documented path **and**
   landed in that issue's own merged PR (not added later in an unrelated PR, not missing
   entirely). **Gated**: only runs when `docs_governance.enabled &&
   docs_governance.write_governance` (absent block/`false` ⇒ this heuristic is inapplicable
   this wave, not a finding — matches `artifact-contract.md`'s own kill-switch contract).
2. **Frontmatter governance** (per `PM-019`). For any `documentation/` file created or touched
   in a merged PR, confirm required lifecycle frontmatter (`type`, `status` at minimum, per
   [doc-governance.md](../doc-governance.md)) is present and well-formed. **Gated**: only runs
   when `docs_governance.enabled && docs_governance.companion_files` (mirrors `reviewer.md` § Companion-File Audit's
   own gating for the same underlying obligation).
3. **Enforcement evidence in PR bodies** (per `PM-029`). For a merged PR whose issue passed
   through the `review` phase (`queue.json` `phase` field history, `queue-dag.md`), confirm
   the PR body or its linked review artifact shows the review pipeline actually ran —
   `Closes #N`/`Fixes #N` linkage (`V-GIT-01`), and either a reviewer verdict/V-code mention
   or a documented deferral with a matching ledger `deferred_to_issue`. **Not**
   `docs_governance`-gated — the review pipeline itself is unconditional, so this heuristic
   always runs.

Every finding is read-verified before it is reported: the hunter re-reads the cited evidence
(the merged PR, the artifact path, the frontmatter block) and only reports `CONFIRMED`
findings ([worker-schemas.md](../worker-schemas.md) § Hunter). A candidate whose gap cannot be
confirmed against current repo/PR state is `STALE`, never rounded up to `CONFIRMED`. A
`CONFIRMED` `parity` finding that clears the `Priority >= 30` gate files through the same
shared [filing.md](filing.md) issue-body template every other kind uses — it does not invent
its own issue-body shape.

## Finding file/line convention

Like `retrospective.md`, this kind's candidates are not naturally single-file/single-line for
every heuristic, so this section fixes a canonical convention per heuristic — chosen so
re-detecting the *same* gap across waves always yields the *same* `(file, line)` pair and the
ledger's dedup check (`findings-ledger.md` § Write protocol, step 3) correctly collapses
re-reports into one row:

| Heuristic | `file` | `line` | Rationale |
|-----------|--------|--------|-----------|
| Artifact set per route | The expected artifact path per `artifact-contract.md`'s Route → artifact table | `0` | Whole-file existence gap, not a line defect |
| Frontmatter governance | The actual `documentation/` file missing/malformed frontmatter | `1` | Frontmatter block convention — the gap lives at the top of the file |
| Enforcement evidence in PR bodies | Sentinel `pr:<number>` (verbatim reuse of `retrospective.md`'s own sentinel convention) | `0` | The finding concerns a merged PR's body, not a file — the sentinel keeps the value distinct from any real file path |

## Severity-term reconciliation note

Like every other hunt kind, the hunter's already-shipped output contract
(`worker-schemas.md` § Hunter, Finding shape) gives `severity` the enum
`LOW | MEDIUM | HIGH | BLOCK`. This kind **reuses that enum as-is** — it does not introduce a
new tier, and it introduces no severity floor the way `bug.md` does. **This kind never assigns
`severity: BLOCK`**: every gap this kind surfaces is a process/governance-conformance gap
found *after* the review pipeline already ran and the PR already merged — a documentation or
evidence-trail defect, not a code-breaking one. The review pipeline itself, not this hunt
kind, is the primary enforcement mechanism; `parity` findings go through the normal
`Priority >= 30` gate like every kind other than `bug`'s severity-floor exception
(precedent: `src/references/hunt/bug.md` § Severity-term reconciliation note; no severity
floor is introduced here, matching `retrospective.md`'s own choice not to add one).

## Calibration table

| Heuristic | Trigger | Gain range | Effort range | Severity range | Worked example |
|-----------|---------|------------|---------------|-----------------|-----------------|
| Artifact set per route | Merged issue's route required a `documentation/` artifact (`artifact-contract.md` Route → artifact table) that is missing or landed outside the issue's own PR | 4–7 | 2–4 | LOW–HIGH | A merged `investigate`-routed issue's PR shows no `documentation/investigations/{slug}.md` was ever committed, so the durable record artifact-contract.md promises never landed (illustrative, invented) → gain 6, effort 3, severity HIGH → Priority 6 × (11 − 3) = 6 × 8 = 48 (moderate, files via the normal gate) |
| Frontmatter governance | A `documentation/` file created/touched in a merged PR is missing `type`/`status` frontmatter or has malformed frontmatter | 3–6 | 1–3 | LOW–MEDIUM | A merged PR adds `documentation/audits/some-audit.md` with no frontmatter block at all, so `type`/`status` cannot be read by any downstream governance tooling (illustrative, invented) → gain 4, effort 2, severity MEDIUM → Priority 4 × (11 − 2) = 4 × 9 = 36 (borderline, files at the floor) |
| Enforcement evidence in PR bodies | A merged PR whose issue passed through `review` shows no `Closes #N` linkage, no reviewer verdict/V-code mention, and no documented deferral | 5–8 | 2–4 | MEDIUM–HIGH | A merged PR's body has no `Closes #N`/`Fixes #N` keyword and no trace of a reviewer verdict, so the campaign's own `V-GIT-01` linkage obligation and review-pipeline evidence trail are both silently absent from the historical record (illustrative, invented) → gain 7, effort 3, severity HIGH → Priority 7 × (11 − 3) = 7 × 8 = 56 (strong candidate) |

`gain` and `effort` are each 1–10, matching the hunter output contract (`worker-schemas.md` §
Hunter, Finding shape). Severity never reaches `BLOCK` for this kind, per the reconciliation
note above — the ranges above are per-heuristic calibration bands, not hard values; a hunter
agent picks the specific score within the listed range based on the concrete gap's actual
scope.

## Scoring — V-PARETO-02 SSOT

`Priority = Gain * (11 - Effort)`; a finding must score `>= 30` to be filed as an issue, and
ready issues are sorted by Priority descending
([blackhole-vcodes.md](../blackhole-vcodes.md), `V-PARETO-02`). This is the **only** scoring
formula for the `parity` kind — no alternate or per-kind formula is introduced, and the
gating notes above are input rules layered on top of the one formula, not a second formula or
a second gating mechanism (ADR-006 § Scoring model verdict: "the formula is sound and stays
unchanged as the single SSOT... mercure's mechanisms as input rules under the one formula, not
as parallel formulas"). Findings scoring below 30 are archived in the ledger and never filed,
per the same rule every other kind follows.
