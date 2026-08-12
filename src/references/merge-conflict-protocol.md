# Rebase & Conflict Preflight — Classification, Resolution, Escalation

Owns the entire merge-conflict handling algorithm (issue #450): whether a PR's conflict against
`main` can be resolved autonomously, and if so, how. No merge-eligibility logic lives here —
`merge-gate.md` owns `mergeEligible()`; this doc runs strictly *after* that gate passes and
*before* `phase-loop.md` § Merge protocol step 1. `phase-loop.md`, `implementer.md`, and
`orchestrator.md` consult this doc by pointer; none of them restates the classification rule or
the resolution procedures inline.

## Trigger — Step 0.5

Runs once `merge-gate.md` § 1 `mergeEligible(issue)` returns `true` (`phase-loop.md` § Merge
protocol step 0) and before step 1's `headRefOid` check, for `merge_mode: immediate` and
`gated-batch` (within § 4's per-issue sequential loop). **Bypassed entirely** under
`merge_mode: leave-open` — same bypass `merge-gate.md`'s existing leave-open note already applies
to steps 0-5; a human merges these manually and can rebase manually too.

`gh pr view <n> --json mergeStateStatus,mergeable`. `mergeable == "MERGEABLE"` (or an unfamiliar
`mergeStateStatus` — see the plan's Execution Strategy note on `gh` version drift) → proceed to
step 1 unchanged, zero extra cost. `mergeable == "CONFLICTING"` → run the protocol below.

## Classification rule (explicit — the threshold is stated, not left to worker judgment)

A conflict hunk is **mechanical** iff it matches one of:

1. **Generated build-output tree.** The conflicting path is one the project's own committed
   build/codegen step regenerates deterministically from source (this repo:
   `scripts/lib/build/targets.ts`'s SSOT list — `.cursor/`, `.claude/`, `skills/`, `codex-*`,
   `.agents/build/`, `plugins/`). Resolution is **self-verifying**: discard both sides' conflict
   markers, run the project's build command, and require it to exit `0` and be idempotent
   (running it a second time produces a byte-identical tree) before trusting the regenerated
   file — never trust the path alone.
2. **Recognized lockfile** (`bun.lockb`, `package-lock.json`, `pnpm-lock.yaml`, `yarn.lock`, or
   the project's equivalent). Resolution: discard both sides, regenerate via the project's
   install command.
3. **Pure two-sided insertion.** Both `<<<<<<<`/`>>>>>>>` sides *add* content at the same anchor
   point and neither side deletes or modifies a line the other side also touches (e.g.
   changelog/list appends). Resolution: keep both insertions, ours-then-theirs order, remove
   conflict markers.
4. **Import-block reordering** with no changed import targets — only ordering/whitespace differs
   within an import/require block. Resolution: keep the union of imports, run the project's
   format/lint autofix command to normalize order.

Every other hunk is **semantic** — including, explicitly, any conflict where both sides changed
the *same* numeric/derived literal (counter, threshold, version pin) to different values. This
repo deliberately does **not** attempt automatic delta computation for that pattern (see the
plan's Decision Record) — always block.

A file can carry a mix: resolve every mechanical hunk in it first (`git add` once the file has no
remaining conflict markers); if any hunk in the file is semantic, the file — and therefore the
whole rebase attempt — cannot be `git add`ed clean. Capture the semantic hunks' content (`file`,
line range, verbatim conflict-marker excerpt) before aborting.

## Attempt strategy — cap 2 (reuses `orchestrator-runtime.md` § Error Classification's existing
2-retry-then-reclassify convention; no new configurable threshold)

- **Attempt 1**: if `queue.json`'s `merge_after`/`depends_on` shows an issue that (a) this issue
  depends on and (b) merged *after* this issue's worktree branch point — the stacked-branch
  signal is already known — go straight to the cherry-pick strategy below. Otherwise, attempt a
  plain `git fetch origin main && git rebase origin/main`.
- If Attempt 1 conflicts: classify every hunk per the rule above; resolve every mechanical hunk.
  If all hunks in every file resolve mechanically, `git rebase --continue` and finish (this
  attempt succeeded — do not consume Attempt 2).
- If any hunk is semantic **and** the stacked-branch signal was not already known at Attempt 1
  (i.e. this looks like it might be the squash-base symptom rather than a genuine semantic
  conflict — git shows the same file/lines conflicting that a squashed predecessor also touched):
  `git rebase --abort`, then **Attempt 2**: identify this branch's own unique commits
  (`git log <original-branch-tip>...<pre-rebase-merge-base>` or the equivalent walk back to the
  worktree's original branch point) and `git cherry-pick` only those onto a fresh checkout of
  `origin/main`. Re-classify any resulting conflicts the same way.
- If Attempt 2 also leaves a semantic hunk, or Attempt 1's semantic hunk was not
  stacked-branch-shaped (a genuine content conflict): stop. Do not attempt a third strategy.

## Post-resolution discipline (mandatory even when no conflict occurred)

Per PR #510's evidence: after **any** successful rebase or cherry-pick — conflict-free or
resolved — always run the project's build command once and commit the result if it changed,
before the Quality gate (lint+test) and push. Stale committed build output relative to freshly
rebased source is a latent conflict for the *next* PR, not a fixed one.

## Worker delegation (5-Field Delegation Contract)

1. **Objective**: rebase/cherry-pick issue #N's branch onto current `origin/main`, resolving
   mechanical conflicts per the rule above; escalate on any semantic hunk.
2. **Output format**: `worker-schemas.md` implementer contract — `status: complete` (rebase
   succeeded, pushed) or `status: blocked, escalation_trigger: merge_conflict_semantic,
   conflict_hunks: [...]`.
3. **Scope boundaries**: git/build/lint/test commands only in the existing `wt-<issue>` worktree
   (recreate via the same `git worktree add ... origin/main` command as `phase-implement.md`'s
   checklist if it was pruned) — no edits outside conflict resolution and the mandatory rebuild.
4. **Tool guidance**: `git fetch`, `git rebase`/`git cherry-pick`, the project's build/lint/test
   commands, `git push --force-with-lease`.
5. **Stop condition**: branch pushed and green (complete), or a captured, non-empty
   `conflict_hunks[]` returned (blocked) — never a silent partial state.

Full gate spec: `implementer.md` § Conflict Resolution Gate.

## Ledger recording

One `V-MERGE-03` (NOTE) row per mechanically-resolved hunk, appended `status: resolved`
immediately (audit trail, not a defect — mirrors how `V-MERGE-01`/`V-MERGE-02` record drift for
audit, not remediation). `file`/`line` identify the hunk; `summary` names which of the 4
mechanical classes matched.

## Blocker surfacing (semantic conflicts)

`git rebase --abort` (or `cherry-pick --abort`) — leave the worktree/branch exactly as it was
before this preflight ran. `queue.json`: `status: blocked`,
`notes: "merge-conflict-semantic:<file1>,<file2>,..."`. The captured `conflict_hunks[]` (file,
lines, excerpt) travels in the worker's return to the orchestrator, which hands it to
`coordinator.md`'s HITL handling — per ruling **R-003**, the owner sees the actual conflicting
content, not just an issue number.

## Edge cases

| Scenario | Resolution |
|---|---|
| `mergeable` is an unfamiliar value on an older/newer `gh` | Treat only `CONFLICTING` as the trigger; anything else proceeds to step 1 unchanged (conservative default) |
| Every hunk in a conflicting PR is mechanical | Resolved in Attempt 1, `V-MERGE-03` rows logged, merge protocol proceeds at step 1 with the new HEAD |
| Mixed mechanical + semantic hunks in one file | Mechanical hunks resolved and staged; the file still can't be `git add`ed clean because of the semantic hunk, so the whole attempt aborts (no partial merge state left behind) |
| Stacked branch (`merge_after` predecessor merged after this branch's point), plain rebase would conflict | Attempt 1 goes straight to cherry-pick (signal already known) — never wastes an attempt on a rebase known to fail this way |
| Non-stacked branch, but rebase conflicts turn out to be squash-base shaped anyway | Attempt 1 (plain rebase) fails, Attempt 2 (cherry-pick) recovers |
| Both attempts exhausted, semantic hunk remains | `status: blocked`, hunks surfaced, no third attempt |
| `merge_mode: leave-open` | Preflight never runs — human merges and rebases manually |

## Consulted by

- `phase-loop.md` § Merge protocol, Step 0.5 (between step 0 and step 1).
- `implementer.md` § Conflict Resolution Gate — the worker-side procedure.
- `orchestrator.md` § Human-in-the-Loop (HITL) & Blocker Gating — the semantic-conflict blocker
  class.
- `orchestrator-dispatch.md` § Escalation dispatch — the `merge_conflict_semantic` branch (routes
  to HITL, never to `investigator`).

None of these four files duplicate the algorithm above inline — they cite this doc by pointer.
