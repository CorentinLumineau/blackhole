---
type: adr
summary: "Worktree write containment and the main-clone git guard apply only to campaign-scoped PreToolUse calls (a campaign agent_type, an assigned worktree, or BLACKHOLE_HOOK_SCOPE=all); ordinary sessions that load the plugin are no longer denied writes outside the repo, while every other guard stays unscoped"
status: accepted
review_trigger: "on protocol change, or on a Claude Code change to the PreToolUse payload's agent_type semantics"
created: 2026-10-10
last_updated: 2026-10-10
related:
  - documentation/decisions/ADR-043-main-clone-git-mutation-guard.md
  - documentation/decisions/ADR-045-cwd-derived-worker-write-containment.md
  - documentation/decisions/ADR-046-run-context-resolution.md
---

# ADR-047: Hook containment scoped to campaign workers

## Status

Accepted — 2026-10-10 (phase 4 of the run-accuracy plan, approved by the owner).

## Context

The PreToolUse hooks ship with the plugin, so they run in every session that has blackhole
installed, not only inside a campaign. Two of them encode campaign rules rather than general
safety: worktree write containment (`outside-worktree` and its siblings, ADR-045) and the
main-clone git guard (ADR-043). In an ordinary session they deny legitimate work. On 2026-10-09
a Claude Project thread was denied a write to the project's shared folder, which sits outside
every registered worktree, although no campaign was running in that session.

Claude Code sets `agent_type` on the PreToolUse payload when a call comes from a subagent. It is
absent on the main thread and, per ADR-045, has not been observed for in-process teammates,
which is why ADR-045 derives the worker's root from `cwd` instead.

## Decision

`templates/hooks/pretooluse/utils/campaign-scope.js` decides whether a call is campaign-scoped.
A call is scoped when any of these holds:

1. `agent_type`, with any `plugin:` prefix stripped, is one of the eight blackhole agents
   (the list is pinned to `AGENT_NAMES` by a test).
2. `readAssignedWorktreeRoot(cwd)` resolves a root: the declared `BLACKHOLE_ASSIGNED_WORKTREE`,
   or a `cwd` inside a linked worktree (ADR-045). This keeps teammates without `agent_type`
   contained.
3. `BLACKHOLE_HOOK_SCOPE=all` is set, which declares the whole session a campaign session.

Only worktree write containment (Write/Edit) and the main-clone git guard (Bash) consult the
scope. Path traversal, system paths, sensitive files, destructive Bash patterns, the Bash
write-target guard and the worktree-removal guard apply to every call, as before. If the scope
check itself throws, the Bash guard treats the call as scoped (fail closed).

## Alternatives Considered

- **Keep the guards global and add allow-listed roots** (Project folder, scratchpad). Every new
  surface would need another root, and the guard would still block ordinary sessions on any
  other path. Rejected: it treats the symptom.
- **Scope by `.blackhole/config.json` presence.** Repos that host a campaign (invest, blackhole)
  would still block every ordinary session in them, which is exactly the reported case.
- **Scope only by `agent_type`.** Misses in-process teammates, which ADR-045 shows carry no
  `agent_type`; rule 2 covers them through their worktree `cwd`.

## Consequences

- Ordinary sessions can write anywhere the other guards allow, and run git commands in the main
  clone, with blackhole installed.
- A campaign orchestrator running on the main thread (Pattern P, no `agent_type`, cwd in the
  main clone) is not scoped by default. A run that wants the guards there sets
  `BLACKHOLE_HOOK_SCOPE=all`.
- A worker that is neither a named blackhole agent nor inside a worktree is no longer contained.
  Workers are dispatched into worktrees, so this is the expected shape, not a gap in practice.
- The change touches `templates/hooks/**`, so the plugin version is bumped (`V-PLUGIN-01`).
