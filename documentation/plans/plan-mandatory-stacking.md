---
issue: #1113
supersedes_adr: null
rulings_checked_at: 6
ruling_conflicts: []
plan_base_commit: c0829bc0
type: plan
summary: "Make stacking the only overlap strategy: compute overlap against every open PR in the repo (GitHub and Gitea) from the files each PR changes, re-check at PR open, on each push and at every turn start, restack by merge only, recover stacked children after any parent merge (squash, merge commit, rebase, or closed unmerged) with a merge that uses the recorded parent tip as merge base, and fail any campaign PR that overlaps an open PR without being stacked on it"
status: current
review_trigger: "on file change"
created: 2026-11-11
last_updated: 2026-11-11
related: [decisions/ADR-027-forge-adapter-interface.md, decisions/ADR-048-github-rest-forge-channel.md, reference/product-principles.md]
---

# Plan: Issue #1113, stacking is the only behavior

Track: **Enterprise**. The change spans 5 milestones, about 30 source files plus generated mirrors,
a queue schema addition, and a new enforcement gate. The Risk Assessment holds HIGH items, so
Threat Model and Stop Conditions are included.

## Objective

Every campaign PR that would conflict with another open PR in the target repo is stacked on it.
Each of the six acceptance criteria of #1113 must be met:

1. Overlap is computed against **every open PR in the target repo**, from the files each PR
   actually changes. Queue issues alone are not enough.
2. Overlap is re-checked at PR open and on each push. A PR that newly overlaps an older open PR is
   restacked onto it by **merge**. Never rebase or force-push.
3. After any parent merge (squash, merge commit or rebase), in every `merge_mode`, the child is
   retargeted and the new base is merged in automatically, before review and CI run on the child.
4. A gate fails a campaign PR that overlaps another open PR without being stacked on it.
5. No config flag turns stacking off. `queue-dag.md`, `merge-gate.md`, `config-template.md` and
   `phase-loop.md` say stacking is the only behavior.
6. Tests cover overlap with a non-queue PR, late overlap at PR open, squash and merge-commit parent
   merges, and the gate.

### What a squash merge forces (stated up front)

When a parent is **squash- or rebase-merged**, the child's history no longer contains the commits
that landed. One new commit on the child is therefore unavoidable: one push, so **CI runs once more
on every direct child**. That run is legitimate, because the child's base really changed. This
plan removes three other costs:

- **The conflict.** The child gets a merge commit whose tree is computed with the recorded parent
  tip as the merge base (`git merge-tree --write-tree --merge-base=<parent_tip>`). When the squash
  content equals the parent tip, that merge has zero conflicts.
- **The extra review round.** An LGTM carries over when the child's own patch is unchanged
  (patch-id equality).
- **The manual work.** Recovery is automatic.

Only a **merge-commit** parent merge avoids the push entirely. That is why D2 below recommends
merge commits for parents with open children. External AI reviewers, such as ActionMan on the
`synchronize` event, will still re-review the new head. The campaign cannot stop that; it can only
post the diff-equivalence evidence.

## Preconditions

| Check | Result |
|-------|--------|
| `ARCHITECTURE.md` at the repo root (V-ADA-01) | Present on `origin/main` (`c0829bc0`) |
| Owner rulings (`documentation/reference/product-principles.md`, `rulings_revision: 5`, bumped to 6 by M0 with R-005) | R-001..R-004 were active at planning time. None contradicts #1113. R-002 ("no silent default for the highest-autonomy option") supports the absence of a stacking toggle. R-004 (campaign implements, ActionMan reviews) holds: recovery is in-process, never a slash command |
| Prior art | #1082 (dispatch stacking), #1086 (replay after squash, prose only), #1100 (open-PR files at dispatch), #860/#794 (`stack-repair.ts`), #793 (merge-base assertion) |
| Existing opt-out to remove | None found. `git grep -iE "stack_mode\|no-stack\|stack: false\|opt.?out"` over the four docs and `scripts/` returns only prose. AC 5 is therefore a **guard against re-introduction**, not a removal |

### Contradictions found in the current code (fixed by this plan)

1. **`stack-repair.ts` rebases and force-pushes.** `planRepair` emits `git rebase --onto` and
   `push --force-with-lease` (`scripts/stack-repair.ts:84-85, 294-302`). `queue-dag.md` Step 3b
   item 6 and `merge-conflict-protocol.md` § Stacked child say "never rebase or force-push". The
   tool and the docs disagree, and the tool is what `phase-loop.md` step 4.6 runs. AC 2 and AC 3
   require the docs' version.
2. **`pr-lint.sh` V-STACK-01 hardcodes `main`** (`scripts/pr-lint.sh:47`) and uses GraphQL
   (`gh api graphql`, line 12). GraphQL fails on classic-Projects repos, the same failure
   `forge-channels.md` documents.
3. **`stacked_on` is an issue number** (`queue-dag.md:68`), so an external parent PR with no queue
   issue cannot be represented.
4. **Overlap reads only queue rows** (`collectParentFiles`, `scripts/lib/stack-parent.ts:136-148`)
   and runs only once, at dispatch (`phase-implement.md:10`). Those are gaps 1 and 2 of the issue.

## Design challenge: the strongest case against "stacking is the only behavior"

| # | Counter-case (steelmanned) | Why it is real here | Mitigation in this plan |
|---|---------------------------|--------------------|-------------------------|
| C1 | **Stacking turns parallel work into a serial chain.** Merge latency becomes chain depth × (CI + review). Conflicts are often rare and cheap, but stacking costs are certain and compound | In blackhole itself, every PR regenerates about 8 mirror trees, and the repo has a finding that every campaign PR conflicts on `documentation/INDEX.md`. A file-overlap predicate would stack *every* PR into one chain | **D1**: the deciding predicate is "would conflict" (`git merge-tree` of the two heads), with file overlap only as a cheap prefilter. Clean-merging overlaps on hot files are not stacked. **D5**: a fixed depth cap (4). Beyond it the issue is *deferred* (Step 3), never fanned out, so it does not break "stack or wait" |
| C2 | **A stale parent blocks its children forever.** A parent stuck in `needs-chef`, review loops, or an owner's abandoned PR holds every descendant hostage | Under `leave-open`, the human may never merge the parent | **D6**: a per-instance HITL "unstack this child" escape after 72 h of parent inactivity or `needs-chef`/`blocked`, asked through `AskQuestion` with an R-003 executive summary. It is not a config flag, and it detaches by replay merge (parent work removed) only when that merge is conflict-free |
| C3 | **Parent fix rounds cascade.** Each parent push merged eagerly into N descendants means N CI runs and possibly N re-reviews per parent fix | Current `queue-dag.md` Step 3b item 5 is eager | **D7**: lazy propagation. The child's three-dot diff against its parent branch is unaffected by new parent commits, so propagation happens only when the child is `CONFLICTING` against the parent, or at parent merge |
| C4 | **On squash-only repos, stacking does not remove the CI rerun the owner wants gone. It moves it to after the parent lands** | See "What a squash merge forces" above | **D2** (merge-commit parents when allowed) plus **D8** (review carry). Residual cost: one CI run per direct child per squash-merged parent. This is stated, not hidden |
| C5 | **External PRs cannot be restacked.** The campaign may not push to them | The live incident was Gitea/workflows#159 vs #157 | The campaign only ever moves **its own** PR. An external same-repo PR can be a parent (we base on its branch and never push to it). A fork PR cannot be a base, so D4 defers or exempts with a named reason |

**Verdict:** the requirement holds with C1–C5 mitigated. Without D1 (conflict predicate) and D7
(lazy propagation), mandatory stacking would be worse than today on hot-file repos.

## Owner decisions

Ranked by when they block work. D1, D2 and D9 block M1/M2. All eleven were answered by the owner on 2026-11-11 (see Decision Records, "Owner answers").

| # | Decision | Options | Recommended | Why the alternative is still credible |
|---|----------|---------|-------------|---------------------------------------|
| D1 | Overlap predicate | (a) shared changed file (AC 1 literal); (b) shared file as prefilter, then `git merge-tree --write-tree <A> <B>` conflict as the decider | **(b)** | (a) is simpler and catches *semantic* coupling that merges cleanly but breaks at runtime. (b) matches the owner's words ("whenever they would conflict") and avoids the C1 serialization. AC 1's "by the files each PR actually changes" stays true: files are the input to both stages |
| D2 | Merge method for a parent that has open stacked children | (a) keep squash everywhere (§ 9); (b) merge commit when `allow_merge_commit`, squash otherwise | **(b)** | Squash keeps `main` linear and one commit per issue. (b) removes the child push, the CI rerun and the review risk entirely, and is the single biggest lever on the issue's stated goal |
| D3 | A child overlaps two different open chains | (a) stack on the tip of the lowest-numbered root, then linearize: merge the older chain's tip into the younger chain's root when the campaign owns that root; (b) defer the child until one chain lands | **(a)** for owned roots, **(b)** when the younger root is external | (b) never touches a PR under review. (a) keeps throughput, but costs one CI run on the moved root |
| D4 | Parent is a fork PR (cannot be a base branch) | (a) defer if not started; if already open, exempt with `unstackable-parent:fork:#N` and hold the merge until #N merges or closes; (b) hard-fail the gate | **(a)** | (b) is purer, but would wedge a campaign on a stranger's PR |
| D5 | Chain depth cap | (a) none; (b) fixed constant 4 in code; (c) config key | **(b)** | (c) gives flexibility, but a config key is the start of the opt-out AC 5 forbids |
| D6 | Stale-parent escape | (a) none, children wait; (b) per-instance HITL unstack after 72 h idle, `needs-chef` or `blocked` | **(b)** | (a) is the only fully "stacking-only" answer, but C2 makes it a liveness bug |
| D7 | Parent fix-round propagation | (a) eager, current doc; (b) lazy: only on `CONFLICTING` against the parent, or at parent merge | **(b)** | (a) keeps every child testable against the latest parent; (b) stops C3 cascades |
| D8 | Review after recovery | (a) always re-review; (b) carry LGTM when `git patch-id --stable` of the child's own diff is unchanged and the replay had zero conflicts | **(b)** | (a) is safest when the new base changes runtime behavior, but CI still runs on the new base and catches that class |
| D9 | Source of each open PR's changed files | (a) `git fetch` of `refs/pull/<N>/head` for the open set, diff computed locally (0 per-PR API calls); (b) REST `pulls/N/files` per PR with a head-SHA cache | **(a)**, with (b) as fallback | (b) needs no git objects and works on shallow clones |
| D10 | Record the requirement | (a) issue only; (b) append ruling R-005 "stacking-is-the-only-behavior" (verbatim from the #1113 body) and write ADR-051 | **(b)** | (a) avoids ceremony, but the reviewer only BLOCKs on *ledger* rulings (V-RULE-01), so without (b) a future PR re-adding a toggle passes |
| D11 | Gate placement for consumer repos (Gitea included) | (a) campaign-side `stack-check.ts` hard STOP at PR open, pre-review and pre-merge, plus `pr-lint.sh` for this repo; (b) also ship a reusable consumer CI job | **(a)**; (b) as a follow-up issue | (b) also catches humans' PRs, but blackhole does not own consumer CI |

## Task Breakdown

TDD throughout: each "tests" task lands the failing tests first, and the next task makes them pass.
One PR per milestone. The milestones overlap on `queue-dag.md` and `merge-gate.md`, so the PRs
**stack** on each other (this plan uses its own behavior).

### M0: Record and decide (about 1 h, owner plus orchestrator)

- **T0.1** Present D1–D11 to the owner through `AskQuestion`, each with an R-003 executive summary.
  - **AC**: every decision has a recorded answer in the plan's Decision Records.
  - **AC**: if D10 is (b), `product-principles.md` gains R-005 with `rulings_revision: 6`, and
    `documentation/decisions/ADR-051-stacking-only-overlap-strategy.md` exists with `status:
    accepted` and a row in `documentation/decisions/INDEX.md`.

### M1: Repo-wide open-PR snapshot and overlap engine (about 7 h)

- **T1.1 (tests first)** `scripts/lib/open-pr-snapshot.test.ts` and
  `scripts/lib/stack-overlap.test.ts`. Required failing tests:
  - a non-queue open PR touching the same file is picked as parent (AC 6a);
  - a fork-head PR is never picked and is reported `unstackable: fork`;
  - two overlapping chains: the tip of the lowest-numbered root is picked and the other is
    reported in `also_overlaps` (D3);
  - a candidate whose base chain reaches the child is refused as a cycle;
  - with D1(b), a file overlap whose `merge-tree` is clean yields no parent;
  - the snapshot uses exactly `ceil(open/100)` list calls plus one `git fetch` and **0** per-PR API
    calls on the refs path, counted with an injected runner;
  - the REST fallback re-reads only PRs whose `head.sha` changed against the cache;
  - more than 1000 open PRs, or a failed list call, returns `unknown`, never `[]`.
- **T1.2** Extend `ForgePr` (`scripts/lib/forge-adapter/types.ts`) with `baseRefName`,
  `headRepoIsFork`, `draft`, `createdAt`. Add `prFiles(n)` and `prChangeBase(n, base)` (REST PATCH
  plus read-back). Implement in `github.ts`/`github-rest.ts` and `gitea.ts`/`tea-cli.ts`;
  `gitlab.ts` throws a `not-supported` error.
  - **AC**: `forge-adapter/{github,gitea}.test.ts` cover mapping and base-change read-back;
    `bun test scripts/lib/forge-adapter` passes in CI.
  - **AC**: `prChangeBase` returns `{ok:false}` when the read-back base differs, even if the PATCH
    exit status is 0.
- **T1.3** `scripts/lib/open-pr-snapshot.ts`: one snapshot per turn, shared across all campaign
  PRs. It reads open PRs through the adapter and fetches `refs/pull/<N>/head` for the open set in a
  **single** `git fetch` (D9a). It computes each PR's files as `git diff --name-only
  $(git merge-base <base> <head>) <head>`. It caches `{pr, headSha, files}` in
  `.blackhole/pr-files-cache.json`, which is gitignored and written by the orchestrator only.
  - **AC**: the T1.1 snapshot tests pass.
- **T1.4** `scripts/lib/stack-overlap.ts`: a pure `pickParent(me, snapshot, opts)` over the
  **forge PR graph**, with edges read from each PR's `baseRefName`. It reuses the glob/known-path
  rules from `stack-parent.ts`, the tip rule (deepest open descendant, lowest number breaks ties),
  cycle refusal over base edges, and the D1(b) `merge-tree` decider through an injected function.
  The depth cap of 4 (D5) returns `defer: depth`. `pickStackParent` in `stack-parent.ts` becomes a
  thin adapter over it, so the dispatch call site keeps working.
  - **AC**: every T1.1 overlap test passes.
  - **AC**: the existing `scripts/lib/stack-parent.test.ts` passes unchanged.
- **T1.5** Queue schema: add `stacked_on_pr: number|null` and `parent_branch: string|null`, the
  canonical stack edge. `stacked_on` stays as the issue-number alias for queue parents. Update
  `queue-dag.md` Field rules, `scripts/lib/campaign-status/types.ts`, `fixtures/queue.example.json`
  and the queue/ledger schema checks.
  - **AC**: `bun run verify` passes in CI.
  - **AC**: `verify.queue-coherence.test.ts` gains a case where an external `stacked_on_pr` is not
    flagged.

### M2: Merge-only restack and recovery engine (about 9 h)

- **T2.1 (tests first)** `scripts/lib/stack-merge.test.ts`, using real temporary git repos in the
  pattern of `scripts/lib/stack-replay.test.ts`. Required failing tests:
  - **squash parent**: the replay merge has zero conflicts, the child's own diff against the new
    base equals the pre-merge diff against `parent_tip`, the old child head is an ancestor of the
    new head (fast-forward push, no force), and the new commit has two parents (AC 6c);
  - **merge-commit parent**: verdict `retarget-only`, and no commit is created (AC 6d);
  - **rebase-merged parent**: same result as squash;
  - **parent closed unmerged**: the replay against the parent's own base removes the parent's
    lines, or reports `conflict` when the child edited the same lines;
  - **external parent force-pushed**: the replay with the old tip as merge base onto the new tip
    succeeds, and `parent_tip_sha` is updated;
  - **late restack**: an open child based on `main` gains overlap with an older PR, and a normal
    merge of the parent head plus a base change yields the child's own diff only (AC 6b);
  - **patch-id**: equal before and after a conflict-free replay, different after a resolved
    conflict;
  - **git without `merge-tree --merge-base`**: returns `unsupported`, never a silent fallback.
- **T2.2** `scripts/lib/stack-merge.ts` with three functions:
  - `replayMerge({repoRoot, child, newBase, mergeBase})` uses `git merge-tree --write-tree
    --merge-base`, then `commit-tree -p child -p newBase`, then a fast-forward `git push origin
    <sha>:refs/heads/<child>`;
  - `restackOnto({child, parentHead})` is an ordinary `git merge` followed by `prChangeBase`;
  - `classifyParentLanding` is local only: `parent_tip` is an ancestor of the new base → `merge`,
    otherwise `rewrite`, or `abandoned` when the forge says closed and not merged.
  - `ownPatchId(base, head)` returns the patch-id of the child's own diff.
  - A guard `assertOwnedBranch(branch, queue)` refuses any push to a branch that is not a queue
    `blackhole/issue-N` branch.
  - **AC**: the T2.1 tests pass.
  - **AC**: a unit test proves `assertOwnedBranch` refuses an external head ref.
  - **AC**: the source contains no `rebase`, `--force` or `-f` push (a grep assertion in the test).
- **T2.3** Rewrite `scripts/stack-repair.ts repair` on top of `stack-merge.ts`. Remove
  `rebaseOnto` and the `--force-with-lease` push. Add a `restack` subcommand. Keep the `capture`
  semantics. Migrate its private `parseFlags` to `scripts/lib/argv-flags.ts`, which is a Scout fix
  inside the diff and satisfies the `verify.argv-flags-adoption` check. The success measure stays
  "child's own file count equals the pre-merge value" (`verifyChildFileCount`), with patch-id
  equality added and emitted as `review_carry: true|false` (D8).
  - **AC**: `scripts/stack-repair.test.ts` is updated. A regression test asserts that the planned
    commands contain neither `rebase` nor `force`. A conflict is reported with exit 1 and the
    conflicted paths, and nothing is pushed.

### M3: Lifecycle wiring in every merge_mode (about 5 h)

- **T3.1** Re-check points. Run `stack-check` (T4.2) with `--fix` at four points:
  - (i) right after the implementer opens the PR (`implementer.md` step 6, `phase-implement.md`
    checklist);
  - (ii) after every fix-round push, before review is requested (`phase-review.md` re-entry);
  - (iii) at every turn start for every open campaign PR, against the turn's single snapshot;
  - (iv) before merge, as a new `phase-loop.md` **Step 0.4**.
  A newly overlapping older PR triggers `restack`. A newly opened *younger* external PR that
  overlaps ours triggers nothing: the younger PR stacks, and ours stays put.
  - **AC**: `phase-loop.md`, `phase-implement.md`, `phase-review.md` and `implementer.md` cite
    Step 0.4 and `stack-check.ts` by pointer only (V-DOC-05). The `verify.links` and
    `verify.vcode-citation` checks pass.
- **T3.2** Recovery per merge mode. `phase-loop.md` step 4.6 runs `stack-repair.ts repair --apply`
  per child **in the same turn**, before that child's review or CI wait.
  - `immediate`: after step 4.5.
  - `gated-batch`: inside § 4's per-issue loop. A recovered child must re-reach CI green before its
    own turn in the batch, which costs one CI cycle per stack level and is stated in `merge-gate.md`
    § 4. Collapsing the chain into one merge is listed as a follow-up.
  - `leave-open`: triggered by the § 3 externally-observed merge at turn start. The child's
    `delivered-at-LGTM` note is revoked until recovery and CI finish.
  - Also add the `review_carry` rule (D8) and lazy fix-round propagation (D7) to `queue-dag.md`
    Step 3b items 5–6.
  - **AC**: a dry-run table in `merge-gate.md` § 7 lists the action for each of the 3 merge modes ×
    4 landings (merge, squash, rebase, closed-unmerged). Every cell names a command or a HITL route.
- **T3.3** Parent merge method (D2). When the PR has open stacked children and the repo allows
  merge commits, step 4 uses `merge_method: merge`; otherwise it uses `squash`. `stack-repair
  capture`'s graded warning is unchanged.
  - **AC**: the `merge-gate.md` § 9 text and the `phase-loop.md` step 4 text agree.
  - **AC**: the `merge-risk.ts` tests are unaffected.

### M4: Enforcement gate and the no-opt-out guard (about 4 h)

- **T4.1 (tests first)** `scripts/stack-check.test.ts`. Required failing tests:
  - overlapping and not stacked → exit 1 with `V-STACK-02` and both PR numbers (AC 6e);
  - stacked on the right tip → 0;
  - stacked on a non-tip of the same chain → 1;
  - exempt fork parent → 0 with the exemption reason printed;
  - unknown snapshot → 3, never 0;
  - malformed flags → 2.
- **T4.2** `scripts/stack-check.ts --pr <N> [--fix] [--open-prs <json>]` over `stack-overlap.ts`.
  `--open-prs` serves the `mcp` channel, where scripts cannot reach the forge. Exit codes follow
  the `merge-base-guard.ts` contract (0/1/2/3). Register **V-STACK-02** (HIGH, BLOCK) in
  `src/references/blackhole-vcodes.md`.
  - **AC**: the T4.1 tests pass.
  - **AC**: `verify.vcode-parity` and `verify.vcode-severity-sync` pass.
- **T4.3** `scripts/pr-lint.sh`:
  - replace the hardcoded `main` with the repo default branch (`gh api repos/$REPO -q
    .default_branch`);
  - replace GraphQL with REST;
  - call `bun run scripts/stack-check.ts --pr "$PR_NUMBER"` for V-STACK-02.
  `.github/workflows/pr-lint.yml` runs on `pull_request` `opened` and `synchronize`, which covers
  "each push" for this repo.
  - **AC**: the CI `pr-lint` job fails on a fixture PR overlapping an unstacked open PR.
    Verification evidence is the CI run on the pushed head, not a local run.
- **T4.4** `scripts/checks/stacking-only.check.ts` plus a test. It fails `bun run verify` when
  `config-template.md` or the config schema gains a key matching `/stack/i`, or when any of the
  four docs lacks the canonical sentence. The sentence is defined once in `queue-dag.md` Step 3b
  and cited by the other three (AC 5).
  - **AC**: `verify.stacking-only.test.ts` has a failing fixture with a `stacking: false` key, and
    a passing one.

### M5: Docs and generated trees (about 4 h)

- **T5.1** Rewrite these docs, each owning its own part:
  - `queue-dag.md` Step 3 and 3b own the "only behavior" sentence and the repo-wide overlap rule.
    Step 3 deferral now applies only to the "no PR yet" and "depth cap" cases.
  - `merge-gate.md` § 7 replaces the `--onto` recipe with the replay merge and the honest squash
    paragraph; § 8 keeps `--stacked-into` as a per-merge landing assertion, not a stacking toggle.
  - `phase-loop.md` adds Step 0.4 and the 4.6 ordering; `leave-open` revokes delivered status.
  - `config-template.md` changes its `merge_mode` stacking note to "stacking is the only behavior,
    no key controls it".
  - `merge-conflict-protocol.md` § Stacked child points to `stack-repair.ts` instead of the manual
    recipe.
  - `forge-channels.md` adds rows for PR files, `refs/pull/<N>/head` and the Gitea base-change
    endpoint.
  - **AC**: `bun run verify` passes, including links, vocabulary and doc-health.
  - **AC**: a grep for `rebase --onto` under `src/references` returns 0 matches.
- **T5.2** `bun run build`, then commit the source and the regenerated mirrors together
  (`phase-implement.md` § Quality gate, V-BUILD-01).
  - **AC**: the CI `verify` job is green on the pushed head. No generated tree is edited by hand.

## Critical Files

All exist on `origin/main` at `c0829bc0`, except the files marked "new".

| File | Change |
|------|--------|
| `scripts/lib/stack-parent.ts` | Becomes an adapter over `stack-overlap.ts` |
| `scripts/stack-parent.ts` | Reads the snapshot instead of `gh pr diff` per queue row |
| `scripts/lib/stack-overlap.ts` (new) | Pure parent pick over the forge PR graph |
| `scripts/lib/open-pr-snapshot.ts` (new) | Bounded open-PR read plus file cache |
| `scripts/lib/stack-merge.ts` (new) | Replay merge, restack, landing classification, ownership guard |
| `scripts/stack-repair.ts` | Rebase and force-push removed, `restack` added |
| `scripts/stack-check.ts` (new) | V-STACK-02 gate |
| `scripts/checks/stacking-only.check.ts` (new) | No-opt-out guard |
| `scripts/pr-lint.sh` | Default branch, REST, V-STACK-02 |
| `scripts/lib/forge-adapter/{types,github,github-rest,gitea,tea-cli,gitlab}.ts` | `baseRefName`, fork flag, `prFiles`, `prChangeBase` |
| `scripts/lib/campaign-status/types.ts`, `fixtures/queue.example.json` | `stacked_on_pr`, `parent_branch` |
| `src/references/{queue-dag,merge-gate,phase-loop,config-template,merge-conflict-protocol,phase-implement,phase-review,forge-channels,blackhole-vcodes}.md` | Docs |
| `src/agents/implementer.md` | Step 6 re-check citation |
| Tests: `scripts/lib/{stack-overlap,open-pr-snapshot,stack-merge}.test.ts` (new), `scripts/stack-check.test.ts` (new), `scripts/verify.stacking-only.test.ts` (new), `scripts/stack-repair.test.ts`, `scripts/lib/stack-parent.test.ts`, `scripts/lib/forge-adapter/{github,gitea}.test.ts`, `scripts/verify.queue-coherence.test.ts` | Tests |

## Codebase Conventions

| Touchpoint | Convention to follow | Source |
|------------|---------------------|--------|
| Script layout | Pure logic in `scripts/lib/*.ts`, thin CLI in `scripts/*.ts` | `stack-parent.ts` / `scripts/stack-parent.ts` |
| CLI flags | `parseFlags` / `requireFlag` from `scripts/lib/argv-flags.ts`. Do not add another private parser; `stack-repair.ts`'s copy gets migrated | `scripts/stack-parent.ts:1`, `verify.argv-flags-adoption` |
| Exit codes | 0 proceed, 1 refuse, 2 usage, 3 could not check | `merge-gate.md` § 8, `merge-base-guard.ts` |
| Forge calls | Through `scripts/lib/forge-adapter/*`. GitHub is REST via `gh api`, never GraphQL porcelain in scripts; Gitea goes through `tea-cli.ts` | `forge-channels.md`, ADR-027, ADR-048 |
| Base change | REST PATCH plus **read-back** of `base.ref`. Exit status is not evidence | `stack-repair.ts` `verifyRetarget` |
| State writes | `.blackhole/queue.json` only by the orchestrator, through `validateStateWrite` (tmp, guard, rename) | `blackhole-state.md` § Single-writer, `stack-repair.ts` `writeQueue` |
| Git tests | Real temporary repos via `makeTempDir`, `git -c user.name=t -c commit.gpgsign=false` | `scripts/lib/stack-replay.test.ts` |
| Verify checks | `scripts/checks/*.check.ts` returning `CheckResult`; a missing live file means SKIP | `scripts/checks/queue-coherence.check.ts` |
| Docs | `src/` is the SSOT; regenerate mirrors with `bun run build` and commit both. Cite by pointer (V-DOC-05); no issue numbers in source comments (V-DOC-06) | `AGENTS.md`, `merge-conflict-protocol.md` § Consulted by |
| Hot files on restack | Generated trees: discard both sides and rebuild. `package.json` version: max. Source files: real 3-way merge | `merge-conflict-protocol.md` § Hot files and generated trees |

## Performance Budget (forge calls)

| Operation | Budget | Notes |
|-----------|--------|-------|
| Open-PR list | `ceil(open/100)` REST calls per **turn**, cap 10 pages | Above the cap, or on failure, the result is `unknown` (exit 3), never "no overlap" |
| PR files (D9a) | 0 API calls; 1 `git fetch` with one refspec per open PR | Only open PRs are fetched, never `refs/pull/*` wholesale. Consumer repos have thousands of closed PRs |
| PR files (fallback) | ≤ open PRs on first run, then only PRs whose `head.sha` changed | Cache in `.blackhole/pr-files-cache.json` |
| Restack or recovery | 1 PATCH + 1 read-back per moved PR | The merge itself is local git |
| `merge-tree` decider (D1b) | Local only; only for file-overlapping pairs | Runs under `with-test-lock` like other bulk git work on the workstation |

## Dependency Blast-Radius

| Consumer | Impact | Estimate |
|----------|--------|----------|
| `phase-implement.md` dispatch checklist → `stack-parent.ts` | Same CLI, wider input | Low |
| `phase-loop.md` Step 0.7 / 4.6 → `stack-repair.ts` | Behavior change: merge replaces rebase | **High**: every stacked campaign PR |
| `campaign-status` dashboard (`stackMergeOrder`) | Must read `stacked_on_pr` | Medium |
| `pr-lint.yml` on this repo | New failing condition | Medium |
| Live consumer `queue.json` files | New fields are optional; old rows still parse | Low |
| Generated mirrors (about 8 trees) | Regenerated | Mechanical |

## Blast Radius (outside the planned file list)

- **Callers and consumers.** Any consumer campaign currently mid-stack. Rows recorded under the old
  `--onto` flow have `parent_tip_sha` set. That works unchanged with the replay merge, because the
  recorded tip is the merge base.
- **Config.** No config key is added or removed.
- **Data.** `.blackhole/pr-files-cache.json` is new and gitignored. `.blackhole/` is already fully
  excluded (`phase-loop.md` step 4.5 cites `.gitignore:2`).
- **CI jobs.** `pr-lint.yml` (V-STACK-02) and `verify.yml` (the new check).
- **Safety fact to prove by executing code**, as the T2.1 precondition:
  `git merge-tree --write-tree --merge-base=<sha> <a> <b>` must exist on the CI runner and on the
  workstation. It needs git ≥ 2.40. This was **not executed during planning**: the planner had
  read-only tools and no shell. T2.1's first test proves it, and its `unsupported` branch covers an
  older git.

## Risk Assessment

| # | Risk | Sev | Mitigation (concrete) |
|---|------|-----|-----------------------|
| R1 | A replay merge computed with the wrong merge base silently drops or duplicates work | **HIGH** | `isAncestor(parent_tip, child)` check before replay. Post-replay own-diff file count must equal the pre-merge count, and patch-id is compared. On mismatch, nothing is pushed (Stop Condition 3) |
| R2 | The campaign pushes to a PR it does not own (external parent) | **HIGH** | `assertOwnedBranch` before every push, with a unit test. External parents are only ever bases |
| R3 | PR-graph cycle (A on B, B on A) | **HIGH** | `stack-overlap.ts` walks base edges from the candidate and refuses if it reaches the child. Tie-break prefers lower-numbered parents. The existing `merge-gate.md` § 2 cycle detector still covers `merge_after` |
| R4 | Parent closed without merging leaves the child containing abandoned work | MEDIUM | `classifyParentLanding` → `abandoned`. Replay against the parent's base removes the parent's lines. A conflict routes to HITL with note `stack-parent-abandoned:#P` |
| R5 | Gitea differences: base-change endpoint, `refs/pull/<N>/head` availability, and whether `RETARGET_CHILDREN_ON_MERGE` is enabled on the live instance | MEDIUM | T1.2 tests both adapters. `prChangeBase` read-back refuses on mismatch. A live probe on the Gitea host (`git ls-remote origin 'refs/pull/*/head' \| head -1`; `PATCH /repos/{o}/{r}/pulls/{n}` with `base`) is the M1 entry check; if it fails, the REST files fallback (D9b) is used. None of the three is verified yet |
| R6 | GitHub auto-retargets a child when the parent branch is deleted, racing our retarget | LOW | Retarget is idempotent. Read-back accepts a base that already equals the target |
| R7 | Long chains serialize merging (C1) | MEDIUM | D1(b) predicate, D5 depth cap, D7 lazy propagation |
| R8 | A stale parent blocks its children (C2) | MEDIUM | D6 HITL unstack |
| R9 | `leave-open` human merges a child into a dead parent branch before recovery runs | MEDIUM | The stack comment states the order. Recovery at turn start retargets. The child's delivered status is revoked on parent merge |
| R10 | The snapshot misses PRs (pagination, rate limit) and reports "no overlap" | **HIGH** | Unknown is exit 3 and never certifies (T1.1 test) |
| R11 | External AI reviewer re-reviews after every recovery push | LOW (accepted) | Post patch-id evidence in the stack comment. Out of the campaign's control |

## Threat Model (STRIDE)

| Category | Threat | Control |
|----------|--------|---------|
| Spoofing | A crafted PR touching our files lures the campaign into basing on it | Fork PRs are never parents. Same-repo branches require write access, so the author is a collaborator |
| Tampering | A parent author force-pushes mid-recovery; a remote child moved by someone else | Replay uses the recorded tip as merge base. Our pushes are fast-forward only, so a moved remote child rejects the push, and the next turn retries |
| Repudiation | Silent restacks | Every restack or recovery edits the stack comment, writes queue `notes`, and appends a decision-log row |
| Information disclosure | Merging an external same-repo branch into ours | No new exposure: same repo, same CI secrets scope |
| Denial of service | Hot-file chains serialize the campaign; oversized open-PR sets | D1(b), D5, D6, the snapshot page cap |
| Elevation of privilege | The campaign writes to a branch it does not own | `assertOwnedBranch` plus Stop Condition 2 |

## Stop Conditions

1. A planned or executed command on a stacked branch contains `rebase`, `--force`,
   `--force-with-lease` or `push -f`: halt and report. This plan removes that path; seeing it means
   a regression.
2. A push target is not a queue-owned `blackhole/issue-N` branch: halt, push nothing.
3. After a replay merge, the child's own-diff file count or patch-id differs unexpectedly and no
   conflict was resolved: halt, push nothing, route to HITL.

## Execution Strategy

| Task | Agent | Model | Parallel? |
|------|-------|-------|-----------|
| T0.1 | blackhole:coordinator (owner `AskQuestion`) | sonnet | First, blocking |
| T1.1, T2.1, T4.1 | mercure:x-tester (writes the failing tests) | sonnet | T1.1 first; T2.1 after T1.2 |
| T1.2–T1.5 | blackhole:implementer | sonnet | Sequential, one worktree |
| T2.2–T2.3 | blackhole:implementer | sonnet | After M1 merges or is stacked on it |
| T3.1–T3.3 | blackhole:implementer | sonnet | After M2 |
| T4.2–T4.4 | blackhole:implementer | sonnet | Can overlap M3 (different files) |
| T5.1 | mercure:x-doc-writer | sonnet | After M3 and M4 |
| T5.2, CI evidence | mercure:x-tester | sonnet | Last |
| Per-PR review | blackhole:reviewer | sonnet | Per milestone PR |

Run tests in CI, not locally (`ci-first-verification.md`): locally, at most one focused spec per
task, through `with-test-lock`.

## Sprint Contract

- **Done means:** all six #1113 acceptance criteria are checked against CI evidence on the final
  head. The `verify`, `pr-lint` and `bun test` jobs are named and green.
- `git grep -nE "rebase --onto|force-with-lease" -- scripts/stack-repair.ts src/references` returns
  0 matches.
- A recorded scenario: a squash-merged parent with one open child recovers with zero conflicts,
  one push, and `review_carry: true`. This is proven by `stack-merge.test.ts` and by one live run on
  a scratch repo if the owner wants it.
- **Out of scope**, filed as follow-ups: a consumer CI job (D11b), gated-batch chain collapse,
  conflict-free aggregate files (union merge driver for `INDEX.md`).

## Decision Records

- **Context**: post-merge child recovery without rebase or force-push.
  - **Alternatives**: (easy) an ordinary `git merge origin/<target>` into the child, the current
    manual recipe, which conflicts on every line both parent and child touched after a squash;
    (hard) a 3-way merge with the recorded `parent_tip` as merge base, committed with two parents.
  - **Choice**: hard.
  - **Rationale**: one mechanism covers squash, rebase, closed-unmerged and external force-push.
    It has no conflicts when the squash content equals the tip, and it is a fast-forward push. The
    cost is git ≥ 2.40 and slightly unusual plumbing (`merge-tree`, `commit-tree`).
  - **Confidence**: Medium. Pending the T2.1 proof.
- **Context**: overlap predicate.
  - **Alternatives**: file overlap vs conflict test.
  - **Choice**: conflict test (D1b), decided 2026-11-11.
  - **Rationale**: see C1.
  - **Confidence**: Medium.

### Owner answers (2026-11-11, decision gate, final)

| # | Answer | Effect on the plan |
|---|--------|--------------------|
| D1 | (b): a shared file is only a prefilter; `git merge-tree` reporting a real conflict decides whether to stack | `stack-overlap.ts` takes the merge-tree decider as an injected function |
| D2 | (b): a parent with open stacked children is merged with a merge commit when the repo allows it, otherwise squash | M3 T3.3 |
| D3 | Recommended: tip of the lowest-numbered root; linearize when the campaign owns the younger root, defer when it is external | `pickParent` reports the other chain in `also_overlaps` |
| D4 | Recommended: fork parent is deferred if not started; if already open, exempt with `unstackable-parent:fork:#N` | `unstackable: fork` result |
| D5 | Recommended: depth cap 4 as a code constant, no config key | `defer: depth` |
| D6 | Recommended: owner-approved unstack after 72 h idle, `needs-chef` or `blocked` | M3 |
| D7 | Recommended: lazy fix-round propagation | M3 |
| D8 | Recommended: carry LGTM when the child's patch-id is unchanged | M2/M3 |
| D9 | (a): changed files of open PRs come from one `git fetch` of `refs/pull/N/head`; per-PR REST with a head-SHA cache is the fallback | `open-pr-snapshot.ts` |
| D10 | Recommended: ruling R-005 plus ADR-051 | M0 (this PR) |
| D11 | Recommended: campaign-side `stack-check.ts` hard stop; a consumer CI job is a follow-up | M4 |
