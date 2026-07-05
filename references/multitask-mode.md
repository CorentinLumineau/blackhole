# Multitask Mode — Coordinator + Background Orchestrator (Pattern B)

Use **Multitask Mode** when the platform does not have a native long-running
goal loop (e.g. Cursor), or when you want explicit coordinator control.
Claude Code users can use `/goal` directly on the `bc-orchestrator` agent instead.

## Roles

| Role | Agent | May implement? | May merge? |
|------|-------|----------------|------------|
| User | Chat | — | approves via AskQuestion |
| Coordinator | `bc-coordinator` | **No** | **No** |
| Orchestrator | `bc-orchestrator` | **No** (spawn workers) | Yes (after LGTM) |
| Workers | Task subagents | Yes (one issue) | No |

## Coordinator flow

```
User: "finish the backlog" / attaches bc-campaign skill / /bc-campaign run
  ↓
Coordinator: Phase 0 bootstrap (auto-sync) — optional status to user
  ↓
Coordinator: Task — attach `.cursor/agents/bc-orchestrator.md` (not subagent_type enum), prompt: campaign-prompt.md, run_in_background: true
  ↓
Coordinator: END TURN (do not busy-wait)
  ↓
Orchestrator: five-phase loop, spawns workers, ends turns
  ↓
User message → Coordinator resumes orchestrator (interrupt: false) with user text
```

## Cursor Task spawn pattern

When spawning bc-* agents in Cursor, **attach** the plugin agent definition file —
do not use built-in `subagent_type` enums as a stand-in.

| DO | DON'T |
|----|-------|
| `Task` + attach `.cursor/agents/bc-<agent>.md` + `run_in_background: true` + role-appropriate prompt | `subagent_type: generalPurpose` (or any built-in enum) instead of a bc-* agent file |

| Role | Agent file |
|------|------------|
| Coordinator (user-facing) | `.cursor/agents/bc-coordinator.md` |
| Orchestrator (background) | `.cursor/agents/bc-orchestrator.md` |
| Workers | `.cursor/agents/bc-planner.md`, `.cursor/agents/bc-implementer.md`, `.cursor/agents/bc-reviewer.md` |

Spawn prompt text and mis-spawn hazard detail: `campaign-prompt.md` § Coordinator usage.

## Coordinator MUST NOT

- Implement features, review PRs, or merge
- Resume orchestrator on every worker completion (orchestrator gets notifications)
- Use `interrupt: true` except user "stop now" or safety-critical policy
- Spawn a second orchestrator while first is live
- Re-paste full campaign-prompt on routine resume — only user message
- Spawn the orchestrator via built-in `subagent_type` enums — see mis-spawn hazard in `campaign-prompt.md` § Coordinator usage

### Protocol state boundaries

- Never write or mutate `queue.json`, `findings-ledger.json`, or plan files under `.agents/worker_*/` (or any `.agents/*` handoff dir).
- Never treat `.agents/orchestrator/`, `.agents/worker_*/`, or `.agents/explorer_*/` as substitutes for `.bc-campaign/` protocol state.
- Orchestrator and workers read/write campaign state only via `.bc-campaign/*` per `bc-campaign-state.md`.

## Coordinator MUST

- Track **one** orchestrator subagent ID for the campaign
- Relay user chat as resume prompt to orchestrator
- Resume orchestrator when: user input, blocker needing user, orchestrator turn ended with queue work and orchestrator idle
- Spawn fresh orchestrator only when prior agent completed/failed entirely

## User starting the campaign

Say any of:

- `/bc-campaign run`
- "Finish the backlog" / "run the backlog campaign"
- Attach `bc-campaign` skill and ask to start

Coordinator spawns orchestrator; user does not need to paste a long prompt.

## Pattern A (legacy)

Single session as orchestrator without coordinator — only if user explicitly
opts out of Multitask Mode. Not the default for this repo.
