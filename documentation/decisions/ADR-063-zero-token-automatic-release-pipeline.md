---
type: adr
summary: "One release model for blackhole and the monorepo, zero model tokens: a workflow_run on the repo's main-CI workflow (daily cron only as backstop) cuts when a deterministic policy says so (batch threshold, age flush, cooldown, optional immediate class) from first-parent commit subjects, once the newest green CI run is an ancestor of the tip; the cut is resumable (state read from git, REST-created tag and Release, post-publish work in the same run); notes are deterministic only; consumers pull (marketplace autoUpdate, an orchestrator update-available line, a consumer-owned vendor-bump poll), the publisher never pushes into a consumer; blackhole never cuts, enforces or assumes a release model in a consumer repo and reads that repo's declared conventions instead; supersedes the trigger and notes parts of ADR-060"
status: accepted
review_trigger: "on a change to the release workflows, the cut policy constants, the marketplace catalogs, branch protection on main, the consumer release contract, or the monorepo release cadence"
created: 2026-11-25
last_updated: 2026-11-25
related:
  - documentation/decisions/ADR-060-cadence-primary-release-policy.md
  - documentation/decisions/ADR-030-plugin-cache-version-bump-gate.md
  - documentation/decisions/ADR-012-shared-artifact-substrate.md
  - documentation/runbooks/release-cadence.md
  - scripts/release-cadence.ts
  - scripts/lib/release-cadence.ts
  - .github/workflows/release-cadence.yml
  - .github/workflows/release.yml
---

# ADR-063: One zero-token, event-driven release model, never imposed on a consumer

## Status

Accepted on merge, and still pending owner approval: this PR is the approval gate and must not
merge before it. The state is `accepted` rather than `proposed` because `V-ADR-01`
(`scripts/checks/adr-status.check.ts:11`) allows only `accepted | superseded | deprecated`, and
`V-ADR-03` requires this heading's first word to match the frontmatter (open question 2).

This is the canonical text of the release model for two repositories: this one and
`CorentinLumineau/monorepo`. The monorepo's adoption record (monorepo PR #5859) cites this
ADR for the model and keeps only monorepo facts. Owner ruling 2026-11-25: one model, the same in
both repos, with per-repo parameters and no per-repo mechanism.

Supersedes ADR-060 decision 1 (manual `bun run release` as the hotfix path), decision 2 (trigger
and early-cut mechanics), decision 3 (the cadence never closes a milestone) and the Haiku option
of its 2026-11-24 amendment; ADR-060 decisions 4 and 5 stand. ADR-030 mechanism 1 (`V-PLUGIN-01`)
is amended only if the owner answers question 8.

Owner goal (2026-11-25, binding): modern and optimised, zero model tokens on the release path,
fully automatic from merge to published release and from release to consumer, sensible batching
because each release costs the owner a plugin update and a session refresh, and the plugin never
enforces a release model on the repositories it works in.

## Context

Measured on 2026-11-25 against this repository's `origin/main` (`732995fc`), `gh`, and the owner's
plugin state. The monorepo evidence base is that repository's adoption record, § Context; this section
states only what shapes the model.

1. **Cron is the only trigger and GitHub drops it.** `release-cadence.yml:15-17` schedules
   `17 */2 * * *`. From 2026-11-19T01:52Z to 2026-11-25T14:20Z (156.5 h, 78 nominal slots) it ran
   19 times (24%); the longest observed gap is 11.9 h (02:27Z to 14:20Z on 11-25). The monorepo
   saw the same drop and added a `push` trigger.
2. **A bare `push` trigger does not carry the evidence the cut needs.** The cut refuses unless the
   main CI already succeeded on the tip (`release-cadence.ts:184-196`, `:489-493`). Here Verify
   takes 4 to 9 minutes (`verify.yml:23-25`); the monorepo's main CI takes about 20 minutes and
   coalesces a merge stream, so most of its runs are cancelled and the runs that finish are
   several commits behind the tip. A push-started run finds no green result and skips until the
   next, dropped, slot; and a rule "the green run must be on the live tip" would almost never hold
   there.
3. **The cadence has never cut here.** All 19 runs ended `success` as no-ops (7 PRs merged since
   v0.34.0, threshold 10), and `git log origin/main --grep 'chore(release)'` shows only manual
   release PRs (v0.24.0 to v0.34.0, for example #1498). The monorepo's cut did run, and wedged: a
   release commit reached `main`, the tag push was rejected, and every later run refused. A cut
   that commits before it tags needs a way to resume.
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
   commit), but its cloud bootstrap checks out the newest `v*` tag on every VM start. A running
   orchestrator cannot learn a release exists: `scripts/plugin-drift-signal.ts` compares the
   installed hooks hash with the repo build, never the installed version with upstream.
7. **Model calls and manual steps** (counted in "Token cost"). `release-cadence.yml:88-116`
   installs `@anthropic-ai/claude-code@2.1.296` and passes `CLAUDE_CODE_OAUTH_TOKEN` to the cut;
   `release-cadence.ts:198-248,308-315` spawn `claude -p --model haiku`; `lib/release-cadence.ts:269-360`
   holds the prompt, validator and argv. `gh secret list` shows no secret, so the call is dormant.
   `.claude/skills/prj-create-release/SKILL.md:44-86` is an eight-step agent procedure with
   hand-edited notes and a milestone close.
8. **The listing is O(history).** `release-cadence.ts:134-141` paginates every closed PR on every
   run (up to three times per cut: `:405`, `:463`, `:495`), though squash subjects on `main`
   already carry type and PR number (`feat(x): ... (#1527)`). The monorepo's squash commit also
   carries the PR title and body, so its trailers travel with the commit.
9. **Direct push to `main` and a milestone rule with nothing to apply to.** `main` has no
   protection (`branches/main/protection` returns 404) and `pushRelease`
   (`scripts/release.ts:204-213`) pushes `main` directly. Only four milestones exist, all closed,
   the last v0.5.0, yet `release-milestone-governance.mdc:12-14,44` still gates on them. Two note
   generators coexist (V-INT-02): `buildDeterministicNotes` (`lib/release-cadence.ts:216-243`) and
   the git-cliff fallback (`release.yml:71-80`, `cliff.toml`).
10. **The plugin carries release rules that target repositories it does not own.** Its shipped
    coordinator tells the owner of any consumer to run `bun run release prepare` and the plugin's
    own `prj-create-release` skill; its merge-risk table, conflict protocol and reviewer name
    this repository's release files and version bump. The audit is in § The plugin rule.

## Decision

### The model

| # | Dimension | Choice | Why |
|---|-----------|--------|-----|
| M1 | Trigger | `workflow_run` of the repo's main-CI workflow (`VERIFY_WORKFLOW`, `types: [completed]`, `branches: [main]`, conclusion `success`); a daily `schedule` as backstop only; `workflow_dispatch` with `force` as the emergency button | Event-driven, no polling; a push run races CI (Context 2) and cron is dropped (Context 1) |
| M2 | Freshness | Cut only when the newest completed, non-cancelled run of `VERIFY_WORKFLOW` on `main` succeeded and its SHA is an ancestor of the live tip | Works when CI is slower than the merge interval; equality with the tip would almost never hold in the monorepo |
| M3 | Pending set | `git log --first-parent` of `<latest v* tag>..HEAD`; type, PR number and trailers from the squash commit; release-relevant only when the range changes a declared shipped path | Zero API calls, deterministic, offline-testable, O(batch) |
| M4 | Policy | Four classes in one constants file: immediate, batch threshold, age flush, cooldown; numbers per repo | The shape is the model; the cost of a release differs per repo |
| M5 | Version | Conventional classification (`type!:` or `BREAKING CHANGE:` major, `feat` minor, else patch); a major-0 repo bumps minor on a breaking change; the cut takes the higher of the classified version and the manifest | The pipeline is the bumper; hand-bumping PRs keep working |
| M6 | Notes | Deterministic only, from commit subjects and trailers; one generator | Zero tokens; a rule-accepted author sentence cannot be improved by a model |
| M7 | Publish | Release commit `chore(release): prepare vX.Y.Z [skip release]` pushed to `main`; tag and Release then created through the REST API, targeting that commit; `GITHUB_TOKEN` only; post-publish work (assets, deploy) runs as jobs of the same run | A REST ref avoids the push-time workflow-scope check that rejected the monorepo's tag push; token events start no workflows, so nothing may hang off a `release` or tag event |
| M8 | Resumable | The cut reads its state from git and the forge and finishes what is left | A commit without a tag is the observed wedge; makes a lost push race harmless |
| M9 | Milestones | Not part of the model; an optional step closes the milestone titled `v<version>` when it exists with zero open issues | A no-op where no such milestone exists |
| M10 | Consumers | Pull, never push: autoUpdate for marketplace installs, an advisory update-available line in the orchestrator, a consumer-owned poll for a vendored pin | Keeps the publisher ignorant of its consumers; needs no cross-repo secret |
| M11 | Plugin rule | The plugin never cuts, enforces or assumes a release model in a consumer repo; it reads that repo's declared conventions | Owner ruling 2026-11-25 |

Decisions M1 to M10 hold in both repositories. Every row is a mechanism; every difference between
the repositories is a parameter in § Per-repo parameters. The decisions in detail follow.

**M1. Trigger.** `release-cadence.yml` keeps its name in both repos. The workflow runs on
`workflow_run` of `VERIFY_WORKFLOW` with the job condition `conclusion == 'success'`, a daily
`schedule`, and `workflow_dispatch` with the `force` input; the `RELEASE_CADENCE_ENABLED` kill
switch stays owner-only. The three triggers run one code path, which evaluates M2 itself rather
than trusting the event payload. `[skip release]` and the no-retag check stay as loop guards, so
even an App-token release commit that re-triggers CI and the cut finds `[skip release]` on `HEAD`
and nothing pending. `concurrency: release`, `cancel-in-progress: false`.

**M2. Freshness.** One API call lists the newest completed, non-cancelled, non-skipped run of
`VERIFY_WORKFLOW` on `main`; call its SHA `V`. The cut proceeds when that run succeeded and
`git merge-base --is-ancestor V HEAD` holds. A newer red run therefore blocks the cut (it is the
newest completed run), a cancelled run is ignored, and a green run several commits behind the tip
is enough. Two refinements:
- The immediate class (M4) additionally requires its trigger commits to be ancestors of `V`, so
  a hooks or security fix is verified before it ships.
- If the push of the release commit is rejected as non-fast-forward, the run exits 0 as
  superseded; M8 makes the next event finish the job.

The cost is stated, not hidden: commits between `V` and the tip ride in the release unverified by
main CI. Each already passed its pre-merge gate, and the bound is the merges of one CI duration.

**M3. Pending set.** `git log --first-parent --format=... <latest v* tag>..HEAD`; the PR number
is the last `(#N)` of the subject, the type comes from the conventional subject, trailers and
`BREAKING CHANGE:` from the body, and the merge time from the committer date (the age clock). A
commit without a conventional subject counts as a patch-level `other`. The pending set is
release-relevant only when `git diff --quiet <tag> HEAD -- <shipped paths>` is false; docs, test
and CI-only batches never cut, whatever their count, and ride with the next shipped change. The
shipped set is one constant, `SHIPPED_PATHS`. A repo may count a narrower set toward the batch
threshold (`COUNTED_PATHS`, default equal to the shipped set).

**M4. Policy.** Constants live in one file per repo (here `scripts/lib/release-cadence.ts`, the
single home; the owner tunes them via question 5):

| Class | Condition (all after M2) | Cut |
|-------|--------------------------|-----|
| immediate | the pending range matches the repo's `IMMEDIATE` predicates: a commit body with `Release: immediate`, plus any declared paths or subject scopes. An empty set disables the class | now, ignores threshold, age and cooldown |
| batch | `THRESHOLD` or more release-relevant pending PRs | now, unless cooldown |
| age flush | at least 1 release-relevant PR and the oldest is `MAX_AGE` or more old | at the next event or the daily backstop, unless cooldown |
| cooldown | last tag is under `COOLDOWN` old | batch and age wait; immediate does not |

`bun run release-cadence --json` prints the class and the reason, so a tuned number is checked
against live history before it is merged.

**M5. Version.** Classification as in the table; while the major version is 0 a breaking change
bumps minor, not `1.0.0` (question 7), a clamp that is inert in a repo already at 1 or above. The
cut takes the higher of the classified version and the version manifest, so PRs that still bump
by hand keep working; the pipeline, not the author, is the normal bumper.

**M6. Notes.** Deterministic only: one generator writes the repo's notes store (here
`.github/releases/<tag>.md`, the contract `validateRelease` and Verify's `release-notes-gate`
read). The git-cliff step and `cliff.toml` go.

**M7. Publish.** The cut commits the notes and version files, pushes `main`, then creates the tag
and the Release with the REST API (`gh release create <tag> --target <release-commit-sha>`),
not `git push <tag>`. `GITHUB_TOKEN` suffices: no App or PAT. Post-publish work (here the
`publish` job calling `release.yml` through `workflow_call`, in the monorepo its prod deploy job)
runs in the same workflow run via `needs`; nothing waits on a `release: published` or tag-push
event, because a token-created event starts no workflow. **This is unverified.** The monorepo's tag
push was rejected with `workflows scope may be required` and the root cause is not established;
nothing proves a REST-created ref clears it. Monorepo slice 0 (in its adoption record) is the single spike,
and slice 2 here does not merge before its result (question 4).

**M8. Resumable cut.** The cut derives its state: nothing pending; a release commit on `main`
(subject `chore(release): prepare vX.Y.Z [skip release]`, version above the latest tag) with no
tag, in which case it creates the tag and Release at that commit; a tag with no Release, in which
case it creates the Release; or done. Any other disagreement between the version manifest and the
tags still refuses loudly: the refusal is correct for a corrupt repo and wrong for a half-finished
cut.

**M9. Milestones.** After publish, an optional step closes the milestone titled exactly
`v<version>` when it exists with zero open issues, and otherwise only emits a notice. It never
creates or retargets a milestone. The governance rule shrinks to that contract; a repo with no
such milestones turns the step off.

**M10. Consumers.** The publisher does nothing for a consumer; each consumer pulls.
- Claude Code user-scope installs need nothing: `autoUpdate: true` plus a version that changes
  on `main` only at cuts (once question 8 retires the per-PR bump, batching applies to them).
  Project-scope installs do not refresh (Context 6, question 12).
- The orchestrator gains an advisory `plugin-update` signal beside `plugin-drift-signal.ts`: at
  turn start it compares the installed version with the newest `v*` tag from `git ls-remote
  --tags` (5 s timeout, fail-open, no model call) and the status page prints `update available:
  X -> Y; run /plugin update, then /reload-plugins at the next wave boundary`. Never mid-wave.
- A repo that vendors the plugin owns its pin: a small poll compares the pin with the newest
  `v*` tag from `git ls-remote --tags` and moves it (the monorepo's `vendor-bump`, in its adoption record).
  Blackhole does not push into a consumer: an App-token `repository_dispatch` would couple the
  publisher to its consumers and add a secret, and is rejected (Alternative F).

**Deleted.** The Haiku install and secret wiring (`release-cadence.yml:88-116`); every AI-notes
function, constant and test in `release-cadence.ts` and `lib/release-cadence.ts`;
`defaultListMergedPrs` and `parseGhPullPages`; the `prepare` command and CLI `main` of
`scripts/release.ts` plus `.github/releases/TEMPLATE.md` (its validate and tag functions stay as a
library for the cut, its tag-push function is replaced by M7); the git-cliff fallback; the
hotfix-only manual path, replaced by an `immediate` commit and the `force` dispatch, so
`/prj-create-release` shrinks to "how to trigger and verify". The owner removes the
`CLAUDE_CODE_OAUTH_TOKEN` repo secret.

### Per-repo parameters

The only place the two repositories differ. A value is a parameter when changing it does not
change a mechanism above.

| Parameter | blackhole | monorepo |
|-----------|-----------|----------|
| `VERIFY_WORKFLOW` | `Verify` (`verify.yml`) | `main-verify` (trust mode; the repo's main-push CI workflow if `CI_MODE=gate`) |
| `SHIPPED_PATHS` | the three distribution roots under `plugins/` (`scripts/lib/build/paths.ts:13,23,45`) plus the root trees the Codex catalog sources (`skills/`, `agents/`, `rules/`, `references/`, `templates/`, `codex-skills/`, `codex-agents/`, `SKILL.md`, the plugin manifest directories); slice 1 verifies the list (question 5) | the union of the path rules of its `scripts/release-deploy-apps.sh` (invest, voyage and croissant trees, `packages/**`, the root lockfile and manifests), so one path map decides both a cut and a deploy |
| `COUNTED_PATHS` | equal to the shipped set | the invest changelog part, as today (#5286 there); voyage and croissant merges still trigger the age flush (question 5) |
| `THRESHOLD` | 10 (`CADENCE_THRESHOLD`, unchanged) | 20 (owner ruling 2026-11-18) |
| `MAX_AGE` | 24 h | 24 h |
| `COOLDOWN` | 6 h | 6 h |
| `IMMEDIATE` | `templates/hooks/**`, subjects `*(security)`, `fix(hooks)`, `fix(security)`, body `Release: immediate` | empty by default (a hotfix uses the `force` dispatch); enabling `Release: immediate` is an owner decision because it is an agent-triggerable prod deploy (question 6) |
| Version and notes store | `package.json` plus the 7 `VERSIONED_MANIFESTS`; `.github/releases/<tag>.md` | the release catalog and the single `v*` tag series |
| Post-publish train | `publish` job calling `release.yml` (`workflow_call`) | `deploy-prod` job, owner-gated |
| Runner lane | hosted | `ops` lane, no PR code runs there |
| Milestone close (M9) | on | off |
| Consumer pickup (M10) | marketplace autoUpdate, `plugin-update` line | `vendor-bump` poll for its `vendor/blackhole` pin |
| Owner-gated files | the release workflows | `.github/workflows/**` (its contributor contract) |

### The plugin rule

Blackhole is a campaign plugin that works inside other repositories. **It never cuts a release,
never enforces a version, changelog, trailer or milestone rule, and never assumes a release model
in a repo it does not own.** Its own repository's release model is this ADR and applies to nobody
else. In a consumer repo the plugin adapts, in this order:

1. **Declared contract.** An optional `release` block in `.blackhole/config.json` (written by the
   launch gate after the owner confirms it, never inferred silently) or a pointer to the repo's
   own document: version-bump policy (`never` or `per-pr`), PR trailers required in the body (for
   the monorepo `Changelog:` and `Story:`), paths whose change holds a PR for the owner, and the
   milestone policy. Repo-convention precedence already exists for INDEX headers and ADR
   frontmatter (ADR-012); this extends it to release conventions.
2. **Discovery.** Absent a contract, the launch gate reads the repo's evidence (`AGENTS.md`,
   `CLAUDE.md`, `CONTRIBUTING.md`, a PR template, recent merged PR bodies and subjects, release
   workflows, `.github/releases/`, `cliff.toml`, `.changeset/`, `release-please-config.json`,
   `CHANGELOG.md`) and proposes the contract to the owner, who confirms it once.
3. **Default.** With neither, a PR carries no version bump, no changelog edit, no release trailer
   and no milestone action, and nothing tags or publishes.

Implementer and planner follow the contract when they write a PR title and body; the reviewer
reports a consumer gate it can see (for example a missing trailer) as a finding, never as a
blackhole V-code.

**Audit: what the plugin imposes on consumers today** (grep of `src/` and `templates/`, 2026-11-25).

| # | Where | What it does in a consumer | Must change |
|---|-------|----------------------------|-------------|
| 1 | `src/agents/coordinator.md:219-237` § Maintainer release routing (built into `plugins/blackhole-claude/agents/coordinator.md:201`) | Tells the owner to route a release request to `.claude/skills/prj-create-release/SKILL.md` and run `bun run release prepare\|validate\|tag\|push`, forbids `gh release create` without `.github/releases/vX.Y.Z.md`, and gates milestone closure on `gh release view`. None of those exist in a consumer; the monorepo has an unrelated skill of the same name | Remove the section from the shipped agent. A consumer's release request goes to its declared skill or contract; with none, the coordinator declines and says release is not blackhole's job here. Blackhole's own maintainer routing moves to this repo's `.claude/` rules |
| 2 | `src/references/merge-risk.md:35`, `scripts/lib/merge-gate/merge-risk.ts:13,28,103,239` | The `release-tag` hold category lists this repo's script names, `.github/releases/` and any `package.json` version bump, so a consumer's PR that bumps its own version is held for the owner | Fill the category from the contract's hold paths plus generic release-machinery detection; remove the literal blackhole file names and the blanket version-bump trigger from the shipped table |
| 3 | `src/references/merge-conflict-protocol.md:160-169` § Hot files | Sets `package.json` `version` to `max(target, child)`, "bumped above the target's" | Apply only when the contract says `version_bump: per-pr`; otherwise keep the target's value and never author a bump |
| 4 | `src/references/audits/29-plugin-cache-version-bump-audit.md`, `V-PLUGIN-01` in `src/references/blackhole-vcodes.md:138`, `templates/hooks/pretooluse/README.md:10-54` | A BLOCK reviewer gate on `templates/hooks/**` plus `package.json` `version`, shipped to every consumer's reviewer; vacuous only by path coincidence | Scope it explicitly to this repo (plugin-source identity), then retire it with the per-PR bump if question 8 is yes; update the README |
| 5 | `src/references/decision-parking.md:52` | Lists "the release permission" among decisions allowed without asking; no such config key exists anywhere | Delete the phrase: the plugin has no release permission because it does not release |
| 6 | `src/references/forge-channels.md:51` | A "Create release" forge-operation row; no playbook step uses it | Keep as a forge capability only if no playbook cites it; add a note that it is not a duty. Verify with the new check below |
| 7 | `src/references/forge-sync.md:96-126`, `src/references/config-template.md:17,43` (`scope_milestone`) | Opt-in campaign scope by milestone title; fails sync if the configured milestone is missing | No change: the consumer chooses it. It is the model for the other rows |
| 8 | Nothing | No code reads a consumer's release trailers, labels or contract | Add the contract reader and launch-gate discovery (slice 6) |

Out of scope and unchanged: the plugin-defined PR trailers `Closes #N` (`V-GIT-01`), `Reuse Check:`
and `Spec-Change-Approved:` are not release rules and coexist with a consumer's trailers.

A new check in `scripts/checks/` (grep-based, like `V-INVOKE-01`) fails when a shipped playbook
(`src/agents`, `src/references`) names `bun run release`, `.github/releases`, `prj-create-release`
or `scripts/release` outside a section marked as this repo's own. Its V-code is allocated at
implementation.

## Alternatives Considered

### A. Push-triggered deterministic auto-cut (chosen, as `workflow_run`)
Strongest case for the naive form: a `push` trigger is three lines of YAML and the monorepo already
runs it. Rejected as written and adopted as `workflow_run`: Context 2 shows a push run races CI
and skips, whereas `workflow_run` is event-driven, needs no polling, and removes one no-op run per
merge from a single-replica runner.

### B. release-please style release PR with auto-merge
Strongest case: no bot push to `main`, so it survives branch protection; the open release PR
shows the pending batch and offers a veto; the tool is maintained and handles several apps.
Rejected today: `main` is unprotected here (Context 9) and in the monorepo, so the PR buys
nothing; a PR opened with `GITHUB_TOKEN` starts no CI, so auto-merge needs an App or PAT anyway;
it cannot run `bun run build`, so the 7 generated manifests become `extra-files` to re-verify; the
merged release PR is itself a merged PR the next count must exclude; latency doubles. It becomes
right if branch protection lands (question 11).

### C. semantic-release on every merge
Strongest case: zero policy, minimal latency, a mature ecosystem, fixes live as soon as they
merge. Rejected: about 12 merges a day is about 12 plugin refreshes a day for one owner (Context
4), the opposite of the batching need, and up to 89 merges a day is a prod deploy each in the
monorepo; it cannot tell that a docs-only merge ships nothing (M3) and adds a Node toolchain to a
Bun repository.

### D. Keep the cadence as is
Strongest case: it runs here (19 of 19 runs succeeded), carries 973 lines of tested code, and the
owner just tuned it (#1516). Rejected: cron-only (24% delivery, gaps over 11 h), the cut has never
executed in production here, the model call and the agent-driven hotfix remain, and no running
session learns of a release. A minimal D' (add `push`, drop Haiku) still fails Context 2. Most of
D is reused: the gate, classification, notes builder and publish step.

### E. External scheduler (a seedbox timer dispatching the workflow)
Strongest case: a reliable clock. Rejected: an owner-hosted dependency and credential for what the
`workflow_run` event already removes.

### F. Push into consumers (App-token `repository_dispatch` and a pin-bump PR)
Strongest case: the consumer's pin moves within seconds of a release, with a reviewable PR.
Rejected: it needs an App token (a new owner-gated secret), makes blackhole know and address its
consumers (against the plugin rule), and a poll bounded at 6 hours gives the same outcome for a
pin that cloud sessions already float past.

### G. Two models, one per repository
Strongest case: each repo keeps what already works (the monorepo's `push` trigger, resumable
cut and age flush landed or proposed there on their own evidence). Rejected by the owner's ruling:
the failure classes are the same (no clock, half-cut, a model call, no consumer signal), the
mechanisms converge once CI duration and the cut's state are parameters, and one model is
maintained and reviewed once.

### H. Cut only when the green run is on the live tip
Strongest case: the released tree is exactly the verified tree. Rejected: with a CI of about 20
minutes and a merge stream, the monorepo's green runs are always behind the tip, so the cut
would almost never run; M2's ancestor rule accepts a bounded unverified delta, each commit of which
already passed its pre-merge gate.

## Consequences

### Positive
- A merge becomes a published release in about 6 to 27 minutes here (Verify 4 to 9 min, cut about
  1 min, `release.yml` 0.5 to 17 min per `release.yml:20`), not a dropped cron's next slot.
- Zero model tokens and no model secret on the release path; about 160 lines of AI-notes code,
  the `gh` listing and one of two note generators go.
- Batching reaches Claude installs for the first time: the version changes on `main` only at
  cuts, plus the immediate class.
- A half-finished cut heals on the next event; the plugin stops carrying release rules that
  point at repositories it does not own.

### Negative
- A bot still pushes to `main`; enabling branch protection later forces alternative B.
- `workflow_run` runs the default branch's copy of the workflow, so a workflow change takes
  effect only after it merges, and a cancelled or skipped CI run produces no cut.
- Commits between the verified SHA and the tip ship unverified by main CI (M2).
- `SHIPPED_PATHS` must track new build targets in each repo.
- A consumer contract block is one more config surface to maintain.

### Risks
- The REST-created tag may be rejected like the git push did. Mitigation: slice 0 of the
  monorepo ADR runs it on the live wedge first; slice 2 here waits for the result; the fallback is
  a credential decision (question 4).
- The policy numbers (24 h, 6 h, 10 and 20) are guesses. Mitigation: constants plus
  `bun run release-cadence --json`.
- A tip that never gets a green CI run under a merge stream. Mitigation: M2 needs only a green
  ancestor, and the daily backstop re-evaluates.
- Dropping the per-PR bump (question 8) makes a hooks fix wait for its immediate cut. Mitigation:
  that cut is automatic and bounded by CI plus `release.yml`.
- Discovery misreads a consumer's conventions. Mitigation: the owner confirms the contract once
  at the launch gate, and the default is to do nothing release-related.

## Token cost

| Step on the release path | Today | After |
|--------------------------|-------|-------|
| Haiku release notes (`claude -p --model haiku --max-turns 1`) | 1 call per cut when `CLAUDE_CODE_OAUTH_TOKEN` is set; secret not visible, so 0 today. Input is capped by code at 10 PRs x 2,000 characters, output at 32 KB, timeout 45 s | 0 |
| Manual hotfix (`/prj-create-release`, eight steps, hand-written notes) | 1 agent session per hotfix; hotfixes were the normal path until v0.34.0 | 0 |
| Maintainer-pass milestone close; orchestrator learning of a release | 1 agent step per milestone; none (it never learns) | 0 (M9; deterministic `git ls-remote`) |
| `claude plugin validate --strict` in `verify.yml:86-102` | 0 (a local static check, not a model call) | 0 |

Token counts are unmeasured: nothing in the repository logs them, so none are claimed. Slice 2
accepts only when `rg -n "claude -p|CLAUDE_CODE_OAUTH_TOKEN" .github scripts` finds nothing. The
monorepo's own table is in its adoption record.

## Adoption by the monorepo

The monorepo adopts this model through its adoption record (PR #5859 there): its parameters in the table
above, its wedge evidence, its deploy train, its ops lane, its `vendor/blackhole` pickup and its
owner-gated slices. That repository's workflow files are owner-gated, so this ADR edits nothing
there. Where the monorepo's own CI differs (its `main-verify` exists only in trust mode and is
cancelled under a merge stream), M2 is the rule that makes the model work there.

## Implementation slices

Each slice is one reviewable PR; gated means workflows, a secret or a gate file, and it waits for
the owner. Monorepo slices are in its adoption record.

| # | Slice | Gated | Acceptance |
|---|-------|-------|------------|
| 1 | Deterministic core: git-log pending set, `SHIPPED_PATHS`, M4 policy, M5 version rule, M2 freshness predicate, M8 state detection, delete the AI-notes code and `gh` listing, tests per class | no | touched libs' tests; `--json` prints class and reason |
| 2 | Workflow: M1 triggers, REST publish (M7) and resume (M8), remove the Haiku step, M9 milestone step, drop git-cliff and `cliff.toml` | yes (workflow) | one real cut observed; the `rg` check is empty; waits for the REST spike |
| 3 | Docs: ADR-060 banner and INDEX row, runbook, `prj-create-release`, governance rule, delete `release.ts` prepare/main and `TEMPLATE.md`, ADR-030 amendment if question 8 is yes | no | Verify green; no stale reference to the manual path |
| 4 | `plugin-update` signal and status line (M10) | no | fixture test: newer tag prints the line, offline prints nothing |
| 5 | Remove the consumer-facing impositions: audit rows 1 to 6 (coordinator release routing, merge-risk table, conflict-protocol bump rule, `V-PLUGIN-01` scoping, phantom permission, forge-channels note) and the new playbook check | no | the check passes; `bun scripts/verify.ts` green; no shipped playbook names this repo's release tooling |
| 6 | Consumer release contract: optional `release` config block, launch-gate discovery and confirmation, contract-aware PR body and merge-risk hold paths | no | config-registration and launch-gate tests; a fixture repo with a declared contract and one without |

Order: 1 (safe alone, the cron path keeps working), then 2 with the owner removing the secret,
then 3 to 6 in any order; 5 before 6 because it only removes. Slice 2 here and the monorepo's
slice 3 both wait on the monorepo's slice 0.

## Open questions for the owner

Questions that concern only the monorepo are in its adoption record (M1 to M4 there).

1. **ADR number.** Open PRs #1508 and #1514 hold decision files numbered 061 and 062 (the
   title of #1514 says 061). This ADR takes 063 so `V-ADR-05` sees no duplicate.
2. **ADR status.** Add `proposed` to the `V-ADR-01` enum so a design PR can say what it is?
3. **One model.** Confirm that both repositories run exactly this mechanism, with the
   parameters above, including the `workflow_run` trigger in the monorepo (replacing its `push`
   trigger) and the freshness rule M2 (accepting an unverified delta between the green SHA and the
   tip).
4. **Tag rejection (both).** If the monorepo's slice 0 shows a REST-created tag is rejected like
   the git push, accept a credential beyond `GITHUB_TOKEN` (a new owner-gated secret), or split the
   tag from the workflow-touching range?
5. **Policy numbers and shipped sets.** Keep 10 PRs here and 20 in the monorepo, 24 h age flush
   and 6 h cooldown in both? Is the `SHIPPED_PATHS` starting list for this repo right? Should
   voyage-only and croissant-only merges count toward the monorepo's threshold, or only trigger the
   age flush as proposed?
6. **Immediate class.** Here, is any change under `templates/hooks/**` too broad (`fix(hooks)`
   only would let hook refactors wait for a batch)? In the monorepo, leave the class empty
   (proposed) or enable `Release: immediate`, which makes any PR able to trigger a prod deploy?
7. **Pre-1.0 breaking change.** Bump minor (proposed) or jump to 1.0.0 as the code does today?
8. **Retire the per-PR bump.** Should `V-PLUGIN-01` stop requiring hooks PRs to bump
   `package.json` (the immediate class replaces it, amending ADR-030 mechanism 1)?
9. **Haiku and its secret (both).** Confirm retiring model-written notes in both repos (in the
   monorepo this retires US-REL-02 criterion 8). Confirm `CLAUDE_CODE_OAUTH_TOKEN` is absent here,
   and delete it in the monorepo; secrets are an owner action.
10. **Milestones.** Keep M9's no-op-safe close here, or retire the milestone rule entirely?
11. **Branch protection.** Will `main` get it in either repo? If yes, build alternative B instead
    of M7.
12. **Pickup of installed copies.** Uninstall the stale project-scope rows and rely on user scope,
    or accept manual refresh there? For a vendored pin, is the consumer-owned poll (a direct
    gitlink push by the consumer's ops lane) acceptable, or must the pin move through a PR?
13. **Consumer contract.** Approve the optional `release` block in `.blackhole/config.json` plus
    launch-gate discovery (slice 6), or discovery and `AGENTS.md` only?
