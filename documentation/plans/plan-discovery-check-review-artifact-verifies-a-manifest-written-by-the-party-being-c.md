---
type: plan
status: current
review_trigger: "on file change"
created: 2026-09-03
last_updated: 2026-09-03
issue: 806
---


# Plan - Issue #806

## Objective

`check-review-artifact.ts` currently gates merge on two legs:
`manifestHasReviewRoute` (does `.blackhole/staged/<n>/manifest.json` declare a `route: "review"`
entry?) and `reviewArtifactPresent` (is the computed `reviewTargetPath` present in the PR diff?).
The first leg is circular by construction — `implementer.md` § Promote Review Artifact instructs
the same party being checked (the promoter) to write both the manifest entry and the committed
file, so the check verifies an input its own target controls. The second leg is not circular but
is weak — existence-only, no content check — so a committed review artifact whose content has
drifted from the findings ledger (wrong verdict, dropped `### Deferred` section — PR #773's actual
failure mode) still passes.

Fix: drop the circular `manifestHasReviewRoute` leg entirely (dead code once removed — it has no
other caller) and replace the missing content check with a **re-render-and-diff** against the live
findings ledger, reusing `renderReviewMarkdown()` (`scripts/lib/promote-review-artifact.ts:112`),
which is a pure function of `input.ledger`/`issueNumber`/`prNumber`/`issueTitle`/`today` — no file
reads, no side effects — written by the orchestrator under the single-writer invariant
(`blackhole-state.md` § Single-writer invariant), an input the checked party (the promoter/
implementer) does not control. This closes the circularity without adding new verification
machinery (V-KISS-01/V-INT-02: reuse the existing renderer, do not write a second one).

Two correctness traps this plan handles explicitly rather than leaving as latent defects:

1. `renderReviewMarkdown` defaults `today` to `new Date().toISOString().slice(0,10)`. A naive
   re-render at check time would stamp today's date into `created:`/`last_updated:`, diffing
   spuriously against a committed artifact from an earlier day on any cross-midnight PR. Fix:
   extract the committed file's own `created:` frontmatter value and pass it back in as the
   re-render's `today` override, so the only two things that can differ are actual content.
2. `promote-review-artifact.ts --out-dir` and `check-review-artifact.ts --manifest`/`--diff-file`
   today resolve relative paths against whatever cwd happens to be active at merge step 2.5
   inside the PR worktree — same latent-defect class as #798's cwd-resolution hazard. This plan
   requires absolute paths for every script invocation at merge step 2.5, sidestepping #798
   rather than sequencing behind it (per the issue body's explicit instruction).

**Design decision (Hard Choice)**: `manifestHasReviewRoute`, `readStagingManifest`, and the
`StagingManifest` type are removed outright rather than kept-but-non-blocking. Grep confirmed
(`grep -rn "manifestHasReviewRoute\|readStagingManifest\|StagingManifest" scripts/`) their only
callers are `review-artifact.ts` itself and its own test file — keeping them present-but-unused
would be dead code (V-KISS-03) providing zero value once the content check supersedes them. The
`--manifest` CLI flag is dropped accordingly; `--ledger`, `--pr`, `--branch`, `--head`, and
`--repo-root` are added so the check has what it needs to re-render and locate the committed file.

## Touch-Paths

- `scripts/lib/merge-gate/review-artifact.ts`
- `scripts/lib/merge-gate/review-artifact.test.ts` (new — no lib-level unit test file exists today; CLI-level coverage lives in `scripts/check-review-artifact.test.ts`)
- `scripts/check-review-artifact.ts`
- `scripts/check-review-artifact.test.ts`
- `fixtures/staging/review-ledger-sample.json` (new fixture — sample findings ledger for content-check tests)
- `fixtures/staging/review-artifact-correct.md` (new fixture — a correctly-promoted review artifact, characterization test)
- `fixtures/staging/review-artifact-drifted.md` (new fixture — a committed artifact whose verdict/`### Deferred` section disagrees with the ledger, regression test)
- `src/references/merge-gate.md` plus all generated dist trees per `scripts/lib/build/targets.ts`
- `src/references/phase-loop.md` plus all generated dist trees per `scripts/lib/build/targets.ts`
- `src/agents/implementer.md` plus all generated dist trees per `scripts/lib/build/targets.ts`

## Documentation Impact

`src/references/merge-gate.md` §5 (Review artifact presence gate) gains the content-verification
mechanism description; `src/references/phase-loop.md` step 2.5 and `src/agents/implementer.md` §
Promote Review Artifact are updated to state the absolute-path requirement for every script
invocation at merge step 2.5 (AC4) and to drop the now-removed `--manifest` flag from their
invocation prose. No new `documentation/` file is created — these are existing companion
reference/agent docs already tracked outside `documentation/`, so `doc-governance.md`'s
search-before-write/canonical-naming obligations do not apply to this change.

## Task Steps

- [ ] **AC1 — Drop the circular manifest leg**: Remove `manifestHasReviewRoute`,
  `readStagingManifest`, and the `StagingManifest` type from
  `scripts/lib/merge-gate/review-artifact.ts`; remove the `manifestPath` param and the
  manifest-based reason from `mergeReadinessForReviewPromotion`. Delete the `--manifest` CLI flag
  and its usage-string reference in `scripts/check-review-artifact.ts`.
  **AC**: `scripts/check-review-artifact.test.ts`'s `describe('manifestHasReviewRoute', ...)`
  block is removed (the export no longer exists — a lingering test would fail to import); a new
  test proves `mergeReadinessForReviewPromotion()` returns `ok: true` for an issue whose staged
  manifest has **zero** `route: "review"` entries (or no manifest file at all), provided the
  committed artifact's content matches a ledger re-render — i.e., merge-readiness no longer
  depends on any self-declared manifest flag.

- [ ] **AC2 — Content verification against the live ledger**: Add
  `reviewArtifactContentMatchesLedger()` to `scripts/lib/merge-gate/review-artifact.ts`, importing
  `renderReviewMarkdown` and `LedgerFile` from `scripts/lib/promote-review-artifact.ts` (read-only
  reuse, not a duplicate renderer — V-INT-02). It reads the committed file at
  `path.join(repoRoot, reviewTargetPath(issueTitle, issueNumber))`, re-renders the expected
  markdown from `{issueNumber, issueTitle, prNumber, branchName, headSha, ledger}`, and returns
  `{ok:false, reason}` when the committed content is missing or the re-render disagrees with it.
  Wire it into `mergeReadinessForReviewPromotion()` (called only when `reviewArtifactPresent`
  already passed, so a missing-file reason is never reported twice). Extend
  `mergeReadinessForReviewPromotion`'s options with `prNumber`, `branchName`, `headSha`, `ledger`,
  `repoRoot`. **AC**: `scripts/lib/merge-gate/review-artifact.test.ts` — a committed artifact that
  byte-for-byte matches `renderReviewMarkdown()`'s output (given the same `today` override) passes
  `reviewArtifactContentMatchesLedger`; feeding it a ledger with one extra `BLOCK` finding not
  reflected in the committed content fails it with a reason string naming the target path.

- [ ] **AC3 — Explicit frontmatter date handling**: Before re-rendering, extract the committed
  file's own `created:` frontmatter value (regex line match, mirroring the existing
  `created: ${today}` template line in `promote-review-artifact.ts`) and pass it as the `today`
  override to `renderReviewMarkdown()`, so the re-render's `created:`/`last_updated:` lines match
  the committed file's dates rather than the check's own invocation date. **AC**:
  `scripts/lib/merge-gate/review-artifact.test.ts` — a fixture committed artifact dated
  `2026-08-05` (`fixtures/staging/review-artifact-correct.md`) passes
  `reviewArtifactContentMatchesLedger` when the test asserts today's real date differs from
  `2026-08-05` (e.g. by stubbing nothing and relying on the test running on a later date, or by
  asserting the check output is identical regardless of `Date.now()`) — the test explicitly proves
  the check does not fail solely because promotion and verification ran on different calendar
  days.

- [ ] **AC4 — Absolute paths at merge step 2.5**: In `scripts/check-review-artifact.ts`, replace
  the removed `--manifest` flag with `--ledger`, `--pr`, `--branch`, `--head`, and `--repo-root`;
  require `--config`, `--ledger`, `--repo-root`, and `--diff-file` to be absolute
  (`path.isAbsolute(...)`), calling `usage()` (exit 2) otherwise. Update
  `src/references/phase-loop.md` step 2.5 and `src/agents/implementer.md` § Promote Review
  Artifact to state explicitly that every script invocation at merge step 2.5
  (`promote-review-artifact.ts` and `check-review-artifact.ts`) must pass absolute paths for
  every path-shaped flag, and why (cwd-relative resolution is the #798 hazard class; this sidesteps
  it rather than sequencing behind it). **AC**: `scripts/check-review-artifact.test.ts` — a
  spawned CLI invocation with a relative `--ledger` (or `--config`/`--repo-root`/`--diff-file`)
  path exits `2` with the usage message; the equivalent invocation with all-absolute paths exits
  `0` on matching content.

- [ ] **AC5 — Regression test (fails before, passes after)**: Add
  `fixtures/staging/review-artifact-drifted.md` modeling PR #773's actual failure — a committed
  review artifact whose verdict line reports `LGTM` while the paired ledger fixture
  (`fixtures/staging/review-ledger-sample.json`) carries an unresolved `BLOCK` finding for that
  issue, and separately a variant with a dropped `### Deferred` section while the ledger has a
  `deferred` finding. **AC**: a test in `scripts/lib/merge-gate/review-artifact.test.ts` asserts
  `reviewArtifactContentMatchesLedger` (and, end-to-end, `mergeReadinessForReviewPromotion`)
  returns `ok: false` for both variants. Confirmed failing against the pre-fix `main` (the old
  `reviewArtifactPresent`-only path returns `ok: true` for this fixture since the file merely
  exists) and passing after this plan's AC2 change lands.

- [ ] **AC6 — Characterization test**: Add `fixtures/staging/review-artifact-correct.md` — the
  markdown `renderReviewMarkdown()` actually produces for `review-ledger-sample.json` at a fixed
  `today`. **AC**: `mergeReadinessForReviewPromotion()` returns `ok: true` for this fixture with
  `prDiffPaths` containing its target path and **no** `route: "review"` manifest entry present
  (proves AC1 and AC2 together: a correctly-promoted artifact still passes merge-readiness without
  relying on the removed manifest leg).

- [ ] **TDD Baseline Verification**: Run `bun test scripts/check-review-artifact.test.ts scripts/lib/merge-gate/` before any edit to confirm the existing suite is green. — **AC**: baseline pass/fail counts quoted in the completion evidence.

- [ ] **Verify Integrity**: Run the full test suite and lint/typecheck after all six AC tasks land. — **AC**: full suite green, lint clean, both quoted in the completion evidence; no file outside the declared Touch-Paths modified (`V-SCOPE-02`).

## Sprint Contract

Definition of done = all six AC items above pass their stated test, plus the TDD Baseline and
Verify Integrity tasks are green. No task in this plan falls back to the blanket "tests and
linters pass" default — every task carries its own narrower AC.
