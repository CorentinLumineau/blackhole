---
type: adr
summary: "A PreToolUse caller with agent_type orchestrator or coordinator, or no agent_type and a cwd at the harness project dir outside any nested linked worktree, may write single files in the .blackhole/ of its own clone and of the main clones named in permissions.additionalDirectories from a linked-worktree cwd, through the existing state-dir allow-list; every worker agent_type, config.json, hook-events/ and settings files stay denied, and config.json edits and git restore of tracked state are out of scope"
status: superseded
superseded_by: ADR-065
review_trigger: "on a change to the campaign-state trust allow-list, trustedWriteRoots, the caller predicate in campaign-scope.js, or how Claude Code reports agent_type in a PreToolUse payload"
created: 2026-11-26
last_updated: 2026-11-26
related:
  - documentation/decisions/ADR-047-hook-containment-scoped-to-campaign-workers.md
  - documentation/decisions/ADR-045-cwd-derived-worker-write-containment.md
  - documentation/decisions/ADR-061-lean-pretooluse-hooks-on-auto-mode.md
  - src/references/hook-schemas.md
---

# ADR-064: Orchestrator-scoped campaign state write trust

## Status

Superseded by ADR-065 - 2026-11-26. The guards this ADR describes are removed; the original acceptance follows.

Accepted - 2026-11-26, owner approval of the design on issue #1370.

## Context

A Pattern C orchestrator runs in the main chat of a Claude desktop session whose folder it cannot
change. When that cwd is a linked worktree, its single-file writes into a main clone's
`.blackhole/` (queue, ledger, plans, staged artifacts) are denied with
`outside-assigned-worktree` / `bash-outside-assigned-worktree`. `trustedWriteRoots` admits only
linked worktrees of other repos, and `campaignStateRoot` reads only the anchored main clone, so a
cwd in another repo grants nothing. The only way through was the variable-target parser gap,
which is a WARN path nobody should depend on. Issue #1370 hit this itself: its planner was denied
writing its own plan file.

Refusing bootstrap from a worktree cwd was rejected as the primary fix because the desktop session
cannot change its folder, so the refusal would make the mode unusable.

## Decision

Grant the state-dir write allow-list, and nothing wider, to an orchestrator-class caller: a
payload with `agent_type` exactly `orchestrator` or `coordinator`, or a payload with no
`agent_type` whose `cwd` is the harness project dir (`CLAUDE_PROJECT_DIR`, the session's own
folder) or inside it but not inside a linked worktree nested under it. An in-process teammate
worker also carries no `agent_type`, but runs in its assigned linked worktree, so it is refused.

1. Roots granted: the caller's own clone state dir (anchored, else the `mainCloneRoot(cwd)`
   fallback), plus the `.blackhole/` of each main clone that is a
   `permissions.additionalDirectories` entry (or whose `.blackhole` or a child of it is). Settings
   are read only from the user settings file and the harness project dir's settings, capped at
   `MAX_EXTRA_ROOT_CANDIDATES`, and a root needs `.blackhole/config.json` and a non-broad
   realpath.
2. One resolver, `orchestratorStateRoots` in `hook-event-log.js`, and one predicate,
   `isOrchestratorCaller` in `campaign-scope.js`, serve both the Write/Edit hook and the Bash
   write-target guard. No new shell shape is added: the existing redirect/`tee` and single-file
   `cp`/`mv`/`install` shapes take a path predicate.
3. The protected set is unchanged for every caller: `config.json`, `hook-events/`,
   `archive/hook-events-*`, the state root itself, `archive/`, settings files, directory
   destinations, symlink and hard-link leaves, `..` segments.

## Alternatives

- Refuse bootstrap from a worktree cwd: unusable on desktop and fails mid-run today. Kept only as
  remedy text for a caller the grant does not cover.
- Trust every campaign-scoped caller's cross-repo state dirs: widens every worker to every repo's
  queue and ledger. Rejected.
- Leave as is and write state only through scripts: makes the variable-target WARN gap the only
  path. Rejected.

## Consequences

- An orchestrator no longer needs the parser gap to update campaign state; a worker is unaffected
  because a typed worker has no grant, and an in-process teammate (no `agent_type`) runs in its
  assigned linked worktree, which is not the project dir.
- An absent `agent_type` alone is no grant: in-process teammates carry none (ADR-045, ADR-047).
  The grant for the main session depends on its `cwd` being the project dir; a main session that
  moved into a linked worktree other than the project dir loses the grant and must run
  orchestrator-class work as an `orchestrator` or `coordinator` agent.
- A subagent of an unlisted type (for example `general-purpose`) gets nothing.
- Out of scope, follow-up issue: orchestrator edits of `.blackhole/config.json` and
  `git restore -- .blackhole/<tracked file>` (`git-main-clone-guard.js`) stay denied.
- Allowed state writes record nothing, as with the own-clone grant today; deny records remain the
  audit trail.

## Post-acceptance amendments

- 2026-11-26 (issue #1644): superseded in full by ADR-065. No blocking PreToolUse guard ships in any harness build, so the guards and trust rules this ADR describes are deleted; auto mode is the gate.
