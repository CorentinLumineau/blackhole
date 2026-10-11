---
type: adr
summary: "On machines whose disk does not outlive the session (run context state_store: branch), campaign state under .blackhole/ is committed to a blackhole/state branch at every turn end with git plumbing that leaves the working tree untouched, and restored from it before state is read on resume; the plugin-cache drift signal and cache refresh are skipped there as local-only"
status: accepted
review_trigger: "on a change to the .blackhole/ file set, or on a host that offers durable storage for agent sessions"
created: 2026-10-10
last_updated: 2026-10-10
related:
  - documentation/decisions/ADR-046-run-context-resolution.md
  - documentation/decisions/ADR-030-plugin-cache-version-bump-gate.md
---

# ADR-049: Branch state store

## Status

Accepted — 2026-10-10 (phase 5 of the run-accuracy plan, approved by the owner).

## Context

`.blackhole/` is gitignored and lives on the main clone's disk. Claude Code cloud sessions,
Project threads, Cursor Cloud agents and CI runners reclaim that disk after the session. Run
context (ADR-046) already resolves `state_store: branch` for those runs, but nothing acted on it:
a resumed campaign on a new machine had no queue, ledger or checkpoint. Two turn-start steps, the
plugin-cache drift signal and the cache refresh, also assume a machine that keeps its plugin
cache between sessions.

## Decision

1. `scripts/state-branch.ts push` commits the state files to `blackhole/state` on `origin`,
   parented on the remote tip. It uses `hash-object`, a throwaway index, `write-tree` and
   `commit-tree`, so the working tree, the real index and the checked-out branch never change. An
   unchanged tree adds no commit. A rejected push stops the turn.
2. `scripts/state-branch.ts pull` restores the branch's files byte-for-byte. It refuses, writing
   nothing, when a local file differs, unless `--force`.
3. Push runs at every turn end (checkpoint write order, step 4). Pull runs at bootstrap right
   after run-context resolution and as step 0 of compaction recovery.
4. Archives, hook-event inboxes, write intermediates and per-machine signals stay local.
5. On `state_store: branch` the plugin-cache drift signal and the cache refresh are skipped and
   said once. Transcript recovery stays, because the current session's transcripts exist on any
   machine.

## Alternatives Considered

- **Commit `.blackhole/` on the working branch.** It would mix campaign state into PR diffs and
  move the checked-out branch under workers. Rejected.
- **Store state in the Project shared folder or another host store.** Only some hosts have one,
  and each needs its own path. A git branch exists wherever the repo does.
- **A worktree checked out on `blackhole/state`.** Works, but adds a worktree the hygiene rules
  must then exempt, and costs a checkout per push. Plumbing does the same with no working copy.
- **Also skip the transcript recovery rung.** It would drop a recovery path that works fine within
  a session. Rejected.

## Consequences

- A campaign resumes on a fresh machine from the last pushed turn.
- At most one turn of state is lost if the session dies before its turn-end push.
- The push needs repository write access, which every campaign already has for its PRs.
- `blackhole/state` is a long-lived branch with one commit per changed turn. It never merges.
