---
type: reference
status: current
review_trigger: "on file change"
created: 2026-07-20
last_updated: 2026-09-02
related:
  - documentation/decisions/ADR-012-shared-artifact-substrate.md
---

# Decision Log

Durable, greppable record of implementation decisions — Root-Cause Decision Records,
Refactoring Verification Decision Records, Reuse Check entries, and Improvement Records —
banked by the orchestrator from `decision_records[]` (ADR-012 E4). **Append-only. Written
solely by the orchestrator**, serially, post-barrier — see `src/agents/orchestrator.md` §
Decision Record Append. No worker writes this file directly.

## Rotation

When this table exceeds 500 rows, the orchestrator moves the oldest rows to
`documentation/reference/_archive/decision-log-{first-issue}-{last-issue}.md`, mirroring the
`findings-ledger.json` archive convention (`src/references/blackhole-state.md`). This file
itself is never deleted, only trimmed.

## Records

| PR/Issue | Kind | Touch Paths | Decision | Why |
|---|---|---|---|---|
| PR #428 / #421 | reuse | src/references/hunt/ux-coherence.md | Reused parity.md structure + kaizen-parity-kind.test.ts test shape for the 8th hunt kind | One-file-per-kind is the established extracted pattern; rule-of-three N/A |
| PR #428 / #421 | improvement | src/references/config-template.md | No improvement needed beyond plan's registration edits | Touched lines already clean; formatting convention preserved |
| PR #430 / #422 | reuse | scripts/lib/worker-json/validators/planner.ts | Reused validateBrainstormChild local-helper shape for validateRulingConflictEntry/validateRulingConflicts instead of extracting a shared combinator | 5 bespoke occurrences now exist (past rule-of-three) but extraction is out of #422 scope — filed as #431 |
| PR #430 / #422 | improvement | src/references/clarify-gates.md | Replaced stale forward-reference ("#422 owns...not that classifier") with live pointer to the new fork + coordinator disposition wiring | Prose promised future work this PR delivers; leaving it would be a stale claim |
| 732 | approach | `documentation/architecture.md` | Used the exact lowercase phrase "maintainer-local, not an install path (ADR-009)" verbatim in the `.claude/` row | The plan AC verifies with a case-sensitive grep; matching exactly avoids a false negative in the plan's own verification step |
| 734 | root-cause | `templates/hooks/pretooluse/utils/hook-event-log.js`, `scripts/hooks-validate-file.test.ts` | Reuse the file's existing realpath-based `resolveExistingAncestor` to build `BARE_TEMP_DIRS` and resolve the incoming value, instead of `path.resolve` or a darwin-only branch | `path.resolve` does not follow symlinks, so a bare temp root reached through a symlinked ancestor evaded the guard; `resolveExistingAncestor` is already used for every other containment comparison in this file (V-INT-02), and the fix generalizes beyond the macOS instance |
| 733 | approach | `scripts/lib/build/facts.ts`, `scripts/verify.ts`, `scripts/lib/plan-touch-path-ssot-pairs.ts`, +5 | Fully retire `EXPECTED_CHECK_COUNT`, `warnOnCheckCountMismatch` and the `TOUCH_PATH_SSOT_PAIRS` new-check-module trigger rather than keep the manual-bump pattern | The constant compared `verify.ts`'s own `results.length` against a hand-bumped literal — one source computing both sides of its comparison, never fitting the § facts SSOT convention; with no companion scan to preserve, deletion removes the recurring hot-file contention instead of tolerating it |
| 735 | root-cause | `templates/companion-files/README.md` | Corrected the README's stale claim that `journeys.md` targets the repo root, to `documentation/reference/journeys.md` | `doc-health.check.ts` only walks `documentation/`, so a repo-root file could never trip `V-DOCHEALTH-02`, yet the issue reports exactly that failure; the template's own lifecycle frontmatter confirms the `documentation/reference/` target |
| 735 | refactor | `scripts/lib/check-common.ts`, `scripts/checks/doc-health.check.ts` | Hoisted `RootIndexRow`/`appendIndexRowIfAbsent` into `check-common.ts`, re-exported from `doc-health.check.ts` | `companion-file-sync.ts` in `lib/` needed the same idempotent-append primitive but `lib/` cannot import a `*.check.ts` module per `check-common.ts`'s documented layering; the shim meant zero edits to the existing test |
| 739 | approach | `src/references/review-core.md`, `src/agents/reviewer.md` | Replaced the flat 5-item checklist claim with a per-mode table and had §13/§24 cite it by name instead of restating their input contract | Restating the contract at three sites lets them drift independently (V-DOC-05); one canonical table matches the repo's primary-enforcement-site discipline |
| 734 | approach | `documentation/INDEX.md` | Append-merge of the rebase conflict: kept both sides' rows verbatim, ordered alphabetically by path within each block | `INDEX.md` is an append-only table where each landed doc owns one row; both hunks were positional, not semantic edits to a shared row, so preserving every row was the whole resolution — verified 39 rows on main → 41 on the branch, 2 additions, 0 deletions |
| 740 | approach | `scripts/checks/config-registration.check.ts`, `src/references/config-template.md` | Teach `parseConfigTemplateKeys` to honour a `(sub-keys: …)` marker on a documented parent row, rather than adding one Field row per leaf | #723 will attach a `resolution:` sentence to each nested block's single canonical row; 8 per-leaf rows would leave that target ambiguous and would not close the general defect class — one parser extension closes it permanently |
| 742 | approach | `scripts/build.test.ts` | Placed the new skills-target test inside the `applyPlatformConditionals` describe block rather than at the plan's cited line numbers | The cited lines pointed at the `compileContent` block in the current file; `applyPlatformConditionals` is the function under test and the plan's primary instruction named it, so the citation was stale rather than the instruction wrong |
| 742 | approach | `documentation/INDEX.md` | Resolved the rebase conflict as an append-merge, keeping `main`'s row from #735 and this branch's plan row | The now-familiar mechanical pattern (#743); no semantic conflict existed, so no alternative was weighed — arithmetic verified 45→46 rows, 1 addition, 0 deletions, 0 duplicates |
| 740 | approach | `documentation/INDEX.md` | Append-merge of the rebase conflict, inserting the branch's plans row into the plans section rather than at the file tail | Preserves both entries without duplication and matches the recurring pattern filed as #743 |
| 740 | approach | `documentation/reviews/review-fix-config-registration-…md` | Corrected the generated verdict from CHANGES REQUESTED to LGTM with the WARN disclosed as deferred, instead of patching the generator | True merge-readiness is LGTM (0 blockers, one WARN deferred to #736); fixing the `selectReviewFindings` defect is #737's job, not a mechanical promotion's |
| 742 | approach | `documentation/INDEX.md` | Second rebase after #740 merged and re-conflicted the file; append-merge keeping both sides' rows again | Sixth instance of the recurring collision (#743) and the first repeat on one PR — evidence the cost is one rebase per *intervening merge*, not per PR |
| 744 | reuse | `scripts/lib/build/facts.ts`, `scripts/verify.content-gates.test.ts` | Seeded three budget rows via the existing measured × 1.2 convention, re-measuring at the PR's own base rather than copying the plan's table | The plan was written 7 merges earlier; re-measurement confirmed zero delta, and reusing the established row shape avoided a differently-shaped variant (V-INT-01/V-INT-03) |
| 744 | reuse | `documentation/reviews/review-chore-content-gates-…md` | Added the `review-aggregate.ts` gate row alongside the generator's single ledger row | Every merged artifact (#706, #709, #713, #714) carries both rows; shipping the generator's bare output would have made this a fifth format variant at an established touchpoint |
| 751 | root-cause | `scripts/verify.model-routing-effort.test.ts` | #742 correctly replaced the "Unverified" note with a citation; the assertion in another file was outside its Touch-Paths and went stale | The prose is the intended end state, so the test was wrong, not the doc — a revert would have been the symptom fix |
| 751 | approach | `scripts/verify.model-routing-effort.test.ts` | Cross-file guard (prose names the cited test; the cited test still exists there) over a `/verified/i` word swap | A word swap passes on any prose containing "Verified", including a lie or a citation to a deleted test; the guard fails if either side drifts — proven by breaking each side in turn |
