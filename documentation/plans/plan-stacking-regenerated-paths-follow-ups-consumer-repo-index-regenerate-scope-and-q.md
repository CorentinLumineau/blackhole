---
type: plan
summary: "Plan for issue 1312: doc-only close-out of the REGENERATED_PATHS follow-ups, scoping the merge-conflict-protocol class-1 INDEX regenerate step to blackhole's own repo with class 3 for consumers (ADR-055 A4), and applying REGENERATED_PATHS in the queue-dag Step 3 conflict filter, guarded by a doc-contract test"
status: current
review_trigger: "on file change"
created: 2026-11-18
last_updated: 2026-11-18
related:
  - documentation/decisions/ADR-055-regenerated-files-exempt-from-stack-overlap.md
---

# Plan - Issue #1312

## Objective

Close the two deferred WARNs from #1303 (PR #1309), doc-only. (1) `src/references/merge-conflict-protocol.md` class 1 scopes the `generate-doc-index.ts --write` regenerate step to blackhole's own repo (Scope-1) and says consumer repos resolve a conflicted root `documentation/INDEX.md` as class 3 (pure two-sided insertion), per ADR-055 A4. No `--repo-root` flag is added. (2) `src/references/queue-dag.md` Step 3 conflict filter drops `REGENERATED_PATHS` (`scripts/lib/stack-overlap.ts`) members from each issue's `touch_paths` before comparing, so two ready issues that both list `documentation/INDEX.md` are not deferred for one wave.

Pareto: Gain 4 x (11 - Effort 2) = 36, at least 30. Rulings: no active-ruling conflict (R-005 untouched: no stacking toggle added).

Plan-time facts: Step 3 conflict filter is prose only; no script implements the pairwise defer (`grep` of `scripts/` finds only note-vocabulary consumers of the `overlap with #N` string and `stack-parent.ts`, whose Step 3b path already applies `withoutRegenerated`). So item 2 is a prose edit citing the constant by name, guarded by a doc-contract test, not a code change. Out of scope (ledger only): no CLI test seam for `generate-doc-index.ts`; the 2-copy `--name-only` parse in stack-overlap.ts and stack-merge.ts.

## Touch-Paths

- `src/references/merge-conflict-protocol.md`
- `src/references/queue-dag.md`
- `scripts/stack-docs-contract.test.ts`
- plus all generated dist trees per `scripts/lib/build/targets.ts`

Disjoint from #1268 (its Touch-Paths list 14 other `src/references/*.md` files, `src/agents/coordinator.md`, `scripts/doctor.ts`); neither `merge-conflict-protocol.md` nor `queue-dag.md` is among them.

## Documentation Impact

The two `src/references` files above are the documentation change. `documentation/decisions/ADR-055-regenerated-files-exempt-from-stack-overlap.md` already states the consumer residual (A4); no edit. None else.

## Task Steps

1. **Red first** in `scripts/stack-docs-contract.test.ts`, reusing its `section()` helper: (a) in the `queue-dag Step 3 conflict filter` describe, assert the section body contains `REGENERATED_PATHS`; (b) add a describe over `merge-conflict-protocol.md` `## Classification rule` asserting the class 1 text contains `Scope-1` and `class 3`. Run the one file; both fail.
2. `src/references/queue-dag.md` Step 3 (~248): before comparing `touch_paths` globs, remove members of `REGENERATED_PATHS` (`scripts/lib/stack-overlap.ts`, ADR-055); an issue whose list holds only such files has no overlap.
3. `src/references/merge-conflict-protocol.md` class 1 (~38): state the `generate-doc-index.ts --write`/`--check` step applies only inside blackhole's own repo (the script resolves the plugin checkout root and has no `--repo-root`); in a consumer repo a conflicted root INDEX is class 3 (ADR-055 A4).
4. Run the one contract test file green, then `bun run build` for the dist trees via the usual path (CI verifies the rest).

## Acceptance Criteria

- **AC**: `bun test scripts/stack-docs-contract.test.ts` fails before steps 2-3 and passes after; it asserts `REGENERATED_PATHS` in the Step 3 section and `Scope-1` plus `class 3` in class 1.
- **AC**: `git diff --name-only` is limited to the Touch-Paths and generated dist trees; no `scripts/**` non-test file and no `--repo-root` flag is added.
- **AC**: `bun run verify` exits 0 (docs and dist trees in sync) in CI on the pushed head.

## Test Strategy

Doc-contract test (existing file, existing helper); one focused spec locally through `with-test-lock`; the full suite runs in CI only.
