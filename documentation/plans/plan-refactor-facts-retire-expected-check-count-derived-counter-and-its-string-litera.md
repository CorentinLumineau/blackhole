---
type: plan
summary: "Implementation plan for issue #704 (R-01) — retire the derived `EXPECTED_CHECK_COUNT` counter and its new-check-module Touch-Paths trigger"
status: current
review_trigger: "on file change"
created: 2026-09-02
last_updated: 2026-09-02
related:
  - documentation/architecture/retrospective-blackhole.md
  - documentation/decisions/ADR-007-drift-proof-toolchain-reseating.md
  - documentation/plans/plan-retrospective-v0.21.0-remediation.md
---

# Plan - Issue #704

## Objective

Retire `EXPECTED_CHECK_COUNT` (`scripts/lib/build/facts.ts`) — a derived rollup of
`results.length` that `verify.ts` already computes independently, bumped in ~30 of the 42 commits
touching `facts.ts` since v0.16.0. This is `R-01` of
`documentation/plans/plan-retrospective-v0.21.0-remediation.md`, and lands first in Wave 0
specifically because retiring it dissolves the `facts.ts` hot-file contention every later
check-adding PR in the wave would otherwise hit.

Two consumers come down with it: `warnOnCheckCountMismatch` (`verify.ts`'s WARN-only comparison),
and the second `TOUCH_PATH_SSOT_PAIRS` entry (`scripts/lib/plan-touch-path-ssot-pairs.ts`) whose
entire premise — that a new `scripts/checks/*.check.ts` module needs a paired `facts.ts` bump —
is exactly the coupling this issue dissolves. `VCODE_TABLE_ROW_COUNT` (the sibling `§ facts`
counter, a true two-sided ground-truth check consumed by `V-GROUND-01`) is untouched.

## Touch-Paths

- `scripts/lib/build/facts.ts`
- `scripts/verify.ts`
- `scripts/verify.runner.test.ts`
- `scripts/lib/plan-touch-path-ssot-pairs.ts`
- `scripts/verify.plan-quality-gate.test.ts`
- `scripts/checks/stop-mode.check.ts`
- `scripts/verify.stop-mode.test.ts`
- `src/references/config-template.md` plus all generated dist trees per
  `scripts/lib/build/targets.ts`

## Documentation Impact

`src/references/config-template.md` (a build source, not a `documentation/` file) is reworded and
rebuilt — its ~9 mirrored dist copies regenerate via `bun run build`, no hand-editing.

No file under `documentation/` is touched. The full-repo sweep also found `EXPECTED_CHECK_COUNT`
cited in `documentation/architecture/retrospective-blackhole.md` (the dated audit report this
whole remediation wave derives from) and in five already-`accepted` ADRs, two already-completed
past plans, and one past review. These are dated historical records of what was true at the time
they were written, not live SSOT prose an agent still consults for current guidance — none is
touched here.

One flagged-but-out-of-scope observation: `documentation/plans/plan-retrospective-v0.21.0-remediation.md`
§ Ground rules item 2 currently reads "Until R-01 lands, bump `EXPECTED_CHECK_COUNT` in `facts.ts`
... for every new row" — that clause goes stale the moment this PR merges. Fixing it is left for
whoever next revises that plan doc rather than widening this xs-sized PR.

## Codebase Conventions

- `§ facts` SSOT convention (ADR-007 T3/R1′, `facts.ts:1-8`): every declared constant is meant to
  pair with an *independent* scan that verifies it (`V-GROUND-01`, `V-VOCAB-01` shape) —
  "declared once, checked twice, never generated from the scan." `EXPECTED_CHECK_COUNT` never fit
  this shape: its only "check" was `verify.ts` comparing the declared number against the very
  `results.length` `verify.ts` itself produced — one source computing both sides of its own
  comparison, the ADR-007-rejected pattern re-emerging as an integer. Removing it is a
  straightforward deletion, not an extraction — there is no companion scan to preserve.
- `TOUCH_PATH_SSOT_PAIRS` (`scripts/lib/plan-touch-path-ssot-pairs.ts`) is an advisory,
  non-blocking finder (`touch_paths_ssot_gap`, never `failing_checks`) — shrinking it from two
  pairs to one changes only which gaps it can *advise* on, never a blocking gate.

## Task Steps

1. **TDD Baseline Verification** — Confirm the pre-change suite is green before touching
   anything. **AC**: `bun test` and `bun run verify` both exit 0 at the plan's base commit;
   pass/fail counts quoted in the completion evidence.

2. **Retire the constant and its WARN comparison**
   (`scripts/lib/build/facts.ts`, `scripts/verify.ts`, `scripts/verify.runner.test.ts`): delete
   the `EXPECTED_CHECK_COUNT` constant and its JSDoc; remove `warnOnCheckCountMismatch` and its
   call site in `verify.ts`; remove the corresponding import, describe block, and now-false
   `warnSpy` assertion in `verify.runner.test.ts`. **AC**: `rg` for both identifiers across the
   three files returns zero matches; `bun test scripts/verify.runner.test.ts` green.

3. **Retire the new-check-module Touch-Paths trigger**
   (`scripts/lib/plan-touch-path-ssot-pairs.ts`, `scripts/verify.plan-quality-gate.test.ts`):
   shrink `TOUCH_PATH_SSOT_PAIRS` to its single `VCODE_TABLE_ROW_COUNT` entry; delete
   `newCheckModuleTriggered`, `CHECK_MODULE_PATH`, `NEW_CHECK_MODULE_TEXT`, and the branch in
   `findTouchPathSsotGaps` that used them (its premise — a new check module needs a paired
   `facts.ts` bump — is exactly what this issue dissolves); update the retired two tests and the
   "documents exactly two relationships" assertion to match. **AC**: `rg` for the four retired
   identifiers across both files returns zero matches; `bun test
   scripts/verify.plan-quality-gate.test.ts` green.

4. **Reword the two historical-comment consumers found by the sweep**
   (`scripts/checks/stop-mode.check.ts`, `scripts/verify.stop-mode.test.ts`) — comment-only, no
   behavior change. **AC**: `rg EXPECTED_CHECK_COUNT` on both files returns zero matches;
   `bun test scripts/verify.stop-mode.test.ts` still returns exactly one `V-STOP-02` result.

5. **Reword the live SSOT prose citation and rebuild** (`src/references/config-template.md`):
   drop the `EXPECTED_CHECK_COUNT` clause from the `wave_scheduling.batched_checks_pr` row; run
   `bun run build`; commit the regenerated mirrored copies. **AC**: `bun run build` exits 0 with
   only the source file and its dist mirrors changed; `rg` across every dist tree returns zero
   matches.

6. **Full-sweep verification**: `grep -rn EXPECTED_CHECK_COUNT scripts src` returns zero matches;
   the same grep over `documentation` returns matches only in the pre-existing historical files
   named in `## Documentation Impact` above. **AC**: `bun run verify` exits 0 with all checks
   passing (including `V-GROUND-01`, unaffected since its logic never referenced the retired
   constant); `bun test` exits 0, full suite green, matching the task 1 baseline counts.

## Sprint Contract

One PR, `blackhole/issue-704`, closing #704. Scope is exactly the six tasks above — no other
`facts.ts` change, per the campaign note that this issue lands first in the wave specifically to
clear the hot-file contention for everything after it.
