---
type: review
status: current
review_trigger: "on file change"
created: 2026-09-03
last_updated: 2026-09-03
issue: 777
---

# Review: `blackhole/issue-777` (bd42ea5)

**Verdict: LGTM** — 0 BLOCK, 1 WARN at merge-readiness.

Diff: PR #799, branch `blackhole/issue-777`.

## Quality gates — campaign review aggregate

| Gate | Result |
|---|---|
| Findings ledger | 2 BLOCK/WARN row(s) for issue #777, 2 deferred |

## Findings

| # | file:line | V-code | Severity | Finding |
|---|---|---|---|---|
| 1 | `templates/hooks/pretooluse/utils/worktree-removal-guard.js:13` | V-DOC-05 | **WARN** | [turn 18, orchestrator-found while verifying the #777 premise] The module header docstring contradicts itself about the one interaction #777 exists to fix. Line 13 reads: the removal command (with or without --force) refuses on a dirty working tree but NOT on committed-but-unpushed history. Line 18 reads: --force already bypasses git own dirty-tree refusal, so it is the one removal path with no native safety net at all. Line 18 is correct. Line 13, on its natural parse, asserts the opposite for the --force case. The parenthetical was most likely intended to attach to the unpushed-history clause rather than the dirty-tree one, but as written this is a load-bearing safety comment contradicting another statement five lines below it, in the exact area a future editor will read before changing the force handling. Same defect class as the false docstring universal review-774 found at :115 on PR #786. Fold into #777 rather than filing separately: that issue already touches this force/dirty interaction and its fix must state the true behaviour anyway. [orchestrator correction turn 18: pr_ref was null and phase 'handle', so this row failed BOTH arms of selectReviewFindings' filter (issue_ref match AND (phase=='review' OR pr_ref==PR)) and rendered in NO review artifact — the merge record would have read '0 WARN' while an open WARN stood against a file this PR modifies. The selector is CORRECT as written (hunt- and plan-phase discoveries should not render as review findings); the fault was the orchestrator appending a PR-relevant finding without tagging pr_ref. Set to 799 because the finding is about worktree-removal-guard.js, which PR #799 changes, and it is unresolved at merge-readiness.] |
| 2 | `templates/hooks/pretooluse/utils/worktree-removal-guard.js:290` | V-DOCFACT-01 | **NOTE** | [review-777 considered-and-dismissed, recorded at orchestrator request] checkDirtyWorktree runs git status --porcelain WITHOUT --ignored, so gitignored dirt is excluded and the check is strictly NARROWER than the --force bypass it backstops on that axis, while the docstring at :290-296 argues for parity with git's own dirty definition. review-777 weighed this as V-DOCFACT-01 and dismissed it: the docstring's claim is scoped to --untracked-files=no and is accurate as written, it simply does not mention ignored files; and the narrowing is the SAFE direction — it is exactly what stops an 'annoying build artifact' false refusal from firing. Recorded as NOTE at the reviewer's own suggested severity because #788 and #803 will both touch this same predicate and the next person reasoning about its scope should find this already weighed rather than re-derive it. Not a defect; a documented boundary. |

### Deferred (not counted toward verdict)

| # | file:line | V-code | Severity | Finding | Deferred to |
|---|---|---|---|---|---|
| 1 | `scripts/hooks-validate-bash.test.ts:1089` | V-DOC-06 | WARN | [review-777, PR #799, RECOVERED turn 18] Added comments embed an issue number and change-history prose ('// #777: --force bypasses git's own native dirty-tree refusal, and until now nothing in this module backstopped it'), also present in the source docstring at worktree-removal-guard.js:15 and :296. Test NAMES carrying (#777) are exempt under the function-name carve-out; the comment bodies are not. Confirmed still present at head bd42ea5b. | #779 |
| 2 | `templates/hooks/pretooluse/utils/worktree-removal-guard.js:413` | V-PARETO-02 | WARN | [review-777, PR #799, RECOVERED turn 18] Improvement discovery, gain 6 / effort 3 -> Priority 48, above the 30 gate. The campaign's own post-merge worktree cleanup now denies on any non-ignored untracked leftover while rm -rf <worktree> remains deliberately unguarded, so each new refusal class raises the incentive toward the one unguarded escape hatch — this fix INCREASES the value of the compensating control it lacks. ORCHESTRATOR NOTE: review-777 returned this as status 'open' because it did not know the orchestrator had already filed #803 for exactly this follow-up earlier in the turn (the #551 prose deferral that was never filed). Recorded as deferred -> #803 rather than open, and the reviewer was asked to object if that narrows what it found. | #803 |
