# Phase — Stop

Binding playbook for the `stop` mode (`SKILL.md` § Modes). Owns the drain sequence and the
`--abandon` tier so neither is inlined as a `SKILL.md` god-step (extension-tax). Not a
five-phase-lifecycle playbook — it composes with handle/plan/implement/review at any point in a
turn without replacing any of them (`SKILL.md` § Five-phase lifecycle is unaffected).

## Two tiers — nothing more, nothing less

| Tier | Trigger keywords | Behavior |
|------|-------------------|----------|
| `stop` (drain, **default**) | `stop`, `pause`, `drain the campaign` | Stop dispatching new work. Let every in-flight worker run to its natural return. Persist returns exactly as a normal turn would. Checkpoint, then report. |
| `stop --abandon` | `stop --abandon`, `abandon`, `kill`, `abort`, `force stop` — **never** a bare "stop now" (reserved: #479's future `stop --now` partial-flush tier is a different mechanism entirely; see Design Decision below) | Kill every in-flight worker immediately (today's improvised behavior, now explicit and opt-in only). Reset each killed worker's queue entry, run the worktree dirty-check, run drift heal, checkpoint, report. |

No third tier ships here. `stop --now` (partial-result flush) is #479, blocked on this issue.

## Drain tier — sequence

The fan-out/barrier mechanics are unchanged (`orchestrator-runtime.md` § Background worker
barrier; `claude-code-native.md` § Two-tier gate topology) — the only behavioral delta from a
normal turn is step 3.

1. **Acknowledge** — do not set `interrupt: true`. A `stop` request is relayed exactly like any
   other user message (`multitask-mode.md` § Coordinator MUST: "Resume orchestrator when: user
   input...").
2. **Let the barrier resolve** — the wave already in flight completes naturally (Pattern B:
   background orchestrator's in-turn `Await`; Pattern C/A: foreground orchestrator's in-turn
   wait). No new mechanism; do not poll, do not interrupt.
3. **Do not spawn the next wave** — the entire behavioral change. Triage every completed worker
   exactly as `orchestrator-runtime.md` § Background worker barrier § Triage already specifies.
4. **Run the Exit Invariants checklist** (below) before reporting.
5. **Checkpoint**: `stopped_by: user`, `stop_kind: drained` (`checkpoint-protocol.md` §
   Checkpoint template).
6. **Report** per Exit Invariant 6.

### Pattern B (coordinator + background orchestrator)

The coordinator cannot interject mid-turn — the orchestrator's background turn is already
barrier-blocked on its current wave (`multitask-mode.md` § Cursor Pattern B). The coordinator
relays the `stop` text as the next resume message (`interrupt: false`), same as any user
feedback — no special channel. Because the orchestrator is mid-turn, the message is delivered as
its next input once the current turn naturally idle-notifies (barrier + triage + checkpoint
already complete by construction). That idle-notification IS the natural return the drain tier
promises — nothing is lost waiting for it. On resume, the orchestrator executes steps 3-6 above
instead of dispatching a new wave, then ends its turn; the coordinator does not resume it again
for this campaign run.

### Pattern C / Pattern A (foreground orchestrator)

Already demonstrated live: `.blackhole/campaign-checkpoint.md` turn 2 ("Pacing directive — DRAIN,
no new dispatch") — the foreground orchestrator held its own in-turn barrier for a live
implementer, triaged its return normally, and left ready candidates undispatched. `stop` (drain)
formalizes exactly that sequence as a named mode instead of an ad hoc pacing choice.

## `--abandon` tier — sequence

1. **Kill** every worker in `## In-flight workers` (today's mechanism — `interrupt: true` /
   harness-equivalent hard stop). Only this tier may do so.
2. **Reset, don't drift** — for each just-killed worker's issue, set `queue.json` `status` back
   to `ready` (or `blocked` with `notes: recovery-needed` if step 3 finds a dirty worktree) and
   remove its row from `## In-flight workers`. This is a direct action the stop procedure
   performs itself — the orchestrator already knows no worker is running. It is not the
   `recovery-protocol.md` §9 drift-detection case: §9 detects a worker that finished silently and
   left an artifact; an abandoned worker leaves no artifact to detect.
3. **Worktree dirty-check** — for every affected worktree, run `recovery-protocol.md` §2
   detection and, if dirty, its §4 decision tree by reference (do not restate abort/split/
   cherry-pick here). Never silently discard a dirty worktree.
4. **Drift heal pass** — run `recovery-protocol.md` §9 by reference across all in-flight
   issues (not only the ones just killed) as a general consistency sweep.
5. **Terminate side-processes** — the memory watchdog, via the variable-indirection form so
   `pkill` never kills its own wrapper shell (`resource-frugal-testing.md` § Watchdog).
6. **Checkpoint**: `stopped_by: user`, `stop_kind: killed`; tag each reset worker's former
   `## In-flight workers` row `worker_state: killed` in the checkpoint Notes before removal, so
   the resume report names what was discarded (mirrors #476's evidence table).
7. **Run the Exit Invariants checklist** (below), then report.

## Exit Invariants (verbatim from #476 — every tier)

- [ ] No `queue.json` entry left `in-flight` naming a worker that is not running (drain tier:
  satisfied by construction via step 3 above; `--abandon` tier: satisfied by step 2's direct
  reset, cross-checked by step 4's `recovery-protocol.md` §9 drift-heal pass — cited, never
  restated)
- [ ] Every worker return received before the boundary is persisted to the ledger — the
  never-drop rule does not suspend during a stop
- [ ] `.blackhole/campaign-checkpoint.md` written per `checkpoint-protocol.md`, naming what was
  in flight, what was killed vs drained, and what the next dispatch should be
- [ ] Every worktree's branch has all commits pushed to its PR branch; any dirty worktree is
  reported by path, never silently left
- [ ] Background side-processes (the memory watchdog) are terminated, using the
  variable-indirection form so `pkill` does not kill its own wrapper shell
- [ ] The report states the exact command to resume and what will happen first

## Checkpoint fields this mode owns

See `checkpoint-protocol.md` § Fields: `stopped_by`, `stop_kind` (frontmatter), `worker_state`
(per-row, `## In-flight workers`). `stop_kind` values: `drained` | `killed` | `null`.
**`flushed` is reserved for #479 (leg B) — do not emit it from this issue's implementation.**

## Non-goal

No new signalling channel. `stop` dispatches through the exact same chat-relay/mode-trigger
machinery as `run`, `status`, `handle #N`, etc. (`SKILL.md` § Modes). Asking a *running* worker
to return early with a partial result is #479's job, not this one's.
<!-- GENERATED by scripts/build.ts from src/references/phase-stop.md — do not hand-edit -->
