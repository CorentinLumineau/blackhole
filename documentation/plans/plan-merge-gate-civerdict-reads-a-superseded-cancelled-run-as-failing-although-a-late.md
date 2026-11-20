---
type: plan
summary: "Judge only the latest run per check name in ciVerdict, ordered by startedAt then runId, failing closed on unorderable names (issue #1381)"
status: current
review_trigger: "on file change"
created: 2026-11-20
last_updated: 2026-11-20
---

# Plan - Issue #1381

## Objective

`ciVerdict` (`scripts/lib/merge-gate/ci-verdict.ts`) judges every check entry, so a superseded
CANCELLED/FAILED run sits next to a later SUCCESS run of the same name and the set reads red
(PR #1360, PR #1384, `pr-lint`). Judge only the **latest run per check name** while keeping every
fail-closed rule. Priority (V-PARETO-03): Gain 6 x (11 - Effort 3) = 48 (>= 30).

Root cause (V-FIX-01): `ForgeCheck` carries no ordering data and `ciVerdict` never groups by name, so
a snapshot that holds several runs of one name (an unfiltered check-runs list, an MCP payload, a
`statusCheckRollup`) is judged as if every run were current. The live REST adapter path
(`listChecks`) is not the source: GitHub's check-runs endpoint defaults to `filter=latest`.

## Design decisions

1. **Ordering key: `startedAt`, tie-break `runId`.** Not `completed_at`: the newest run of a name
   that is still running has `completed_at: null`, so ordering by it would rank an in-progress rerun
   below an older completed run and mask a pending head. `started_at` exists for queued and running
   runs alike. `runId` (the check-run `id`, monotonic per forge) resolves same-second starts. A
   timestamp that does not parse counts as absent.
2. **`ForgeCheck` gains two optional fields**: `startedAt?: string` (ISO 8601) and `runId?: number`.
   The names match the `gh` `statusCheckRollup` keys (`startedAt`), so a rollup array passed as
   `ForgeCheck[]` (the `Array.isArray` path of `checksFromSnapshot`) is ordered with no extra mapper.
   Optional, so `forge-fake.ts`, `pr-signals.ts` and every existing fixture compile and behave as before.
3. **Per-name rule** (`latestPerName(checks)`, exported from `ci-verdict.ts`, applied at the top of
   `ciVerdict` and `unconfiguredSkipWarning`, so the `requiredChecks` branch, the `executed` rule and
   the warning all read the same latest set):
   - one entry for a name: kept as is;
   - several entries, all with a valid `startedAt`: keep those with the maximal `startedAt`; among
     them, when every one has a `runId`, keep the maximal `runId`; otherwise keep all tied entries;
   - several entries where any lacks a valid `startedAt`: if all have `runId`, keep the maximal
     `runId`; otherwise **the name is unorderable and every entry is kept** (today's behavior, so any
     non-passing one is red). Ordering data is never guessed, and a name with no ordering data fails
     closed rather than picking an arbitrary run;
   - ids are only compared between entries that both carry one; commit statuses carry no `runId`, so
     the check-run and status id namespaces never mix.
4. **Fail-closed rules preserved by construction** (the verdict logic below the filter is untouched):
   an older SUCCESS cannot mask a newer FAILURE/CANCELLED (the older entry is dropped, the newer is
   judged); an older SUCCESS cannot mask a newer SKIPPED in an unconfigured repo (latest set is only
   SKIPPED, so `executed` is false and the verdict stays pending, and a required name stays pending);
   an older SUCCESS cannot mask a newer IN_PROGRESS/QUEUED (pending).
5. **Forge mappers supply the data where the forge has it**: `mapRestCheckRun` sets `runId: id`,
   `startedAt: started_at`; `mapRestStatus` sets `startedAt: created_at`; `mapGiteaStatus` sets
   `startedAt: created_at` (`GiteaCommitStatus` gains optional `created_at`); GitLab `prChecks` sets
   `runId: job.id`, `startedAt: job.started_at ?? job.created_at`. MCP check-run payloads are
   REST-shaped and ride `mapRestCheckRun`. Gitea and GitLab already return one row per name (combined
   status is latest per context; GitLab reads only the newest pipeline), so there the fields are
   informational and the filter is a no-op.
6. **Sibling #1383 (`total_count` truncation in `listChecks`) is not touched**: `listChecks`, its
   paging and its `per_page` stay as they are. `latestPerName` runs downstream in `ciVerdict`, so a
   later paginated `listChecks` feeds it unchanged, and the new fields add no dependency on the
   page size.
7. **Out of scope, flagged**: `ciOf` in `scripts/lib/campaign-status/pr-signals.ts` has the same
   every-entry reading but is fed only by live `prChecks`; file a follow-up to reuse `latestPerName`
   there rather than widen this PR.

## Touch-Paths

- `scripts/lib/forge-adapter/types.ts` (`ForgeCheck` optional fields)
- `scripts/lib/forge-adapter/github-rest.ts` (`RestCheckRun`/`RestStatus` types, `mapRestCheckRun`, `mapRestStatus`)
- `scripts/lib/forge-adapter/gitea.ts` (`GiteaCommitStatus.created_at`, `mapGiteaStatus`)
- `scripts/lib/forge-adapter/gitlab.ts` (`prChecks` job mapping)
- `scripts/lib/merge-gate/ci-verdict.ts` (`latestPerName`, applied in `ciVerdict`, `unconfiguredSkipWarning`)
- `scripts/lib/merge-gate/ci-verdict.test.ts`
- `scripts/lib/forge-adapter/github.test.ts`, `scripts/lib/forge-adapter/gitea.test.ts`, `scripts/lib/forge-adapter/gitlab.test.ts` (mapper assertions)
- `fixtures/ci-verdict/` (one new four-run `pr-lint` snapshot)

No `src/**` file changes, so no generated dist tree is touched.

## Documentation Impact

None - `docs_impact` is false; `ci-verdict.ts`'s header comment carries the rule. `src/references/merge-gate.md`
(605/606 lines) is deliberately not edited.

## Task Steps

1. **Failing tests first** in `ci-verdict.test.ts` (each marked below fails on current origin/main,
   V-TEST-11; the rest are fail-closed guards that pass today and must keep passing):
   - FAILS now: REST payload with `pr-lint` CANCELLED (older `started_at`) + SUCCESS (newer) is `green`,
     also with the array order reversed, and with `requiredChecks: ['pr-lint']`.
   - FAILS now: same-second `startedAt`, higher `runId` SUCCESS beats lower `runId` CANCELLED, so `green`.
   - FAILS now: older SUCCESS + newer SKIPPED, no required list, is `pending` (today `executed` is true so it reads green).
   - FAILS now: `unconfiguredSkipWarning` returns null when the SKIPPED run was superseded by a later SUCCESS.
   - FAILS now: a four-run `pr-lint` snapshot fixture (shape of PR #1360) exits 0 through the CLI.
   - GUARD: older SUCCESS + newer FAILURE is `red`; older SUCCESS + newer CANCELLED is `red`; older SUCCESS + newer
     IN_PROGRESS is `pending`; older SUCCESS + newer SKIPPED with `requiredChecks` is `pending`.
   - GUARD (no ordering data): CANCELLED + SUCCESS of one name, neither with `startedAt`/`runId`, is `red`; fully tied
     (same `startedAt`, no ids) CANCELLED + SUCCESS is `red`; one entry with data and one without is `red`.
   - GUARD: distinct names are never collapsed; a Vercel name still lands in `ignored`.
   Mapper tests: `mapRestCheckRun` returns `runId`/`startedAt` (FAILS now), `mapRestStatus` returns `startedAt` from
   `created_at` (FAILS now), `mapGiteaStatus` returns `startedAt` (FAILS now), GitLab `prChecks` returns `runId`/`startedAt`
   (FAILS now; existing `toEqual` expectations in `github.test.ts` and `gitlab.test.ts` are updated to the new shape).
2. Add the two optional fields to `ForgeCheck` and populate them in the four mappers above.
3. Add `latestPerName` to `ci-verdict.ts` per design decision 3 and route `ciVerdict` and `unconfiguredSkipWarning`
   through it (the `ignored` list and every check below the filter keep their current code).
4. Verify per `ci-first-verification.md`: scoped `bun test scripts/lib/merge-gate/ci-verdict.test.ts` and the adapter
   test files through `with-test-lock`, plus typecheck of the touched files; the full suite is CI's job.

## Task Breakdown

- [ ] **Failing tests** - **AC**: the tests marked FAILS above fail on origin/main for the stated reason before steps 2-3 land.
- [ ] **Type + mapper fields** - **AC**: `ForgeCheck` exposes optional `startedAt`/`runId`; mapper tests pass; no existing `ForgeCheck` literal needs editing outside the listed tests.
- [ ] **`latestPerName`** - **AC**: all ci-verdict tests pass, including the GUARD cases; `bun run scripts/ci-verdict.ts --checks <four-run pr-lint fixture>` exits 0.
- [ ] **Scope** - **AC**: `git diff --name-only` lists only Touch-Paths (V-SCOPE-02).

## Sprint Contract

Done when the listed tests pass, no fail-closed GUARD case changed verdict, and the PR body links `Closes #1381` and names #1383 as untouched.
