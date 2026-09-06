## Conflict Resolution Gate

Orchestrator Step 0.5 (`merge-conflict-protocol.md` § Trigger — Step 0.5) spawns the
`implementer` in conflict-resolution mode when a PR is `CONFLICTING` against `main` before merge.
The classification rule and resolution procedures live only in `merge-conflict-protocol.md` —
this section documents the worker-side git mechanics and return shape, not the algorithm.

*   **Trigger**: orchestrator's merge-pipeline Step 0.5 dispatch — a 5-Field Delegation Contract
    whose Objective/Output/Scope/Tools/Stop fields are summarized in
    `merge-conflict-protocol.md` § Worker delegation.
*   **Git mechanics**: in the issue's `wt-<issue>` worktree, `git fetch origin main`, then attempt
    rebase or cherry-pick per `merge-conflict-protocol.md` § Attempt strategy. Classify and resolve
    mechanical hunks per `merge-conflict-protocol.md` § Classification rule — never restate that
    rule here.
*   **Post-resolution rebuild** (mandatory): after any successful rebase or cherry-pick, run the
    project's build command once (matching `phase-loop.md` step 3's generic phrasing — "the
    project's build command... if applicable") and commit the result if it changed.
*   **Quality gate**: run the project's lint and test commands before push — same bar as a normal
    implement session.
*   **Push**: `git push --force-with-lease` to the existing `blackhole/issue-N` branch (explicit
    refspec per `phase-implement.md` § Explicit Git Targeting Gate).
*   **Ledger**: append one `V-MERGE-03` (NOTE) row per mechanically-resolved hunk per
    `merge-conflict-protocol.md` § Ledger recording.
*   **Semantic escalation**: on any semantic hunk after both attempts are exhausted (or on a
    genuine semantic conflict on Attempt 1), `git rebase --abort` (or `cherry-pick --abort`),
    return `status: blocked`, `escalation_trigger: "merge_conflict_semantic"`, and a non-empty
    `conflict_hunks[]` (`implementer-schemas.md` § `conflict_hunks[]`) — never a silent partial state.

---
