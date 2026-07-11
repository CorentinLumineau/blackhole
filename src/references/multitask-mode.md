# Multitask Mode — Coordinator + Background Orchestrator (Pattern B)

Use **Multitask Mode** when the platform does not have a native long-running
goal loop (e.g. Cursor), or when you want explicit coordinator control.
Claude Code users can use `/goal` directly on the `orchestrator` agent instead.

On a harness with a deterministic fan-out primitive plus background→foreground completion
notifications, prefer **Pattern C** instead — the main chat acts as orchestrator directly, no
coordinator hop. See [claude-code-native.md](claude-code-native.md). This file documents
**Pattern B**, which remains the required path on harnesses without that primitive
(Cursor/OpenCode) and the universal fallback everywhere else.

## Roles

| Role | Agent | May implement? | May merge? |
|------|-------|----------------|------------|
| User | Chat | — | approves via AskQuestion |
| Coordinator | `coordinator` | **No** | **No** |
| Orchestrator | `orchestrator` | **No** (spawn workers) | Yes (after LGTM) |
| Workers | Task subagents | Yes (one issue) | No |

## Coordinator flow

```
User: "finish the backlog" / attaches blackhole skill / /blackhole run
  ↓
Coordinator: Phase 0 bootstrap (auto-sync) — run `bun run status` → print **full** dashboard (`coordinator-dashboard.md`)
  ↓
Coordinator: Task — attach `.cursor/agents/orchestrator.md` (not subagent_type enum), prompt: campaign-prompt.md, run_in_background: true
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
| `Task` + attach `.cursor/agents/bc-<agent>.md` + `run_in_background: true` + role-appropriate prompt + per-task `model` when `worker_model_policy: cost-optimized` | `subagent_type: generalPurpose` (or any built-in enum) instead of a bc-* agent file |

| Role | Agent file |
|------|------------|
| Coordinator (user-facing) | `.cursor/agents/coordinator.md` |
| Orchestrator (background) | `.cursor/agents/orchestrator.md` |
| Workers | `.cursor/agents/planner.md`, `.cursor/agents/implementer.md`, `.cursor/agents/reviewer.md` |

Spawn prompt text, model policy, and mis-spawn hazard detail: `campaign-prompt.md` § Coordinator usage; `model-routing.md`.

## Coordinator MUST NOT

- Implement features, review PRs, or merge
- Resume orchestrator on every worker completion — on Cursor, neither the coordinator nor the orchestrator receives per-worker idle notifications after ending a turn; the **orchestrator** must barrier-wait for its own background worker batch **in-turn** before turn-end
- Use `interrupt: true` except user "stop now" or safety-critical policy
- Spawn a second orchestrator while first is live
- Re-paste full campaign-prompt on routine resume — only user message
- Spawn the orchestrator via built-in `subagent_type` enums — see mis-spawn hazard in `campaign-prompt.md` § Coordinator usage

### Protocol state boundaries

- Never write or mutate `queue.json`, `findings-ledger.json`, or plan files under `.agents/worker_*/` (or any `.agents/*` handoff dir).
- Never treat `.agents/orchestrator/`, `.agents/worker_*/`, or `.agents/explorer_*/` as substitutes for `.blackhole/` protocol state.
- Orchestrator and workers read/write campaign state only via `.blackhole/*` per `blackhole-state.md`.

## Coordinator MUST

- Track **one** orchestrator subagent ID for the campaign
- Relay user chat as resume prompt to orchestrator
- Resume orchestrator when: user input, blocker needing user, orchestrator **background turn completes** (idle notification) **and** queue work remains — this is the outer loop; the inner loop is the orchestrator's in-turn worker barrier, not coordinator polling workers
- Spawn fresh orchestrator only when prior agent completed/failed entirely
- Print the **full** dashboard (`bun run status`) on campaign start and after each orchestrator turn notification — see `coordinator-dashboard.md`

## Coordinator turn flow (with visibility)

```
Orchestrator turn completes (notification)
  ↓
Coordinator: bun run status → print full dashboard to user
  ↓
If queue work remains and not blocked on user: resume orchestrator
  ↓
END TURN
```

**Anti-pattern:** collapsing the dashboard to a one-line summary — users rely on the main chat for campaign overview.

## Cursor Pattern B — Background worker barrier

On Cursor, the orchestrator **must not** end its turn while `campaign-checkpoint.md`
`## In-flight workers` lists any spawned background worker. After spawning a batch
with `run_in_background: true`, block in-turn until every worker in the batch
completes, then triage outputs before the turn-end checklist.

```
Orchestrator turn
  → forge sync
  → WAVE N: spawn workers (run_in_background: true)
  → BARRIER: wait in-turn for ALL batch completions
  → triage: validate JSON + mutate queue.json + clear in-flight workers
  → turn-end checklist + checkpoint
  → END TURN (coordinator may resume for next orchestrator turn)
```

**Idle vs barrier:** `idle_notification` means the agent's **current turn ended** —
not that a worker batch finished. Coordinator idle = orchestrator turn ended (resume
outer loop). Worker completion = orchestrator must have already barrier-waited in-turn
before ending its turn.

## User starting the campaign

Say any of:

- `/blackhole run`
- "Finish the backlog" / "run the backlog campaign"
- Attach `blackhole` skill and ask to start

Coordinator spawns orchestrator; user does not need to paste a long prompt.

## Claude Code harness notes

| Signal | Meaning | Wrong reaction |
|--------|---------|----------------|
| `idle_notification` from a background agent | The agent's **current turn ended** — not unreachable, not gone | Re-messaging the agent asking it to "report status" and waiting on a chat reply |

Verify phase/worker completion via on-disk artifacts — the plan file under
`.blackhole/plans/`, PR state (`gh pr list` / `gh pr view`), worktree
`git status` — or the Agent tool's own completion/result signal. **Never**
poll completion by chat message.

## Runbook — WAVE router barrier

Acceptance fixture for Pattern B stall fix (#151):

| Step | Actor | Action | Expected state |
|------|-------|--------|----------------|
| 1 | coordinator | Phase 0 + spawn orchestrator (`run_in_background: true`) | orchestrator live |
| 2 | orchestrator | forge sync; select 2–4 handle-phase issues without `route{}` | queue ready |
| 3 | orchestrator | `WAVE 0`: spawn `router` per issue, `run_in_background: true` | checkpoint lists N in-flight workers |
| 4 | orchestrator | **Barrier wait** in-turn for all N routers | no turn-end yet |
| 5 | routers | each writes `route{}` + `routing_decisions` row | artifacts on disk |
| 6 | orchestrator | triage: validate JSON, set `phase: plan`, `status: ready`, clear in-flight workers | checkpoint workers empty |
| 7 | orchestrator | turn-end checklist → end turn | coordinator receives idle |
| 8 | coordinator | `bun run status` → resume orchestrator if more work | next phase dispatches **without user message** |

**Failure signal (pre-fix):** step 4 skipped → step 6 never runs → `notes: "router initial pass (WAVE 0)"` persists with `route{}` present.

## Pattern A (legacy)

Single session as orchestrator without coordinator — only if user explicitly
opts out of Multitask Mode. Not the default for this repo.
