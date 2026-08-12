# Hunt Kind: Backlog

Scan heuristics, calibration table, and scoring rule for the `backlog` hunt kind
(`kaizen.kinds`, [config-template.md](../config-template.md)). This kind closes mercure parity
PM-089 (issue #452): unlike every other default kind, its primary territory is **open forge
issues** in campaign scope — not source files, documentation trees, or merged campaign history.
It performs backlog-hygiene triage (duplicate open-issue detection, stale-referent validation,
and low-information enrichment drafts) so Handle and router confidence gates have material to
work with before wave scheduling. Like every prior kind, this is a pure additive extension: it
reuses every existing kaizen mechanism verbatim — the `V-HUNT-01` `CONFIRMED` verification gate,
`V-PARETO-02` scoring, per-wave caps, ledger idempotency dedup, and the `hunt_state` watermark
(`territory.bands_scanned` / `bands_done`). It introduces no new scoring formula, no new ledger
field, no new finding schema, and no change to `V-HUNT-01`/`V-HUNT-02` gating logic.

**Scope filter**: only issues matching the same campaign scope as forge ingest —
`scripts/forge-scope.ts` / `issueMatchesScope` (`forge-sync.md` §1.5–2). Never scan the full
forge outside scope.

## Territory bands

Because this kind's territory is issue-number space rather than directory structure, "bands" for
`backlog` are issue-number windows over scoped open issues — e.g. `"issues 400-450"` — stored in
`hunt_state.kinds.backlog.bands_done`, the same string-array mechanic `retrospective.md` uses for
PR/issue windows. A wave scans one band: fetch every open scoped issue whose number falls in the
window, then run the heuristics below against that slice only.

## Scan heuristics

A `backlog` wave walks **open scoped issues** as primary territory. Every candidate is
read-verified before it is reported (`hunter.md` § Verification pass): `CONFIRMED` means the
duplicate pair, missing referent, or low-info body was re-checked against fresh `gh issue` output
and/or current repo Glob/Grep state — never a hunch from stale cache.

**Data sources** (read-only):

1. `gh issue list --state open $(bun scripts/forge-scope.ts list-args) --json number,title,body,labels`
2. `queue.json` for `touch_paths`, `phase`, `status` (read only — not for post-merge signals)
3. Repo Glob/Grep for stale-referent verification

### Heuristic 1 — Duplicate open issues

Flag pair `(A, B)` when **both**:

1. **Similarity rule** (stated, machine-auditable): normalized title+body token Jaccard similarity
   ≥ **0.55** (lowercase, strip markdown fences/code blocks, drop common stopwords), **and**
2. `touch_paths` intersection non-empty **or** both bodies cite a common backtick-quoted path
   prefix (longest shared path segment ≥ 3 path components).

**Verification (`V-HUNT-01`)**: re-fetch both issue bodies via `gh issue view`; recompute scores;
only `CONFIRMED` when both predicates hold on the fresh read.

**Filing**: propose consolidation via `[Kaizen]` issue (link both issues, recommend keep/close
candidate) — **never** auto-close.

**Finding location**: `file: "issue:<lower-number>"`, `line: <higher-number>` (stable pair key).

### Heuristic 2 — Stale referent

Extract backtick-quoted paths and `src/...` / `scripts/...` globs from the issue body plus any
plan path cited in the body.

- Glob each path from repo root; Grep exported symbols when the body cites `functionName` near a
  path.
- Flag when **all** cited paths are missing **or** the cited symbol is absent in the cited file.

**Verification**: re-run Glob/Grep immediately before report; mark `STALE` if the referent
reappears.

**Finding location**: `file: "<first-missing-path>"`, `line: 0`.

### Heuristic 3 — Low-information

**Trigger**: open issue in `phase: handle` (or not yet in `queue.json`) where body length
< **400** characters **and** no markdown checklist (`- [ ]`) **and** the router would flag low
`confidence.plan_mode` if routed today.

**Hunter output**: `rationale` contains a structured enrichment draft (proposed AC bullets,
suggested touch paths from body hints) — **no forge write** by the hunter.

**Orchestrator post-wave action** (not hunter Bash): after the wave's step-3 filing completes,
the orchestrator runs the enrichment pass documented in `phase-loop.md` § Kaizen hunt dispatch
step 3 — appends a `<!-- blackhole:enrichment -->` delimited comment via `gh issue comment` and
mirrors a summary into `queue.json` `issues.<n>.notes` before Handle spawns on a later turn.

**Finding location**: `file: "issue:<number>"`, `line: 0`.

## Finding file/line convention

| Heuristic | `file` | `line` | Rationale |
|-----------|--------|--------|-----------|
| Duplicate open issues | `issue:<lower-number>` (e.g. `issue:440`) | `<higher-number>` | Stable pair key — re-detecting the same duplicate yields the same `(file, line)` |
| Stale referent | First missing path cited in the issue body | `0` | Path-level gap, not a single line defect |
| Low-information | `issue:<number>` | `0` | Issue-level enrichment candidate |

This matches the sentinel precedent in `retrospective.md` § Finding file/line convention
(`pr:<n>`, prefix paths with trailing `/`, `line: 0` for non-line-shaped findings).

## Severity-term reconciliation note

Like every other hunt kind except `bug`, the hunter's output contract (`worker-schemas.md` §
Hunter, Finding shape) gives `severity` the enum `LOW | MEDIUM | HIGH | BLOCK`. This kind
**reuses that enum as-is** — no severity floor. Duplicate and stale-referent findings are typically
`MEDIUM`; low-information enrichment drafts are typically `LOW`–`MEDIUM`. All go through the
normal `Priority >= 30` gate.

## Calibration table

| Heuristic | Trigger | Gain range | Effort range | Severity range | Worked example |
|-----------|---------|------------|--------------|----------------|----------------|
| Duplicate open issues | Jaccard ≥ 0.55 on title+body **and** touch_path or path-prefix overlap | 4–7 | 2–4 | MEDIUM | Issues #441 and #443 both propose the same `scripts/forge-scope.ts` helper with 0.62 Jaccard similarity → gain 6, effort 3, severity MEDIUM → Priority 6 × (11 − 3) = 48 |
| Stale referent | All cited backtick paths missing or cited symbol absent after Glob/Grep | 3–6 | 2–4 | MEDIUM | Issue body cites `` `src/references/hunt/legacy-kind.md` `` but the file was renamed away → gain 5, effort 2, severity MEDIUM → Priority 5 × (11 − 2) = 45 |
| Low-information | `phase: handle`, body < 400 chars, no checklist, low plan_mode confidence | 3–5 | 1–3 | LOW–MEDIUM | Issue title only, 80-char body, no AC — enrichment draft proposes three AC bullets → gain 4, effort 2, severity LOW → Priority 4 × (11 − 2) = 36 |

`gain` and `effort` are each 1–10, matching the hunter output contract (`worker-schemas.md` §
Hunter, Finding shape).

## Scoring — V-PARETO-02 SSOT

`Priority = Gain * (11 - Effort)`; a finding must score `>= 30` to be filed as an issue, and
ready issues are sorted by Priority descending
([blackhole-vcodes.md](../blackhole-vcodes.md), `V-PARETO-02`). This is the **only** scoring
formula for the `backlog` kind — no alternate formula. Low-information findings that clear the
gate are enriched by the orchestrator (not filed as `[Kaizen]` duplicates) per heuristic 3;
duplicate and stale-referent findings file through the shared [filing.md](filing.md) template.
<!-- GENERATED by scripts/build.ts from src/references/hunt/backlog.md — do not hand-edit -->
