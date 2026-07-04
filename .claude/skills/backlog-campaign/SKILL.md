# Backlog Campaign

Orchestrates issue implementation until the forge backlog is empty. Binding
runbook: `.claude/skills/backlog-campaign/references/backlog-campaign-protocol.md`.

## Entry (Multitask Mode)

If the agent lacks a native long-running goal loop, use Multitask Mode (Pattern B) with a coordinator + background orchestrator:

1. User talks to **`backlog-coordinator`** agent (or attaches this skill in Multitask Mode)
2. Coordinator runs Phase 0 → spawns **`backlog-orchestrator`** in background
3. User feedback → coordinator **resumes** orchestrator (`interrupt: false`)

Full flow: [multitask-mode.md](references/multitask-mode.md)
Orchestrator spawn text: [campaign-prompt.md](references/campaign-prompt.md)

Direct `/backlog-campaign run` or `/goal` in a single session: act as orchestrator (legacy Pattern A) — still follow all phases below.

## Modes

| Mode | Trigger | Who runs it |
|------|---------|-------------|
| `run` | `run`, `campaign`, "finish the backlog" | Coordinator spawns orchestrator |
| `status` | default, `status`, `sync` | Coordinator or orchestrator — auto-sync + dashboard |
| `handle #N` | `handle #N` | Orchestrator — phase 1 only |
| `plan #N` | `plan #N` | Orchestrator — phase 2 only |
| `implement #N` | `implement #N` | Orchestrator — phase 3 only |
| `review #N` | `review #N` | Orchestrator — phase 4 only |

## Phase 0: Bootstrap (ALL modes)

**Native forge sync** — automatic, never AskQuestion to confirm.

1. **Config** — `.backlog-campaign/config.json` (from `config-template.md` in this repo)
2. **State init** — `queue.json`, `findings-ledger.json`, `plans/`
3. **Validate** — `jq empty` on both JSON files
4. **Forge sync** — if `auto_sync` true (default): `gh auth status` then [forge-sync.md](references/forge-sync.md). Sandbox: `full_network`.
5. **Dashboard** — open issues/PRs, new since sync, in-flight, LEDGER OPEN, ready set

---

## Five-phase lifecycle

| Phase | Reference |
|-------|-----------|
| 1 Handle | [phase-handle.md](references/phase-handle.md) |
| 2 Plan | [phase-plan.md](references/phase-plan.md) |
| 3 Implement | [phase-implement.md](references/phase-implement.md) |
| 4 Review | [phase-review.md](references/phase-review.md) |
| 5 Loop | [phase-loop.md](references/phase-loop.md) |

Cross-cutting:

- [clarify-gates.md](references/clarify-gates.md) — AskQuestion for **all sizes**
- [issue-splitting.md](references/issue-splitting.md) — split any non-reviewable PR

**Binding:** Never drop a V-code finding → `findings-ledger.json`. Deferrals
require `gh issue create` + `deferred_to_issue`.

---

## Orchestration (run mode — orchestrator)

0. Auto-sync every turn
1. Ready set → [queue-dag.md](references/queue-dag.md) — skip `blocked` (user gates)
2. Per issue: handle → plan → **user gate if needed** → implement → review → loop
3. Spawn workers via the designated agent files (`backlog-planner`, `backlog-implementer`, `backlog-reviewer`), `run_in_background: true`, one turn per batch
4. End turn; triage completions → ledger → next phase

**Do not spawn implement** while `status: blocked` with
`awaiting-user-clarification` or `awaiting-plan-approval`.

---

## State references

- [findings-ledger.md](references/findings-ledger.md)
- [queue-dag.md](references/queue-dag.md)
- [forge-sync.md](references/forge-sync.md)
- [config-template.md](references/config-template.md)

## Rules references

- [backlog-campaign-protocol.md](references/backlog-campaign-protocol.md)
- [backlog-campaign-state.md](references/backlog-campaign-state.md)
- [backlog-campaign-vcodes.md](references/backlog-campaign-vcodes.md)

## User interaction

- [clarify-gates.md](references/clarify-gates.md) — default clarify; narrow auto-proceed only
- Chat feedback → clarify if ambiguous → file issue → auto-sync ingests
- Split per [issue-splitting.md](references/issue-splitting.md) — not epics only
