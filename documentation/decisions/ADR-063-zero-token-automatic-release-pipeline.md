---
type: adr
summary: "The release path is event-driven and spends zero model tokens: a workflow_run on a green Verify of main (daily cron only as backstop) cuts when a deterministic policy says so - 10 pending PRs, or a shipped-tree change older than 24 h, or an immediate class (hooks, security, Release trailer) - from first-parent commit subjects with no API listing; notes are deterministic only (the Haiku step, the git-cliff fallback and the hotfix-only manual path are deleted); the cut closes a matching empty milestone; the running orchestrator gets an advisory update-available line; supersedes the trigger and notes parts of ADR-060"
status: accepted
review_trigger: "on a change to the release workflows, the cut policy constants, the marketplace catalogs, branch protection on main, or the monorepo release cadence"
created: 2026-11-25
last_updated: 2026-11-25
related:
  - documentation/decisions/ADR-060-cadence-primary-release-policy.md
  - documentation/decisions/ADR-030-plugin-cache-version-bump-gate.md
  - documentation/runbooks/release-cadence.md
  - scripts/release-cadence.ts
  - scripts/lib/release-cadence.ts
  - .github/workflows/release-cadence.yml
  - .github/workflows/release.yml
---

# ADR-063: Zero-token, event-driven release pipeline

## Status

Accepted on merge, and still pending owner approval: this PR is the approval gate and must not
merge before it. The state is `accepted` rather than `proposed` because `V-ADR-01`
(`scripts/checks/adr-status.check.ts:11`) allows only `accepted | superseded | deprecated`, and
`V-ADR-03` requires this heading's first word to match the frontmatter (open question 9).

Supersedes ADR-060 decision 1 (manual `bun run release` as the hotfix path), decision 2 (trigger
and early-cut mechanics), decision 3 (the cadence never closes a milestone) and the Haiku option
of its 2026-11-24 amendment; ADR-060 decisions 4 and 5 stand. ADR-030 mechanism 1 (`V-PLUGIN-01`) is amended only if the owner answers question 4.

Owner goal (2026-11-25, binding): modern and optimised, zero model tokens on the release path,
fully automatic from merge to published release and from release to consumer, with sensible
batching because each release costs the owner a plugin update and a session refresh.

## Context

Measured on 2026-11-25 against `origin/main` (`732995fc`), `gh`, and the owner's plugin state.

1. **Cron is the only trigger and GitHub drops it.** `release-cadence.yml:15-17` schedules
   `17 */2 * * *`. From 2026-11-19T01:52Z to 2026-11-25T14:20Z (156.5 h, 78 nominal slots) it ran
   19 times (24%); the longest observed gap is 11.9 h (02:27Z to 14:20Z on 11-25).
2. **A bare `push` trigger would not fix it.** The cut refuses unless Verify already succeeded on
   the tip SHA (`release-cadence.ts:184-196`, `:489-493`) and Verify takes 4 to 9 minutes
   (`verify.yml:23-25`), so a push-started run finds none and skips until the next, dropped, slot.
3. **The cadence has never cut.** All 19 runs ended `success` as no-ops (7 PRs merged since
   v0.34.0, threshold 10), and `git log origin/main --grep 'chore(release)'` shows only manual
   release PRs (v0.24.0 to v0.34.0, for example #1498). The automatic cut is untested in production.
4. **Releases are bursty.** 13 releases between 2026-11-10 and 2026-11-24 against about 100
   merged PRs in 8.1 days (about 12 a day); patches follow their minor by 7 minutes (v0.30.0 to
   v0.30.1) and 18 minutes (v0.27.0 to v0.27.1).
5. **A consumer sees a version change on `main`, not a tag.** The Claude catalog resolves the
   commit on `main` (ADR-060 decision 4). Cache directories `0.31.1` and `0.33.4` on the owner's
   machine have no tag or release: they are hooks-fix PRs that bumped `package.json` themselves
   (#1360, #1483) as `V-PLUGIN-01` requires. Each such PR is already a plugin update, so
   ADR-030's per-PR bump works against batching.
6. **Consumer pickup works for the user-scope install only.** `known_marketplaces.json` has
   `autoUpdate: true` for `blackhole-marketplace`, and the user-scope install moved to 0.34.0
   54 s after v0.34.0 was published (08:34:42Z to 08:35:36Z). Of 27 project-scope rows, 24 point
   at deleted worktrees; the 3 live ones sit at 0.22.0, 0.25.0 and 0.26.0, so autoUpdate does
   not refresh them (to confirm). The monorepo submodule pin is stale (`e92d976`, the 0.23.3
   commit), but its cloud bootstrap checks out the newest `v*` tag on every VM start, so the pin
   is never read there. A running orchestrator cannot learn a release exists:
   `scripts/plugin-drift-signal.ts` compares the installed hooks hash with the repo build, never
   the installed version with upstream.
7. **Model calls and manual steps** (counted in "Token cost"). `release-cadence.yml:88-116`
   installs `@anthropic-ai/claude-code@2.1.296` and passes `CLAUDE_CODE_OAUTH_TOKEN` to the cut;
   `release-cadence.ts:198-248,308-315` spawn `claude -p --model haiku`; `lib/release-cadence.ts:269-360`
   holds the prompt, validator and argv. `gh secret list` shows no secret, so the call is dormant.
   `.claude/skills/prj-create-release/SKILL.md:44-86` is an eight-step agent procedure with
   hand-edited notes and a milestone close.
8. **The listing is O(history).** `release-cadence.ts:134-141` paginates every closed PR on every
   run (up to three times per cut: `:405`, `:463`, `:495`), though squash subjects on `main`
   already carry type and PR number (`feat(x): ... (#1527)`).
9. **Direct push to `main` and a milestone rule with nothing to apply to.** `main` has no
   protection (`branches/main/protection` returns 404) and `pushRelease`
   (`scripts/release.ts:204-213`) pushes `main` directly. Only four milestones exist, all closed,
   the last v0.5.0, yet `release-milestone-governance.mdc:12-14,44` still gates on them. Two note
   generators coexist (V-INT-02): `buildDeterministicNotes` (`lib/release-cadence.ts:216-243`) and
   the git-cliff fallback (`release.yml:71-80`, `cliff.toml`).

## Decision

**D1. Trigger.** `release-cadence.yml` keeps its name and runs on `workflow_run` of `Verify`
(`types: [completed]`, `branches: [main]`, conclusion `success`), a daily `schedule` as backstop
only (it flushes the age rule when no merge arrives), and `workflow_dispatch` with the existing
`force` input as the emergency button; the `RELEASE_CADENCE_ENABLED` kill switch stays
owner-only. Guards, all exit 0: a run whose `workflow_run.head_sha` is not the live `origin/main`
tip is superseded, and so is a non-fast-forward push (the newer tip has its own Verify and cut).
`[skip release]` and the no-retag check stay as loop guards, so even an App-token release commit
that re-triggers Verify and the cut finds `[skip release]` on HEAD and nothing pending.
`concurrency: release`, `cancel-in-progress: false`, as today.

**D2. Pending set from git.** `git log --first-parent --format=... <latest v* tag>..HEAD` replaces
the PR listing; type and number come from the squash subject (`(#N)`, last wins), and the commit
body supplies `BREAKING CHANGE:` and trailers. Zero API calls, deterministic, testable offline.
A commit without a conventional subject counts as a patch-level `other`. The pending set is
release-relevant only when `git diff --quiet <tag> HEAD -- <shipped paths>` is false; docs,
test and CI-only batches never cut, whatever their count, and ride with the next shipped change.
The shipped set is one constant, `SHIPPED_PATHS`. It starts as the three distribution roots
under `plugins/` (`scripts/lib/build/paths.ts:13,23,45`) plus the root-level trees the Codex
catalog sources from the whole repository (`skills/`, `agents/`, `rules/`, `references/`,
`templates/`, `codex-skills/`, `codex-agents/`, `SKILL.md`, the plugin manifest directories);
slice 1 verifies the list against the build and the catalogs (question 2).

**D3. Cut policy** (constants in `scripts/lib/release-cadence.ts`, the single home; owner tunes
via question 2):

| Class | Condition (all after a green Verify on the tip) | Cut |
|-------|--------------------------------------------------|-----|
| immediate | pending diff touches `templates/hooks/**`, or a subject is `*(security)`, `fix(hooks)` or `fix(security)`, or a commit body has `Release: immediate` | now, ignores threshold, age and cooldown |
| batch | 10 or more release-relevant pending PRs (`CADENCE_THRESHOLD`, unchanged) | now, unless cooldown |
| age flush | at least 1 release-relevant PR and the oldest is 24 h or more old | at the next event or the daily backstop, unless cooldown |
| cooldown | last tag is under 6 h old | batch and age wait; immediate does not |

**D4. Version.** Classify the pending subjects as today (`type!:` or `BREAKING CHANGE:` is major,
`feat` is minor, else patch), but while the major version is 0 a breaking change bumps minor, not
`1.0.0` (question 3). The cut takes the higher of the classified version and `package.json`, so
PRs that still bump by hand keep working; the pipeline, not the author, is the normal bumper.

**D5. Notes.** Deterministic only: `buildDeterministicNotes` is the single generator, writing
`.github/releases/<tag>.md`, which stays the contract `validateRelease` and Verify's
`release-notes-gate` read. The git-cliff step and `cliff.toml` go.

**D6. Publish.** `GITHUB_TOKEN` stays. The cut commits `chore(release): prepare vX.Y.Z [skip release]`
(notes, `package.json`, the 7 `VERSIONED_MANIFESTS`), pushes an annotated tag, and the `publish`
job calls `release.yml` through `workflow_call`, the sole publisher. No App or PAT is needed in
this repository; only the cross-repo hop in D8 needs one.

**D7. Milestones.** After publish, a step closes the milestone titled exactly `v<version>` when it
exists with zero open issues, and otherwise only emits a notice. It never creates or retargets a
milestone. The governance rule shrinks to that contract.

**D8. Consumers.**
- Claude Code user-scope installs need nothing: `autoUpdate: true` plus a version that changes
  on `main` only at cuts (once question 4 retires the per-PR bump, batching applies to them).
  Project-scope installs do not refresh (Context 6, question 10).
- The orchestrator gains an advisory `plugin-update` signal beside `plugin-drift-signal.ts`: at
  turn start it compares the installed version with the newest `v*` tag from `git ls-remote
  --tags` (5 s timeout, fail-open, no model call) and the status page prints `update available:
  X -> Y; run /plugin update, then /reload-plugins at the next wave boundary`. Never mid-wave.
- Monorepo submodule pin: cloud sessions float to the newest tag already, so the pin is
  cosmetic and the default is no bump PR. A current pin needs an App-token `repository_dispatch`
  to a monorepo workflow that opens the bump PR (slice 5, owner-gated): a PR opened with
  `GITHUB_TOKEN` starts no checks, and the monorepo merge script requires them.

**D9. Deleted.** The Haiku install and secret wiring (`release-cadence.yml:88-116`); every
AI-notes function, constant and test in `release-cadence.ts` and `lib/release-cadence.ts`;
`defaultListMergedPrs` and `parseGhPullPages`; the `prepare` command and CLI `main` of
`scripts/release.ts` plus `.github/releases/TEMPLATE.md` (its validate, tag and push functions
stay as a library for the cut); the git-cliff fallback; the hotfix-only manual path, replaced by
an `immediate` commit and the `force` dispatch, so `/prj-create-release` shrinks to "how to
trigger and verify". The owner removes the `CLAUDE_CODE_OAUTH_TOKEN` repo secret.

## Alternatives Considered

### A. Push-triggered deterministic auto-cut (chosen, as `workflow_run`)
Strongest case for the naive form: a `push` trigger is three lines of YAML. Rejected as written
and adopted as `workflow_run`: Context 2 shows a push run races Verify and skips, whereas
`workflow_run` is event-driven, needs no polling and carries `head_sha` for the staleness guard.

### B. release-please style release PR with auto-merge
Strongest case: no bot push to `main`, so it survives branch protection; the open release PR
shows the pending batch and offers a veto; the tool is maintained. Rejected today: `main` is
unprotected (Context 9), so the PR buys nothing; a PR opened with `GITHUB_TOKEN` starts no
Verify, so auto-merge needs an App or PAT anyway; it cannot run `bun run build`, so the 7
generated manifests become `extra-files` to re-verify; the merged release PR is itself a merged
PR the next count must exclude; latency doubles. It becomes right if branch protection lands.

### C. semantic-release on every merge
Strongest case: zero policy, minimal latency, a mature ecosystem, fixes live as soon as they
merge. Rejected: about 12 merges a day is about 12 plugin refreshes a day for one owner (Context
4), the opposite of the batching need; it cannot tell that a docs-only merge ships nothing (D2)
and adds a Node toolchain to a Bun repository.

### D. Keep the cadence as is
Strongest case: it runs (19 of 19 runs succeeded), carries 973 lines of tested code, and the
owner just tuned it (#1516). Rejected: cron-only (24% delivery, gaps over 11 h), the cut has
never executed in production, the model call and the agent-driven hotfix remain, and no
running session learns of a release. A minimal D' (add `push`, drop Haiku) still fails Context 2.
Most of D is reused: the gate, classification, notes builder and publish step.

### E. External scheduler (a seedbox timer dispatching the workflow)
Strongest case: a reliable clock. Rejected: an owner-hosted dependency and credential for what
the `workflow_run` event already removes.

## Consequences

### Positive
- A merge becomes a published release in about 6 to 27 minutes (Verify 4 to 9 min, cut about 1
  min, `release.yml` 0.5 to 17 min per `release.yml:20`), not a dropped cron's next slot.
- Zero model tokens and no model secret on the release path; about 160 lines of AI-notes code,
  the `gh` listing and one of two note generators go.
- Batching reaches Claude installs for the first time: the version changes on `main` only at
  cuts, plus the immediate class.

### Negative
- A bot still pushes to `main`; enabling branch protection later forces alternative B.
- `workflow_run` runs the default branch's copy of the workflow, so a workflow change takes
  effect only after it merges, and a cancelled or skipped Verify produces no cut.
- `SHIPPED_PATHS` must track new build targets.

### Risks
- The policy numbers (24 h, 6 h, 10) are guesses. Mitigation: constants plus
  `bun run release-cadence --json`, which prints the class and the reason.
- A tip that never gets a green Verify under a merge stream. Mitigation: the daily backstop
  re-evaluates the live tip.
- Dropping the per-PR bump (question 4) makes a hooks fix wait for its immediate cut. Mitigation:
  that cut is automatic and bounded by Verify plus `release.yml`.

## Token cost

| Step on the release path | Today | After |
|--------------------------|-------|-------|
| Haiku release notes (`claude -p --model haiku --max-turns 1`) | 1 call per cut when `CLAUDE_CODE_OAUTH_TOKEN` is set; secret not visible, so 0 today. Input is capped by code at 10 PRs x 2,000 characters, output at 32 KB, timeout 45 s | 0 |
| Manual hotfix (`/prj-create-release`, eight steps, hand-written notes) | 1 agent session per hotfix; hotfixes were the normal path until v0.34.0 | 0 |
| Maintainer-pass milestone close; orchestrator learning of a release | 1 agent step per milestone; none (it never learns) | 0 (D7; deterministic `git ls-remote`) |
| `claude plugin validate --strict` in `verify.yml:86-102` | 0 (a local static check, not a model call) | 0 |

Token counts are unmeasured: nothing in the repository logs them, so none are claimed. Slice 2
accepts only when `rg -n "claude -p|CLAUDE_CODE_OAUTH_TOKEN" .github scripts` finds nothing.

## Applicability to the monorepo

The monorepo release cadence (issue #5827) had the same cron-only trigger. On its `main` the
fix has landed (a `push` trigger plus the schedule as backstop) and its cut does not wait on a
CI result, so the Verify race of Context 2 does not apply there. What carries over: the
batching policy (D3), deterministic notes (it still runs a post-publish Haiku polish, one model
call per release), and consumer pickup (D8). Check first whether a release published with
`GITHUB_TOKEN` fires `release` workflows at all (GitHub says token-created events start no run),
which would leave that polish dormant too. Its workflow files are owner-gated, so this ADR edits
nothing there; slice 6 files the follow-up.

## Implementation slices

Each slice is one reviewable PR; gated means workflows, a secret or a gate file, and it waits
for the owner.

| # | Slice | Gated | Acceptance |
|---|-------|-------|------------|
| 1 | Deterministic core: git-log pending set, `SHIPPED_PATHS`, D3 policy, D4 version rule, delete the AI-notes code and `gh` listing, tests per class | no | touched libs' tests; `--json` prints class and reason |
| 2 | Workflow: D1 triggers and guards, remove the Haiku step, D7 milestone step, drop git-cliff and `cliff.toml` | yes (workflow) | one real cut observed; the `rg` check is empty |
| 3 | Docs: ADR-060 banner and INDEX row, runbook, `prj-create-release`, governance rule, delete `release.ts` prepare/main and `TEMPLATE.md`, ADR-030 amendment if question 4 is yes | no | Verify green; no stale reference to the manual path |
| 4 | `plugin-update` signal and status line (D8) | no | fixture test: newer tag prints the line, offline prints nothing |
| 5 | Optional: App-token `repository_dispatch` and monorepo bump PR workflow (D8) | yes (secret, workflow, cross-repo) | only if question 5 is yes |
| 6 | Monorepo follow-up per the applicability section | yes (its gate files) | a monorepo issue, not edited here |

Order: 1 (safe alone, the cron path keeps working), then 2 with the owner removing the secret,
then 3 and 4 in any order.

## Open questions for the owner

1. **ADR number.** PR #1514 holds `ADR-062-multi-repo-campaign-model.md` (its title says
   ADR-061). This ADR takes 063 so `V-ADR-05` sees no duplicate; renumber if you prefer 061.
2. **Policy numbers and shipped set.** Keep 10 PRs, 24 h age flush, 6 h cooldown? Is the
   `SHIPPED_PATHS` starting list in D2 right?
3. **Pre-1.0 breaking change.** Bump minor (proposed) or jump to 1.0.0 as the code does today?
4. **Retire the per-PR bump.** Should `V-PLUGIN-01` stop requiring hooks PRs to bump
   `package.json` (the immediate class replaces it, amending ADR-030 mechanism 1)?
5. **Pin bump.** Is a current `vendor/blackhole` pin worth an App token and a monorepo workflow,
   or is the floating-tag behaviour of `cloud-agent-plugins.sh` enough?
6. **Immediate class.** Is any change under `templates/hooks/**` too broad? `fix(hooks)` only
   would let hook refactors wait for a batch.
7. **Branch protection.** Will `main` get it? If yes, build B instead of D6.
8. **Milestones and secret.** Keep D7's no-op-safe close or retire the milestone rule? Confirm
   `CLAUDE_CODE_OAUTH_TOKEN` is absent, or delete it.
9. **ADR status.** Add `proposed` to the `V-ADR-01` enum so a design PR can say what it is?
10. **Project-scope installs.** Uninstall the stale project-scope rows and rely on user scope,
    or accept manual refresh there?
