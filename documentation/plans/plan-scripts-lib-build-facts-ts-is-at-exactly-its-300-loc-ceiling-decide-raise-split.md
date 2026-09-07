---
issue: #952
rulings_checked_at: 5
ruling_conflicts: []
type: plan
status: current
summary: "Implementation plan retiring scripts/lib/build/facts.ts's stale ADR-007-cited grandfather entry: confirms ADR-007 is fully implemented, then splits its self-contained CONTENT_GATE_* config into a new content-gate-facts.ts module (2 consumers only) rather than raising the ceiling or leaving the misattributed citation in place"
review_trigger: "on file change"
created: 2026-09-07
last_updated: 2026-09-07
---

# Plan - Issue #952: `scripts/lib/build/facts.ts` at its 300-LOC ceiling — raise, split, or retire

## Objective

**ADR-007 completeness check (required before any change, per this issue's own first AC):**
ADR-007 is **fully implemented**. Its frontmatter/`documentation/decisions/INDEX.md` row both
carry `status: accepted`, and commit `d52aaf8d` ("ADR-007 Accepted — all 6 implementation tasks
merged (PRs #254-#259)", 2026-07-11) is direct historical confirmation. Live-verified this
session: `scripts/lib/fs.ts` (R6) exists; `scripts/checks/links.check.ts` (R7) exists;
`scripts/checks/ground-truth.check.ts` (R1′ facts-conformance) exists and `ground-truth.md`
itself no longer exists anywhere in the tree (its counter role was fully retired, not merely
slimmed); `scripts/verify.ts` (R2′) is a 63-line thin runner that glob-discovers
`scripts/checks/*.check.ts`, exactly the shape the ADR specifies; R5′ (tracked⇒built-by-default)
is live (`--gemini`/`--all`/`--no-codex` print deprecation no-op warnings, confirmed via
`scripts/build.test.ts`'s own fixtures); R3′ was later reversed by #408/#712, itself disclosed as
a `## Post-acceptance amendments` entry on the ADR (2026-09-02).

**What ADR-007's completeness implies for the `facts.ts` grandfather entry — and why it is
*not* a "quick retire":** the router's decision tree framed "ADR-007 complete → retire entry
(quick)". That framing does not survive contact with the actual mechanics. Retiring the
`CONTENT_GATE_GRANDFATHERED` row for `scripts/lib/build/facts.ts` — `{ ceiling: { maxSectionLoc:
68, maxFileLoc: 300 }, sunset_adr: 'ADR-007' }` — falls the file back to its glob class's plain
ceiling (`scripts/lib/build/*.ts`: `maxFileLoc: 287`). `facts.ts` is 300 lines today, so a bare
row deletion trips `V-CONTENTGATE-01` immediately — the exact same 300-vs-287 gap the entry
exists to paper over. Worse: the entry's own inline comment already disclosed that its ceiling
is **not actually governed by ADR-007 at all** — it is "pinned to `build.test.ts`'s
`MAX_BUILD_MODULE_LOC`" (=300), an entirely independent SRP gate from **issue #363**, unrelated
to ADR-007's blueprint-v2 toolchain work. So `sunset_adr: 'ADR-007'` on this one row was a
**misattribution from the start** — ADR-007 finishing was never what would retire it; issue #363
still exists, unresolved, and would still hold `facts.ts` to ≤300 LOC even with the grandfather
row gone. Confirmed via `git log --follow`: `facts.ts` grew from 245→300 LOC across just the last
9 commits (2026-09-04 to 2026-09-06, ~3 days) — the pressure is real, structural, and ongoing,
exactly as the issue describes, and unrelated to ADR-007.

**Decision: Option 2 (targeted split), not Option 1 (raise) or a bare Option 3 (retire).** The
issue frames splitting as "more work" with "an import surface many modules depend on" — true of
`facts.ts` as a whole (14 consumer files across `scripts/`), but the `CONTENT_GATE_*` block
specifically (`CONTENT_GATE_BUDGETS`, `CONTENT_GATE_BOUNDARY_UNITS`, `CONTENT_GATE_GRANDFATHERED`,
`CONTENT_GATE_WARN_RATIO`, plus their two exported types) is a self-contained sub-concern —
"CONTENT_GATE_* config arguably does not belong in the same file it constrains", as the issue
itself notes — with **exactly 2 consumers repo-wide** (`scripts/checks/content-gates.check.ts`,
`scripts/verify.content-gates.test.ts`; confirmed via `grep -rln` across `scripts/`). Extracting
that ~92-line block into a new `scripts/lib/build/content-gate-facts.ts` drops `facts.ts` to
well under its 287-LOC class ceiling, at which point it needs **no grandfather entry at all** —
the row is deleted outright rather than re-cited to a different (nonexistent) ADR. This
simultaneously satisfies the issue's Option 3 intent (retirement) without the immediate
gate-trip a bare deletion would cause, is far cheaper than a whole-file `facts.ts` split (Option
2 read literally), and needs no ceiling raise (Option 1) — so no "current + a little" number to
defend. Zero behavior change: every exported constant/type keeps its name and value; only its
module address moves. A comment re-wrap is not used anywhere in this resolution.

## Touch-Paths
- `scripts/lib/build/facts.ts` — remove the `CONTENT_GATE_*` declaration block (moved out) and
  its own now-obsolete `CONTENT_GATE_GRANDFATHERED` self-row; trim the top-of-file "Direct
  consumers" comment (drop `content-gates` — no longer a direct consumer)
- `scripts/lib/build/content-gate-facts.ts` — **new file**; receives the moved block verbatim
  (minus the `facts.ts` grandfather row)
- `scripts/checks/content-gates.check.ts` — retarget its 2 `from '../lib/build/facts.ts'` import
  lines to `'../lib/build/content-gate-facts.ts'`
- `scripts/verify.content-gates.test.ts` — retarget its `from './lib/build/facts.ts'` import
  block (the `CONTENT_GATE_*` symbols only) to `'./lib/build/content-gate-facts.ts'`; add the new
  failing-then-passing test (Task 2/3)
- `documentation/decisions/ADR-007-drift-proof-toolchain-reseating.md` — append a 5th
  `## Post-acceptance amendments` bullet recording this disposition
- `src/references/plan-template.md` — fix the now-stale facts.ts-only citation of
  `CONTENT_GATE_BUDGETS`, plus all generated dist trees per `scripts/lib/build/targets.ts`

## Documentation Impact
- `documentation/decisions/ADR-007-drift-proof-toolchain-reseating.md` — amended in place (Task
  4); existing file, no search-before-write needed.
- `src/references/plan-template.md` — amended in place (Task 5); existing file, no
  search-before-write needed. Its compiled dist copies (e.g.
  `.claude/skills/blackhole/references/plan-template.md`) regenerate via `bun run build`.
- No other companion doc (`ARCHITECTURE.md`, `DESIGN.md`, `AGENTS.md`,
  `documentation/decisions/INDEX.md`) is affected: ADR-007's `status` and INDEX row are unchanged
  (still `accepted`); this is an amendment, not a reversal or a new decision, so it needs no new
  ADR and no INDEX row.

## Critical Files
- `scripts/lib/build/facts.ts`
- `scripts/checks/content-gates.check.ts`

## Codebase Conventions

| Convention | Where established | Applies to |
|---|---|---|
| Content-gate SSOT split shape | `hook-schemas.md`/`implementer-schemas.md` extraction precedent (issue #473, #802): new file gets a short header comment naming the split rationale and citing the source issue, then the moved block verbatim; the origin file gains a short note where the block used to be | Task 3 |
| Grandfather-entry retirement = row deletion, not re-citation | `CONTENT_GATE_GRANDFATHERED`'s own header comment: "recorded... against the ADR whose completion retires it"; the `reviewer.md`/`implementer.md` rows' comment confirms retirement means the row is removed once its condition is met, never re-pointed at a different ADR to keep it alive | Task 3 |
| `§ facts` per-declaration header-comment style | Every export in `facts.ts` carries a `// § facts — <topic> (<ADR/issue>)` or `/** ... */` header naming its consumer(s) and citation; `content-gate-facts.ts` keeps the same style for its own moved block | Task 3 |
| ADR amendment citation format | ADR-007's own 4 existing `## Post-acceptance amendments` bullets: `**YYYY-MM-DD — <title> (#<issue>, recording #<source>).** <prose>` | Task 4 |
| `last_updated` frontmatter not bumped by amendments | Observed directly: ADR-007's `last_updated: 2026-07-11` was left unchanged by both the 2026-09-02 and 2026-09-04 amendment commits (`1d2aeb69`, `7b483dd5`) despite substantive body additions — this plan follows the same precedent rather than inventing a new one | Task 4 |
| Facts-literal re-derivation (issue #769) | Never freeze a `facts.ts`/`content-gate-facts.ts` `§ facts` numeric value as a plan-time literal; state ACs as live re-derivation instructions (`wc -l`, live `bun test` counts) instead | Tasks 1, 3, 6 |
| Direct ES imports, no barrel | `scripts/lib/build/` has no `index.ts`; every consumer of `facts.ts` imports it directly by path (confirmed via `grep -rn "from '\./lib/build/facts"`) — `content-gate-facts.ts` follows the same direct-import convention, no barrel introduced | Task 3 |

## Database/API Schema Changes
N/A — no database or public API schema changes. This is an internal build-tooling module split;
the moved constants' names, types, and values are unchanged (`ContentGateBudget`,
`ContentGateGrandfather`, `CONTENT_GATE_BUDGETS`, `CONTENT_GATE_BOUNDARY_UNITS`,
`CONTENT_GATE_GRANDFATHERED`, `CONTENT_GATE_WARN_RATIO` — same shapes, same values, new module
address only).

## Execution Strategy & Stop Conditions
- If `bun test scripts/verify.content-gates.test.ts` still fails after Task 3's move (any test
  beyond the one Task-2 test, or that one test staying red), halt and do not proceed to Task 4 —
  diagnose the import-path retarget or the moved-block boundary before touching the ADR.
- If, after the split, `bun run verify`'s `content-gates` check reports a *new* `V-CONTENTGATE-01`
  violation for any file (not only `facts.ts`), abort the split and re-measure — never raise a
  ceiling as a workaround for a self-inflicted regression; re-derive the correct block boundary
  instead.
- If `git diff -- scripts/lib/build/facts.ts scripts/lib/build/content-gate-facts.ts` shows any
  exported constant's **value** changed (not just relocated), revert immediately — this issue's
  AC requires zero behavior change; a value drift is not a legitimate byproduct of a pure move.
- Unless `bun run build` after Task 5 produces a diff limited to the expected dist mirrors of
  `plan-template.md`, stop and inspect before committing — an unrelated dist diff signals a stale
  working tree, not a successful isolated change.

## Task Breakdown

- [ ] **Task 1 — TDD Baseline Verification.** Run `bun test scripts/verify.content-gates.test.ts
  scripts/build.test.ts` (scoped to the two directly-affected test files, not the full suite, per
  the resource-frugal-testing policy) before any edit. Baseline captured this session at base
  commit `f4d6ce54`: `verify.content-gates.test.ts` 39 pass / 0 fail; `build.test.ts` 82 pass / 0
  fail — re-run and re-quote live counts at implement time, since other campaign PRs may have
  landed on either file since.
  — **AC**: both commands exit 0; the quoted pass/fail counts from this live run appear in the
  completion evidence.

- [ ] **Task 2 — Write the failing test for the grandfather-entry retirement.** In
  `scripts/verify.content-gates.test.ts`, inside the existing `describe('CONTENT_GATE_BUDGETS
  integration (real repo content, zero false positives)')` block, add:
  `test('has no grandfather entry for scripts/lib/build/facts.ts — retired after the content-gate
  config split (issue #952)', () => { expect(CONTENT_GATE_GRANDFATHERED.find((g) => g.file ===
  'scripts/lib/build/facts.ts')).toBeUndefined(); });`. Leave the file's existing import (`from
  './lib/build/facts.ts'`) untouched at this step — it must still compile against the
  not-yet-moved declarations.
  — **AC**: `bun test scripts/verify.content-gates.test.ts` reports exactly 1 new failing test
  (this one, red because the row is still present) and the same 39 pre-existing tests still
  passing — confirms the new test targets precisely the change Task 3 makes, nothing else.

- [ ] **Task 3 — Move the `CONTENT_GATE_*` block to a new module and delete the retired row.**
  Create `scripts/lib/build/content-gate-facts.ts`. Cut the entire self-contained block from
  `facts.ts` — starting at the `// § facts — content-gate budgets, v3 (ADR-007 T6/R3′ extension)`
  header comment through the closing `export const CONTENT_GATE_WARN_RATIO = 0.85;` statement
  (re-grep both boundary markers in the live file first; do not trust a frozen line-number range,
  since concurrent PRs may have shifted it) — and paste it into the new file with a short header
  comment naming its own consumers (`scripts/checks/content-gates.check.ts`,
  `scripts/verify.content-gates.test.ts`) and citing this issue as the split rationale. Within
  the pasted `CONTENT_GATE_GRANDFATHERED` array, delete the `scripts/lib/build/facts.ts` row and
  its preceding "Never per-file-declared..." comment entirely (do not re-cite it to a different
  ADR — no ADR governs this file's size; issue #363's independent `build.test.ts` SRP gate is the
  only remaining constraint, and that test already passes dynamically for any file under the
  directory). In `facts.ts`, remove the cut block and trim the top-of-file "Direct consumers"
  comment to drop `content-gates` from its list (it no longer imports anything from `facts.ts`).
  In `scripts/checks/content-gates.check.ts`, retarget both `from '../lib/build/facts.ts'` import
  lines to `'../lib/build/content-gate-facts.ts'`. In `scripts/verify.content-gates.test.ts`,
  retarget the `CONTENT_GATE_*` import block (including Task 2's new test's dependency) from
  `'./lib/build/facts.ts'` to `'./lib/build/content-gate-facts.ts'`. No exported symbol is
  renamed and no value changes anywhere in this task.
  — **AC**: `wc -l scripts/lib/build/facts.ts` reports a value strictly less than 287 (its
  `scripts/lib/build/*.ts` class ceiling, unchanged by this plan); `wc -l
  scripts/lib/build/content-gate-facts.ts` also reports a value strictly less than 287; `bun test
  scripts/verify.content-gates.test.ts scripts/build.test.ts` reports 0 fail, with
  `verify.content-gates.test.ts` now at (Task 1's baseline + 1) pass including Task 2's test now
  green, and `build.test.ts` unchanged at its Task 1 baseline pass count (its SRP test discovers
  files dynamically via `fs.readdirSync`, so the new file is covered with no test-file edit
  needed); `bun run verify`'s output contains no `V-CONTENTGATE-01` or `V-CONTENTGATE-03` failure
  line.

- [ ] **Task 4 — Record the disposition as an ADR-007 post-acceptance amendment.** Append a 5th
  bullet to `documentation/decisions/ADR-007-drift-proof-toolchain-reseating.md`'s `##
  Post-acceptance amendments` section, in the same `**YYYY-MM-DD — <title> (#<issue>, recording
  #<source>).** <prose>` format as the 4 existing bullets, dated `2026-09-07`, titled along the
  lines of "`scripts/lib/build/facts.ts` grandfather entry retired via targeted split (#952)".
  Content: (a) confirms ADR-007's 6 Implementation Order items are fully merged, citing commit
  `d52aaf8d`/PRs #254-#259; (b) discloses that this completion does not by itself retire the
  `facts.ts` grandfather row, because that row's `sunset_adr: 'ADR-007'` citation was a
  misattribution — its actual governing pressure was issue #363's independent `build.test.ts`
  `MAX_BUILD_MODULE_LOC` SRP gate, per the row's own inline comment; (c) states the resolution —
  the `CONTENT_GATE_*` config was extracted to `scripts/lib/build/content-gate-facts.ts`
  (2 consumers only), bringing `facts.ts` back under its class ceiling with the row deleted
  outright rather than re-cited. Do **not** bump the file's `last_updated:` frontmatter value —
  matches the observed precedent of the 2 prior amendments (see Codebase Conventions above).
  — **AC**: `grep -c "^\*\*2026-09-07" documentation/decisions/ADR-007-drift-proof-toolchain-reseating.md`
  is 1; that bullet's text contains both `#952` and `misattribut`; `git diff -- documentation/decisions/ADR-007-drift-proof-toolchain-reseating.md`
  touches only the `## Post-acceptance amendments` section (no frontmatter line changed).

- [ ] **Task 5 — Fix the now-stale facts.ts-only citation in the plan template.** In
  `src/references/plan-template.md`, the sentence "Never bump a `scripts/lib/build/facts.ts` `§
  facts` value (`VCODE_TABLE_ROW_COUNT`, `EXPECTED_CHECK_COUNT`-style successor counters,
  `CONTENT_GATE_BUDGETS` entries, `DOC_HEALTH_THRESHOLDS` values, or any future addition to that
  block)" now names a value that no longer lives in `facts.ts`. Reword to name both files (e.g.
  "...a `scripts/lib/build/facts.ts` or `content-gate-facts.ts` `§ facts` value..."). Run `bun run
  build` to regenerate the dist trees per `scripts/lib/build/targets.ts`.
  — **AC**: `grep -c "content-gate-facts.ts" src/references/plan-template.md` is at least 1; `bun
  run build` exits 0; `git status --porcelain` after the build shows changes only in
  `src/references/plan-template.md` and its regenerated dist mirrors (per
  `scripts/lib/build/targets.ts`) plus Tasks 1-4's own edits — no unexpected file touched.

- [ ] **Task 6 — Full verification (invariance gate).** Run the project's full test suite once,
  serialized and memory-gated per the resource-frugal-testing policy (`free -m` `MemAvailable` ≥
  3500 MB before starting; `bun test` at default single-invocation concurrency, no parallel
  fan-out), and `bun run verify`. Compare the full-suite pass count against a freshly-captured
  pre-Task-1 full-suite baseline (capture that baseline first, before Task 1's scoped runs, if not
  already captured this session).
  — **AC**: full-suite pass count identical before and after (0 new fails, 0 new skips); every
  exported constant touched by this plan (`CONTENT_GATE_BUDGETS`, `CONTENT_GATE_BOUNDARY_UNITS`,
  `CONTENT_GATE_GRANDFATHERED`, `CONTENT_GATE_WARN_RATIO`, `ContentGateBudget`,
  `ContentGateGrandfather`) keeps its pre-change name and value (spot-checked via `git diff`
  showing only whitespace/location movement, no value edits); `bun run verify` exits 0.

## Sprint Contract
Per-task `— **AC**:` markers above are the closure gate for every task; there is no task in this
plan without a narrower AC, so the blanket "all tests and linters pass" phrasing is not needed as
a fallback beyond Task 6's explicit invariance gate.

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
| `ac_facts_literal_bump` | PASS — Task 3/6 ACs are stated as live re-derivations (`wc -l`, live `bun test` counts), never a frozen `from N to M` literal pair |

## References
- Issue #952 — `scripts/lib/build/facts.ts is at exactly its 300-LOC ceiling — decide raise,
  split, or retire the grandfather entry`
- `documentation/decisions/ADR-007-drift-proof-toolchain-reseating.md` — completeness confirmed
  this session; amendment target (Task 4)
- `documentation/decisions/ADR-007-drift-proof-toolchain-reseating.md`'s `## Post-acceptance
  amendments` — precedent for citation format and the "amendments don't bump `last_updated`"
  convention
- `scripts/lib/build/facts.ts:161-234` (as of base commit `f4d6ce54`) — the `CONTENT_GATE_*`
  block and grandfather allowlist being split/retired
- `scripts/build.test.ts:1179-1210` — issue #363's SRP gate (`MAX_BUILD_MODULE_LOC = 300`), the
  entry's real (misattributed) governing constraint
- `.blackhole/plans/issue-802.md` — prior precedent for a `facts.ts`-adjacent module split
  (`worker-schemas.md` → `implementer-schemas.md`) with the same ADR-amendment recording pattern
