# Blackhole Protocol

When this repo has `.blackhole/config.json` or the user asks to
finish/run the backlog campaign, follow this protocol.

## Entry

- Use Multitask Mode (coordinator + background orchestrator) or a direct orchestrator session
- Skill: root `SKILL.md`
- Flow: `references/multitask-mode.md`

Coordinator routes only; orchestrator runs five phases; workers implement.

## Five phases (binding)

Handle → Plan → Implement → Review → Loop.

Playbooks: `plugins/blackhole-agent-plugins/skills/blackhole/references/phase-*.md`

## Clarify — all issue sizes

- `AskQuestion` on product, UX, data, destructive ops, **any ambiguity**
- Size label does **not** skip clarification — see `clarify-gates.md`
- `status: blocked` while waiting on user; no implement workers until unblocked
- Auto-proceed only when AC complete and scope is one reviewable PR

## Split — not only epics

- Split when not one comfortable reviewable PR — see `issue-splitting.md`
- Applies to `size:xs` through `size:xl`
- User sign-off on split plan when non-obvious

## Never drop findings

- Every V-code → `findings-ledger.json`
- Deferral: `gh issue create` first, then `deferred_to_issue`

## Native forge sync

- Automatic at bootstrap and every orchestrator turn — never ask to sync
- New GitHub issues ingested into `queue.json` silently

## Orchestrator discipline

- One PR per issue; coordinator never implements or merges
- Review: `reviewer` → `scripts/review-aggregate.ts` → ledger (see `review-core.md`)
- File new issues for discoveries (bugs, refactors, quick wins)

## Branch & Worktree Hygiene (V-BRANCH, V-WORKTREE)

- **No direct commits to main**: Workers must checkout into dedicated, isolated git worktrees (`wt-<issue>`) and push to branches named `blackhole/issue-N` (`V-BRANCH-02`, `V-BRANCH-03`). Direct commits or force-pushes to `main`, `master`, or `release/*` are strictly blocked (`V-BRANCH-01`).
- **Automated pruning**: The orchestrator must run `git worktree prune` and `git fetch --prune` at the start and end of every turn to clean up stale worktrees and local branches whose upstream PRs have merged (`V-WORKTREE-01`).
- **Removal safety refusal**: Before any `git worktree remove` — mergeable-PR release, post-merge cleanup, or manual pruning alike — check `git -C <worktree> log @{u}..HEAD`. `git worktree remove` only refuses on a dirty working tree; it does not refuse on committed-but-unpushed history, so a merged PR does not by itself prove the worktree is safe to delete (local HEAD may have advanced past what the PR merged, e.g. a post-push rebase or a commit made after the last push). Non-empty output refuses the removal until that history is pushed or cherry-picked elsewhere. Full procedure and the stale-cleanup example: `recovery-protocol.md` §4 "Stale cleanup" row, §6(c).
- **Static resolvability requirement** (#551): a PreToolUse hook (`worktree-removal-guard.js`, #532) enforces the safety refusal above mechanically, but it can only verify a call it can parse statically. Issue `git worktree remove <literal-absolute-path>` (`--force` if needed) as its own standalone command: one positional argument, no shell variable, no glob, no chained `&&`/`;` call, and no trailing redirect — a bare `&` inside `2>&1` (or similar) is parsed as a second positional argument and the call is refused as unresolvable even though the path itself was literal. When the refusal is instead `worktree-remove-unverifiable` on a pushed PR branch checked out under a local name that doesn't match its remote branch name, fetch its head into the tracking ref the check falls back to: `git fetch origin refs/pull/<PR>/head:refs/remotes/origin/<branch>`. A branch genuinely never pushed anywhere has no non-destructive fix — push it first.
- **`rm -rf` on a worktree directory — decision recorded (#551)**: not guarded by this hook. Telling a worktree directory apart from any other path needs the same dynamic `git worktree list` resolution `checkUnpushedCommits` already performs — a static `bash-patterns.json` regex can't do it. Extending the guard to intercept `rm -rf <worktree>` the same way is real, scoped work (still `V-HOOK-01`, no new V-code), deferred to a follow-up issue.
- **Installed plugin cache refresh (#800, ADR-030)**: the Claude Code plugin cache
  (`~/.claude/plugins/cache/<marketplace>/<plugin>/<version>/...`) is **version-keyed, not
  content-addressed** — a merged fix to `templates/hooks/**` ships inert to every existing
  installation until the version is bumped and the plugin is reinstalled (confirmed empirically:
  issue #800's three merged hook fixes, #761/#774/#777, were absent from the installed copy while
  both it and the repo build reported the identical version string). Refresh path: bump
  `package.json`'s `version` → `bun run build` (regenerates all 5 version-carrying manifests,
  `.claude-plugin/plugin.json` included) → `/plugin marketplace update <name>` → reinstall the
  plugin. Same-version reinstall's cache-refresh semantics are undocumented by the platform
  (`.blackhole/plans/issue-800-research.md` § Assumption Audit) — when in doubt, use the
  documented unconditional fallback instead: `rm -rf ~/.claude/plugins/cache`, restart Claude
  Code, then reinstall. See `templates/hooks/pretooluse/README.md` for the hooks-specific version
  of this same procedure, and `blackhole-state.md` § Plugin-Drift Signal for the advisory
  detection mechanism that surfaces a stale installed copy.

## Merge & Linkage Gate (V-GIT)

- **Mandatory Issue Linkage**: Every PR body generated by a worker must contain a keyword link (e.g., `Closes #N` or `Fixes #N`) pointing directly to its GitHub issue (`V-GIT-01`). Merging a PR without this linkage is a BLOCK violation.

## Kaizen Hunt (V-HUNT)

Opt-in proactive discovery loop (ADR-006): when the `kaizen` block is absent or
`kaizen.enabled: false`, hunting is a no-op and current behavior is preserved — this
section only applies when a campaign has explicitly opted in.

- **Verification before filing**: Every hunt-origin finding must pass a `CONFIRMED`
  verification re-check before it may be filed as an issue. Filing from an unverified
  finding is a BLOCK violation (`V-HUNT-01`).
- **Pareto + bug-severity-floor gate**: Filing follows the same `V-PARETO-03` gate
  (`Priority = Gain * (11 - Effort) >= min_priority`) as every other discovery, plus a
  floor override — a `kind: bug` finding with `severity: BLOCK` or `HIGH` always files
  regardless of computed Priority.
- **Caps, dedup, never-drop**: Each wave files at most `kaizen.max_issues_per_wave`
  issues; findings already matching an open `[Kaizen]` issue or ledger row are
  deduplicated, never re-filed. Exceeding the per-wave cap, or filing below
  `kaizen.min_priority` without the bug-severity-floor override, is `V-HUNT-02` (WARN) —
  excess above-floor findings stay `open` in the ledger for a future wave, never dropped.
- **Where hunting is activated and run**: Kaizen activation, kinds, trigger, and caps are
  confirmed once per campaign in `coordinator.md` § Bootstrap preflight, step 5
  ("Kaizen"). A wave can also be dispatched manually at any time via the `hunt [kind]`
  SKILL mode, independent of the configured trigger.

## Campaign state vs. agent handoff dirs

Campaign protocol state lives **only** under `.blackhole/*` (SSOT):

- `queue.json`, `findings-ledger.json`, `config.json`, `plans/issue-N.md`

The following are **not** blackhole protocol state:

- `.agents/orchestrator/`, `.agents/worker_*/`, `.agents/explorer_*/` — ephemeral
  session handoff dirs from individual agent runs; safe to ignore for queue/ledger
  mutations.
- `.agents/build/agents/`, `.agents/build/rules/`, `.agents/build/skills/` — **build
  outputs** from `bun run build` (Antigravity workspace target, built by default —
  ADR-007 T2; `--gemini`/`--all`/`--no-codex` are deprecated no-op aliases scheduled for
  removal next release); edit `src/` and rebuild, do not hand-edit.

Handoff dirs share the `.agents/` parent with build output but are separate namespaces.
Never treat handoff dirs as a substitute for `.blackhole/` state.

## Plan Touch-Paths & API Drift (V-SCOPE, V-API)

- **Touch-Paths compliance**: Implementation workers must restrict code modifications to the touch-paths defined during the Phase 2 Plan (`V-SCOPE-02`). General refactoring of untouched files or unrelated code changes is blocked.
- **API Contract compliance**: Any modification that alters public interfaces, database schemas, or configurations in a way that diverges from the planned specification is blocked as drift (`V-API-01`).
<!-- GENERATED by scripts/build.ts from src/references/blackhole-protocol.md — do not hand-edit -->
