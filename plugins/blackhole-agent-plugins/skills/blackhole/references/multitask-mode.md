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
Coordinator: Phase 0 bootstrap (auto-sync) — run `bun run scripts/campaign-status.ts` → print **full** dashboard (`coordinator-dashboard.md`)
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
| `Task` + attach `.cursor/agents/bc-<agent>.md` + `run_in_background: true` + role-appropriate prompt + per-task `model` when `worker_model_policy: cost-optimized` + tier-folded effort when `worker_effort_policy: cost-optimized` (or absent) | `subagent_type: generalPurpose` (or any built-in enum) instead of a bc-* agent file |

| Role | Agent file |
|------|------------|
| Coordinator (user-facing) | `.cursor/agents/coordinator.md` |
| Orchestrator (background) | `.cursor/agents/orchestrator.md` |
| Workers | `.cursor/agents/planner.md`, `.cursor/agents/implementer.md`, `.cursor/agents/reviewer.md` |

Spawn prompt text, model/effort policy, and mis-spawn hazard detail: `campaign-prompt.md` § Coordinator usage; `model-routing.md`.

## Coordinator MUST NOT

- Implement features, review PRs, or merge
- Resume orchestrator on every worker completion — on Cursor, neither the coordinator nor the orchestrator receives per-worker idle notifications after ending a turn; the **orchestrator** must barrier-wait for its own background worker batch **in-turn** before turn-end
- Use `interrupt: true` except the explicit `stop --abandon` tier or safety-critical policy — see
  `phase-stop.md`. A bare `stop` (drain, default) is relayed as a normal resume message
  (`interrupt: false`), never a hard kill.
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
- Print the **full** dashboard (`bun run scripts/campaign-status.ts`) on campaign start and after each orchestrator turn notification — see `coordinator-dashboard.md`

## Coordinator turn flow (with visibility)

```
Orchestrator turn completes (notification)
  ↓
Coordinator: bun run scripts/campaign-status.ts → print full dashboard to user
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

## Cursor Pattern C-lite (opt-in, issue #694)

When the session exposes **both** C2 (native loop: `/goal`, `CreateGoal`, or
Subscriptions) **and** C3 (`AskQuestion` or accepted inline fallback per
`clarify-gates.md` § C3 adapter), the **main chat may act as orchestrator** without a
coordinator hop — same foreground state ownership as Pattern C in `claude-code-native.md`.

| Primitive | Pattern C-lite behavior |
|-----------|-------------------------|
| Fan-out | `Task` + `run_in_background` + in-turn barrier (identical to Pattern B mechanics) |
| Gates | Native picker when present; inline lettered C3 when not |
| Loop | User `/goal` on desktop/CLI; Cloud `CreateGoal` when attached; else Pattern B |

Pattern B remains the **required fallback** when either C2 or C3 is absent. Cloud sessions
without `CreateGoal` use coordinator + background orchestrator unchanged.

See `documentation/decisions/ADR-028-cursor-pattern-c-lite.md` for the design amendment.

## Shared usage budget (manager / peer)

Several campaign sessions on one account share one usage budget. `usage_budget.coordination`
(`config-template.md`) says how this session takes part; `scripts/usage-budget.ts` stays the only
place that turns usage into a worker count.

| `coordination.role` | Meaning |
|---|---|
| `solo` (default) | This session sizes its own rounds from its own gate verdict. The budget is per-session; nothing is exchanged |
| `manager` | This session owns the shared pool: the `workers` its own gate returns. It grants worker slots to peers and runs its own workers out of the same pool |
| `peer` | This session asks `coordination.manager_session` for slots before each round and uses only what it was granted, plus `coordination.peer_floor` |

### Messages

Four plain-text messages, one per line, sent over the host's cross-session message tool
(per-harness mapping: `claude-code-native.md` § Cross-session budget transport):

| Message | Direction | Body |
|---|---|---|
| `slot-request` | peer → manager | `slot-request session=<peer session> want=<N> running=<R> verdict=<peer's own gate verdict>` |
| `slot-grant` | manager → peer | `slot-grant session=<peer session> slots=<M>` — `M` may be `0` |
| `worker-done` | peer → manager | `worker-done session=<peer session> slots=<K>` — returns `K` slots when workers finish |
| `heartbeat` | peer → manager | `heartbeat session=<peer session> running=<R>` — renews the peer's lease (below); `R` is the workers the peer has in flight right now |

The manager's free slots are its pool minus its own running workers, minus every slot granted and
not yet returned or expired, minus `peer_floor` for each known peer. A session becomes a known
peer the moment any of its messages arrives, even one the manager has never seen before, so its
floor is reserved from that message on. A grant never exceeds the free slots.

### Verdicts

Both sides read the gate verdict the way the spawn round does (`orchestrator-runtime.md`
§ Background worker barrier, Spawn — the usage-gate verdict table, issue #1213). The manager re-runs its gate
before each grant; a peer runs the smaller of its own verdict's count and its grant plus
`peer_floor`.

| Verdict | Manager grants | Peer runs |
|---|---|---|
| `GO` | Up to the free slots | Its grant plus `peer_floor`, capped by its own `workers` |
| `unavailable` (or a non-zero exit) | No cut: the pool is `workers` = `parallel_max`, granted as under `GO`; the reason is logged | No cut from its own gate; still bounded by its grant plus `peer_floor` |
| `NO-NEW-STARTS` | Slots only for workers that continue an issue already past handle; none for a new start | The same: no issue leaves `ready`; in-flight workers continue |
| `NO-SPAWN` | `0`; slots already granted stay held until returned or expired | No new spawn; in-flight workers finish |
| `STOP-WORKERS`, `PACE-WAIT`, `STOP-CAMPAIGN` | `0` | No new spawn; drain per `phase-stop.md` § Usage stop |

### Grant lease

Every grant and every floor reservation is a lease. Each message a peer sends renews its lease.
A peer holding granted slots or running workers sends `heartbeat` at least every 20 minutes (the
same interval as the CI check-in, `project-thread-mode.md` § Scheduling: routines). The lease is
twice that, 40 minutes, so one late or lost heartbeat does not lapse it. When 40 minutes pass with
no message from a peer, the manager frees every slot granted to it, releases its floor
reservation and stops counting it as known. A peer that died or lost its context therefore leaks
its slots for at most one lease.

`running=<R>` is how the manager stays right when a lapsed peer turns out to be alive. On every
`slot-request` and `heartbeat`, the manager sets that peer's held slots to at least `R`. On
re-contact after a lapse, it re-reserves the peer's in-flight workers before it grants anything
new, even when that leaves no free slots. A peer whose lease lapsed treats its old grant as gone
and runs no new worker beyond `peer_floor`. Its `R` in-flight workers still finish. It then sends
a fresh `slot-request` carrying `running=<R>`.

### Peer floor

`peer_floor` is the number of workers a peer may always run without a grant (default `1`; `0`
makes every worker wait on a grant). It is counted inside the manager's pool, never on top of
it, and it never overrides the peer's own gate verdict (table above).

### No-reply timeout

A peer that has no `slot-grant` 10 minutes after its `slot-request` proceeds with `peer_floor`
workers only, and asks again before its next round. The timeout is fixed by this protocol; there
is no config key for it. A late grant is read at the next round, never used to widen a round
already running.

### Plans with only a weekly window

A plan may report only a `seven_day` window, with no `five_hour` one; the windows are detected
from the reading (`usage-source.ts`), so no config says so. There is then no 5-hour fit, and the
weekly rules alone gate. With `usage_budget.weekly.target_at_reset` set, the pool comes from the
weekly leg (`weekly_fit`). Without a target the verdict is `GO` capped at
min(`max_workers`, `parallel_max`), and the weekly lines still stop the run: `NO-NEW-STARTS` at
`weekly.no_new_starts_at` (default 78%) and `STOP-CAMPAIGN` at `weekly.stop_campaign_at` (default
80%). The cap does not track the weekly pace, so set `target_at_reset` when `manager`/`peer`
should share the weekly headroom evenly.

## User starting the campaign

Say any of:

- `/blackhole run`
- "Finish the backlog" / "run the backlog campaign"
- Attach `blackhole` skill and ask to start

Coordinator spawns orchestrator; user does not need to paste a long prompt.

Leaving for the night: `/blackhole sleep` — the coordinator relays nothing to the owner, every
owner question is parked, and `/blackhole wake` asks them in one round (`sleep-mode.md`).

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
| 5 | routers | each **returns** `route{}` + `trigger` + `local_analyze` in its result JSON (never writes `queue.json`/`findings-ledger.json` directly — single-writer-orchestrator invariant) | N return payloads collected |
| 6 | orchestrator | triage: validate JSON, apply mutations **serially, one router at a time** — construct + append the `routing_decisions` row from each return, set `phase: plan`, `status: ready`, clear in-flight workers | checkpoint workers empty; artifacts on disk |
| 7 | orchestrator | turn-end checklist → end turn | coordinator receives idle |
| 8 | coordinator | `bun run scripts/campaign-status.ts` → resume orchestrator if more work | next phase dispatches **without user message** |

**Failure signal (pre-fix):** step 4 skipped → step 6 never runs → `notes: "router initial pass (WAVE 0)"` persists with `route{}` present.

## Pattern A (legacy)

Single session as orchestrator without coordinator — only if user explicitly
opts out of Multitask Mode. Not the default for this repo.
<!-- GENERATED by scripts/build.ts from src/references/multitask-mode.md — do not hand-edit -->
