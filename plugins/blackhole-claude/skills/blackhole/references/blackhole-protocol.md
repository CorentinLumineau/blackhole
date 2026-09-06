# Blackhole Protocol

When this repo has `.blackhole/config.json` or the user asks to
finish/run the backlog campaign, follow this protocol.

## Entry

- **Use `/goal`** or Multitask Mode: `coordinator` → spawns
  `orchestrator` in background
- Skill: `plugins/blackhole-claude/skills/blackhole/SKILL.md`
- Flow: `plugins/blackhole-claude/skills/blackhole/references/multitask-mode.md`

Coordinator routes only; orchestrator runs five phases; workers implement.

## Five phases (binding)

Handle → Plan → Implement → Review → Loop.

Playbooks: `plugins/blackhole-claude/skills/blackhole/references/phase-*.md`

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
- A step whose output is a pure function of files or JSON is a `bun run scripts/<name>.ts` invocation; prose holds only judgment (ADR-003).

## Branch & Worktree Hygiene (V-BRANCH, V-WORKTREE)

- **No direct commits to main**: Workers must checkout into dedicated, isolated git worktrees (`wt-<issue>`) and push to branches named `blackhole/issue-N` (`V-BRANCH-02`, `V-BRANCH-03`). Direct commits or force-pushes to `main`, `master`, or `release/*` are strictly blocked (`V-BRANCH-01`).
- **Automated pruning**: The orchestrator must run `git worktree prune` and `git fetch --prune` at the start and end of every turn to clean up stale worktrees and local branches whose upstream PRs have merged (`V-WORKTREE-01`).
- **Removal safety refusal**: Before any `git worktree remove` — mergeable-PR release, post-merge cleanup, or manual pruning alike — check `git -C <worktree> log @{u}..HEAD`. `git worktree remove` only refuses on a dirty working tree; it does not refuse on committed-but-unpushed history, so a merged PR does not by itself prove the worktree is safe to delete (local HEAD may have advanced past what the PR merged, e.g. a post-push rebase or a commit made after the last push). Non-empty output refuses the removal until that history is pushed or cherry-picked elsewhere. Full procedure and the stale-cleanup example: `recovery-protocol.md` §4 "Stale cleanup" row, §6(c).
- **Static resolvability requirement** (#551): a PreToolUse hook (`worktree-removal-guard.js`, #532) enforces the safety refusal above mechanically, but it can only verify a call it can parse statically. Issue `git worktree remove <literal-absolute-path>` (`--force` if needed) as its own standalone command: one positional argument, no shell variable, no glob, no chained `&&`/`;` call, and no trailing redirect — a bare `&` inside `2>&1` (or similar) is parsed as a second positional argument and the call is refused as unresolvable even though the path itself was literal. When the refusal is instead `worktree-remove-unverifiable` on a pushed PR branch checked out under a local name that doesn't match its remote branch name, fetch its head into the tracking ref the check falls back to: `git fetch origin refs/pull/<PR>/head:refs/remotes/origin/<branch>`. A branch genuinely never pushed anywhere has no non-destructive fix — push it first.
- **Recursive `rm` at a worktree directory (#803)**: guarded by the same hook, on the same terms (`V-HOOK-01`, no new V-code). A recursive `rm` — `-r`, `-R`, a cluster carrying either (`-rf`, `-fr`), a split `-r -f`, or `--recursive`, under any literal spelling of the executable `normalizeShellWord` resolves — whose target `isRegisteredLinkedWorktree` resolves to a registered linked worktree runs the identical checks `git worktree remove` runs: `checkUnpushedCommits`, `checkDetachedReachability`, `checkDirtyWorktree`, reached through the one shared verdict body `evaluateResolvedWorktree`. The dirty-tree check applies unconditionally here rather than only under a force flag, because `rm -r` has no native refusal for a flag to bypass. Everything else is untouched: a non-recursive `rm`, and a target that is not a registered *linked* worktree — an ordinary path, a subdirectory of a worktree, or the main working tree — return "nothing to check" rather than a refusal, so ordinary recursive `rm` calls behave exactly as before. A chained, LITERAL `cd <dir> && rm -rf <relative-path>` is resolved against the `cd` destination, not the harness's pre-execution cwd (F-00043, review round on PR #880) — the guard simulates a resolvable `cd` between clauses of the same command. A subshell wrapping the identical shape — `(cd <dir> && rm -rf <relative-path>)` — is resolved the same way (F-00058, review round 2 on PR #880): `)` is a clause boundary exactly like `;`/`|`/newline already were, so a trailing paren can no longer ride into the removal target's own last token, while a `$(...)` command substitution inside the same clause (e.g. the pre-existing `$(which git) worktree remove <target>` executable-indirection coverage) is skipped as a balanced span rather than mistaken for that boundary. Control-flow ambiguity is also covered now: `cd <real-parent> || cd <bogus> && rm -rf <relative-path>` (F-00059) is resolved against BOTH plausible cwds — the one standing after `<real-parent>`'s `cd` and the one standing after `<bogus>`'s, since which one a real shell ends up in depends on the first `cd`'s exit status, which this guard does not execute anything to learn — and blocks if either resolution names an unsafe registered worktree. A `cd` NOT immediately preceded by `||` is still assumed to always run (an earlier failed link in a plain `&&`/`;` chain means the chain, including any dangerous command later in it, never runs at all, so there is nothing left to track); only a `||`-guarded `cd` widens the tracked set rather than replacing it. **Remaining documented limitations**: (1) a target spelled dynamically (`$VAR`, `${VAR}`, a glob, a command substitution), or a relative target following a `cd` whose OWN destination is spelled dynamically (including `cd -` and a bare `cd`, neither of which this guard tracks), cannot be resolved statically and is allowed knowingly — refusing any of these would attach a new refusal to every `rm -rf "$dir"`/`cd "$dir" && rm -rf relative` in the repo, so a recursive `rm` at a worktree path reached this way still bypasses these checks; spell the path (and any `cd` ahead of it) literally when the target is a worktree. (2) `find <worktree> -delete` and `mv <worktree> <elsewhere> && rm -rf <elsewhere>` are not intercepted at all — neither is recognized as a removal invocation by this guard's clause walk, a pre-existing scope limit shared with the `git worktree remove` guard this module extends. (3) issue #863 extracted the uniform shell-lexer primitives this guard, `bash-context.js`, and `bash-write-target-guard.js` each reimplemented independently (`skipQuotedSpan`, `isRedirectAmpersand`) into the shared `shell-lexer.js` module. The three guards' own CLAUSE SPLITTERS deliberately stay separate: this guard's `findClauseStartIndices`/`clauseTailFrom` are quote-UNAWARE (load-bearing for the F-00065 `eval`-wrapped-removal detection above) while `bash-write-target-guard.js`'s `splitClauses` is quote-AWARE (load-bearing for its own main-clone write-containment check) — unifying them would reopen one bypass or the other, per `documentation/decisions/ADR-040-shell-lexer-primitives-and-splitter-quote-policy.md`. Each fix above still lands as a parsing-model change within this guard's own splitter, not against a shared one. (4) the generic wrapper-token walk (F-00064/F-00065, PR #880 round 3) that closes the `{ cd <parent> && rm -rf <basename>; }` brace-group and `eval "cd <parent> && rm -rf <basename>"` bypasses cannot tell a genuine transparent wrapper (`nohup`, `env`, `command`, `sudo -u <user>`, …) from an ordinary command whose own arguments merely contain the literal words `cd <path>` or a bare `git` (e.g. a `sudo -u git rm -rf <worktree>` flag value, not the executable) — so a `cd`/`git` match found only after skipping unrecognized leading tokens is treated as UNCERTAIN and is deliberately never allowed to narrow what gets checked (an uncertain `cd`'s resolved target is UNIONED into the tracked cwd set rather than replacing it, and an uncertain `git` whose subcommand isn't `worktree remove` resumes scanning rather than stopping). This closes every under-detection case found so far, at the cost of a narrow, accepted over-tightening residual: a command like `echo "cd /tmp" && rm -rf ordinary-path` can add a spurious cwd candidate (or spawn one extra, ultimately harmless `isRegisteredLinkedWorktree` call) without ever suppressing detection of a real removal at its correct location.
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
