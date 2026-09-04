---
type: plan
summary: "Declares ADR_SHAPES (classic-5 / design-track-8) and checks tracked ADR headings against either"
status: current
review_trigger: "on ADR acceptance"
created: 2026-09-02
last_updated: 2026-09-02
---


# Plan - Issue #711

## Objective
Declare `ADR_SHAPES` (`classic` 5-heading / `designTrack` 8-heading) once in
`scripts/lib/build/facts.ts`, have `design-track.check.ts` import the `designTrack` list instead
of restating it, add a new heading-shape check over the 28 tracked ADRs, document both shapes in
`src/references/adr-template.md`, and cite the fact by name in `planner.md`'s Design Track Gate
subsection. Part of #703, item R-08 of
`documentation/plans/plan-retrospective-v0.21.0-remediation.md`.

## Touch-Paths
- `scripts/lib/build/facts.ts` — new `ADR_SHAPES` export
- `scripts/checks/design-track.check.ts` — `DESIGN_TRACK_REQUIRED_HEADINGS` now aliases
  `ADR_SHAPES.designTrack` instead of a local literal
- `scripts/checks/adr-shape.check.ts` — **new file** (not `adr-status.check.ts` — see Codebase
  Conventions / Execution Strategy for why)
- `scripts/verify.adr-shape.test.ts` — **new file**, pairs with the above per Ground rule #2
- `src/references/adr-template.md` — documents both shapes, cites `ADR_SHAPES` by name
- `src/agents/planner.md` — Design Track Gate item cites `ADR_SHAPES` by name
- `src/references/blackhole-vcodes.md` — new `V-ADR-0N` row
- plus all generated dist trees per `scripts/lib/build/targets.ts` for every `src/**` file above

**Deliberate deviation from the queue's touch-path hint**: the hint listed
`scripts/checks/adr-status.check.ts` and `scripts/verify.adr-status.test.ts`. Neither is touched
by this plan — see Codebase Conventions.

## [If docs_governance.enabled] Documentation Impact
- `documentation/decisions/INDEX.md`: not touched — this issue adds a *check*, not an ADR.
- `documentation/plans/plan-retrospective-v0.21.0-remediation.md`'s R-08 checkbox: left to the
  epic (#703) owner, not this PR's Touch-Paths.
- `src/references/adr-template.md` and `src/agents/planner.md` are themselves the doc updates the
  AC asks for — covered under Touch-Paths, not restated here.
- No other companion/consumer doc is affected: `None — this PR touches only build/check tooling
  and two doc files already in scope.`

## [Standard Only] Critical Files
None — this PR touches no auth, database, or secrets touchpoint. All Touch-Paths are build
tooling, checks, and reference docs.

## [Standard Only] Codebase Conventions
- **New-file-per-domain-check** (Ground rule #2, `plan-retrospective-v0.21.0-remediation.md` §
  Ground rules): "New checks go in a new `scripts/checks/<domain>.check.ts` with a `runChecks()`
  export; `verify.ts` auto-discovers it." `scripts/checks/adr-status.check.ts` is currently
  **217/218 LOC** against its `scripts/checks/*.check.ts` glob budget (`facts.ts`
  `CONTENT_GATE_BUDGETS`, `maxSectionLoc: 68` / `maxFileLoc: 218`) — 1 line of headroom, not
  enough to add a new check function. Extraction of an already-full sibling file is out of this
  issue's scope (that's R-02/R-15's job per Ground rule #4). So the new check goes in
  `scripts/checks/adr-shape.check.ts`, a fresh domain file, auto-discovered by `verify.ts`'s glob
  (`scripts/verify.ts`'s own header comment confirms this — no registration needed elsewhere).
  `design-track.check.ts` (76 LOC) has ample headroom for the one-line import swap.
- **Pure-function-plus-thin-checker split**: follow `adr-status.check.ts` and
  `design-track.check.ts`'s shape exactly — pure functions (`extractAdrHeadings`,
  `classifyAdrShape`, `findMalformedAdrShapes`) unit-tested directly with literal string
  fixtures (no `fs`/tmpdir), a thin `checkAdrShapeConformance(): CheckResult` that does the file
  I/O and is not itself unit-tested, and a `runChecks(): CheckResult[]` domain entrypoint.
- **Advisory (`ok: true` always) pattern**: `scripts/checks/doc-health.check.ts` (`V-DOCHEALTH-03`)
  and `content-gates.check.ts` (`V-CONTENTGATE-02`) already establish this shape in this codebase
  for a check whose findings should surface without blocking `bun run verify`. This issue's new
  check reuses it — see Execution Strategy for why the shape check must be advisory, not blocking.
- **SSOT declaration comment**: `facts.ts`'s existing `§ facts` header comment convention
  ("declared exactly once... never restate... never collapse the scan and the declaration onto
  one path") — `ADR_SHAPES` gets the same one-paragraph doc comment shape as `DOC_HEALTH_THRESHOLDS`
  immediately above it in the file.
- **Heading-presence idiom**: reuse `design-track.check.ts`'s existing
  `content.includes(heading)` verbatim-substring check for a shape's required headings — do not
  invent a second markdown-heading-matching mechanism (`V-INT-02`).

## [Standard Only] Database/API Schema Changes
No database schema change. One new exported fact (`ADR_SHAPES: { classic: string[], designTrack:
string[] }` in `facts.ts`) and one new V-code row (`V-ADR-0N`, number resolved at implement time —
see Execution Strategy). No `queue.json`/`findings-ledger.json` shape change; findings from the
new check use the existing `CheckResult { id, ok, detail? }` wire type unchanged.

## [Standard Only] Execution Strategy & Stop Conditions

1. **`adr-status.check.ts` LOC guard.** Do not add any line to
   `scripts/checks/adr-status.check.ts` in this PR. If a diff to that file appears necessary,
   stop — re-verify against Codebase Conventions above; the new check belongs in
   `adr-shape.check.ts`, full stop.

2. **`planner.md` section-LOC guard (V-BUILD-01, Ground rule #4).** The `## Plan Complexity
   Tracks & Sections` section is measured at **exactly 350/350 LOC** at this plan's base commit
   (verify with `awk '/^## /{if(n){print NR-s,n};n=$0;s=NR}END{print NR-s+1,n}'
   src/agents/planner.md | grep 'Plan Complexity'` — must print `350`). Any net-positive edit to
   that section overflows `V-CONTENTGATE-01` and fails `bun run verify`. Before committing:
   confirm the same `awk` command still prints `≤350` for that section. If citing `ADR_SHAPES` by
   name adds net lines, trim an equal or greater number of lines elsewhere in the same section
   (tighten existing prose) — never raise `CONTENT_GATE_BUDGETS` to make it fit. If no net-zero
   edit is possible without deleting substantive content, stop and escalate rather than raising
   the budget.

3. **`V-ADR-0N` number collision guard.** `scripts/checks/adr-status.check.ts` already emits
   `V-ADR-01`..`V-ADR-05` (04/05 have no `blackhole-vcodes.md` row yet — filed as #731); issue
   #712 (R-09, in flight) claims `V-ADR-06`. Before writing the new check's id, run:
   `grep -rn "V-ADR-0[6-9]" src/references/blackhole-vcodes.md scripts/checks/*.check.ts` — use
   the lowest integer not already present in either the table or any `runChecks()` emission. If
   `V-ADR-06` is unclaimed at implement time (i.e. #712 has not yet landed), do **not** race it —
   use `V-ADR-07` regardless, so this PR never collides with #712's claim whichever lands first.

4. **`VCODE_TABLE_ROW_COUNT` sync.** After adding the new row to
   `src/references/blackhole-vcodes.md`, bump `VCODE_TABLE_ROW_COUNT` in `facts.ts` from `89` to
   `90` in the same commit. If `bun run verify` reports a `V-GROUND-01` row-count mismatch, this
   step was skipped — fix it before proceeding, never adjust the count without a matching row add.

5. **`EXPECTED_CHECK_COUNT` (conditional).** No `EXPECTED_CHECK_COUNT` export exists anywhere in
   the repo at this plan's base commit (`grep -rn EXPECTED_CHECK_COUNT scripts/ src/` returns
   nothing) — the ground rule #2 obligation to bump it is currently **N/A**. If issue #704
   reintroduces this constant before this PR merges, rebase onto that change first, then bump it
   by 1 for the new `adr-shape.check.ts` file.

6. **Shape-check severity: advisory, not blocking — grandfathering the corpus is out of scope.**
   Measured directly against the live tree: of the 28 tracked ADRs, only 5
   (`ADR-017`, `018`, `019`, `020`, `025`) match `ADR_SHAPES.designTrack` exactly (case-sensitive
   heading text); **zero** match `ADR_SHAPES.classic` exactly — the closest files
   (`ADR-002`, `008`, `011`, `016`, `022`–`024`, `026`–`028`) use `## Alternatives considered`
   (lowercase "c") instead of the template's `## Alternatives Considered`, and/or omit `## Status`
   entirely. If `checkAdrShapeConformance` returns `ok: false` for any malformed file, `bun run
   verify` fails immediately for ~23 of 28 pre-existing ADRs with no code change of their own —
   unacceptable for a "quick"-shaped check addition. Per Codebase Conventions, the check is
   **advisory** (`ok: true` always; malformed filenames listed in `detail`), matching the
   `V-DOCHEALTH-03`/`V-CONTENTGATE-02` precedent. This is flagged as
   `[NEEDS CLARIFICATION: should ADR shape conformance ever BLOCK, or stay advisory forever? A
   blocking version needs either a frozen legacy-exempt filename list in facts.ts (declared
   alongside ADR_SHAPES) or a separate backfill initiative to bring the 23 non-conforming ADRs
   into shape first — both are materially larger than this issue's scope; proceeding with
   advisory-only pending owner confirmation.]` in Task Breakdown item 5 below.

7. **Build regeneration order (V-BUILD-01).** Failing tests first
   (`scripts/verify.adr-shape.test.ts` red, then green), then `bun run build`, then commit
   source + regenerated dist trees together, then `bun run verify`. Never commit `src/**` changes
   without their regenerated dist trees in the same commit.

## Task Breakdown
- [ ] **TDD Baseline Verification**: Run the project's test suite first to verify all existing
  tests pass before modifying any codebase files. — **AC**: baseline suite run, pass/fail counts
  quoted in the completion evidence (`bun test scripts/verify.adr-status.test.ts
  scripts/verify.design-track.test.ts` and a scoped `bun run scripts/verify.ts` pass at HEAD
  before any edit).
- [ ] **Write Failing Tests**: Author `scripts/verify.adr-shape.test.ts` covering
  `extractAdrHeadings`, `classifyAdrShape` (one fixture per shape: classic, designTrack, and one
  malformed ADR matching neither), and `findMalformedAdrShapes`, plus a test asserting
  `DESIGN_TRACK_REQUIRED_HEADINGS` (re-exported from `design-track.check.ts`) still equals the 8
  headings verbatim. (`V-TEST-01/02`) — **AC**: `bun test scripts/verify.adr-shape.test.ts` fails
  (module/export not found) before implementation lands.
- [ ] **Declare `ADR_SHAPES` in `facts.ts`**: add the `classic` (5-heading, verbatim from
  `adr-template.md`) and `designTrack` (8-heading, verbatim from `design-track.check.ts`'s
  current `DESIGN_TRACK_REQUIRED_HEADINGS`) arrays, each `## `-prefixed exact heading strings, with
  a one-paragraph SSOT doc comment matching `DOC_HEALTH_THRESHOLDS`'s style. — **AC**: `bun test
  scripts/verify.adr-shape.test.ts -t "ADR_SHAPES"` passes; `wc -l scripts/lib/build/facts.ts`
  stays ≤ 287 (glob budget headroom check).
- [ ] **`design-track.check.ts` imports the shared list**: replace the local
  `DESIGN_TRACK_REQUIRED_HEADINGS` array literal with `export const DESIGN_TRACK_REQUIRED_HEADINGS
  = ADR_SHAPES.designTrack;`, importing `ADR_SHAPES` from `../lib/build/facts.ts`. — **AC**: `bun
  test scripts/verify.design-track.test.ts` passes unchanged (no test-file edit needed — same
  exported symbol, same value); `grep -c "'## Requirements Framing'" scripts/checks/design-track.check.ts`
  returns `0` (no more local literal).
- [ ] **New `scripts/checks/adr-shape.check.ts`**: `extractAdrHeadings(content)`,
  `classifyAdrShape(headings): 'classic' | 'designTrack' | null` (a shape matches when every one
  of its required headings is present verbatim — extra headings are allowed), `
  findMalformedAdrShapes(files)`, and `checkAdrShapeConformance(): CheckResult` (id `V-ADR-0N`,
  **`ok: true` always** — advisory; malformed filenames + which-shape-came-closest in `detail`)
  reading every file in `documentation/decisions/ADR-*.md`. Export `runChecks()`.
  `[NEEDS CLARIFICATION: advisory vs. blocking severity — see Execution Strategy item 6.]`
  — **AC**: `bun test scripts/verify.adr-shape.test.ts` passes (classic fixture classifies
  `'classic'`, designTrack fixture classifies `'designTrack'`, malformed fixture classifies
  `null`); running the file's `runChecks()` against the live `documentation/decisions/` tree
  returns `ok: true` for the sole `V-ADR-0N` result with all ~23 non-conforming filenames named in
  `detail`.
- [ ] **`adr-template.md` documents both shapes**: add a section naming `ADR_SHAPES.classic` and
  `ADR_SHAPES.designTrack` by name (citing `facts.ts`), stating when each applies (`classic` for a
  narrative decision record; `designTrack` for a plan-track-gated design note per `planner.md`
  §4.8) — **AC**: `grep -c "ADR_SHAPES" src/references/adr-template.md` returns `≥1`; both shape
  names (`classic`, `designTrack`) appear in the file.
- [ ] **`planner.md` Gate item cites `ADR_SHAPES` by name**: extend the existing sentence "Staged
  ADR bodies must follow `src/references/adr-template.md` (`##` missing = blocked)" in the Design
  Track's Gate subsection to name `ADR_SHAPES` (from `facts.ts`) as the declared source of the
  required heading set. — **AC**: `grep -c "ADR_SHAPES" src/agents/planner.md` returns `≥1`; the
  `## Plan Complexity Tracks & Sections` section LOC (per Execution Strategy item 2's `awk`
  command) is `≤350` after the edit.
- [ ] **New `V-ADR-0N` row**: add one row to `src/references/blackhole-vcodes.md`'s table (WARN
  severity, matching the sibling `V-ADR-01..03` rows' severity, citing
  `scripts/checks/adr-shape.check.ts` as Primary enforcement site), number resolved per Execution
  Strategy item 3; bump `VCODE_TABLE_ROW_COUNT` in `facts.ts` from `89` to `90`. — **AC**: `grep -E
  "^\| V-" src/references/blackhole-vcodes.md | wc -l` equals the new `VCODE_TABLE_ROW_COUNT`
  value; `bun test` (or a scoped `bun run scripts/verify.ts`) shows `V-GROUND-01` passing.
- [ ] **`bun run build`, commit source + dist together**: regenerate the mirrored trees for every
  `src/**` file touched above, per `scripts/lib/build/targets.ts`. — **AC**: `git status --short`
  shows changes under `.claude/`, `.cursor/`, `skills/`, `codex-*`, `.agents/build/` matching each
  touched `src/**` file, all committed in the same commit as their source.
- [ ] **Verify Integrity**: run the full check suite. — **AC**: `bun run scripts/verify.ts` (or
  `bun run verify`) exits `0`; `bun test scripts/verify.adr-shape.test.ts
  scripts/verify.design-track.test.ts scripts/verify.adr-status.test.ts` all pass — the latter
  unchanged, confirming this PR did not disturb `adr-status.check.ts`.

## Sprint Contract
Definition of done for every task above is its own `— **AC**:` line — all ten are
machine-verifiable via the quoted commands. No task in this plan falls back to the blanket "all
tests and linters pass" phrasing; the final "Verify Integrity" task is the aggregate gate, not a
substitute for the per-task ACs above it.

## [Standard Only] Quality Gate Results
| Check | Result |
|---|---|
| `touch_paths_declared` | PASS |
| `schema_baseline` | PASS |
| `ac_mapping` | PASS |
| `critical_files_exist` | PASS — no `## Critical Files` entries to Glob (section explicitly empty) |
| `mitigation_concrete` | PASS — every Execution Strategy bullet pairs a condition with a concrete stop/abort action, no bare "monitor"/"be careful" |
| `ac_sweep_conflict` | PASS — no sweep-to-zero AC in this plan |
| `ac_sweep_scope` | PASS — no sweep-to-zero AC in this plan |
| `touch_paths_ssot_gap` | PASS — Touch-Paths and Task Breakdown reference the same file set |
