---
type: plan
summary: "Latest-run selection per proved producer (suite joined to workflow and event) in ciVerdict, fail closed when identity is unprovable (issue #1381)"
status: current
review_trigger: "on file change"
created: 2026-11-20
last_updated: 2026-11-20
---

# Plan - Issue #1381 (re-plan after review of PR #1385)

## Objective

`ciVerdict` (`scripts/lib/merge-gate/ci-verdict.ts`) judges every check entry, so a superseded
CANCELLED/FAILED run beside a later SUCCESS of the same check reads red (PR #1360, PR #1384,
`pr-lint`). Judge only the latest run of each **producer's** check, never the latest run of a bare
name, and keep every fail-closed rule. Priority (V-PARETO-03): Gain 7 x (11 - Effort 5) = 42 (>= 30).

Root cause (V-FIX-01): a check name does not identify one producer. The first plan grouped by name
alone (PR head 5095e129, F-00746), which hides an older FAILURE whenever two producers share a name
(two workflows with a `build` job, one workflow fired on push and pull_request, a commit status named
like a check run). The first plan's premise "GitHub's check-runs endpoint defaults to `filter=latest`,
so the live path is not the source" is false across suites (F-00749): `filter=latest` dedupes only
inside one check suite, and each pr-lint rerun of PR #1384's shape sits in its own suite.

## Design decisions

1. **Producer identity is proved, never guessed.** `ForgeCheck` gains `producer?: string`, an opaque
   key set only by a mapper that can prove it. A run joins a group only when it carries a `producer`;
   a run without one is never grouped, so it is always judged (fail closed, matrix row 7). Group key
   is `producer` + `\0` + `name`.
   - **GitHub Actions check run**: `actions:<workflow_id>:<event>:<head_branch>`, resolved by joining
     the run's `check_suite.id` to the workflow-run list. Verified on PR #1384 head 80e3639f: both
     pr-lint suites (121141391826, 121141393769) map to workflow 386981354 + event `pull_request`
     (same producer, row 1); Verify's suite 121141391380 is workflow 307277644 (another producer). A
     rerun reuses its suite (run_attempt 2). `workflow_id` alone fails row 3 (one workflow on two
     events); event alone fails row 2; check suite fails row 1; workflow name alone fails row 3. The
     `head_branch` segment stops two refs at the same SHA (two pushes) from collapsing.
   - **Commit status**: `status` (source discriminator, row 4). Statuses of one context may group with
     each other (the combined-status endpoint already returns the latest per context); they never
     group with a check run, whose key starts `actions:`.
   - **Any other check run** (a third-party app, a suite absent from the join): no `producer`, kept.
2. **Join mechanism (decision and trade-off).** The campaign's merge step feeds `ci-verdict.ts` from
   REST check-runs (`forge-channels.md` row "PR checks"), which carry `check_suite.id` but no workflow
   or event. Chosen: **an optional `--runs <file>` input to the CLI** holding the
   `GET repos/{repo}/actions/runs?head_sha=<sha>&per_page=100` payload, parsed by a pure mapper and
   joined inside `checksFromSnapshot(snapshot, runs?)`; and `listChecks` (live adapter path) makes the
   same one extra call itself. Cost: **one extra API call per verdict** (the orchestrator saves a second
   JSON next to the check-runs file; the CLI stays a pure function of its files). Rejected: (a) a
   `statusCheckRollup` snapshot source, which has `workflowName` but no event and no suite id, so it
   cannot prove identity (row 3); (b) one call per check run to `actions/runs/{id}`, N calls; (c) a
   mapper-only join, which has no data to join. Fail-closed property: with no `--runs` file, a runs
   payload that does not contain a run's suite, or a failed/short runs call (more than 100 runs for one
   SHA), the run has no `producer` and stays judged individually, which is today's behavior (the #1381
   symptom returns, never a false green). Documented, not hidden: `forge-channels.md` and
   `project-thread-mode.md` instruct the orchestrator to pass `--runs`.
3. **Runs index** (`scripts/lib/forge-adapter/github-rest.ts`, pure, exported): `suiteProducers(payload)`
   returns `Map<check_suite_id, key>` from `workflow_runs[]` entries that carry numeric `check_suite_id`
   and `workflow_id` and string `event` and `head_branch`; an entry missing a field is skipped; a suite
   id that appears twice with different keys is dropped from the map (ambiguous, fail closed). A runs
   payload that is not `{workflow_runs: []}` is a usage error in the CLI (exit 2), never ignored.
   `listChecks` catches only the runs call (not the check-runs or status calls) and falls back to an
   empty map, so a token without `actions: read` degrades to today's behavior; a test pins the fallback.
4. **Selection helper** `latestPerName(checks)` (kept exported from `ci-verdict.ts`, so #1386 can reuse
   it for `ciOf` without pulling anything else) per group:
   - single entry, or no `producer`: kept as is;
   - order by `startedAt` then `runId`. A timestamp is **absent** when it is missing, unparseable, or
     `<= 0` ms since the epoch (so the Go zero time `0001-01-01T00:00:00Z` that `gh` exports for a
     queued run, F-00748, never sorts as oldest). Any absent `startedAt` in the group: order by
     `runId` when every entry has one, else keep every entry. Ties on both keys keep all tied entries;
   - **non-executing newest** (F-00747): when every newest entry is COMPLETED with SKIPPED or NEUTRAL,
     also keep the nearest older entry whose conclusion is not SKIPPED/NEUTRAL when it is not SUCCESS
     (FAILURE, CANCELLED, ACTION_REQUIRED, or still running). An older SUCCESS beneath a newer skip is
     dropped, so the PR #1382 rule holds unchanged (latest SKIPPED, unconfigured repo: pending). A
     skip proves nothing was fixed; a newer SUCCESS or FAILURE supersedes as before.
5. **Mappers**: `mapRestCheckRun(row, suites?)` sets `runId: id`, `startedAt: started_at`, and
   `producer` when `suites?.get(row.check_suite?.id)` resolves; `mapRestStatus` sets
   `startedAt: created_at`, `runId: id`, `producer: 'status'`. `RestCheckRun`/`RestStatus` gain the
   optional fields. **Gitea and GitLab changes in PR head 5095e129 are reverted** (their mappers,
   `GiteaCommitStatus.created_at`, `prChecks` job fields and tests): both forges already return one row
   per name, so the fields have no consumer (V-YAGNI-01); their rows carry no `producer` and are never
   grouped.
6. **Out of scope, unchanged**: #1383 (`total_count` truncation; `listChecks` paging and `per_page`
   stay) and #1386 (`ciOf` in `pr-signals.ts`, which will import `latestPerName`). The new runs call
   adds no page-size dependency and degrades to keep-all on a truncated list.

## Touch-Paths

- `scripts/lib/forge-adapter/types.ts` (`ForgeCheck`: `startedAt?`, `runId?`, `producer?`)
- `scripts/lib/forge-adapter/github-rest.ts` (types, `suiteProducers`, `mapRestCheckRun`, `mapRestStatus`, `listChecks` runs call)
- `scripts/lib/merge-gate/ci-verdict.ts` (`latestPerName`, `checksFromSnapshot(snapshot, runs?)`, `unconfiguredSkipWarning`)
- `scripts/ci-verdict.ts` (`--runs <file>`, usage text, exit 2 on a malformed runs payload)
- `scripts/lib/merge-gate/ci-verdict.test.ts`, `scripts/lib/forge-adapter/github.test.ts` (matrix and mapper tests)
- `fixtures/ci-verdict/` (a PR #1384-shape snapshot plus its runs payload)
- `src/references/forge-channels.md` ("PR checks" row), `src/references/project-thread-mode.md` (step 3 only; same line, no net lines)
- plus all generated dist trees per `scripts/lib/build/targets.ts`, which include the marketplace bundle
  `plugins/blackhole-claude/` (byte-identical mirror of the five script paths above, including
  `plugins/blackhole-claude/scripts/lib/merge-gate/ci-verdict.ts`) and the compiled reference copies
- carry-step outputs: `documentation/plans/plan-merge-gate-civerdict-reads-a-superseded-cancelled-run-as-failing-although-a-late.md` and `documentation/INDEX.md` (regenerated)
- **Reverted to origin/main, not edited**: `scripts/lib/forge-adapter/gitea.ts`, `gitlab.ts`, `gitea.test.ts`, `gitlab.test.ts`
- Untouched on purpose: `src/references/merge-gate.md` (605/606 lines), `scripts/lib/campaign-status/pr-signals.ts` (#1386)

## Documentation Impact

`src/references/forge-channels.md` row "PR checks": add the second call (`GET repos/{repo}/actions/runs?head_sha=S&per_page=100`,
MCP `actions_list`) and name `--runs`. `src/references/project-thread-mode.md` step 3: one clause naming `--runs`
(replace words, add no line). `ci-verdict.ts` header carries the producer rule. Search-before-write: no new
`documentation/` file beyond the carried plan.

## Critical Files

- `scripts/lib/merge-gate/ci-verdict.ts`
- `scripts/ci-verdict.ts`
- `scripts/lib/forge-adapter/github-rest.ts`
- `scripts/lib/forge-adapter/types.ts`

## Codebase Conventions

- Pure mappers exported from `github-rest.ts`, consumed by files saved from MCP/REST channels (header comment there); the runs index follows the same shape.
- CLI flags go through `parseFlags`/`unknownFlagKeys` (`scripts/lib/argv-flags.ts`, V-ARGV-01); a flag without a usable value is exit 2, as `--required` already is.
- Fixtures are recorded JSON with a `description` field (`fixtures/ci-verdict/pr-event-green.json`).
- Playbook prose invokes `bun run scripts/ci-verdict.ts` by source path (V-INVOKE-01).
- Comment discipline: rationale once, at `latestPerName` / `suiteProducers`; no issue numbers in source comments (V-DOC-05/06); issue numbers only in test names.

## Database/API Schema Changes

`ForgeCheck` (public adapter type, V-API-01) gains three optional fields; no existing literal needs editing.
`checksFromSnapshot(snapshot, runs?)` gains an optional second parameter; every existing call stays valid.
CLI: new optional `--runs <file>`; existing invocations unchanged. No config key.

## Threat Model

Surface: the merge gate's CI verdict; the failure of concern is a **false green** (a failing producer
hidden, a PR merged red). The next review runs in security mode.

| STRIDE | Threat | Severity | Mitigation | Status |
|---|---|---|---|---|
| Spoofing | A check run or status named like a gating check hides an older real failure by being newer | High | `producer` is derived from the server-side suite-to-workflow join, never from the name; a status (`status`) or third-party run (no `producer`) never joins an `actions:` group; matrix rows 4 and 7 | Mitigated |
| Tampering | A forged `started_at` (future date) or zero time makes a run sort newest/oldest | High | Epoch/zero/unparseable times are absent, which forces `runId` order or keep-all (row 6); a far-future time can only reorder runs inside one proved producer (repo write access); the merge also requires the head SHA and review gates | Accepted Risk (inside one producer) |
| Repudiation | A superseded failure disappears with no trace | Medium | Dropped runs are not reported today; the verdict JSON is unchanged. No new log; a follow-up could list `superseded[]` | Accepted Risk |
| Information Disclosure | Runs payload exposes more than check-runs | Low | Only ids, workflow ids, event and branch are read; nothing is printed | Mitigated |
| Denial of Service | Truncated or failed runs call, 100+ runs per SHA | Medium | Missing suite means no `producer` means keep-all (pending/red, never green); degrade path pinned by test | Mitigated |
| Elevation of Privilege | A token without `actions: read`, or a mismatched runs file for another SHA, widens what is trusted | High | A suite not in the file is unjoined (keep-all); a duplicate suite id with differing keys is dropped; a malformed payload exits 2 | Mitigated |

## Red-first matrix (each row a test; "fails on" names the baseline that must go red)

| # | Case | Expect | Fails on |
|---|---|---|---|
| 1 | Same workflow, same event, distinct suites, older CANCELLED then newer SUCCESS, joined by runs payload (PR #1384 shape); also via the CLI fixture pair | green | origin/main (red) |
| 2 | Two workflows sharing a job name, older FAILURE then newer SUCCESS (also with `requiredChecks`) | red | PR head 5095e129 (green) |
| 3 | One workflow on `push` and `pull_request` for one SHA, older FAILURE then newer SUCCESS | red | PR head |
| 4 | Commit status and check run sharing a name (`status` vs `actions:`), status FAILURE older, run SUCCESS newer | red | PR head |
| 5 | Same producer, older FAILURE then newer SKIPPED, and then newer NEUTRAL (also: FAILURE, SUCCESS, SKIPPED stays superseded) | red, red, green | PR head |
| 6 | Same producer, older SUCCESS then QUEUED rerun with `startedAt` null, then with `0001-01-01T00:00:00Z`, with and without `runId` | pending | PR head (green on zero time) |
| 7 | No provable identity (no runs payload; suite absent from it; duplicate suite id with differing keys; array input with no `producer`): CANCELLED then SUCCESS of one name | red (every run kept) | passes on both (guard) |
| 8 | Latest SKIPPED, no required list, older SUCCESS of the same producer | pending (`missing_config`) | passes on both (PR #1382 rule, guard) |

Plus: `suiteProducers` and `mapRestCheckRun`/`mapRestStatus` field tests (fail on main: fields absent); `--runs` CLI test
(green with the pair, red without `--runs`, exit 2 on a malformed payload); `listChecks` runs-call failure degrades to keep-all.
Keep the old guards: older SUCCESS then newer FAILURE/CANCELLED red, then IN_PROGRESS pending; Vercel still in `ignored`.

## Execution Strategy & Stop Conditions

- Write the matrix tests first and run them against the PR head; if rows 2, 3, 4, 5 or 6 do not fail there, stop and re-read the row before writing any selection code.
- If the runs payload for a real head does not map `check_suite_id` to `workflow_id` and `event` for a github-actions check run, abort the join design and return blocked.
- If the producer key needs a field the runs API does not return, stop and halt for an owner decision instead of falling back to name-only grouping.
- If `git diff --name-only` shows a path outside Touch-Paths other than dist mirrors and carry outputs, revert that change before pushing.
- If the Gitea/GitLab revert changes any other file than those four, abort the revert and report.

## Task Breakdown

- [ ] **Revert gitea/gitlab edits** - revert only `gitea.ts`, `gitlab.ts` and their tests to origin/main. — **AC**: `git diff origin/main --name-only` lists none of the four paths.
- [ ] **Failing matrix tests** - add rows 1-8 plus mapper, `--runs` and degrade tests. — **AC**: rows 1 (vs main) and 2-6 (vs PR head 5095e129) are red for the stated reason before the fix lands; rows 7-8 pass.
- [ ] **Types and mappers** - `ForgeCheck` fields, `suiteProducers`, mapper joins, `listChecks` runs call. — **AC**: mapper and degrade tests pass; `bun test scripts/lib/forge-adapter/github.test.ts` green.
- [ ] **`latestPerName` and CLI** - producer grouping, absent-timestamp rule, non-executing rule, `--runs`. — **AC**: all `ci-verdict.test.ts` cases pass; `bun run scripts/ci-verdict.ts --checks <fixture> --runs <fixture>` exits 0 and exits 1 without `--runs`.
- [ ] **Docs** - forge-channels row, project-thread-mode step 3. — **AC**: both name `--runs`; `bun run build` mirrors them; `src/references/merge-gate.md` unchanged.
- [ ] **Scope and mirror** - **AC**: `git diff --name-only` lists only Touch-Paths, generated mirrors and carry outputs; the plugins/blackhole-claude copies are byte-identical to their sources.

## Quality Gate Results

- touch_paths_declared: PASS
- schema_baseline: PASS
- ac_mapping: PASS
- critical_files_exist: PASS
- mitigation_concrete: PASS

## Review directive

The next review of PR #1385 is a **FULL review in security mode, not a recheck**: re-audit every file
of the amended diff against the matrix, the threat model above and F-00746..F-00750, with an
independent security verification leg (V-SEC-07). Do not scope it to the delta of the fix round.

## Sprint Contract

Done when every matrix row is a passing test that was red on its baseline, scoped tests and typecheck
pass locally and CI is green on the pushed head (`ci-first-verification.md`), F-00746..F-00750 are
addressed, and the PR body links `Closes #1381` and names #1383 and #1386 as untouched.
