---
type: plan
summary: "Plan for making Gitea adapter tea calls work on tea 0.14.2 (output flag, paged lists, REST create)"
status: current
review_trigger: "on file change"
created: 2026-11-18
last_updated: 2026-11-18
---

# Plan: tea 0.14.2 JSON output flag (issue #1292)

## Objective
Make every `tea` call the Gitea adapter parses as JSON work on tea 0.14.2, so `bun run scripts/forge-sync.ts` no longer exits with `flag provided but not defined: -json`. Today `runTeaJson` (`scripts/lib/forge-adapter/tea-cli.ts:12-14`) appends `--json`, a flag no tea 0.14.2 subcommand defines.

## Findings (tea 0.14.2, `tea <sub> --help` run locally)
| Call site (`scripts/lib/forge-adapter/gitea.ts`) | tea subcommand | Output flag in 0.14.2 | Verdict |
|---|---|---|---|
| `issueList` (l.235) | `issues list` | `--output/-o` (simple,table,csv,tsv,yaml,json) + `--fields` | Needs `-o json` and explicit `--fields` (default fields omit `body`, so `mapIssue` would lose bodies) |
| `prList` no-state branch (l.381) | `pulls list` | `--output/-o` + `--fields` | Needs `-o json` and explicit `--fields` covering what `mapPr` reads |
| `issueCreate` (l.251) | `issue create` | none (no `--output`, no `--json`) | Cannot be fixed by a flag swap: no JSON mode exists |
| `prCreate` (l.405) | `pull create` | none | Same as `issueCreate` |
| `issueEdit`, `prComment` and other `runTeaText` calls | `issue edit`, `pull comment` | not JSON | Unaffected |
| `authStatus`, `forge-doctor.ts:30` | `logins` via `runTea` | not JSON | Unaffected |
| PR reads/lists with state, `prView`, `prFiles`, bodies | `tea api` REST | n/a | Unaffected |

Only `issueList` is on the forge-sync path; the create calls fail the same way when a campaign files an issue or opens a PR on Gitea.

## Touch-Paths
- `scripts/lib/forge-adapter/tea-cli.ts`
- `scripts/lib/forge-adapter/gitea.ts`
- `scripts/lib/forge-adapter/tea-cli.test.ts`
- `scripts/lib/forge-adapter/gitea.test.ts`

No `src/**` build source and no `templates/hooks/**` file is touched, so no `bun run build` and no plugin-cache version bump is required.

## Task Steps
1. **Red tests first** in `tea-cli.test.ts` and `gitea.test.ts` (one test per call-site shape, spying `child_process.spawnSync` or `teaCli.runTea` as the existing suites do).
2. **`runTeaJson`**: append `--output json` instead of `--json`; stay idempotent when the args already carry `--output`, `-o`, or `--json`-free input; never emit `--json`.
3. **`issueList`**: add `--fields index,title,body,state,labels,milestone,updated,assignees` (confirm names against `tea issues list --help` and the live JSON of one scratch call) so `mapIssue` keeps body, labels, milestone, `updatedAt`, assignees. Verify `labels` arrives as a string or array and that `normalizeLabels` handles it; if tea emits one comma-joined string, add the split in `gitea.ts` with a test.
4. **`prList` (no-state branch)**: same treatment with the `pulls list` field set `mapPr` needs (read `TeaPrRow`); add `--fields` accordingly.
5. **Shipped design (supersedes the text of step 5 below)**: `issueCreate` and `prCreate` use REST `POST repos/<slug>/issues|pulls` through `runTeaApiJson` directly, because `tea issue create` / `tea pull create` have no JSON output and their printed text was not relied on. Label names resolve to ids through a paged `GET repos/<slug>/labels` that stops on an empty page or `X-Total-Count`; an unknown label throws. `issueList` and `prList` walk `--page` (page size 50, Gitea's clamp) until an empty page, because `--limit` is per page.
5a. **Original step 5**: stop routing through `runTeaJson`. Run the create with `runTeaText`, read the new issue or PR number from tea's printed URL or index, then read the row back through the existing `runTeaApiJson` REST path (`GET repos/<slug>/issues/N`, `.../pulls/N`, the same mechanism `prView` already uses). If tea 0.14.2's create output does not expose the number, fall back to `tea api POST` with label-name to id resolution via `GET repos/<slug>/labels`. Choose by running the real command against a scratch repo; record the observed output in the PR body.
6. **Pagination check (advisory)**: `issueList` passes `--limit 200`, which tea treats per page. Confirm one page returns all open issues on a repo with 100+ (the ssl-management case in the issue); if tea caps below 200, loop `--page` until a short page and add a test. Report, do not widen scope, if it already works.
7. Run `tea issues list --help`-based live smoke: `tea issues list --repo <slug> -o json --fields index,title,state --limit 2` parses as JSON.

## Acceptance Criteria (machine-verifiable)
- **AC1**: no `--json` string remains in `scripts/lib/forge-adapter/tea-cli.ts` or `gitea.ts` (`grep -rn "'--json'" scripts/lib/forge-adapter/tea-cli.ts scripts/lib/forge-adapter/gitea.ts` returns nothing; exemption: none).
- **AC2**: `runTeaJson(['issues','list'])` spawns `tea` with argv containing `--output` followed by `json` and no `--json`; passing args that already contain `--output json` or `-o json` does not add a second flag (two tests in `tea-cli.test.ts`).
- **AC3**: `issueList` spawns `tea issues list` with `--output json` and a `--fields` value containing `body`, `labels`, `milestone`, `updated`; the mapped `ForgeIssue` keeps body and label names (test in `gitea.test.ts`).
- **AC4**: `prList` without a state filter spawns `tea pulls list` with `--output json` and `--fields` (test).
- **AC5**: `issueCreate` and `prCreate` spawn no argv containing `--json` or `--output`, and return a mapped issue or PR built from the REST read-back (one test each).
- **AC6**: `bun test scripts/lib/forge-adapter/tea-cli.test.ts scripts/lib/forge-adapter/gitea.test.ts` passes; the existing two `--json` expectations in `tea-cli.test.ts` (l.47, l.58) are rewritten, not deleted.
- **AC7**: `bun run scripts/forge-sync.ts` against a real Gitea campaign repo no longer prints `flag provided but not defined`, run once by the implementer and quoted in the PR (CI-delegation: this is one scoped script run, not a suite).

## Test Strategy
Unit tests with mocked spawn per call-site shape (list issue, list pr, create issue, create pr, idempotent flag); no full-suite local run (CI verifies). Local: `bun test` on the two touched test files through `with-test-lock`, plus typecheck of the touched files.

## Quality Notes
- Pareto: Gain 8, Effort 3, Priority 64 (above 30).
- V-INT-02: reuse `runTeaApiJson`; no new REST helper.
- Data-structure citation: n/a (no key/value membership assertions).
- ADVISORY touch_paths_ssot_gap: none expected; no check-module row-add involved.
