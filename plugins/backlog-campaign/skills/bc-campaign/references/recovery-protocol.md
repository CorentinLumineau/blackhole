# Recovery Protocol — Mixed-Issue Worktrees & Stashes

Binding recovery procedure for polluted git worktrees and mixed-issue stashes that violate one-PR-per-issue (`V-BRANCH-02`). Complements `checkpoint-protocol.md` (queue/checkpoint layer) with a decision tree for dirty worktrees holding changes from multiple issues.

See also: `phase-implement.md` (worktree naming), `queue-dag.md` (wave scheduling after split).

---

## §1 Problem

Campaign workers operate in isolated worktrees (`<scratchpad>/wt-<issue>` on branch `campaign/issue-<issue>`). When a session crashes, compacts, or an implementer edits outside touch-path scope, a single worktree may accumulate uncommitted changes or commits spanning **multiple** issues. That violates `V-BRANCH-02` (one issue per branch/worktree) and `V-SCOPE-02` (touch-path boundaries).

Recovery must restore the **one-issue-per-worktree** invariant before any `bc-implementer` is (re)spawned.

---

## §2 Detection

Run at orchestrator turn start and during compaction recovery (after reading checkpoint):

```bash
git worktree list
git -C <scratchpad>/wt-<issue> status --porcelain
git -C <scratchpad>/wt-<issue> stash list
```

**Dirty** when:

- `git status --porcelain` is non-empty for the worktree, **or**
- stash entries reference the worktree path or carry recovery tags (`recovery-issue-<N>`, `recovery-abort-wt-<issue>`, `recovery-plan-missing-<N>`).

---

## §3 Map uncommitted files to issues

Before choosing abort vs split vs cherry-pick, build a file→issue map:

1. Collect dirty paths from `git status --porcelain` (and `git diff --name-only` for unstaged).
2. For each in-flight issue `#N` in `queue.json`, load:
   - `.bc-campaign/plans/issue-N.md` → `## Touch-Paths`
   - `queue.json` → `issues.*.touch_paths`
3. Match each dirty file against globs (simple prefix/glob match). Prefer plan `## Touch-Paths` when present (more specific than queue globs).
4. Build map: `{ issue: [files...] }` plus `unmapped: [files...]`.
5. If `unmapped` is non-empty → default **abort or coordinator gate** — do **not** spawn implementer until resolved.

When ambiguous overlaps occur (one file matches multiple issues), escalate to coordinator (§7).

---

## §4 Decision tree: abort vs split vs cherry-pick

| Situation | Action |
|-----------|--------|
| All dirty files map to **one** issue `#N` and worktree is `wt-N` | **Resume** — clean staging if needed, re-spawn implementer |
| Dirty files map to **multiple** issues, changes are **uncommitted** only | **Split** — per-issue partial stash or `git add -p` by touch_paths; park non-target files in stash tagged `recovery-issue-<N>`; one issue at a time |
| Dirty files map to multiple issues but include **commits** on wrong branch | **Cherry-pick** — identify commits per issue (`git log --oneline`), cherry-pick onto correct `campaign/issue-N` branches in correct worktrees |
| Unmappable files, corrupted state, or wrong base branch | **Abort** — `git stash push -u -m "recovery-abort-wt-<issue> <ISO8601>"` or discard if user approves; `git worktree remove --force`; reset queue issue to `ready` / re-plan |
| Worktree branch PR already merged | **Stale cleanup** — see Example (c); no cherry-pick |

Enforcement gates: `V-BRANCH-02`, `V-WORKTREE-01`, `V-SCOPE-02`.

---

## §5 Orchestrator checklist before re-spawning implementer

After crash or compaction recovery, **complete this checklist** before spawning `bc-implementer`:

1. Complete `checkpoint-protocol.md` compaction steps (read checkpoint, forge sync, validate JSON).
2. Run `git worktree prune` + `git fetch --prune` (`V-WORKTREE-01`).
3. For each in-flight implement issue: run §2 detection.
4. If dirty: execute §3 map + §4 decision tree — **do not spawn** until worktree matches single-issue scope.
5. Confirm plan artifact exists at `{repo_root}/.bc-campaign/plans/issue-N.md` and planner returned `status: ready`.
6. Confirm `queue.json`: `phase: implement`, `status: in-flight` or `ready` as appropriate.
7. Log recovery action in `campaign-checkpoint.md` Notes (e.g. `Recovery: split stash wt-11 → #11 + #13`).
8. Only then spawn `bc-implementer` with `<PLAN_CONTEXT>`.

---

## §6 Examples

### (a) Plan missing

Queue shows `#N` with `phase: implement` but `.bc-campaign/plans/issue-N.md` is absent.

**Action:** Do **not** spawn implementer. Set `phase: plan`, `status: ready`; spawn `bc-planner`. If worktree has dirty files, stash with `recovery-plan-missing-N` or abort worktree per §4.

### (b) Mixed-issue stash

`wt-11` is dirty with files mapping to #11, #13, and #10 touch_paths.

**Action — Split:**

```bash
git stash push -m "recovery-11" -- <paths-for-11>
# repeat per issue
```

Pop stash in the correct `wt-<issue>`; spawn implementers one wave at a time, respecting touch_paths conflicts (`queue-dag.md`).

### (c) Stale worktree after PR merge

`gh pr view` shows PR for `campaign/issue-11` merged; `wt-11` still exists.

**Action — Abort/cleanup:**

```bash
git worktree remove <scratchpad>/wt-11
```

Prune branch; set queue `#11` `phase: done`. Do **not** cherry-pick unless unmerged commits remain on branch (then cherry-pick to new branch only if issue still open).

---

## §7 Coordinator escalation

When abort vs split is non-obvious or data-loss risk exists:

1. Set `status: blocked`, `notes: awaiting-recovery-approval` in `queue.json`.
2. Delegate to `bc-coordinator` with the file map table from §3.
3. Do not spawn implementer until coordinator clears the gate.
