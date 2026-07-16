# Hunt Kind: Retrospective

Scan heuristics, calibration table, and scoring rule for the `retrospective` hunt kind
(`kaizen.kinds`, `config-template.md`). Ported from mercure's manual `x-architect`
retrospective mode into an automated, campaign-native hunt kind (ADR-010 D7 / P5). Unlike
every other kind, this kind's territory is **the campaign itself** —
`findings-ledger.json` (current rows plus rotated snapshots under `.blackhole/archive/`,
`src/references/blackhole-state.md:18`), merged-PR history, and `queue.json` — **never the
codebase**. It surfaces systemic redesign candidates (recurring V-code clusters, touch-path
hotspots, review-iteration outliers) instead of relying on manual mercure-style
retrospection.

This kind is a pure additive extension: it reuses every existing kaizen mechanism verbatim —
the `V-HUNT-01` `CONFIRMED` verification gate, `V-PARETO-02` scoring, per-wave caps, ledger
idempotency dedup, and the `hunt_state` watermark (`territory.bands_scanned` /
`bands_done`). It introduces no new scoring formula, no new ledger field, no new finding
schema, and no change to `V-HUNT-01`/`V-HUNT-02` gating logic — every candidate passes
through the existing CONFIRMED verification pass (`hunter.md` § Verification pass) and the
existing `phase-loop.md` § Kaizen hunt dispatch 5-step wave protocol unmodified.

## Territory bands

Because this kind's territory has no directory structure to walk, "bands" for `retrospective`
are campaign-history slices rather than path globs — e.g. an issue-number window (`"issues
201-300"`) or a PR-number window (`"PRs 1-100"`) already scanned. This still fits the shared
`territory.bands_scanned` string-array mechanic every other kind already uses
(`worker-schemas.md` § Hunter) unmodified — it is a per-kind semantic for what a "band"
*means*, not a new field or a new watermark shape (mirrors `bug.md`'s note that the shared
territory mechanic applies generically, not a kind-specific banding scheme).

## Scan heuristics

A `retrospective` wave cross-correlates campaign metadata into systemic candidates — never a
single isolated finding or a single merged PR in isolation:

1. **Recurring V-code clusters.** Scan `findings-ledger.json` (current `findings[]` rows plus
   any rotated `.blackhole/archive/findings-<timestamp>.json` snapshots, per the archival
   protocol in `src/references/findings-ledger.md` § Archival) for **3 or more** rows sharing
   the same `vcode` **and** a common file/module path prefix. A qualifying cluster is
   summarized as a candidate, e.g. "V-DRY-02 ×5 in `scripts/checks/*` → extract shared helper
   epic."
2. **Touch-path hotspots.** Fetch merged-PR history via
   `gh pr list --state merged --json number,files,mergedAt --limit 100` — the same
   `gh <cmd> --json <fields> [--limit N]` convention already used for `--state open` in
   `src/references/forge-sync.md:77` and `src/references/phase-loop.md:133`. This is the
   first `--state merged` consumer of that pattern, not a second query mechanism. A
   qualifying hotspot is the **same file path** touched across **3 or more merged issues'**
   PRs — a signal that the file is a de facto shared dependency no single issue's plan ever
   accounted for.
3. **Review-iteration outliers.** **Must not** read `queue.json`'s `review_iteration` field as
   a post-merge signal: `src/references/phase-loop.md` § Ledger cleanup on merge resets
   `review_iteration` to `0` on **every** merge, so by the time a retrospective wave runs
   against a merged issue, `queue.json.review_iteration` is authoritatively zeroed and would
   silently manufacture false "no outliers" findings — a `retrospective` wave built on that
   field would never report a real review-iteration outlier. Instead, this heuristic derives
   review-round counts from the merged PR's **own** activity —
   `gh pr view <n> --json reviews` — and counts the review-submission entries returned. A
   qualifying outlier is an issue whose merged PR required **materially more** review rounds
   than the campaign's typical pattern (e.g. 4+ review submissions on a `size:s`/`size:m`
   issue that should have closed in one or two rounds), read as a signal that the underlying
   code or the plan quality around it is structurally troubled, not just unlucky.
4. **`needs_design: true` flagging.** A candidate whose fix is architectural in scope — a
   coupling hotspot, a cross-cutting extraction spanning several files — is written up with
   an explicit architectural framing in its `rationale` (the existing Hunter finding field,
   `worker-schemas.md` § Finding shape — no new field is added). When the candidate is filed
   as a `[Kaizen]` issue through the existing `filing.md` template, that rationale text flows
   into the issue body's Rationale field verbatim; the already-shipped router (ADR-004,
   `router.md`) then computes `needs_design` from the issue's own content at Phase 0 ingest
   time, the same way it does for every other issue — closing the loop into the M2 autonomous
   design tier (ADR-010 D4) with zero new mechanism. A candidate that is a contained,
   single-file fix is left with a plain fix-direction rationale and is not architecturally
   framed — it is expected to route as a normal, non-design-track issue.

Every finding is read-verified before it is reported: the hunter re-reads the cited evidence
(ledger rows, `gh pr`/`gh issue` output) and only reports `CONFIRMED` findings
(`worker-schemas.md` § Hunter). For this kind specifically, `CONFIRMED` means the cluster,
hotspot, or outlier was walked against the actual ledger/PR data and the pattern holds — a
plausible-sounding but unconfirmed correlation (e.g. "these files feel related") is
`STALE`/not reported, never rounded up to `CONFIRMED`.

## Severity-term reconciliation note

Like every other hunt kind, the hunter's already-shipped output contract
(`worker-schemas.md` § Hunter, Finding shape) gives `severity` the enum
`LOW | MEDIUM | HIGH | BLOCK`. This kind **reuses that enum as-is** — it does not introduce a
new `CRITICAL` tier, and it does not introduce a `retrospective`-specific severity floor the
way `bug.md` does. A `retrospective` finding's `severity` reflects how systemically the
underlying pattern threatens the codebase (e.g. `HIGH` for a god-module cluster with 20+
consumers, `MEDIUM` for a moderate touch-path hotspot); it goes through the normal
`V-PARETO-02` gate like every kind other than `bug`'s severity-floor exception (precedent:
`src/references/hunt/bug.md` § Severity-term reconciliation note).

## Finding file/line convention

The hunter's Finding shape (`worker-schemas.md` § Finding shape (Hunter)) requires `file`
(string) and `line` (number) on every finding, and the ledger dedups on
`(vcode, file, line, issue_ref)` (`findings-ledger.md` § Write protocol, step 3). Every
other hunt kind's findings are naturally single-file/single-line, so those two fields fall
out of the scan directly. This kind's candidates are cluster- or PR-level instead — there is
no single file:line to report — so this section fixes a canonical convention per heuristic,
chosen so that re-detecting the *same* cluster/hotspot/outlier across waves always yields the
*same* `(file, line)` pair and the dedup check correctly collapses re-reports into one row
instead of manufacturing a new row every wave:

| Heuristic | `file` | `line` | Rationale |
|-----------|--------|--------|-----------|
| Recurring V-code clusters | The shared module/dir path prefix common to the clustered rows, with a trailing `/` (e.g. `scripts/checks/`) to signal it is a prefix, not a literal file | `0` | The cluster spans multiple files by definition — the prefix is the smallest identifier stable across future waves re-detecting the same cluster |
| Touch-path hotspots | The exact hotspot file path (this heuristic already narrows to one concrete file touched across 3+ merged PRs) | `0` | The finding is about the file as a whole being a de facto shared dependency, not one line in it |
| Review-iteration outliers | The sentinel `pr:<number>` (e.g. `pr:42`) | `0` | The finding concerns a merged PR, not a file — the sentinel keeps the value distinct from any real file path so it can never collide with an unrelated per-file finding |
| `needs_design: true` flagging | Inherits the `file`/`line` of the heuristic-1-or-2 candidate it is layered onto | inherits | This heuristic never stands alone — it re-frames an existing cluster/hotspot candidate's `rationale`, so it carries that candidate's location, not a new one |

This is a documentation convention only — it introduces no new ledger field and no change to
the dedup mechanism itself (`findings-ledger.md` § Write protocol), matching this kind's
"pure additive extension" framing above.

## Calibration table

`effort` for this kind, like `refactor.md`'s, is **not** raw implementation time — it is
derived from blast radius: the number of files, modules, or issues the underlying systemic
pattern spans. A cluster contained to 3-4 files stays at the low end of its range; a
cluster spanning a dozen+ files or issues climbs toward the high end.

| Heuristic | Trigger | Gain range | Effort range | Worked example |
|-----------|---------|------------|---------------|-----------------|
| Recurring V-code clusters | 3+ ledger rows (current + archived) sharing `vcode` and a file/module prefix | 5–8 | 3–6 | `findings-ledger.json` (current + one archived snapshot) shows a vcode filed 5 times across three modules under a shared directory prefix, each a near-identical duplicated validation block (illustrative, invented) → gain 6, effort 4 → Priority 6 × (11 − 4) = 6 × 7 = 42 (moderate); the candidate's `rationale` is written with architectural framing ("shared helper extraction spanning 3 files") so it routes `needs_design: true` on filing. Finding location: `file: "<shared-dir-prefix>/"`, `line: 0` (shared-prefix convention, § Finding file/line convention) |
| Touch-path hotspots | Same file path touched across 3+ merged issues' PRs | 4–7 | 3–5 | `gh pr list --state merged --json number,files,mergedAt --limit 100` shows one file touched by 4 separate merged PRs over the campaign, none of whose plans anticipated the others (illustrative, invented) → gain 5, effort 3 → Priority 5 × (11 − 3) = 5 × 8 = 40 (moderate). Finding location: `file: "<hotspot-file-path>"`, `line: 0` (whole-file convention, § Finding file/line convention) |
| Review-iteration outliers | Merged PR's `gh pr view <n> --json reviews` review-submission count is materially above the campaign's typical pattern for its size label | 3–6 | 2–4 | `gh pr view <N> --json reviews` returns 5 review-submission entries for a `size:s` issue that should typically close in 1-2 rounds, indicating the underlying module's design made review unusually hard (illustrative, invented) → gain 4, effort 2 → Priority 4 × (11 − 2) = 4 × 9 = 36 (borderline). Finding location: `file: "pr:<N>"`, `line: 0` (PR-level sentinel convention, § Finding file/line convention) |
| `needs_design: true` flagging (architectural candidates) | A recurring-cluster or hotspot candidate's fix is a coupling hotspot or cross-cutting extraction, not a contained single-file fix | 6–9 | 5–8 | A god-module fan-in cluster surfaced by heuristic 1/2 spans 8 consumer files with no shared abstraction (illustrative, invented) → gain 8, effort 6 → Priority 8 × (11 − 6) = 8 × 5 = 40 (moderate); the finding's `rationale` explicitly states the architectural scope so the router's ADR-004 content-based computation sets `needs_design: true` on the filed issue, routing it into the M2 design tier rather than a normal implement-only issue. Finding location: inherits the `file`/`line` of the underlying heuristic-1/2 candidate (§ Finding file/line convention) |

`gain` and `effort` are each 1–10, matching the hunter output contract
(`worker-schemas.md` § Hunter, Finding shape). The ranges above are per-heuristic
calibration bands, not hard values — a hunter agent picks the specific score within the
listed range based on the concrete finding's actual scope (cluster size, hotspot file count,
review-round delta).

## Scoring — V-PARETO-02 SSOT

`Priority = Gain * (11 - Effort)`; a finding must score `>= 30` to be filed as an issue, and
ready issues are sorted by Priority descending (`src/references/blackhole-vcodes.md`,
`V-PARETO-02`). This is the **only** scoring formula for the `retrospective` kind — no
alternate or per-kind formula is introduced, and the blast-radius-derived `effort` semantics
and the `needs_design` rationale-framing convention above are input rules layered on top of
the one formula, not a second formula or a second gating mechanism (ADR-006 § Scoring model
verdict: "the formula is sound and stays unchanged as the single SSOT... mercure's
mechanisms as input rules under the one formula, not as parallel formulas"). Findings scoring
below 30 are archived in the ledger and never filed, per the same rule every other kind
follows.
