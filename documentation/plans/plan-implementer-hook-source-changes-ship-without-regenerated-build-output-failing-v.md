---
type: plan
summary: "Always run build, commit regenerated output, then verify in the implementer flow so hook or script source edits never leave a dirty build tree (V-BUILD-01)"
status: current
review_trigger: "on file change"
created: 2026-11-18
last_updated: 2026-11-18
---

# Plan: Always run build, commit regenerated output, then verify in the implementer flow so hook or script source edits never leave a dirty build tree (V-BUILD-01) (issue #1279)

## Objective
Make the implementer always regenerate and commit build output before the final `bun run verify`, so a PR that changes a build input (hook source under `templates/hooks/**`, `scripts/**` that the build copies into `plugins/*/scripts`, `src/**`) never reaches CI with a dirty tree (V-BUILD-01, PR #1249 / commit a62e99dd).

## Design decisions (80/20)
- **Cause is the trigger wording, not a missing step.** `phase-implement.md` § Quality gate (pre-PR) already prescribes build, commit, verify, but only "when the diff touches `src/` or anything that regenerates committed build-output trees". A hook edit under `templates/hooks/**` does not read as either, so the step was skipped. Fix: make the step unconditional ("every PR, whatever paths changed"), and name `templates/hooks/**` and `scripts/**` as examples without enumerating (`scripts/lib/build/targets.ts` is the SSOT for the trees). Unconditional is cheaper than a path list that drifts (V-DRY-01) and costs nothing when the tree is already clean.
- **Optional pre-push fail-fast check: rejected (YAGNI).** `bun run verify` already runs V-BUILD-01 and CI runs it; a second detector duplicates it.
- **`scripts/verify.runner.test.ts`: no row.** Its `verify.ts CLI subprocess` test runs the real `verify`, which includes V-BUILD-01; the change is agent prose and no new check is added, so there is no new behaviour to assert. Decision recorded, nothing to add.
- **Version-bump waiver (owner, 2026-11-18, `owner-decisions.json`)**: `implementer.md` and `phase-implement.md` carry no per-PR version-bump instruction (grep `bump|version` returns none), so there is nothing to align. The new wording must not introduce one: build output is committed with the source commit and the version is left to the `chore(release)` commit.
- **Conflict check**: #1301 and #1305 are MERGED; they edited the dispatch-gate checklist near the top of `phase-implement.md`. This plan edits only the `## Quality gate (pre-PR)` section at the end and one bullet in `implementer.md` step 6. No open PR touches either file.

## Touch-Paths
- `src/references/phase-implement.md` (§ Quality gate (pre-PR) only)
- `src/agents/implementer.md` (step 6 build-output bullet only; keep net lines flat, V-CONTENTGATE-01 section budget)
- plus all generated dist trees per `scripts/lib/build/targets.ts`

## Documentation Impact
None beyond the two source files: the only prose naming this ordering is these two files (grep `V-BUILD-01` in `src/`).

## Task Steps
1. In `phase-implement.md` § Quality gate (pre-PR): replace the conditional lead-in with an unconditional one: before the final verify on every PR run `bun run build`, then `git status --porcelain`; if any path changed, commit source and regenerated output together (no staged-only state), then `bun run verify`, then push. Keep the `V-BUILD-01` explanation. Name `templates/hooks/**` (hook source) and `scripts/**` (copied into `plugins/*/scripts`) as examples that regenerate output, plus "all trees per `scripts/lib/build/targets.ts`".
2. In `implementer.md` step 6, reword the bullet to point at that section and drop the `src/`-only condition: "Run `phase-implement.md` § Quality gate (pre-PR) build, commit, verify ordering on every PR; a hook, script or `src/` edit regenerates committed output."
3. `bun run build` regenerates dist trees (implementer; through with-test-lock); push and let CI run `bun run verify`.

## Task Breakdown / Acceptance Criteria
- T1 phase-implement - **AC**: `grep -c "templates/hooks" src/references/phase-implement.md` >= 1 inside § Quality gate (pre-PR), and the sentence "when the diff touches `src/`" no longer gates the build step (`grep -n "When the diff touches" src/references/phase-implement.md` returns no line in that section).
- T2 implementer - **AC**: `src/agents/implementer.md` step 6 build bullet contains no `src/`-only condition; `grep -n "bump" src/agents/implementer.md src/references/phase-implement.md` returns nothing (waiver respected).
- T3 gates - **AC**: `bun run build` exits 0 and `git status --porcelain` is empty after committing its output; `bun run verify` green in CI (V-BUILD-01, V-CONTENTGATE-01, V-GATE-01 marker for implementer.md unchanged).

## Test Strategy
Prose-only change: no new runtime behaviour, so no new unit test (V-TEST-01 does not apply to agent prose; `scripts/verify.runner.test.ts` already exercises real verify and is not edited). Verification per ci-first-verification: `bun run build` locally through with-test-lock, one focused `bun test scripts/checks/agents.check.test.ts` if present, full verify in CI.

## Stop conditions
- If `bun run verify` reports V-CONTENTGATE-01 on `implementer.md`, shrink the new wording until net lines are flat; do not raise a budget.
- If the build produces output changes unrelated to this issue (other drift on main), halt and file an issue instead of committing them.

## Track / Classification
Quick; `task_type: bugfix`; size xs. No security surface (`route.security_review_required` not set); no UI.

## Pareto
Gain 6, Effort 2, Priority = 6 x 9 = 54 (>= 30).
