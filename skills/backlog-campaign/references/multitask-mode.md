# Multitask Mode — canonical Cursor entry (Pattern B)

Cursor has **no `/goal` command**. The supported entry is **Multitask Mode**
with a lightweight coordinator + background orchestrator.

## Roles

| Role | Agent | May implement? | May merge? |
|------|-------|----------------|------------|
| User | Chat | — | approves via AskQuestion |
| Coordinator | `backlog-coordinator` | **No** | **No** |
| Orchestrator | `backlog-orchestrator` | **No** (spawn workers) | Yes (after LGTM) |
| Workers | Task subagents | Yes (one issue) | No |

## Coordinator flow

```
User: "finish the backlog" / attaches backlog-campaign skill / /backlog-campaign run
  ↓
Coordinator: Phase 0 bootstrap (auto-sync) — optional status to user
  ↓
Coordinator: Task → backlog-orchestrator (campaign-prompt.md), run_in_background: true
  ↓
Coordinator: END TURN (do not busy-wait)
  ↓
Orchestrator: five-phase loop, spawns workers, ends turns
  ↓
User message → Coordinator resumes orchestrator (interrupt: false) with user text
```

## Coordinator MUST NOT

- Implement features, review PRs, or merge
- Resume orchestrator on every worker completion (orchestrator gets notifications)
- Use `interrupt: true` except user "stop now" or safety-critical policy
- Spawn a second orchestrator while first is live
- Re-paste full campaign-prompt on routine resume — only user message

## Coordinator MUST

- Track **one** orchestrator subagent ID for the campaign
- Relay user chat as resume prompt to orchestrator
- Resume orchestrator when: user input, blocker needing user, orchestrator turn ended with queue work and orchestrator idle
- Spawn fresh orchestrator only when prior agent completed/failed entirely

## User starting the campaign

Say any of:

- `/backlog-campaign run`
- "Finish the backlog" / "run the backlog campaign"
- Attach `backlog-campaign` skill and ask to start

Coordinator spawns orchestrator; user does not need to paste a long prompt.

## Pattern A (legacy)

Single session as orchestrator without coordinator — only if user explicitly
opts out of Multitask Mode. Not the default for this repo.
