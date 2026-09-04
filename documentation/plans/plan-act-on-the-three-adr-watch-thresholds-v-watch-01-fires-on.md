---
issue: 802
rulings_checked_at: 5
ruling_conflicts: []
resume_context: design_approved
type: plan
status: current
summary: "Implementation plan executing ADR-037's disposition of the three ADR_WATCH_ITEMS trips (accept-with-expiry item 1, split item 2 into implementer-schemas.md, raise+correct item 3) in one coordinated PR"
review_trigger: "on ADR acceptance"
created: 2026-09-04
last_updated: 2026-09-04
---

# Plan - Issue #802: Act on the three ADR watch thresholds V-WATCH-01 fires on

## Objective

Execute ADR-037's Decision (already staged at
`.blackhole/staged/802/ADR-037-adr-watch-threshold-dispositions.md`, orchestrator-approved under
`autonomy.mode: full`, overriding `design-aggregate.ts`'s per-item `blocked` verdicts) in one
coordinated PR: (1) accept-with-expiry `worker-schemas.md`'s whole-file LOC watch trip, (2) split
`worker-schemas.md` § Implementer into a new `src/references/implementer-schemas.md` (mirroring
the `hook-schemas.md` #473 precedent) and update every dependent surface in lockstep, (3) raise
and correct `phase-implement.md`'s watch threshold/note. All three land together because item 1's
acceptance is explicitly conditioned on item 2's split landing in the same change, and item 2 has
4 dependent surfaces that must move atomically (ADR-037 Decision, Consequences).

**Live re-measurement performed at this plan's `plan_base_commit` (2026-09-04) found two
numeric drifts from the design note's figures, both corrected below (never hand-arithmetic,
issue #769):**

1. `worker-schemas.md` grew from 958 to **970** lines between the design note's read
   (`8ec97a23`) and this plan's baseline (`1fce3adb`) — an unrelated change (#843, ADR-036,
   Reviewer-section fields) landed in between. The file is now at **exactly 970/970 (100%)** of
   `CONTENT_GATE_BUDGETS.maxFileLoc`, not 958/970 (98.8%) as the design and the staged ADR-037
   Context/Decision text state. This does not change the chosen disposition (Accept-with-expiry,
   conditioned on item 2's split) but the ADR-007 amendment's cited figures must reflect the
   live numbers at implementation time, not the design note's stale ones (Task 8).
2. Item 3's approved figure ("raise 15→~40") does not actually close the trip it targets: the
   live-measured (and design-confirmed, unchanged) max section in `phase-implement.md` is
   **49 LOC** (`## Git operations must not depend on inherited cwd`). A threshold of 40 is
   *below* 49 and would leave the item tripping immediately after the "fix" — contradicting
   ADR-037's own claimed consequence ("closes all three trips"). The ADR's "~40" is explicitly
   approximate (tilde); Task 4 substitutes the corrected value **59** (`ceil(49 × 1.2)`, the
   exact seeding convention every other row in this codebase's threshold system already uses —
   see `facts.ts:131-144`), which both exceeds the live max and preserves the ADR's stated intent
   (recalibrate to the observed 12-49 LOC distribution, give real headroom). This is a numeric
   substitution only — the decision (Raise, not Split or Accept) is unchanged.

Both drifts are called out explicitly in each affected task's AC below rather than silently
patched, per this spawn's "Critical" re-derivation instruction.

## Touch-Paths

- `src/references/worker-schemas.md`, plus all generated dist trees per `scripts/lib/build/targets.ts`
- `src/references/implementer-schemas.md` (new file), plus all generated dist trees per `scripts/lib/build/targets.ts`
- `scripts/lib/build/facts.ts`
- `scripts/checks/inline-schema-drift.check.ts`
- `scripts/verify.content-gates.test.ts`
- `src/agents/implementer.md`, plus all generated dist trees per `scripts/lib/build/targets.ts`
- `documentation/decisions/ADR-007-drift-proof-toolchain-reseating.md`
- `documentation/decisions/ADR-021-durable-artifact-staging.md`

## Documentation Impact

`documentation/decisions/ADR-007-drift-proof-toolchain-reseating.md` and
`documentation/decisions/ADR-021-durable-artifact-staging.md` each gain a dated
`## Post-acceptance amendments` bullet (Tasks 8-9) — updates to existing docs, not new files, so
no search-before-write gate applies. `documentation/decisions/ADR-037-adr-watch-threshold-dispositions.md`
and its `documentation/decisions/INDEX.md` row are **already staged** by this planner spawn's
prior work (per `.blackhole/staged/802/manifest.json`) and are carried by `implementer`'s
existing ADR-021 D2 carry-step — not re-staged or re-authored here. This plan's own durable copy
is staged separately per § Durable plan staging below (ADR-021 D3).

## Critical Files

None — this is an internal documentation-schema/build-constant change with no database, auth, or
other pre-existing security-critical touchpoint in scope.

## Codebase Conventions

Sourced from `.blackhole/plans/issue-802-analysis.md`'s Conventions Catalog (investigator
`analyze` sub-mode) — not independently re-discovered:

| Convention | Where established | Applies to |
|---|---|---|
| Section-line-count measurement | `parseSectionLineCounts` (`scripts/checks/content-gates.check.ts`), reused verbatim by `adr-watch.check.ts` — never re-implement (V-INT-02) | Tasks 4, 5, 9 (live re-measurement) |
| File-split extraction shape | `hook-schemas.md`'s own extraction from `worker-schemas.md` (issue #473): new file gets an H1 title + short intro paragraph citing the split issue, then the moved `## `-level section(s) verbatim; the origin file gains a short cross-reference pointer near its own intro (see `worker-schemas.md:5,13-14`'s existing hook-schemas.md pointer) | Task 2 |
| `CONTENT_GATE_BUDGETS` seeding | *current measured value × 1.2, rounded up* (`facts.ts:131-144` comment; `hook-schemas.md`'s own row: 139→167, 84→101) — never hand-pick a round number | Task 4 |
| ADR amendment citation format | ADR-007's own `## Post-acceptance amendments` bullet shape: `**YYYY-MM-DD — <title> (#<issue>, recording #<source>).** <prose>` (analysis note's #712 precedent, confirmed as the format to follow — not ADR-021's own `### A1`-`### A4` critique-subsection shape, which records a different provenance) | Tasks 8, 9 |
| Facts-literal re-derivation | Never freeze a `facts.ts` §-facts value at plan time as a literal number pair (issue #769); state the AC as a live re-derivation instruction | Tasks 4 (all three items), 8 |

## Database/API Schema Changes

N/A — no database or public API schema changes. This touches internal documentation-schema
reference files (`worker-schemas.md`/`implementer-schemas.md`, which document the worker JSON
*return* contract, unchanged in shape by this split) and build-time constants only.

## Dependency Blast-Radius

Item 2's split changes an interface (which file documents the Implementer role contract) with 5
affected consumers — crosses the 3-consumer threshold (`V-SCOPE-03`). Items 1 and 3 touch no code
interface beyond a single constant/note edit each, contributing no rows.

| Consumer | Classification | Note |
|---|---|---|
| `scripts/verify.content-gates.test.ts` (`'covers exactly the 11 declared keys'`) | **BREAKING** | Hardcodes an exact-11-key array for `CONTENT_GATE_BUDGETS`; adding a 12th key without updating this test fails it outright (Task 3 flips it red first, Task 4 makes it green) |
| `scripts/checks/inline-schema-drift.check.ts` (`EXCLUDED_REFERENCE_FILES`) | **BREAKING** | Exclusion set is keyed by bare filename; the extracted section carries literal `"status": "<value>"` JSON skeletons this check scans for — moving them to a new, un-excluded file risks a false-positive `V-BRIEF-02` finding (Task 5) |
| `scripts/lib/build/facts.ts` (`ADR_WATCH_ITEMS` item 2) | DEPRECATION | Post-split, the max section in `worker-schemas.md` is no longer Implementer; re-pointed to `implementer-schemas.md` (same 80-LOC threshold, unchanged — Task 4) rather than silently drifting like item 3's own documented failure mode |
| `scripts/lib/build/facts.ts` (`CONTENT_GATE_BUDGETS['src/references/worker-schemas.md']`) | DEPRECATION | `maxSectionLoc: 179` stays technically passing post-split but no longer reflects the real remaining max section — re-measured and tightened, plus a new row added for the extracted file (Task 4) |
| `src/agents/implementer.md:535,645,686,689` (prose citations `"worker-schemas.md § Implementer"`) | DEPRECATION | Stale prose pointer once the section moves; non-functional but corrected for accuracy (Task 6) |
| `scripts/checks/plan-quality-gate.check.ts:155` (reads `worker-schemas.md` content) | TRANSPARENT | The Planner markers it checks for live in the Planner section, not Implementer — confirmed unaffected by the split; not listed as a Touch-Path |

## Execution Strategy & Stop Conditions

- If, after Task 2's extraction, `worker-schemas.md`'s live-measured whole-file LOC still exceeds
  `CONTENT_GATE_BUDGETS.maxFileLoc` for that file (i.e. the split did not actually relieve the
  hard-gate proximity item 1's Accept-with-expiry is conditioned on), halt before Task 8 and
  re-open the item-1 disposition rather than writing an amendment whose stated rationale is false.
- If the corrected item-3 threshold (Task 4) does not exceed the live-measured max `section_loc`
  in `phase-implement.md` at implementation time, abort Task 4's item-3 edit and recompute —
  never land a "fix" that leaves the trip active.
- If `bun test scripts/verify.content-gates.test.ts` still fails after Task 4 lands, stop and
  re-derive the exact `Object.keys(CONTENT_GATE_BUDGETS)` list live rather than hand-editing the
  expected array a second time.
- If any of the 4 corrected `implementer.md` citation lines (Task 6) leaves a dangling reference
  to a section no longer present in `worker-schemas.md`, revert Task 6 and fix before proceeding
  to Task 7.
- If Task 9's full verify run reports any new CRITICAL or HIGH-severity finding not already
  disclosed in this plan's Dependency Blast-Radius table, stop and escalate rather than merging.

## Task Breakdown

- [ ] **TDD Baseline Verification**: Run `bun run verify` and `bun test` at `plan_base_commit`
  (`1fce3adb`) to confirm the pre-change baseline is green. — **AC**: both commands exit 0; pass
  counts quoted verbatim in the completion evidence.
- [ ] **Extract `worker-schemas.md` § Implementer → `src/references/implementer-schemas.md`**
  (item 2 split, mirrors `hook-schemas.md` #473 exactly): create the new file with an H1 title,
  a short intro paragraph citing "Split out of `worker-schemas.md` (issue #802) to restore
  `worker-schemas.md`'s file-LOC headroom", then the moved `## Implementer (`implementer`)`
  section verbatim (unchanged content — the JSON contract shape does not change). Remove that
  section from `worker-schemas.md` and add a short cross-reference line near its own intro
  (mirroring the existing `hook-schemas.md` pointer at lines 5/13-14). — **AC**: `grep -c "^## "
  src/references/implementer-schemas.md` shows the moved section present; `grep -c "^## Implementer"
  src/references/worker-schemas.md` returns 0; `grep -q "implementer-schemas.md"
  src/references/worker-schemas.md` passes.
- [ ] **Flip `verify.content-gates.test.ts` red**: update the `'covers exactly the 11 declared
  keys'` test to expect the live `Object.keys(CONTENT_GATE_BUDGETS).length + 1` keys (12 today),
  adding `'src/references/implementer-schemas.md'` to the expected array — before `facts.ts` is
  updated, so this fails for the right reason. — **AC**: `bun test
  scripts/verify.content-gates.test.ts -t "covers exactly"` fails, citing the missing new key.
- [ ] **Update `scripts/lib/build/facts.ts`** (makes the above test green; three sub-edits, one
  change): (a) add a `CONTENT_GATE_BUDGETS` row for `src/references/implementer-schemas.md`,
  seeded at the file's own live-measured `{maxSectionLoc, maxFileLoc}` × 1.2 rounded up (same
  convention as every existing row — re-derive live, do not copy a number from this plan); (b)
  re-measure `worker-schemas.md`'s post-split `{maxSectionLoc, maxFileLoc}` live and tighten its
  `CONTENT_GATE_BUDGETS` row to `ceil(measured × 1.2)` for both fields; (c) re-point
  `ADR_WATCH_ITEMS` item 2's `file` field from `src/references/worker-schemas.md` to
  `src/references/implementer-schemas.md`, keeping `metric: 'section_loc'` and `threshold: 80`
  unchanged (the ADR-007 rejected-alternatives per-role-section number is untouched by *where*
  the role contract lives); (d) update `ADR_WATCH_ITEMS` item 3's `threshold` to **59**
  (`ceil(49 × 1.2)` — see this plan's Objective note on why the ADR's approximate "~40" would not
  close the trip) and rewrite its `note` field to describe `measureAdrWatchItem`'s actual
  whole-file-max-`##`-section semantics, dropping the reference to the specific
  `"## Worker prompt must include"` section it no longer targets. — **AC**: `bun test
  scripts/verify.content-gates.test.ts` passes; `bun run scripts/checks/adr-watch.check.ts`'s
  `V-WATCH-01` detail string no longer names `phase-implement.md`; it may still name
  `implementer-schemas.md` (expected — advisory, unchanged content just relocated, not a
  regression).
- [ ] **Update `inline-schema-drift.check.ts`**: add `'implementer-schemas.md'` to
  `EXCLUDED_REFERENCE_FILES`. — **AC**: `bun test scripts/validate-worker-json.test.ts` (or the
  relevant inline-schema-drift fixture test) reports zero new `V-BRIEF-02` findings for the
  extracted file's JSON skeletons.
- [ ] **Correct `src/agents/implementer.md`'s 4 stale citations** (lines 535, 645, 686, 689 as
  re-verified this session — unchanged from the design note's read): replace
  `` `worker-schemas.md` § Implementer `` with `` `implementer-schemas.md` `` at each site. —
  **AC**: `grep -c "worker-schemas.md § Implementer" src/agents/implementer.md` returns 0;
  `grep -c "implementer-schemas.md" src/agents/implementer.md` returns 4.
- [ ] **Add ADR-007 `## Post-acceptance amendments` bullets for items 1 and 2**: use the design
  note's (`.blackhole/plans/issue-802-design.md` §8) drafted bullet text as the template for
  framing, decision content, citations, and expiry condition verbatim — but re-derive every
  cited LOC/percentage figure live at implementation-commit time rather than copying the design
  note's stale numbers (958/98.8%/≈779 — this plan's baseline already measured 970/100%; the
  post-Task-2 figure must be freshly measured, not assumed). Item 2's bullet (the split itself,
  disclosed per this issue's own R-19 discipline) needs no numeric substitution. — **AC**: the
  new bullets appear after the existing 2026-09-02 entry in ADR-007's `## Post-acceptance
  amendments` section; `grep -q "#802" documentation/decisions/ADR-007-drift-proof-toolchain-reseating.md`
  passes (`V-ADR-06` citation requirement); no cited LOC/percentage figure in the new text
  contradicts a live re-measurement at merge time.
- [ ] **Add ADR-021 `## Post-acceptance amendments` bullet for item 3**: append after the
  existing `### A4` subsection and before `## References`, in ADR-007's bullet format (per the
  analysis note's #712 precedent), recording the threshold recalibration (15→59, not "~40" — see
  this plan's Objective note) and the note correction. — **AC**: `grep -q "#802"
  documentation/decisions/ADR-021-durable-artifact-staging.md` passes; a diff of the file shows
  only an appended bullet, with `### A1`-`### A4` untouched.
- [ ] **Verify Integrity**: run `bun run verify` and the full `bun test` suite. — **AC**: full
  suite green, `bun run verify` reports zero new CRITICAL/HIGH findings beyond what this plan's
  Dependency Blast-Radius table already discloses; `V-WATCH-01`'s detail string names at most
  `implementer-schemas.md` (item 2, expected/advisory) and never `worker-schemas.md` or
  `phase-implement.md`; pass/fail counts quoted verbatim in the completion evidence.

## Sprint Contract

Per-task `— **AC**:` markers above are the closure gate for every task; there is no task in this
plan without a narrower AC, so the blanket "all tests and linters pass" phrasing is not needed as
a fallback.

## Quality Gate Results

| Check | Result |
|---|---|
| `touch_paths_declared` | PASS |
| `schema_baseline` | PASS — no DB/API schema in scope |
| `ac_mapping` | PASS |
| `critical_files_exist` | PASS |
| `mitigation_concrete` | PASS |
| `ac_sweep_conflict` | PASS — no sweep-to-zero ACs in this plan |
| `ac_sweep_scope` | PASS — no sweep-to-zero ACs in this plan |
| `touch_paths_ssot_gap` | PASS |
| `ac_facts_literal_bump` | ADVISORY — Task 4(d) and the ADR-021 amendment task state the item-3
  threshold as a specific number (59) rather than a pure re-derivation instruction, because it is
  an approved policy threshold (not a repo-measured count) that this plan corrected from the
  ADR's own approximate figure; the underlying measurement it is calibrated against (`phase-implement.md`'s
  live max section LOC) is still required to be re-verified live per Task 4(d)'s AC and the Stop
  Conditions above, not hand-arithmetic'd a second time |

## References

- `.blackhole/plans/issue-802-analysis.md` — investigator `analyze` sub-mode evidence
- `.blackhole/plans/issue-802-design.md` — Design Track note, all 8 subsections, especially §8
- `.blackhole/staged/802/ADR-037-adr-watch-threshold-dispositions.md` — approved decision this
  plan executes (already staged, not modified by this plan)
- `documentation/decisions/ADR-007-drift-proof-toolchain-reseating.md`,
  `documentation/decisions/ADR-021-durable-artifact-staging.md` — amendment targets
