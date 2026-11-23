---
type: plan
summary: "Drop a CANCELLED run in ciVerdict only when a newer pull_request run of the same workflow and single PR, in a newer suite with a higher check-run id, replaced it; judge everything else (issue #1381)"
status: current
review_trigger: "on file change"
created: 2026-11-20
last_updated: 2026-11-23
---

# Plan - Issue #1381 (re-plan 2, after review iteration 2 of PR #1385)

## Revision note (turn 165)

This revision replaces the "latest run per proved producer" design that PR #1385 head
`53025ccb` implements. What changed and why:

| Change | Why |
|---|---|
| Only a COMPLETED **CANCELLED** run can ever be dropped; FAILURE, ACTION_REQUIRED, TIMED_OUT, SKIPPED, NEUTRAL, SUCCESS and unfinished runs are always judged | Narrowest rule that fixes the real shape (#1360, #1384: a run cancelled by the `pr-lint` concurrency group). A later-ordered run can no longer hide an older FAILURE under any ordering (F-00753, F-00756) |
| Producer proved only for `event == "pull_request"` with **exactly one** `pull_requests[]` entry; key adds the PR number and base ref | F-00754: two PRs from one head branch list both PRs on each run (length 2, unproved); `push`, `workflow_dispatch`, `repository_dispatch` and every other event are unproved |
| `ForgeCheck.suiteId` kept; a run is only ever replaced by a run of a **different, newer** suite | F-00754 same-suite siblings (a matrix job with a static name, a tied start time) |
| Order by server-assigned check-run id **and** suite id, both strictly newer; `startedAt` is only a veto (newer-by-id but earlier-start keeps both) | F-00753 / F-00756: no ordering decision rests on a timestamp |
| Non-executing-newest rule (F-00747) and the tier ordering code deleted | Moot for a FAILURE, which is never dropped. Not moot for a CANCELLED run: fix round 4 (owner ruling F-00834) lets only a run that executed, or is still running, replace one; a newer NEUTRAL, SKIPPED or CANCELLED run does not (design decision 1, rows 15-19) |
| `mapRestStatus` reverted to origin/main (no `producer`, `runId`, `startedAt`) | A commit status has no CANCELLED state, so it can never be dropped; the fields lose their only consumer (V-YAGNI-01) |
| `src/references/merge-gate.md` moves into Touch-Paths | F-00755: the poll merge path calls `ci-verdict.ts` without `--runs`, so the fix was inactive there |
| `listChecks` join failure writes one stderr line | F-00757 |
| Rationale comment lives once, on `withoutSupersededCancelled` | F-00758 (V-DOC-05) |
| Owner chose option A (CANCELLED only) on 2026-11-23; recorded in § Owner decision |  Resolves the one clarification marker |
| PR retitled; matrix extended with rows 9-14 | Title named the rejected per-check-name design; every sibling shape needs a red-first test |
| `plan_base_commit` restamped to main `13c34e83` | Main moved from `5da2611`; `git diff --name-only 5da2611..13c34e83` over every Touch-Path is empty, `merge-gate.md` is still 605 lines |

## Failed approaches (do not re-plan)

1. Group runs by **check name** alone (PR head 5095e129, F-00746): two producers sharing a name
   collapse and an older FAILURE is hidden.
2. Group by **check suite**: each concurrency-cancelled run sits in its own suite (#1360: runs
   653-656, four suites), so it re-opens #1381.
3. Group by **workflow name** alone: one workflow on push and pull_request collapses.
4. Key `actions:<workflow_id>:<event>:<head_branch>` ordered by `startedAt` first (PR head
   53025ccb): an independent verifier showed it flips red to green for sibling runs sharing the
   full key (two PRs from one head branch to different bases; `workflow_dispatch` /
   `repository_dispatch` runs with different inputs, as in `release-cadence.yml`; same-suite
   siblings with a tied start time), and lets a later-started run hide an older FAILURE when
   run-id order disagrees.

## Objective

`ciVerdict` (`scripts/lib/merge-gate/ci-verdict.ts`) judges every check entry, so a CANCELLED
`pr-lint` run that the workflow's own concurrency group cancelled reads red beside the newer run
that replaced it (PR #1360, PR #1384). Drop a CANCELLED run only when a newer run provably replaced
it, and judge everything else exactly as origin/main does. Priority (V-PARETO-03): Gain 7 x
(11 - Effort 5) = 42 (>= 30).

Root cause (V-FIX-01): the verdict has no notion of replacement. A check name does not identify a
producer, and even a full producer key (workflow, event, branch) does not prove the newer run
replaced the older one. Replacement is provable only from server-assigned data for one narrow,
observed shape: a `pull_request` run of the same workflow, for the same single open PR, in a newer
suite with a higher check-run id.

### Evidence (live GitHub data, gathered for this re-plan)

PR #1360 head `e6bf7efb` (`filter=latest`, the campaign's REST path):

| check run | conclusion | started | suite | workflow run (number, attempt) |
|---|---|---|---|---|
| 136260270795 | success | 11:29:25 | 121066561024 | 44728009301 (653, 1) |
| 136260445105 | **cancelled** | 11:29:49 | 121066700170 | 44728059373 (654, 1) |
| 136260534015 | success | 11:30:01 | 121066750703 | 44728078251 (655, 1) |
| 136267644473 | success | 11:45:34 | 121072422323 | 44730189679 (656, 1) |

All four: `workflow_id` 386981354, `event` pull_request, `head_branch`
`blackhole/issue-1347-guard-gaps`. The cancelled run's annotation reads "Canceling since a higher
priority waiting request for pr-lint-1360 exists" (`pr-lint.yml`: `concurrency.group:
pr-lint-${{ github.event.pull_request.number }}`, `cancel-in-progress: true`). So the #1381 shape
is **cross-run, cross-suite, attempt 1**, not a rerun.

PR #1384 head `80e3639f`: run 667 (suite 121141391826) was cancelled by run 668 (suite
121141393769), then the campaign re-ran 667 (attempt 2, same suite). `filter=all` returns 5 check
runs (the attempt-1 CANCELLED and the attempt-2 SUCCESS share suite 121141391826); the default
`filter=latest` returns 4 and omits the attempt-1 CANCELLED. A rerun therefore never needs this
fix on the documented REST path.

`pull_requests[]` on workflow runs (observed): empty (`[]`) on every run of the merged PRs checked
(#1360, #1361, #1369, #1374, #1380, #1384), and `1385:main` on every run of the one open PR (#1385).
**Inferred, not observed** (only one open PR existed): GitHub computes the list at query time from
open PRs whose head matches, so the merge gate (which only judges open PRs) sees it populated for
same-repo PRs, a fork or closed PR sees it empty, and two open PRs from one head branch list both
PRs on every run. Row 9a covers both possible behaviours of that last case.

Failed-then-passed shape (observed, pr-lint workflow 386981354, last 300 runs): heads `0e105ec5`
(failure, success, success), `cca09a76` (failure, failure, success) and `d77eb8e9` (failure,
failure, success, cancelled, success, success) each carry an older FAILURE followed by a newer
SUCCESS on the same head (a PR body or label fixed between `edited`/`labeled` runs). Merge-gate step
2's remedy reruns only `cancelled` runs; a FAILURE goes to `ci-diagnosis.md`. See § Owner decision.

**What distinguishes the true supersession from the sibling shapes**:

| Field | #1360 / #1384 true supersession | Two PRs, one head branch | dispatch runs | same-suite siblings | rerun in one suite |
|---|---|---|---|---|---|
| `event` | pull_request | pull_request | workflow_dispatch / repository_dispatch | any | any |
| `pull_requests[]` length | 1 (same number, same base) | 2 on every run (inferred), or 1 with different numbers | 0 | - | - |
| `check_suite_id` | different, newer | different | different | **same** | **same** |
| check-run id | higher on the newer run | - | - | - | - |
| verdict under this plan | CANCELLED dropped, green | kept, red | kept, red | kept, red | kept, red (and absent on `filter=latest`) |

## Design decisions

1. **Supersession rule** (`withoutSupersededCancelled(checks)` in `ci-verdict.ts`, exported; it
   replaces `latestPerName`, and #1386 will import it under this name). Drop entry C iff all hold:
   - C is `status: COMPLETED`, `conclusion: CANCELLED`, and carries `producer`, `suiteId` and
     `runId`;
   - some other entry N has the same `producer` and `name`, `N.suiteId > C.suiteId`, and
     `N.runId > C.runId` (both numeric, both server-assigned);
   - and it is not the case that both carry a usable `startedAt` with `start(N) < start(C)`
     (usable: parses to a moment after the epoch, so the zero time `0001-01-01T00:00:00Z` of a
     queued run is unusable, F-00748). A disagreement between id order and start order keeps both;
   - and N executed or is still running: N is QUEUED or IN_PROGRESS, or COMPLETED with a conclusion
     other than NEUTRAL, SKIPPED or CANCELLED (owner ruling 2026-11-23, F-00834). A newer NEUTRAL or
     SKIPPED run leaves C in place, so the verdict is red. Since a CANCELLED N never replaces, a
     replacing run is never itself dropped, and the start veto cannot be bypassed through a chain of
     CANCELLED runs (F-00852).
   Every other entry is kept and judged by the unchanged `ciVerdict` body. N's own conclusion is
   judged as is: a newer FAILURE stays red, a newer QUEUED stays pending, a latest CANCELLED with
   no newer run stays red (the issue's "a name whose latest run is CANCELLED stays non-green").
   Deleted from head: `tiersNewestFirst`, `isNonExecuting`, the F-00747 older-tier loop.
2. **Producer identity** (`suiteProducers(payload)` in `github-rest.ts`): for each
   `workflow_runs[]` entry with numeric `check_suite_id` and `workflow_id`, `event ===
   "pull_request"`, string `head_branch`, and `pull_requests` an array of **exactly one** entry
   with numeric `number` and string `base.ref`, map the suite to
   `actions:<workflow_id>:pull_request:<head_branch>:<number>:<base.ref>`. Any other event, an
   empty or multi-entry or malformed `pull_requests`, or a missing field: no entry (unproved). A
   suite id claimed by two different keys is dropped (ambiguous). Suite ids are per head SHA, so a
   runs file for another SHA joins nothing. A payload that is not `{workflow_runs: [...]}` throws
   (CLI exit 2, unchanged).
3. **Mapper**: `mapRestCheckRun(row, suites?)` sets `suiteId: row.check_suite.id` when numeric
   (always, joined or not), `runId: row.id`, `startedAt: row.started_at`, and `producer` when the
   suite resolves. `mapRestStatus` reverts to origin/main.
4. **Join transport** (unchanged decision from re-plan 1): `--runs <file>` on the CLI holding
   `GET repos/{repo}/actions/runs?head_sha=<sha>&per_page=100`; `listChecks` makes the same call
   itself. On failure `listChecks` writes one stderr line, `listChecks: workflow-runs join failed
   (<message>); every check run is judged on its own`, and keeps the empty map (F-00757). No
   `--runs`, a short or failed runs list, or an unjoined suite: no `producer`, nothing dropped,
   today's behavior (red, never a false green).
5. **Comment discipline** (F-00758): the rationale (why a name and a producer key do not prove
   replacement, why only CANCELLED, why ids order) lives once, in the `withoutSupersededCancelled`
   doc comment. `suiteProducers` says only which runs yield a key and refers to
   `withoutSupersededCancelled` by name; the `ForgeCheck` field comments are one-line descriptions
   with no rationale; `checksFromSnapshot` and the `listChecks` comment name the function, nothing
   more. No issue numbers in source comments (V-DOC-06).
6. **Narrowing (fail closed over coverage)**: these shapes stay red as on origin/main. A
   concurrency-cancelled `push` run, a cancelled run of a fork PR (`pull_requests` empty), and a
   rerun seen through an unfiltered (`filter=all`) or MCP snapshot keep merge-gate step 2's
   existing remedy (`cancelled` → rerun once; a rerun in one suite is deduped by `filter=latest`).
   **An older FAILURE followed by a newer SUCCESS of the same PR workflow also stays red**; see
   § Owner decision.
7. **#1383 stays separate** (`checksFromSnapshot` ignores `total_count`). This plan adds no read
   of `total_count` on either payload and no paging. It does not widen #1383: an entry is dropped
   only when its replacing run is present in the same snapshot, and a truncated runs list only
   removes producers (keep-all). #1386 (`ciOf` in `pr-signals.ts`) stays separate and will import
   `withoutSupersededCancelled`.

## Owner decision (2026-11-23)

The owner chose **option A, "cancelled only"** (orchestrator question channel, 2026-11-23,
resume_context clarify-resolved): only an older CANCELLED run that a newer run provably replaced is
dropped. Option B (also drop an older FAILURE, ACTION_REQUIRED or TIMED_OUT under the same proof)
was rejected.

**Accepted limitation (owner's choice, not a threat row)**: the failed-then-passed shape stays red.
An older FAILURE followed by a newer SUCCESS of the same PR workflow on one head is judged as on
origin/main. Merge-gate step 2 reruns only `cancelled`, so such a head goes to `ci-diagnosis.md`.
Observed in the last 300 pr-lint runs (workflow 386981354) on heads `0e105ec5` (failure, success,
success), `cca09a76` (failure, failure, success) and `d77eb8e9` (failure, failure, success,
cancelled, success, success).

**Second ruling (2026-11-23, F-00834)**: "Only a newer SUCCESS (or a failing run) replaces a
CANCELLED run; a newer NEUTRAL or SKIPPED run leaves the verdict red. Fail closed." A newer run
still QUEUED or IN_PROGRESS keeps replacing (verdict pending). Accepted cost: a job that is always
SKIPPED on PRs (the tag-only Release Notes Gate in `verify.yml`, under cancel-in-progress
concurrency) whose CANCELLED run is followed by a SKIPPED one stays red until that run is re-run.
Whether GitHub reports a job whose job-level `if:` is false as CANCELLED or SKIPPED when its run is
cancelled is not determined: GitHub's workflow cancellation reference says the `if:` of running
jobs is re-evaluated on cancel, but does not state the conclusion of a job whose `if:` was false.

## Touch-Paths

- `scripts/lib/forge-adapter/types.ts` (`ForgeCheck`: `startedAt?`, `runId?`, `suiteId?`, `producer?`; one-line comments)
- `scripts/lib/forge-adapter/github-rest.ts` (`RestWorkflowRuns` gains `pull_requests`; `suiteProducers`; `mapRestCheckRun` sets `suiteId`; `mapRestStatus` reverted to origin/main; `listChecks` stderr line)
- `scripts/lib/merge-gate/ci-verdict.ts` (`withoutSupersededCancelled` replaces `latestPerName` and its helpers; `ciVerdict` and `unconfiguredPendingMessage` call it)
- `scripts/ci-verdict.ts` (`--runs` usage line reworded to the new rule)
- `scripts/lib/merge-gate/ci-verdict.test.ts`, `scripts/lib/forge-adapter/github.test.ts`
- `fixtures/ci-verdict/superseded-run.json`, `fixtures/ci-verdict/superseded-run-runs.json` (re-recorded to the #1360 shape; runs entries carry one `pull_requests` entry, labelled constructed in `description`)
- `src/references/merge-gate.md` (lines 34-38 only, reworded to name `--runs <runs file>`, no line added)
- `src/references/forge-channels.md` ("PR checks" row) and `src/references/project-thread-mode.md` (step 3): already name `--runs`; touched only if the wording must match the new rule, same line count
- plus all generated dist trees per `scripts/lib/build/targets.ts`, including the marketplace bundle `plugins/blackhole-claude/` (byte-identical copies of the four script sources above) and the compiled reference copies of the three `src/references/` files
- carry-step outputs: `documentation/plans/plan-merge-gate-civerdict-reads-a-superseded-cancelled-run-as-failing-although-a-late.md` and its `documentation/INDEX.md` row (regenerated from the plan's `summary`)
- Must stay equal to origin/main: `scripts/lib/forge-adapter/gitea.ts`, `gitlab.ts`, `gitea.test.ts`, `gitlab.test.ts`, `scripts/lib/campaign-status/pr-signals.ts` (#1386)

## Documentation Impact

- `src/references/merge-gate.md` § CI-wait poller contract (line 36): the command becomes
  `bun run scripts/ci-verdict.ts --checks <file> --runs <runs file>`; rewrap lines 34-38 inside the
  same 5 lines (file stays at 605 of 606).
- `src/references/forge-channels.md` and `project-thread-mode.md`: already carry `--runs` from
  the previous round; keep.
- `scripts/ci-verdict.ts` usage text: "`--runs`: ... lets a newer pull_request run of the same
  workflow and PR replace an older CANCELLED run, unless that newer run ended NEUTRAL, SKIPPED or
  CANCELLED; without it every run is judged".
- Search-before-write: no new `documentation/` file beyond the carried plan (updated in place).

## Critical Files

- `scripts/lib/merge-gate/ci-verdict.ts`
- `scripts/ci-verdict.ts`
- `scripts/lib/forge-adapter/github-rest.ts`
- `scripts/lib/forge-adapter/types.ts`
- `src/references/merge-gate.md`

## Codebase Conventions

- Pure mappers exported from `github-rest.ts` and consumed by files saved from MCP/REST channels; `suiteProducers` follows that shape.
- CLI flags go through `parseFlags`/`unknownFlagKeys` (`scripts/lib/argv-flags.ts`, V-ARGV-01); a flag without a usable value is exit 2.
- Fixtures are recorded JSON with a `description` field (`fixtures/ci-verdict/pr-event-green.json`); a constructed field is said to be constructed.
- Playbook prose invokes `bun run scripts/ci-verdict.ts` by source path (V-INVOKE-01).
- Comment discipline per design decision 5; issue numbers only in test names.
- `src/references/merge-gate.md` has a 606-line cap; check with `wc -l`.

## Database/API Schema Changes

- `ForgeCheck` (public adapter type, V-API-01): optional `startedAt?: string`, `runId?: number`,
  `suiteId?: number`, `producer?: string`. Relative to origin/main all four are new and optional;
  relative to head 53025ccb `suiteId` is added. No existing literal needs editing.
- `checksFromSnapshot(snapshot, runs?)`: optional second parameter (as on head).
- Export rename: `latestPerName` (head only, never on main) becomes `withoutSupersededCancelled`.
- CLI: optional `--runs <file>`; existing invocations unchanged. No config key.

## Threat Model

Surface: the merge gate's CI verdict. The failure of concern is a **false green** (a failing or
never-completed run hidden, a PR merged red). Every High row below names the mechanism and the
test that pins it.

| STRIDE | Threat | Severity | Mitigation | Status |
|---|---|---|---|---|
| Spoofing | A run of another producer (another workflow, event, PR, base, a dispatch with other inputs, a commit status, a third-party app) passes as the replacement of a gating run | High | `producer` comes only from the server-side suite-to-workflow-run join, only for `event == pull_request` with exactly one `pull_requests[]` entry, keyed on workflow id, branch, PR number and base ref; statuses and third-party runs carry none; nothing without a `producer` is ever dropped. Tests: matrix rows 2, 3, 4, 7, 9a, 9b, 10 and the `suiteProducers` event/length cases | Mitigated |
| Tampering | A forged, zero or skewed `started_at` makes a run sort newest and hide another | High | No decision orders by time: replacement needs a strictly higher check-run id **and** a strictly higher suite id (both server-assigned), `startedAt` can only veto (id/start disagreement keeps both), and only a COMPLETED CANCELLED entry can be dropped, so no ordering can hide a FAILURE. Tests: rows 6, 11, 13a, 13b, 13c, 14 | Mitigated |
| Tampering (residual) | A sibling PR from the same head branch is closed after its run; GitHub then lists only the open PR on that run, so the closed PR's newer run matches the open PR's key | Low | Effect is bounded to dropping a CANCELLED run of the open PR (never a FAILURE); a concurrency-cancelled run already has a newer run of its own PR, which is judged; the remaining case needs a manual cancel plus a sibling PR from the same branch, i.e. repo write access | Accepted Risk |
| Repudiation | A dropped CANCELLED run leaves no trace in the verdict | Medium | Verdict JSON unchanged; the run stays visible on GitHub; a follow-up may list `superseded[]` | Accepted Risk |
| Information Disclosure | Runs payload exposes more than check-runs | Low | Only suite id, workflow id, event, branch, PR number and base ref are read; nothing is printed except the join-failure message | Mitigated |
| Denial of Service | Truncated or failed runs call, more than 100 runs per SHA | Medium | Missing suite: no `producer`, nothing dropped (red or pending, never green); the failure is logged on stderr. Test: `listChecks` degrade test asserts keep-all and the stderr line | Mitigated |
| Elevation of Privilege | A token without `actions: read`, or a runs file for another SHA, widens what is trusted | High | A suite absent from the file is unjoined (keep-all); a suite claimed by two keys is dropped; a malformed payload exits 2; a failed join is logged, never silent. Tests: row 7 (four unproved variants), the `--runs` malformed-payload CLI test, the `listChecks` degrade test | Mitigated |

## Red-first matrix

Each row is a test. "Fails on" names the baseline that must produce the wrong verdict for the
stated reason before the fix lands. Rows 9-14 must each be shown wrong on head `53025ccb` before
the new selection code is written.

| # | Case | Expect | Fails on (reason) |
|---|---|---|---|
| 1 | #1360 shape: one PR workflow, event pull_request, one `pull_requests` entry, distinct suites, CANCELLED (lower id, suite, start) then SUCCESS; also via the CLI fixture pair; also with `requiredChecks: ["pr-lint"]` | green | origin/main 5da2611 (red: the CANCELLED entry is judged) |
| 2 | Two workflows sharing a job name, older FAILURE then newer SUCCESS (also with `requiredChecks`) | red | guard (red on head) |
| 3 | One workflow on `push` and `pull_request` for one SHA, older FAILURE then newer SUCCESS | red | guard |
| 4 | Commit status and check run sharing a name, status FAILURE older, run SUCCESS newer | red | guard |
| 5 | Same proved producer, older FAILURE then newer SKIPPED, then newer NEUTRAL | red, red | guard (red on head via its F-00747 rule) |
| 6 | Same proved producer, older SUCCESS then QUEUED run with `startedAt` null, then `0001-01-01T00:00:00Z`, with and without `runId` | pending | guard |
| 7 | No provable identity (no runs payload; suite absent from it; suite claimed by two keys; ForgeCheck[] input without `producer`): CANCELLED then SUCCESS | red | guard. On 5da2611 the test may not compile against the old API (F-00752); that is not a behaviour failure |
| 8 | Latest SKIPPED, no required list, older SUCCESS of the same producer | pending (`missing_config`) | guard. Same F-00752 caveat for the `requiredChecks` assertion on 5da2611 |
| 9a | Two open PRs from one head branch to different bases, in both possible GitHub behaviours: (i) every run lists both PRs (`pull_requests` length 2); (ii) each run lists only its own PR (one entry, different numbers and bases). Older CANCELLED then newer SUCCESS, and older FAILURE then newer SUCCESS | red (all four) | head 53025ccb (green: same `actions:<wf>:pull_request:<branch>` key) |
| 9b | Same as row 1 with `pull_requests: []` (fork or closed PR) | red | head (green) |
| 10 | Two `workflow_dispatch` runs of one workflow (different inputs), older CANCELLED then newer SUCCESS, and older FAILURE then newer SUCCESS; same for `repository_dispatch`; same CANCELLED case for two `push` runs | red (all) | head (green: dispatch and push key on event and branch only) |
| 11 | Same suite, same name (matrix with a static name), tied `startedAt`, CANCELLED with lower `runId`, SUCCESS with higher | red | head (green: the tie breaks on `runId`) |
| 12 | Rerun inside one suite (`filter=all` view): attempt 1 CANCELLED and attempt 2 SUCCESS share a suite, no other suite | red (by design; `filter=latest` omits attempt 1) | head (green). Plus the real #1384 `filter=all` 5-run shape with one constructed `pull_requests` entry: green (run 668's suite is newer and its check-run id higher), guard |
| 13a | Same proved producer, FAILURE with higher `runId` and suite but earlier `startedAt`, SUCCESS with lower id but later start | red | head (green: start order wins, FAILURE dropped) |
| 13b | Same, but the higher-id earlier-start run is CANCELLED | red | head (green) |
| 13c | CANCELLED with lower id and suite but later `startedAt` than the higher-id SUCCESS | red (start vetoes) | guard (red on head) |
| 14 | Same proved producer (row 1 identity), older FAILURE then newer SUCCESS | red (a FAILURE is never dropped) | head (green) |
| 15 | Same proved producer, no required list: `x` CANCELLED (suite 1, run 1) then `x` NEUTRAL (suite 2, run 2) | red | b3f696a7 (green: the NEUTRAL run replaced the CANCELLED one) |
| 16 | `pr-lint` CANCELLED then newer `pr-lint` SKIPPED, plus `verify` SUCCESS; required `[verify]` | red | b3f696a7 (green) |
| 17 | `pr-lint` CANCELLED then newer `pr-lint` SKIPPED; required `[pr-lint]` | red | b3f696a7 (pending) |
| 18 | Static-name matrix: `t` SUCCESS (suite 1, run 1), `t` CANCELLED (suite 1, run 2), `t` SUCCESS (suite 2, run 3), no list | green (the newer-suite SUCCESS executed, so it replaces) | guard (green on b3f696a7 too) |
| 19 | Chain: C1 CANCELLED (suite 11, run 1, start 11:45), C2 CANCELLED (suite 12, run 2, no start or the zero time), N2 SUCCESS (suite 13, run 3, start 11:29) | red (C2 never replaces C1; N2's earlier start vetoes) | b3f696a7 (green: C1 dropped via C2, C2 via N2) |

Plus: `suiteProducers` tests (pull_request with one entry yields the key with number and base;
push, workflow_dispatch, repository_dispatch, empty, two-entry and malformed `pull_requests` yield
none; ambiguous suite dropped), which fail on head for the dispatch/push/length cases;
`mapRestCheckRun` sets `suiteId` joined and unjoined (fails on head: field absent); `mapRestStatus`
equals origin/main output; `--runs` CLI test (green with the fixture pair, red without `--runs`,
exit 2 on a malformed payload); `listChecks` runs-call failure keeps every run and writes the
stderr line (fails on head: no stderr). Keep the old guards: older SUCCESS then newer
FAILURE/CANCELLED red, newer IN_PROGRESS pending; Vercel still in `ignored`.

## Execution Strategy & Stop Conditions

- Write rows 9-14 and the new `suiteProducers`/mapper/degrade tests first and run only those two
  test files against head 53025ccb; if any of rows 9a, 9b, 10, 11, 12, 13a, 13b, 14 does not give
  the wrong verdict there, stop and re-read that row before writing selection code.
- If the re-recorded row 1 fixture is not red on origin/main 5da2611, stop: the fixture lost the
  #1360 shape.
- If a real open-PR runs payload (`gh api "repos/CorentinLumineau/blackhole/actions/runs?head_sha=<PR head>"`)
  shows `pull_requests` empty on a same-repo open PR, abort the pull_requests-based key and return
  blocked to the orchestrator; never fall back to a key without the PR number.
- If any implementation step would drop an entry whose conclusion is not CANCELLED, stop: that is
  failed approach 4.
- If `wc -l src/references/merge-gate.md` exceeds 606 after the edit, revert that edit and reword
  inside the existing lines.
- If `git diff --name-only origin/main...HEAD` (three-dot: the branch is based on 5da2611 and main
  has moved) lists a path outside Touch-Paths other than dist mirrors and carry outputs, revert
  that path before pushing; never revert a path that only main changed.

## Task Breakdown

- [ ] **Red tests** - add matrix rows 9-14, the `suiteProducers` event/length cases, the `mapRestCheckRun` `suiteId` case and the `listChecks` stderr case to `ci-verdict.test.ts` and `github.test.ts`; rewrite the head tests whose expectation inverts or whose input lacks the new fields: the FAILURE, SUCCESS, SKIPPED case expecting green (now red, row 14 semantics), the `mapRestStatus` `producer: 'status'` assertion (now origin/main output), the `startedAt` tie test (now row 11, same suite, red), and row 1's inline cases (add `suiteId` and a single `pull_requests` entry). — **AC**: running `bun test scripts/lib/merge-gate/ci-verdict.test.ts` and `bun test scripts/lib/forge-adapter/github.test.ts` on head 53025ccb shows each new row failing with the wrong verdict named in the matrix (quote the failing assertion per row in the PR body).
- [ ] **Fixture** - re-record `fixtures/ci-verdict/superseded-run.json` and `superseded-run-runs.json` to the #1360 shape with one constructed `pull_requests` entry. — **AC**: `bun run scripts/ci-verdict.ts --checks fixtures/ci-verdict/superseded-run.json --runs fixtures/ci-verdict/superseded-run-runs.json --required pr-lint --required 'Protocol Conformance'` exits 0 after the fix and exits 1 without `--runs` (without a `--required`/`--config` list it exits 3: the recorded Release Notes Gate is SKIPPED); `description` names the constructed field.
- [ ] **Identity** - `suiteProducers` pull_request-only single-PR key, `suiteId` on `ForgeCheck`, `mapRestCheckRun`, `mapRestStatus` reverted. — **AC**: `git diff origin/main...HEAD -- scripts/lib/forge-adapter/github-rest.ts` shows no change inside `mapRestStatus`; the `suiteProducers` and mapper tests pass.
- [ ] **Selection** - `withoutSupersededCancelled` replaces `latestPerName`, `tiersNewestFirst`, `isNonExecuting`. — **AC**: every matrix row 1-19 passes; `grep -c "latestPerName\|tiersNewestFirst\|isNonExecuting" scripts/lib/merge-gate/ci-verdict.ts` returns 0 (scope: that file only, no exemptions).
- [ ] **Join diagnostics** - stderr line in the `listChecks` catch, fallback unchanged. — **AC**: the degrade test asserts the stderr line text and that the returned checks carry no `producer`.
- [ ] **Comments** - one canonical rationale on `withoutSupersededCancelled` (F-00758). — **AC**: `grep -n "does not identify\|never superseded" scripts/lib/forge-adapter/github-rest.ts scripts/lib/forge-adapter/types.ts` returns nothing (scope: those two files only, no exemptions); no `#\d+` in any added source comment line.
- [ ] **Poll path doc** - `src/references/merge-gate.md` names `--runs <runs file>` (F-00755). — **AC**: `grep -c -- "--checks <file> --runs <runs file>" src/references/merge-gate.md` returns 1 (flag and argument on one line) and `wc -l < src/references/merge-gate.md` prints 605 or 606; `bun run build` regenerates the mirrors.
- [ ] **PR hygiene** - retitle PR #1385 to `fix(merge-gate): let a newer run of the same PR workflow replace a CANCELLED run in ciVerdict` and update the body to the rule, the narrowing list (design decision 6) and "#1383 and #1386 untouched". — **AC**: `gh pr view 1385 --json title` returns that title; the body still contains `Closes #1381`.
- [ ] **Scope and mirror** - **AC**: `git diff --name-only origin/main...HEAD` lists only Touch-Paths, generated mirrors and carry outputs; each `plugins/blackhole-claude/` script copy is byte-identical to its source (`cmp`); each changed `.ts` transpiles with `bun build <file> --no-bundle --outdir <tmp dir>` (the repo has no tsc or tsconfig, so no typecheck runs locally); CI green on the pushed head.

## Quality Gate Results

Computed by `bun run scripts/plan-quality-gate.ts --plan-file <this plan> --repo-root <blackhole repo>` at main 13c34e83: `{"ac_mapping": true, "critical_files_exist": true, "mitigation_concrete": true}`.

- touch_paths_declared: PASS
- schema_baseline: PASS
- ac_mapping: PASS
- critical_files_exist: PASS
- mitigation_concrete: PASS
- ADVISORY: touch_paths_ssot_gap: none (`findTouchPathSsotGaps` returned `[]`)
- ADVISORY: ac_sweep_conflict / ac_sweep_scope: none; both grep-to-zero ACs state their scope and "no exemptions"
- V-THREAT-02: every High row (Spoofing, Tampering, Elevation of Privilege) is Mitigated with a named mechanism and test; the only Accepted Risk rows are Low or Medium
- clarification markers: 0 (owner decision recorded 2026-11-23: option A)
- Rulings ledger: `documentation/reference/product-principles.md` rulings_revision 7 read; no active ruling conflicts (R-002 `merge-mode-no-default` relies on the CI gate, which this plan keeps fail closed)

## Review directive

The next review of PR #1385 is a **FULL review in security mode, not a recheck**: re-audit every
file of the amended diff against matrix rows 1-19, the threat model above and F-00746..F-00758,
with an independent security verification leg (V-SEC-07) that tries each sibling shape in the
"what distinguishes" table against the code.

## Sprint Contract

Done when every matrix row is a passing test that was wrong on its stated baseline (rows 9-14 shown
wrong on 53025ccb, rows 15-17 and 19 on b3f696a7), scoped test files pass and changed sources transpile locally, CI is green on the pushed head
(`ci-first-verification.md`), F-00753..F-00758 are addressed, the PR is retitled, and the PR body
links `Closes #1381` and names #1383 and #1386 as untouched.
