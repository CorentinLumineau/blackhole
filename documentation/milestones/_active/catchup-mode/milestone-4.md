---
type: plan
summary: "Catchup-mode M4 plan: lane claim and release on the GitHub, Gitea and GitLab adapters (ADR-053 C4), the account-stable lane replacing the hardcoded OWN_LANES with the old list as fallback, forge-sync deciding ownership by the own lane label, a claim lease, and the claim CLI wired into the orchestrator dispatch playbook"
status: current
review_trigger: "on milestone completion"
created: 2026-11-17
last_updated: 2026-11-17
plan_base_commit: 1a80fca1
related:
  - documentation/milestones/_active/catchup-mode/README.md
  - documentation/milestones/_active/catchup-mode/discovery.md
  - documentation/milestones/_active/catchup-mode/outcomes.md
  - documentation/milestones/_active/catchup-mode/milestone-3.md
  - documentation/decisions/ADR-053-catchup-mode-quota-pacing.md
  - documentation/decisions/ADR-027-forge-adapter-interface.md
---

# M4: Lane claim

Track: standard. Branch: `design/catchup-mode` (shared, already checked out). Estimate: about 11 hours
(T1 1 h, T2 1.5 h, T3 1 h, T4 1 h, T5 1 h, T6 1.5 h, T7 45 min, T8 1.5 h, T9 1 h, T10 45 min), two
commits, one `bun run build`. Depends on M3 (shipped: `catchup.ts` with the registered `catchup.lane` and
`catchup.claim_lease_hours`, recorded but unused until now).

## Objective

After this milestone (ADR-053 C4):

1. `ForgeAdapter` has `claim(issue, lane, user)`, `release(issue, lane)` and `viewerLogin()` on GitHub,
   Gitea and GitLab. A claim adds `in-progress:<lane>` (through the existing `labelAdd`) and assigns the
   user, under a lease; a release removes the lane label and the assignee.
2. The lane comes from config (`catchup.lane`, plus the invocation-only `--lane`). It replaces the
   hardcoded `OWN_LANES` in `blocked-classes.ts`; `claude` and `blackhole` stay as the fallback when no lane
   is configured, and every output with no lane stays identical to today.
3. `forge-sync` decides ownership by the own lane label, not by the `claude/` or `blackhole/` branch prefix
   (the prefix survives only for an issue with no lane label at all).
4. A claim whose issue and open PR show no activity for `claim_lease_hours` is stale: `forge-sync` leaves
   the issue `ready`, and the next `claim` takes it over (`RECLAIMED`).
5. The campaign claims on dispatch and releases on merge, stop and failure, through `scripts/claim.ts`,
   wired into `src/references/orchestrator-dispatch.md`.

Out of scope: mercure `git-issue` (C5, separate repo), usage provider 4 (M2 D1), branch-only activity as a
lease signal (D1 below), any new status page panel (D3).

## Assumptions and deferred items (recorded, no interactive channel)

| # | Assumption | Consequence if wrong |
|---|-----------|----------------------|
| A1 | The lane is `catchup.lane` (registered in M3; the ADR's "account-stable `lane` config key"), not a new top-level key. `--lane` overrides it for one invocation, as in the launch gate | A top-level `lane` later is an alias row; additive |
| A2 | No lane means claims are off and every ownership rule is the legacy one, so `run` without a lane is byte-identical. With a lane set, `run` claims too (the lane is account-stable, not catchup-only). Config is read tolerantly in M4 surfaces (an invalid `catchup` block reads as no lane): the catchup gate already rejects it strictly, and `run` must not break on a block it never uses | A bad block silently disables claims under `run`; the catchup gate catches it first |
| A3 | Lease clock: the issue's `updatedAt` and the latest `updatedAt` of an open PR that closes it. An absent or unparseable time reads as live, never stale (fail closed toward the other claimant). The lease applies to `in-progress:*` labels only (`agent:*` is another tool's statement, always foreign) and only when a lane is set (A2) | A shorter-lived claim than intended frees an issue early |
| A4 | A reclaim removes the stale lane labels, adds the own one and assigns the user; other assignees are left alone (non-destructive) | Two assignees on a reclaimed issue; harmless |
| A5 | Races: after the write the claim is read back; if another non-stale lane label appeared, the lexicographically greater lane rolls back and returns `HELD`. Both claimants apply the same rule, so one survives. A read-back that precedes the other write leaves a small residual window | Two lanes briefly hold one issue; the next `forge-sync` shows `another lane:` on both and the owner sees it |
| A6 | `release` removes the own lane label and unassigns the authenticated user; with no own label it returns `NOT-HELD` and touches nothing. On stop, only claims with no open own PR are released; a claim with an open PR stays until merge (the lease covers an abandoned one). `--abandon` and a failed worker release their issue | A claim with a PR outlives a stop; bounded by the lease |
| A7 | Ownership: the lane label decides. An open PR is the campaign's own when its issue carries the own lane label; the `claude/`/`blackhole/` prefix is only the fallback for an issue with no lane label (work started before the lane was configured) | None for new work |
| A8 | `viewerLogin()` is a new adapter method: `claim` needs the user and no adapter exposes it. GitHub `GET user`, Gitea `tea api GET user`, GitLab `glab api user` | A caller passes `--user` and skips it |
| A9 | Gitea resolves labels by name and fails on an unknown one, so its channel creates `in-progress:<lane>` when missing (`ensureLabel`); GitHub and GitLab create labels on first use | Gitea claim fails loud, never dispatches |
| A10 | The `tea` and `glab` JSON field names for update time and assignees are not verified (`updated` or `updated_at`; assignees as names or objects). Mappers accept both spellings, tests pin them, a missing field reads as live (A3). T4 and T5 start by reading the CLI help (no network) | Stale detection never fires on that forge; safe direction |
| A11 | No Bash tool in the planning session: the file was written directly, not through `.tmp` and rename; `plan_base_commit` is the session-start HEAD (`1a80fca1`) | None |
| D1 | Branch-only activity (commits pushed, no PR yet) is not a lease signal: a foreign branch name is not derivable and the per-branch read is an extra API call. A PR covers the normal case | A branch-only claim older than the lease is reclaimable |
| D2 | mercure `git-issue` adopting the convention (C5) is a separate PR in the mercure repo | Interactive sessions stay invisible to campaigns until then |
| D3 | The status page gets no new panel; blocked rows keep the `another_lane` class | A page row can be added with a `bh-template-version` bump |
| D4 | A claim CLI forge failure (exit 1) never dispatches that issue this turn: it is a transient error, not a `HELD` | A forge outage pauses dispatch; safe |

## Task Breakdown

Every task is test-first: write the failing test, see it fail, then write the code. Run named files through
`with-test-lock` (one `bun test a b c` per task, never the full suite; CI runs it after the push). The
adapter tests spy the CLI wrapper (`spawnSync` for GitHub, `runTeaText`/`runTeaApiJson` for Gitea,
`runGlabText`/`runGlabJson` for GitLab), the existing pattern.

### T1. Lane vocabulary and the `OWN_LANES` fallback (RED then GREEN)

New `scripts/lib/lane.ts` (pure): `LEGACY_OWN_LANES` (`claude`, `blackhole`), `LANE_NAME` (the regex now
private in `catchup.ts`, exported here and imported back), `LANE_LABEL_PREFIX` (`in-progress:`),
`laneLabel(lane)`, `laneOfLabel(label)` (the one parser for `in-progress:*` and `agent:*`),
`ownLanes(lane)` (`{lane}` when set, else the legacy set), `readLaneConfig(config)` (tolerant:
`{lane, leaseHours}`, an invalid block reads as `{null, 24}`), `isClaimStale({updatedAt, activityAt, now,
leaseHours})` (A3). `scripts/lib/campaign-status/blocked-classes.ts`: delete `OWN_LANES` and `LANE_LABEL`;
`foreignLaneLabel(labels, lane?)`, `classifyBlocked(issue, issues, lane?)`, `groupBlockedRows(blocked,
issues, lane?)` take an optional lane (absent means the legacy set); `isOwnLaneBranch` keeps the legacy
prefixes.

Tests (new `scripts/lib/lane.test.ts`; cases added to `blocked-classes.test.ts`):

| Case | Expected |
|------|----------|
| `laneOfLabel` on `in-progress:acct-a`, `agent:cursor`, `bug`, `in-progress:` | `acct-a`, `cursor`, null, null |
| `ownLanes(null)` and `ownLanes('acct-a')` | `{claude, blackhole}`; `{acct-a}` |
| `readLaneConfig({})`, `{catchup:{lane:'acct-a',claim_lease_hours:6}}`, `{catchup:{lane:'Bad Lane'}}`, `{catchup:'x'}` | `{null,24}`, `{acct-a,6}`, `{null,24}`, `{null,24}` |
| `isClaimStale` at 25 h and 23 h with lease 24; `updatedAt` absent, `'garbage'`; `activityAt` 1 h ago with `updatedAt` 30 h ago | true, false, false, false, false |
| `foreignLaneLabel(['in-progress:cursor'])` with no lane; `['in-progress:claude']` with lane `acct-a`; `['in-progress:acct-a']` with lane `acct-a` | `in-progress:cursor`, `in-progress:claude`, null |
| `classifyBlocked` on a `in-progress:acct-a` issue with lane `acct-a` and notes `depends on upstream` | `dependency`, not `another_lane` |

Acceptance:
- `with-test-lock bun test scripts/lib/lane.test.ts scripts/lib/campaign-status/blocked-classes.test.ts scripts/lib/catchup.test.ts scripts/lib/campaign-status/report.test.ts` exits 0 with no existing assertion edited.
- `git grep -n "OWN_LANES" scripts/lib/campaign-status/blocked-classes.ts` returns nothing; `git grep -n "LEGACY_OWN_LANES" scripts` shows `lane.ts` as the only definition.

### T2. Adapter contract and the shared claim logic (RED then GREEN)

Depends on T1. `scripts/lib/forge-adapter/types.ts`: `ForgeIssue` gains optional `assignees?: string[]`,
`updatedAt?: string | null`; `ForgePr` gains `updatedAt?: string | null`; new `ClaimResult`
(`verdict: 'CLAIMED' | 'ALREADY-OWN' | 'RECLAIMED' | 'HELD' | 'CLOSED'`, `held_by?`), `ReleaseResult`
(`'RELEASED' | 'NOT-HELD'`), and on `ForgeAdapter`: `claim(issue, lane, user, lease?: {leaseHours; now?})`,
`release(issue, lane)`, `viewerLogin()`. New `scripts/lib/forge-adapter/claim.ts` (the way `dependencies.ts`
holds the shared logic over a per-forge channel): `ClaimOps {read, labelAdd, labelRemove, assign, unassign,
ensureLabel, viewer}` and `claimIssue(ops, ...)`, `releaseIssue(ops, ...)` implementing A3 to A6 once. Mappers
add the new fields only when the row carries them (so existing `toEqual` assertions hold).

Tests (new `scripts/lib/forge-adapter/claim.test.ts` over a fake `ClaimOps` recording calls):

| Case | Expected |
|------|----------|
| unclaimed open issue | `CLAIMED`; calls: ensureLabel, labelAdd `in-progress:acct-a`, assign user, one read back |
| already labelled and assigned | `ALREADY-OWN`, zero writes |
| labelled, not assigned | `CLAIMED`, assign only |
| `in-progress:acct-b`, updated 2 h ago, lease 24 | `HELD`, `held_by` `acct-b`, zero writes |
| `in-progress:acct-b`, updated 30 h ago; again with an `activityAt` 1 h ago (PR) | `RECLAIMED`, label b removed, a added; `HELD` |
| `agent:cursor` label, updated 30 h ago | `HELD` (no lease for `agent:*`) |
| closed issue | `CLOSED`, zero writes |
| read-back shows `in-progress:acct-b` fresh, lane `acct-z` then lane `acct-a` | `acct-z` rolls back, `HELD`; `acct-a` keeps, `CLAIMED` |
| release with own label; without | `RELEASED` (label removed, viewer unassigned); `NOT-HELD`, zero writes |
| `updatedAt` absent on a foreign claim | `HELD` |

Acceptance: `with-test-lock bun test scripts/lib/forge-adapter/claim.test.ts` exits 0; `git grep -nE "Date\.now|new Date\(\)" scripts/lib/forge-adapter/claim.ts` matches only the default of the `now` parameter.

### T3. GitHub adapter

Depends on T2. `github.ts` builds `ClaimOps` from REST (ADR-048): read `viewIssue` (extend `RestIssueRow`
with `assignees`, `updated_at`), labels through the existing `labelAdd`/`removeLabel`, `ensureLabel` a no-op
(A9), `POST repos/{r}/issues/{n}/assignees`, `DELETE` the same with `{assignees:[user]}`, `viewerLogin` =
`GET user` `.login`. `listIssues` and `listPrs` map `assignees` and `updatedAt`.

Tests (added to `github.test.ts`, the `mockApi` pattern; calls asserted by method and endpoint):
claim on an unclaimed issue posts the label then the assignee and returns `CLAIMED`; `HELD` makes no POST;
release removes the label and DELETEs the assignee; `viewerLogin` returns the login; `issueList` maps
`assignees` and `updatedAt`, and a row without them keeps the existing shape.

Acceptance: `with-test-lock bun test scripts/lib/forge-adapter/github.test.ts` exits 0, existing cases unedited.

### T4. Gitea adapter

Depends on T2. First step: `tea labels create --help` and `tea api --help` (read-only, no network) to
confirm the label-create flags and `tea api` method syntax; the argv below changes only if they differ.
`gitea.ts`: read `runTeaApiJson('GET', repos/{slug}/issues/{n})` (labels, assignees, `updated_at`); labels
through the existing `labelAdd` (`tea issue edit --add-labels`); `ensureLabel` runs `tea labels create`
and ignores "already exists" (A9); assign and unassign `PATCH repos/{slug}/issues/{n}` with the full
assignee list (Gitea replaces it); `viewerLogin` = `tea api GET user` `.login`. `mapIssue` accepts both
update-time spellings and both assignee shapes (A10); `mapGiteaApiPr` maps `updated_at`.

Tests (added to `gitea.test.ts`; `runTeaText`, `runTeaApiJson` spies): the exact argv for `ensureLabel`,
the label edit and the PATCH body (existing assignees kept plus the user); `HELD` writes nothing; release
PATCH drops only the user; both field spellings map; a missing label surfaces as a thrown error from
`ensureLabel` other than "already exists".

Acceptance: `with-test-lock bun test scripts/lib/forge-adapter/gitea.test.ts` exits 0, existing cases unedited.

### T5. GitLab adapter, then commit 1

Depends on T2. `gitlab.ts`: read `glabApiJson('projects/{enc}/issues/{iid}')` (labels, assignees with `id`,
`updated_at`); labels through the existing `labelAdd`/`labelRemove` (`glab issue update --label/--unlabel`,
GitLab creates labels on use); assign and unassign `PUT projects/{enc}/issues/{iid}?assignee_ids[]=...`
with the id list (query parameters, so the existing `glabApiJson(endpoint, method)` helper needs no new
flag); the user id from `glab api users?username=<user>`; `viewerLogin` = `glab api user` `.username`.
`mapIssue` and `mapMr` map `assignees` and `updated_at`.

Tests (added to `gitlab.test.ts`; `runGlabText`/`runGlabJson` spies): claim argv for label then PUT with the
union of ids; release PUT drops only the user; `HELD` writes nothing; `viewerLogin`; field mapping.

Acceptance: `with-test-lock bun test scripts/lib/forge-adapter/gitlab.test.ts scripts/lib/forge-adapter/github.test.ts scripts/lib/forge-adapter/gitea.test.ts scripts/lib/forge-adapter/claim.test.ts scripts/verify.forge-adapter-routing.test.ts` exits 0 (V-FORGE-01: no bare CLI spawn added).
Commit 1 (explicit paths): `feat(forge): lane claim and release on the three forge adapters`, body naming ADR-053 C4.

### T6. `forge-sync`: ownership by lane label and the lease

Depends on T1, T2. `scripts/lib/forge-sync.ts`: `SyncInput` gains optional `lane?: string | null` and
`claimLeaseHours?: number` (absent means null and 24, so every existing call is unchanged).
`foreignLaneLabel(entry.labels, lane)`; with a lane set and an `in-progress:*` label whose issue is stale
(A3: `isClaimStale` on the issue's `updatedAt` and the latest open closing PR's `updatedAt`), the label is
ignored, so the entry stays `ready`. `openPrIndex` takes the set of issue numbers carrying the own lane
label: a PR closing such an issue is own, a PR closing an issue carrying another lane is foreign, and the
branch prefix decides only for an issue with no lane label (A7). `scripts/forge-sync.ts`: a `--lane <name>`
flag (in the `unknownFlagKeys` list and `USAGE`), `readLaneConfig(config)` for the default, the `Config`
type gains `catchup?: unknown`; the summary line is unchanged.

Tests (added to `scripts/lib/forge-sync.test.ts`, its `sync()` helper; one case in `scripts/forge-sync.test.ts`):

| Case | Expected |
|------|----------|
| every existing case, no lane | unchanged and unedited (the guard) |
| lane `acct-a`: labels `in-progress:acct-a`, `in-progress:acct-b`, `in-progress:claude`, `agent:cursor` | ready; blocked `another lane: in-progress:acct-b`; blocked (legacy lane is foreign under a lane); blocked |
| lane `acct-a`, `in-progress:acct-b` updated 25 h ago; 23 h ago; no `updatedAt` | ready (reclaimable); blocked; blocked |
| the same stale label with an open PR closing it, `updatedAt` 1 h ago | blocked |
| lane `acct-a`, `agent:cursor` updated 48 h ago | blocked (no lease) |
| PR `foo/issue-9` closing #9, issue 9 labelled `in-progress:acct-a` | linked as the own PR |
| PR `blackhole/issue-9` closing #9, issue labelled `in-progress:acct-b` | not linked; blocked by the label |
| PR `blackhole/issue-4`, issue 4 with no lane label, lane set | linked (fallback, A7) |
| PR `cursor/x` closing #5, issue 5 with no lane label | `another lane: cursor/x` |
| CLI: `--lane acct-a` with a fake adapter | the lane reaches `syncQueue` |

Acceptance: `with-test-lock bun test scripts/lib/forge-sync.test.ts scripts/forge-sync.test.ts` exits 0 with the existing cases unedited.

### T7. Thread the lane through the status surfaces

Depends on T1. `scripts/lib/campaign-status/report.ts` passes `readLaneConfig(config).lane` to
`groupBlockedRows`; `dashboard.ts` `formatDashboard` takes an optional `lane` for `renderBlockedSection`;
`scripts/campaign-status.ts` passes it at the `formatDashboard` call. The report config type gains
`catchup?: unknown`.

Tests: one case each in `report.test.ts` and `dashboard.test.ts`: with config lane `acct-a`, an issue
labelled `in-progress:acct-a` and notes `depends on upstream` is class `dependency`, not `another_lane`;
without a lane the existing fixtures are unchanged.

Acceptance: `with-test-lock bun test scripts/lib/campaign-status/report.test.ts scripts/lib/campaign-status/dashboard.test.ts scripts/lib/campaign-status/blocked-classes.test.ts scripts/campaign-status.test.ts` exits 0.

### T8. The claim CLI

Depends on T2 to T5, T6 (adapter helper). New `scripts/lib/forge-adapter/for-campaign.ts`: `adapterForCampaign(
campaignDir, config)` holding the four lines `forge-sync.ts` uses to resolve forge and adapter, which
`forge-sync.ts` then imports (one resolution, V-INT-02). New `scripts/claim.ts` (built like `usage.ts`:
`parseFlags`, `unknownFlagKeys`, `import.meta.main`): exports `runClaim(argv, {adapter?, now?})`; flags
`claim <N>` or `release <N>` (exactly one), `campaign-dir`, `lane`, `user`, `lease-hours`, `now`. Lane:
`--lane`, else `readLaneConfig`; none means one JSON line `{verdict:'SKIP', reason:'no lane configured'}`
and no forge call (A2). Otherwise it calls `adapter.claim` (user from `--user` or `viewerLogin()`) or
`release` and prints one line `{verdict, issue, lane, user, held_by?}`; exit 0 on any verdict, 2 on bad
usage, 1 on a forge failure with the message on stderr (D4). `package.json`: `"claim": "bun run
scripts/claim.ts"`. `scripts/checks/argv-flags-adoption.check.ts`: add `'scripts/claim.ts'` (sorted) and fix
the header counts (18 to 19); `scripts/verify.argv-flags-adoption.test.ts` title 18 to 19.

Tests (new `scripts/claim.test.ts`: in-process `runClaim` with a fake adapter; one `spawnSync` case for the
exit codes): no lane gives `SKIP` and the fake adapter is never called; `claim 12` with a lane calls
`claim(12, lane, user)` and prints `CLAIMED`; `HELD` prints `held_by` and exits 0; `--lane` beats config;
`release 12` prints `RELEASED`; both or neither of `claim`/`release`, an unknown flag, a non-numeric issue
exit 2; a throwing adapter exits 1 with stderr.

Acceptance: `with-test-lock bun test scripts/claim.test.ts scripts/verify.argv-flags-adoption.test.ts scripts/forge-sync.test.ts` exits 0; `git grep -n "scripts/claim.ts" package.json scripts/checks/argv-flags-adoption.check.ts` shows both.

### T9. Docs, dispatch wiring and the wiring test

Depends on T8. Edit `src/` only.

- `src/references/orchestrator-dispatch.md`: new `## Lane claim and release (ADR-053 C4)`: before the status
  moves to `in-flight`, run `bun run scripts/claim.ts --claim <N> --campaign-dir .blackhole [--lane <pinned>]`;
  `CLAIMED`, `ALREADY-OWN`, `RECLAIMED` and `SKIP` dispatch; `HELD` or `CLOSED` do not (`status: blocked`,
  notes `another lane: in-progress:<held_by>`, the form `forge-sync` writes); exit 1 does not dispatch and
  retries next turn (D4). Release with `--release <N>`: on merge (after `phase-loop.md` Merge protocol step
  5), on a worker that returns failed, on `stop --abandon` and a `stop --now` worker that falls back to
  abandon, and on a stop for a claim with no open own PR (A6). Cites ADR-053 and `scripts/claim.ts` by path
  (the build keeps cited scripts in the shipped closure).
- One pointer line each at the dispatch site that sets `in-flight` (found by `Grep "status: in-flight"` in
  `orchestrator-delegation.md`, `orchestrator-runtime.md`, `queue-dag.md`; edit only the one site),
  `phase-loop.md` § Merge protocol, `phase-stop.md` (outside every Usage stop section, as in M3).
- `src/references/forge-sync.md`: the "held elsewhere" bullet and the ingest bullet say ownership is the own
  lane label (fallback to the branch prefix with no lane), and the lease; one sentence for `--lane`.
- `src/references/config-template.md`: the `catchup.lane` and `catchup.claim_lease_hours` rows say they are
  read by `scripts/claim.ts`, `forge-sync` and the status surfaces; the `## catchup` contract note drops
  "consumed from M4".
- `src/references/phase-catchup.md`: the single-account warning becomes "set `catchup.lane` per account
  before a second account runs"; one sentence that dispatch claims through `orchestrator-dispatch.md`.

Tests (new `scripts/lane-claim-docs.test.ts`, written first, reads the `src/` files): the dispatch section
names `scripts/claim.ts`, `--claim`, `--release` and each verdict; the three pointer sites cite `Lane claim`;
`forge-sync.md` names the lane label and the lease; `config-template.md` no longer says "consumed from M4";
`phase-catchup.md` names `catchup.lane`.

Acceptance:
- `with-test-lock bun test scripts/lane-claim-docs.test.ts scripts/verify.config-registration.test.ts scripts/verify.stop-mode.test.ts scripts/verify.playbook.test.ts` exits 0.
- targeted `with-test-lock bun run scripts/checks/stop-mode.check.ts` (and `config-registration`, `playbook`) report ok; the full verify runs in CI.
- `rg -c "Lane claim" src/references` lists the four files above.

### T10. Build, index row, commit 2, scout

Depends on T9. `with-test-lock bun run build`. Splice the `milestones/_active/catchup-mode/milestone-4.md`
row into `documentation/INDEX.md` (`bun run scripts/generate-doc-index.ts`, copy the one new row, never
overwrite the file); `bun run scripts/generate-doc-index.ts --check` exits 0. Commit 2 with explicit paths,
never `git add -A`: `feat(forge-sync): lane-label ownership, claim lease and the claim CLI`, body naming
ADR-053 C4 and D1 to D4, no AI attribution. Scout Check on the diff, one Improvement Record (planned
candidate: the stale "consumed from M4" wording and the `argv-flags-adoption` header counts the diff already
touches).

Acceptance: `git status --short` shows only planned `src/`, `scripts/`, `documentation/`, `package.json` and
rebuilt outputs; two commits on `design/catchup-mode` (T1-T5, then T6-T10); `ls
plugins/blackhole-claude/scripts/claim.ts plugins/blackhole-claude/scripts/lib/lane.ts` lists both.

## Critical Files

| File | Change | Why |
|------|--------|-----|
| `scripts/lib/lane.ts` | new: vocabulary, tolerant config read, lease | One parser and one lease rule (V-INT-02) |
| `scripts/lib/campaign-status/blocked-classes.ts` | `OWN_LANES` out, optional lane params | ADR-053 C4 fallback |
| `scripts/lib/forge-adapter/types.ts`, `claim.ts` (new) | contract, shared claim logic | One implementation for three adapters |
| `scripts/lib/forge-adapter/github.ts`, `github-rest.ts`, `gitea.ts`, `gitlab.ts` | `claim`, `release`, `viewerLogin`, new fields | BREAKING for all three adapters in one change |
| `scripts/lib/forge-sync.ts`, `scripts/forge-sync.ts` | ownership by lane label, lease, `--lane` | ADR-053 C4 |
| `scripts/lib/campaign-status/report.ts`, `dashboard.ts`, `scripts/campaign-status.ts` | pass the lane | Blocked classes stay right under a lane |
| `scripts/claim.ts` (new), `scripts/lib/forge-adapter/for-campaign.ts` (new), `package.json`, `scripts/checks/argv-flags-adoption.check.ts` | CLI, adapter helper, alias, allowlist | The orchestrator needs a command |
| `src/references/orchestrator-dispatch.md`, one dispatch site, `phase-loop.md`, `phase-stop.md`, `forge-sync.md`, `config-template.md`, `phase-catchup.md` | claim/release wiring and docs | ADR-053 C4 |
| Tests: `lane.test.ts`, `claim.test.ts`, the three adapter tests, `forge-sync.test.ts`, `claim.test.ts` (CLI), `lane-claim-docs.test.ts`, `blocked-classes.test.ts`, `report.test.ts`, `dashboard.test.ts` | new cases | Test-first evidence |
| `documentation/INDEX.md` | one row | Doc governance |

Not touched: `usage-budget.ts`, `pace-floor.ts`, `catchup.ts` beyond importing `LANE_NAME`,
`orchestrator-runtime.md` (V-STOP-03 scan), the status page template (D3), any mercure file (D2).

## Codebase Conventions

| Touchpoint | Convention | Source | Required by |
|------------|------------|--------|-------------|
| Adapter methods | Every forge behaviour is a `ForgeAdapter` method, implemented once per forge; shared logic sits over a per-forge channel like `dependencies.ts`; no bare forge CLI spawn outside `*-cli.ts` | `scripts/lib/forge-adapter/types.ts:133-167`, `dependencies.ts`, `scripts/checks/forge-adapter-routing.check.ts:25-47` | V-FORGE-01, V-INT-02, V-SOLID-03 |
| Adapter tests | Spy the CLI wrapper (`spyOn(teaCli, 'runTeaText')`, `spawnSync` mock for `gh api`) and pin the exact argv or method and endpoint | `scripts/lib/forge-adapter/gitea.test.ts:194-224`, `github.test.ts:41-52` | V-INT-01 |
| Existing label ops | Reuse `labelAdd`/`labelRemove`; never a second label writer | `github.ts:107-114`, `gitea.ts:395-405`, `gitlab.ts:254-271` | V-INT-02 |
| Lane parsing | One parser for `in-progress:*`/`agent:*`, one lease rule, both in `lane.ts` | `scripts/lib/campaign-status/blocked-classes.ts:26-45` (moved) | V-INT-02, V-DRY-01 |
| Config reads | Narrow per-consumer type, tolerant on surfaces `run` shares; strict `resolveCatchup` stays in the catchup CLIs | `scripts/lib/catchup.ts:36-53`, `scripts/forge-sync.ts:29` | V-KISS-01 |
| CLI shape | `parseFlags`/`unknownFlagKeys`, one JSON line, exit 0 on a verdict, 2 on bad usage, 1 on a forge failure, `main()` behind `import.meta.main`, V-ARGV-01 allowlist | `scripts/usage.ts`, `scripts/forge-sync.ts:89-110`, `scripts/checks/argv-flags-adoption.check.ts:12-31` | V-ARGV-01 |
| Queue write | `forge-sync` writes only through the state write guard; no claim state in `queue.json` | `scripts/forge-sync.ts:55-58` | blackhole-state.md |
| Docs | Edit `src/`, then `bun run build`; cite scripts by path; new doc rows in `documentation/INDEX.md` | `.claude/CLAUDE.md`, M3 outcome | V-DOC-GOV-02 |
| Usage-stop prose | A pointer outside every Usage stop section, forbidden words only in the one `Never on a usage stop:` list | `scripts/checks/stop-mode.check.ts:49-143` | V-STOP-03 |

## Dependency Blast-Radius

| Changed file | Downstream consumers | Blast radius |
|--------------|----------------------|--------------|
| `forge-adapter/types.ts` (3 methods, 3 optional fields) | the three adapters, `index.ts`, every test double typed `ForgeAdapter` (none found: tests construct the real classes) | MEDIUM: BREAKING for a missing implementation, caught by the three adapter suites |
| `blocked-classes.ts` signatures | `report.ts`, `dashboard.ts`, `forge-sync.ts`, tests | LOW: the new parameter is optional |
| `forge-sync.ts` ownership | `scripts/forge-sync.ts`, the orchestrator's every-turn sync | MEDIUM: guarded by the unedited existing suite; no lane means the legacy path |
| `forge-sync.md`, `config-template.md` | V-CONFIG-02/03, doc checks | LOW |
| `orchestrator-dispatch.md`, `phase-stop.md`, `phase-loop.md` | built trees, V-STOP-03, `playbook.check.ts` | MEDIUM: wording slips fail verify; targeted checks run locally |

Overall: MEDIUM. Each MEDIUM entry has an unchanged suite or a targeted check as its guard.

## Blast Radius

| Surface | Outside the diff | Why it matters |
|---------|------------------|----------------|
| Callers | The orchestrator runs `forge-sync` every turn and will run `claim.ts` per dispatch | With no lane both are byte-identical to today |
| Consumers | Status page and dashboard blocked classes; `merge-gate.md` reconciliation reads queue labels | The `another_lane` class is unchanged without a lane |
| Config | `catchup.lane` and `catchup.claim_lease_hours` already registered (M3); no new key | V-CONFIG-02 needs no new row |
| Data | Forge labels and assignees written on real issues; no new local state | A wrong claim is visible on the forge and reversible by `release` |
| CI | `verify` (V-FORGE-01, V-ARGV-01, V-STOP-03, V-CONFIG-02/03, doc INDEX) and the full suite after the push | Not run locally |
| Other repos | mercure `git-issue` does not write the convention yet (D2) | Interactive sessions are invisible to campaigns until C5 |

**Safety fact**: the no-lane path is behaviour-preserving. Before any edit `with-test-lock bun test
scripts/lib/forge-sync.test.ts scripts/lib/campaign-status/blocked-classes.test.ts
scripts/lib/campaign-status/report.test.ts` passes; after T6 and T7 the same three files pass with no
existing assertion edited. T6 quotes both runs in the commit body.

## Risk Assessment

| Risk | Severity | Mitigation |
|------|----------|------------|
| Two accounts claim one issue at once (the harm C4 exists to stop) | MEDIUM | A5 read-back and deterministic tie-break; the T2 race rows; residual window named |
| A live branch-only claim reads stale and is reclaimed (D1) | MEDIUM | An open PR counts as activity; absent times read live; the lease default is 24 h; documented |
| Adding three adapter methods breaks a forge | MEDIUM | One shared `claim.ts` plus one mocked-CLI suite per adapter; V-FORGE-01 test in T5 |
| `forge-sync` ownership change flips pre-lane in-flight work to foreign | MEDIUM | A7 fallback for an issue with no lane label; T6 row for `blackhole/issue-4` |
| Gitea label missing fails the claim | MEDIUM | A9 `ensureLabel`; a failure is exit 1, never a dispatch (D4) |
| `tea`/`glab` field names differ from the mapped ones | LOW | A10: both spellings, absent reads live, help read first in T4 and T5 |
| Docs wording trips V-STOP-03 or the playbook check | LOW | T9 runs the targeted checks and the wiring test |
| A claim label or assignee is left on a stopped campaign | LOW | A6 release rules; the lease bounds it |

No HIGH-risk item, so no `## Stop Conditions` section.

## Execution Strategy

**Pattern**: Sequential on the shared branch. One test process at a time through `with-test-lock`;
focused files only; CI runs the full suite after the push.

| Agent | Task(s) | Model | Delegation Contract |
|-------|---------|-------|---------------------|
| x-implementer (or the main session) | T1 | sonnet | **Objective**: lane vocabulary, lease rule, `OWN_LANES` fallback, tests first. **Output**: `lane.ts`, `blocked-classes.ts`, `catchup.ts` import, tests. **Scope**: those files; nothing under `src/`. **Tool guidance**: `with-test-lock bun test` on the four named files. **Stop**: table green, existing assertions unedited. |
| x-implementer | T2 | sonnet | **Objective**: contract and shared claim logic. **Output**: `types.ts`, `claim.ts`, `claim.test.ts`. **Scope**: `forge-adapter/` only. **Stop**: the T2 table green. |
| x-implementer | T3, T4, T5 | sonnet | **Objective**: one adapter per task, mocked-CLI tests first. **Output**: the adapter, its mapper edits, its test cases. **Scope**: that adapter and its test only. **Tool guidance**: read-only `--help` for `tea` and `glab`; no network call. **Stop**: the adapter suite green, existing cases unedited; commit 1 after T5 with explicit paths. |
| x-implementer | T6, T7 | sonnet | **Objective**: lane-label ownership, lease and lane threading. **Output**: `forge-sync` files, status surfaces, tests. **Scope**: files in Critical Files tagged T6 or T7. **Stop**: existing suites unedited and green. |
| x-implementer | T8 | sonnet | **Objective**: the claim CLI and the adapter helper. **Output**: `claim.ts`, `for-campaign.ts`, alias, allowlist, tests. **Scope**: those files plus `forge-sync.ts` import. **Stop**: CLI table and V-ARGV-01 test green. |
| x-implementer | T9 | sonnet | **Objective**: docs, pointers, wiring test first. **Output**: the `src/` edits and `lane-claim-docs.test.ts`. **Scope**: `src/` files in T9 only; never `skills/`. **Stop**: wiring test and targeted checks green. |
| main session | T10 | sonnet | **Objective**: build, INDEX row, commit 2, scout record. **Output**: one commit, one Improvement Record. **Scope**: planned paths, explicit `git add`. **Stop**: `--check` exits 0, `git show --stat` lists planned paths only. |

**Parallelization**: none (T3, T4 and T5 could overlap in principle and are serialized by the
one-test-process rule).

## Sprint Contract

### Machine-verifiable

- [ ] `with-test-lock bun test scripts/lib/lane.test.ts scripts/lib/forge-adapter/claim.test.ts scripts/lib/forge-adapter/github.test.ts scripts/lib/forge-adapter/gitea.test.ts scripts/lib/forge-adapter/gitlab.test.ts` exits 0.
- [ ] `with-test-lock bun test scripts/lib/forge-sync.test.ts scripts/forge-sync.test.ts scripts/claim.test.ts scripts/lane-claim-docs.test.ts` exits 0.
- [ ] `with-test-lock bun test scripts/lib/campaign-status/blocked-classes.test.ts scripts/lib/campaign-status/report.test.ts scripts/lib/campaign-status/dashboard.test.ts scripts/verify.argv-flags-adoption.test.ts scripts/verify.forge-adapter-routing.test.ts` exits 0 with no existing assertion edited.
- [ ] `git grep -n "OWN_LANES" scripts/lib/campaign-status/blocked-classes.ts` returns nothing; `LEGACY_OWN_LANES` is defined only in `scripts/lib/lane.ts`.
- [ ] `bun run claim --claim 12 --campaign-dir <config with no lane>` prints one `SKIP` line and exits 0 without a forge call.
- [ ] `rg -c "Lane claim" src/references` is at least 1 for `orchestrator-dispatch.md`, `phase-loop.md`, `phase-stop.md` and the one dispatch site.
- [ ] `with-test-lock bun run build` exits 0; `plugins/blackhole-claude/scripts/claim.ts` exists.
- [ ] `bun run scripts/generate-doc-index.ts --check` exits 0.

### Human-verifiable

- [ ] On a scratch issue, `claim` then `release` through the CLI leaves the issue with no lane label and no assignee, and a second lane's `claim` in between returns `HELD`.
- [ ] `orchestrator-dispatch.md` § Lane claim reads as one short procedure an orchestrator can follow without opening the ADR.
- [ ] Both commits reference ADR-053 and carry no AI attribution line.

## Plan Quality Gate

| Check | Result |
|-------|--------|
| 1 Task acceptance criteria (blocking) | Pass: every task states a measurable acceptance line |
| 2 Critical file existence | Pass: modified files were read or listed by Grep; new files are named as new; the one dispatch site is resolved by a `Grep` step in T9 |
| 3 Dependency completeness | Pass: T1 to T10 in order, no cycle |
| 4 Risk mitigation | Pass: each risk names a concrete mitigation |
| 5 Success criteria measurability | Pass: commands with expected results |
| 6 Boundary conditions (advisory) | Covered: no lane, invalid block, closed issue, race, stale and fresh lease, absent update time, `agent:*` label, pre-lane in-flight PR, bad flags |
| 7 Stop conditions (advisory) | N/A: no HIGH risk |
| 8 Codebase conventions (blocking) | Pass: section populated at the touchpoints |

Marker count: 0 `[NEEDS CLARIFICATION]` (the open readings, A1, A6 and A7, are recorded as assumptions).

## Implementation notes

- Two commits: T1 to T5 (adapters), then T6 to T10 (forge-sync, status surfaces, claim CLI, docs, build).
- `config-registration` (V-CONFIG-02) fails on the live `.blackhole/config.json` key `merge_mode_note`, which is not in `config-template.md`; it predates this milestone and is untouched by it.
- Scout Improvement Record: File `src/references/config-template.md` and `scripts/checks/argv-flags-adoption.check.ts`; What: the stale "consumed from M4" wording and the allowlist header counts (18 to 19); Category: stale documentation; Scope: inside the diff.
