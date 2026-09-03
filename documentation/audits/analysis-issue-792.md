---
type: analysis
status: current
created: 2026-09-03
last_updated: 2026-09-03
review_trigger: "on file change"
issue: 792
confidence: 80
computed_at_revision: 1
---

# Analysis — Issue #792: Orchestrator resolves repo facts from a possibly-stale working checkout

## Conventions Catalog

One row per pattern the campaign's own protocol/agent files already establish for freshness or
fetch/prune-before-operation — cited by `file:line`, with a usage count where the pattern repeats.

| Convention | Source (`file:line`) | Usage count | Applies to issue #792? |
|---|---|---|---|
| `git worktree prune` + `git fetch --prune` at turn start | `src/agents/orchestrator.md:16`, `src/references/recovery-protocol.md:74` (§ Session resume & recovery step 3 cross-reference), `blackhole-protocol.md` § Branch & Worktree Hygiene | 2 direct call sites, 1 cross-reference | **Prunes stale refs/dirs, but never fast-forwards the checked-out branch itself** — `git fetch --prune` updates `refs/remotes/origin/*`, it does not touch `HEAD` or the working tree. This is the closest existing mechanism and the one #792's fix should extend, not the one that already solves it. |
| Fresh worktree at delegation time (`git worktree add --no-track <scratchpad>/wt-<issue> -b blackhole/issue-<issue> origin/main`) | `src/references/phase-implement.md:10` | 1 (implementer only) | **This is the mechanism that already handles staleness for a different actor** — see § Architecture Coherence below. It works by construction (each worktree is born at whatever `origin/main` resolves to *at creation time*), not by a periodic refresh. It has no equivalent for the orchestrator's own long-lived checkout, which is created once per campaign and never re-created. |
| `git status --porcelain` dirty-check on the main clone at turn start (WARN-only, non-blocking) | `src/agents/orchestrator.md:18` | 1 | Adjacent but orthogonal: checks the main clone isn't *dirty*, never checks it isn't *behind*. A clean-but-stale clone passes this check silently — exactly issue #792's failure mode. |
| Route staleness check (`route.body_hash` vs current issue body) | `src/references/recovery-protocol.md` §8 (per grep: "Route staleness check before any dispatch decision") | 1 | Same *shape* of problem (a cached value silently outliving the ground truth it was computed from) but scoped to forge issue bodies, not repo file content — not directly reusable, but the strongest existing precedent for "detect drift, force a refresh before dispatch" as a protocol pattern. |
| Native forge auto-sync every turn | `blackhole-state.md` § Sync, `orchestrator-runtime.md` (turn-start cadence) | every turn | Same cadence slot the fix should share — forge sync already runs "start of every orchestrator turn," so a repo-freshness refresh has a ready-made insertion point beside it rather than a new turn-start hook. |
| Absolute-path passing for artifacts that must resolve independent of worktree cwd (`{repo_root}/.blackhole/plans/issue-N.md`) | `phase-implement.md:26-36`, `blackhole-state.md` § Staging | several | Not a freshness mechanism, but confirms the codebase's established way of avoiding cwd-dependent resolution bugs — relevant precedent for *how* to phrase a fix (explicit ref, not implicit cwd trust), matching `phase-implement.md` § "Git operations must not depend on inherited cwd" (issue #516) exactly.

**No existing mechanism periodically refreshes the orchestrator's own long-lived main-clone
checkout.** This is a genuine gap, not an already-solved concern re-encountered — confirms the
issue's own framing ("Nothing in the protocol flags this").

## Architecture Coherence

**Does the issue's expected diff sit consistently with existing module boundaries, or introduce a
new pattern variant for an already-solved concern?**

Consistent, not a third-variant risk (V-INT-03 clean) — for one specific reason: the
implementer's existing freshness mechanism and the fix issue #792 wants are **structurally
different solutions to structurally different problems**, so extending one into the other's role
would itself be the V-INT-03 violation:

- **Implementer freshness is point-in-time, by construction.** `git worktree add ... origin/main`
  resolves `origin/main` once, at worktree-creation time (`phase-implement.md:10`). It has no
  "periodic" component and needs none — the worktree is short-lived (created, used, removed per
  `blackhole-protocol.md` § Branch & Worktree Hygiene). Nothing in `implementer.md` re-checks
  freshness mid-session because nothing needs to: the worktree's entire lifetime is bounded by one
  issue's implement phase.
- **The orchestrator's checkout is long-lived, by design.** It is created once (session/campaign
  start) and persists across every turn, every merge, every phase transition for every issue in
  the campaign — exactly the shape that goes stale. There is no natural "recreate" moment
  analogous to worktree teardown; a fix here has to be a **refresh-in-place** action
  (`git fetch origin main && git merge --ff-only origin/main`, matching the reactive fix already
  applied this session per the dispatch prompt), not a recreate-on-demand action like the
  implementer's.

So the correct fix is a new, narrowly-scoped periodic step for the orchestrator's own checkout —
not a generalization of the implementer's worktree-creation pattern (that pattern is already
correct and complete for its own actor) and not a modification to that pattern's call site
(`phase-implement.md:10` needs no change).

**Router/planner/investigator/reviewer share the orchestrator's exposure, unscoped by this
issue's framing.** Grepping `phase-handle.md`, `phase-plan.md`, `phase-review.md`, and
`review-core.md` for `worktree`/`git -C`/`origin/main`/cwd finds zero matches — these four
thinking-mode agent roles have no worktree-isolation mechanism of their own (`implementer` is the
only role with one, per the Conventions Catalog row above). In this session's orchestration
model they are spawned as subagents against the orchestrator's own checkout (or a harness
equivalent), so a stale main clone is stale for all of them, not just the orchestrator's own
Bash calls. Issue #792's title and body scope the fix to "the orchestrator" specifically; this
note flags the wider exposure as a scope question for Plan, not something to fix under this
analysis's own read-only remit.

## Scope map — call sites assuming a fresh main-clone read, no freshness precondition stated

Every documented `bun run --cwd <repo>` / `bun run scripts/*.ts` invocation and file-read pattern
in the campaign's own protocol/agent files that implicitly runs against "wherever the
orchestrator's cwd currently is," with no stated freshness check:

| Call site | `file:line` | Reads repo facts from disk? | Risk |
|---|---|---|---|
| `git status --porcelain` dirty-check | `orchestrator.md:18` | No (git metadata only) | None — not a facts read |
| Plugin-cache drift signal | `orchestrator-runtime.md:163-167` (§ Session resume & recovery step 4) | **Yes** — compares plugin cache content against the live tree | **Highest** — directly the failure class described in the issue: a stale live tree makes a real drift look absent, or an absent drift look present |
| Doc-health signal | `blackhole-state.md` § Doc-Health Signal (Scope-1 only, blackhole's own `documentation/` tree) | Yes — walks `documentation/` for frontmatter/INDEX rows | Medium — Scope-1 only per that section, so it's blackhole self-hosting its own campaign; still reads live tree content each turn with no freshness gate |
| `bun run scripts/plan-quality-gate.ts --plan-file <path>` | `planner.md:96`, `worker-schemas.md:61` | Yes — planner reads codebase conventions/critical-files against live source | High — this is exactly the "Wrong fact pushed into three delegation contracts" failure mode the issue describes (planner cites a config/workflow file that may be stale on the orchestrator-adjacent checkout) |
| "Run the project's build command in main clone (if applicable)" | `phase-loop.md:122` (Merge protocol step 3) | Yes — builds whatever is checked out in the main clone | High — a stale main clone could build/verify against pre-merge source, giving a false green before `gh pr merge` |
| `bun run scripts/ci-diagnosis.ts --pr <n>` | `orchestrator-dispatch.md:239` | Partial — reads CI logs (external, always fresh) but may cross-reference source file content for classification | Low-Medium |
| `bun run scripts/check-review-artifact.ts ... --repo-root <abs>` | `merge-gate.md:292-294` | Yes, but **not at risk**: `--repo-root` is passed as an explicit absolute path to the PR's own worktree/branch content, and `--ledger` points at orchestrator-owned `.blackhole/findings-ledger.json` (never stale relative to itself — orchestrator is sole writer). Cited as a **negative example**: it already sidesteps this whole class by taking explicit paths instead of trusting cwd (issue #806 AC4, `merge-gate.md:295-296`), which is the shape the fix for the other rows should copy. | None |
| `gh issue create ... $(bun scripts/forge-scope.ts create-args)` (Discovery/Kaizen filing) | `orchestrator.md:159`, `phase-loop.md:173`, multiple | No — reads only `config.json`'s scope labels, not repo source content | None |

The two **highest-risk, unmitigated** rows — plugin-drift signal and plan-quality-gate — both
already run at existing turn-cadence checkpoints (§ Session resume & recovery step 4; planner's
own quality gate step), which is why § Insertion Points below proposes hanging the fix on those
same checkpoints rather than inventing a new one.

## Insertion Points (evidence for Plan, not a fix)

Two candidate insertion points, both already-established cadence points — extending an existing
step rather than adding new protocol surface (would keep this a `V-INT-01`-clean change):

1. **Turn-start, inside § Session resume & recovery** (`orchestrator-runtime.md:150-167`). This
   section already runs, unconditionally, every orchestrator turn including compaction recovery,
   and already performs the same class of action for a sibling concern one step later (plugin-cache
   drift signal, step 4, same section). A repo-freshness refresh slots in as a numbered step in
   this exact list, sharing its existing "run once per turn, before any dispatch" guarantee — no
   new turn-start hook needed.
2. **Post-merge, immediately after `gh pr merge --squash`** (`phase-loop.md:123-124`, Merge
   protocol step 4). This is the literal moment that caused this session's incident per the
   dispatch prompt ("Fixed reactively by running `git fetch origin main && git merge --ff-only
   origin/main` after each merge from then on") — refreshing right here closes the specific gap
   between "a PR merged" and "the orchestrator's own clone still shows the pre-merge tree,"
   which is the shortest possible staleness window of the two candidates.

These are not mutually exclusive: (1) bounds staleness to at most one turn's worth of drift;
(2) additionally closes the tighter same-turn window between an in-turn merge and any facts-read
later in that same turn (e.g., `phase-loop.md:122`'s build-in-main-clone step, which runs *before*
step 4's merge in the documented step order — so (2) alone would not protect step 3 of the *same*
merge; only (1), or a step reordering, would). Plan should weigh both; this analysis does not
recommend one over the other.

## Performance / Safety Concern (objective 4)

**Confirmed explicitly, as requested**: `.blackhole/` is fully `.gitignore`-excluded
(`.gitignore:2`; verified via `git check-ignore -v` against both `queue.json` and a `plans/*.md`
path in this checkout — both report a match on that one `.gitignore` line). A `git fetch origin
main && git merge --ff-only origin/main` run in the main clone therefore has **no path to
conflict** with any campaign-state file: `.blackhole/`'s contents are untracked from Git's
perspective entirely, so a fast-forward merge can neither touch them nor be blocked by them. The
one remaining hazard is unrelated to `.blackhole/`: a **tracked-file** local modification in the
main clone (the orchestrator's own dirty working tree, distinct from `.blackhole/` — see the
`git status --porcelain` dirty-check row above) would make `--ff-only` fail closed (exit non-zero,
no merge attempted) rather than silently corrupt anything. `--ff-only` is the correct choice
specifically because it fails safe on exactly this case instead of attempting a merge commit or
rebase that could touch a dirty tree.

Cost side: a `git fetch`+`--ff-only merge` is cheap relative to any `bun run` script invocation
already on the turn-start critical path (network fetch of one ref plus a fast-forward pointer
move — no working-tree rewrite when nothing has changed, which is the common case most turns).
No measurable baseline exists in-repo for this specific operation's latency (no prior benchmark
or profiling artifact found for `git fetch`/`git merge --ff-only` under this campaign's protocol
docs) — omitted per instruction rather than fabricated. The only real risk is the dirty-tree
failure mode above, which is already surfaced (non-blocking WARN) by the existing turn-start
`git status --porcelain` check (`orchestrator.md:18`) — Plan should decide whether that WARN
should be upgraded to a precondition gate for the new refresh step specifically, since today it's
purely informational.

## Uncertainty

- Whether the fix should run every turn (higher-frequency, catches drift from causes other than
  blackhole's own merges — e.g. the human pushing to the shared branch mid-campaign, which is
  exactly the scenario the forge-sourced issue #792 body describes) or only post-merge (lower
  frequency, closes only self-inflicted staleness) is a Plan-level trade-off this analysis
  deliberately leaves open — both candidate insertion points above are evidenced, neither is
  recommended.
- This session's issue #792 was routed with `route.revision: 1` and `needs_analysis: true`,
  `needs_investigation: true`, `needs_design: true` all set (`findings-ledger.json` routing
  decision `R-00077`) — this analysis note covers the `needs_analysis` leg only; whichever
  `investigate` sub-mode work and `design` track work the router also flagged are separate
  spawns, not covered here.
