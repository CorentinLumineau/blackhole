---
type: reference
summary: "Running decision log of Hard Choice / Bugfix / Refactoring decision records"
status: current
review_trigger: "on file change"
created: 2026-07-20
last_updated: 2026-09-04
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

## Known Baseline (decision_log_silent_prs)

`decision_log_silent_prs` (`scripts/doc-health-signal.ts`) counts merged PRs whose number never
appears in the Records table below. As of issue #767 the count is ~168/173 merged issues — this
is expected steady-state, not a live defect. Two structural, non-defect causes dominate it:

- **Pre-mechanism history (structurally silent, permanent)**: this file and the orchestrator's
  append step did not exist before commit `ca1f6a1d` (2026-07-20, issue #421/#422). Every merged
  issue that landed before that date has no mechanism it could have hit — it is unrecoverable
  history, not a gap to close.
- **A closed six-week implementation gap (2026-07-20 → 2026-09-02)**: the append mechanism was
  documented (`src/agents/orchestrator.md` § Decision Record Append) from `ca1f6a1d` onward, but
  the invocable script, `scripts/decision-log-append.ts`, was not written until commit
  `2fe253e9` (2026-09-02, issue #750). Any `decision_records[]` a worker returned in that window
  had no automated path into this log. Issue #749 / PR #770 (commit `221e7030`) already recovered
  the 17 rows that survived in an uncommitted working-tree file from that window; anything else
  from that window that was never persisted to disk is permanently unrecoverable — there is
  nothing further to retroactively "fix" for it.

Since `2fe253e9` landed the mechanism has run again — PR #810's rows landed via commit
`2e51e674` — confirming the wiring works going forward. The current count is therefore the
expected floor from this point on; it will never shrink (history is unrecoverable). The only
thing worth watching is **growth past this floor after 2026-09-02**: a future merged PR whose
implementer worker returned a non-empty `decision_records[]` that still fails to reach this log
would indicate the wiring broke again. This does not change the signal's existing advisory
framing (`V-DOCHEALTH-03`: `doc_debt` stays advisory, no ledger append, no phase gate) — it only
records why the number is what it is, so the question is not re-litigated on every turn.

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
| 786 | root-cause | templates/hooks/pretooluse/utils/worktree-removal-guard.js | Added isPathQualifiedGitWordStart, ORed into findGitWordIndices, rather than widening isCommandWordStart's predecessor class to include '/' | isCommandWordStart's [\s;&\|(\n] class excluded '/', so a path-qualified git word was discarded and evaluateWorktreeRemoval returned null — fail-open. Widening the class would newly admit the --git-dir=/x/git fragment; the new predicate walks back to the real token boundary with an '=' crossing check instead |
| 786 | reuse | templates/hooks/pretooluse/utils/worktree-removal-guard.js | No reusable predicate found repo-wide; isCommandWordStart left untouched and extended by OR rather than modified | First occurrence of a path-qualified command-word predicate in the tree; extending by OR keeps the existing predicate's contract intact for its other caller |
| 786 | improvement | templates/hooks/pretooluse/utils/worktree-removal-guard.js | Restated findGitWordIndices' docstring to cover path-qualified tokens | Scout Check within the diff boundary; the existing docstring described only the shell-separator case and would have read as contradicting the new predicate |
| 810 | root-cause | scripts/lib/carry-target-allowlist.ts, scripts/lib/carry-staged-artifacts.ts | Chose an explicit target_path allowlist (documentation/**, root ARCHITECTURE.md) over patching only the ENOTDIR throw | The narrow fix would have left the arbitrary-code-execution vector (package.json, .github/workflows/*.yml, .git/hooks/*) open; the allowlist bounds the write surface to what artifact-contract.md's route table ever legitimately produces |
| 810 | root-cause | scripts/lib/carry-staged-artifacts.ts | Normalized target_path before the allowlist comparison, matching containment's existing normalize-before-compare against repoRoot | Containment normalized the path before comparing against repoRoot; the allowlist did not normalize before comparing against documentation/**. Two gates, two different representations of the same path — that mismatch, not either gate individually, was the vulnerability |
| 810 | reuse | scripts/lib/carry-target-allowlist.ts | New scripts/lib/carry-target-allowlist.ts modeled on ops-touch-paths.ts's named-glob-array + boolean-predicate shape | Reuse check found no existing carry-target-allowlist primitive (repo-wide grep returned 5 unrelated hits) — first occurrence of this concern |
| 810 | improvement | scripts/lib/carry-staged-artifacts.test.ts | Flipped the stale /etc/passwd 'keeps carrying' assertion whose comment explicitly warned against flipping it, and rewrote the comment to record that AC1's allowlist supersedes it | Scout Check within the diff boundary; containment still holds, it was simply never sufficient on its own to make a path safe to write |
| 852 | root-cause | src/references/implementer-schemas.md, src/references/worker-schemas.md, scripts/lib/worker-json/validators/implementer.ts | State pr_number once as the canonical top-level spelling, have the reviewer contract cite it, and make the implementer validator reject a top-level `pr` by name — no alias | The reported reviewer-vs-implementer divergence does not exist; the real cause is one contract carrying both spellings at different nesting levels with no rule saying which applies where, and a diagnostic that never names the field actually supplied |
| 852 | reuse | scripts/lib/worker-json/validators/implementer.ts | Reused the existing errors.push('<field>: …') diagnostic idiom instead of extracting a helper | Every validator reports field-level problems this way; a validateCanonicalPrField helper would be a single-consumer abstraction (V-YAGNI-03) |
| 852 | improvement | scripts/lib/worker-json/validators/implementer.ts | No improvement needed — code already clean | Reconciling the mixed `'x' in data` guards would change acceptance behaviour for explicit-undefined payloads, outside this diff's scope (V-SCOPE-01) |
