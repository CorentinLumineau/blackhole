# Phase — Stop

Binding playbook for the `stop` mode (`SKILL.md` § Modes). Owns the drain sequence, the
`stop --now` worker-side ask, and the `--abandon` tier so none is inlined as a `SKILL.md`
god-step (extension-tax). Not a five-phase-lifecycle playbook — it composes with
handle/plan/implement/review at any point in a turn without replacing any of them (`SKILL.md` §
Five-phase lifecycle is unaffected).

## Three tiers — nothing more, nothing less

| Tier | Trigger keywords | Behavior |
|------|-------------------|----------|
| `stop` (drain, **default**) | `stop`, `pause`, `drain the campaign` | Stop dispatching new work. Let every in-flight worker run to its natural return. Persist returns exactly as a normal turn would. Checkpoint, then report. |
| `stop --now` | `stop --now`, bare `stop now`, `flush now` | Ask every running worker to flush a partial result and return early; a worker that does not cooperate within its grace window falls back to `--abandon` semantics for that worker only. See § `stop --now` tier below. |
| `stop --abandon` | `stop --abandon`, `abandon`, `kill`, `abort`, `force stop` — never bare `stop now` (that phrasing now belongs to `stop --now` above, its previously-reserved trigger) | Kill every in-flight worker immediately (today's improvised behavior, now explicit and opt-in only). Reset each killed worker's queue entry, run the worktree dirty-check, run drift heal, checkpoint, report. |

This issue (#491, leg A of #479) ships the `stop --now` worker-side ask above. The partial-result
response schema and the orchestrator's ingest of a flushed return are #492's job (leg B) — see
`worker-schemas.md` § Flush request for the exact boundary.

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

## `stop --now` tier — sequence

Composes with the two shipped tiers rather than replacing either: a worker that cooperates is
triaged exactly like a drain-tier natural return (§ Drain tier step 3, cited not restated); a
worker that does not is handled by the `--abandon` tier's existing machinery (steps 1-4 above),
invoked per-worker instead of campaign-wide.

### Signalling channel

No new file-based side channel — and **not** `.blackhole/resume-request.json`
(`worker-schemas.md` § SubagentStop resume hook). That channel is worker-written,
orchestrator-read, and fires only *after* a worker has already stopped naturally; the ask this
tier needs is the opposite direction and timing — orchestrator-written, worker-read, delivered
to a worker still running (`V-INT-02`: reused where the shape fits, not forced where it does
not — see `worker-schemas.md` § Flush request for the full Reuse Check). The ask is instead
delivered via the harness's own live-worker message relay, on a harness whose fan-out primitive
keeps a spawned worker addressable while running — demonstrated live at campaign turn 4
(2026-08-10), where a running `implementer` was asked mid-edit to finish only its in-flight
work, commit, push, and report honestly, and did. On a harness whose fan-out primitive only
barrier-blocks until natural completion with no live push into a running worker
(`claude-code-native.md` § Capability matrix, cited not extended), there is nothing to ask —
every worker is uncooperative by construction and step 4 below fires immediately for all of
them.

1. **Ask** — for every worker in `## In-flight workers`, deliver the Flush Request
   (`worker-schemas.md` § Flush request) via the channel above, or skip straight to step 4 when
   no such channel exists on this harness.
2. **Grace window** — wait up to 5 minutes, wall-clock, per worker, for either its natural
   SubagentStop return or an explicit flush acknowledgment, whichever comes first. Checked via
   the same detached-poll idiom already used for the CI-wait poller and the background barrier
   (`orchestrator-runtime.md` § Background worker barrier; `merge-gate.md` § CI-wait poller
   contract) — never a new polling mechanism, never a foreground sleep.
3. **Cooperative return** — a worker that returns within its grace window is triaged exactly
   like a drain-tier natural return. Tag its `## In-flight workers` row `worker_state: drained`
   before removal (`checkpoint-protocol.md` § Fields — the value already exists in that field's
   enum; this tier is the first to exercise it).
4. **Uncooperative fallback** — a worker that does not return within its grace window, or that
   was never reachable (no channel on this harness), falls back to `--abandon` tier semantics —
   kill, reset, dirty-check, drift heal (steps 1-4 of the `--abandon` tier above, cited not
   restated) — for that worker alone. Sibling workers that did cooperate are unaffected: this is
   a per-worker fallback, not an escalation to killing everyone.
5. **Run the Exit Invariants checklist** (below), verified explicitly for this tier.
6. **Checkpoint**: `stopped_by: user`; `stop_kind: killed` if any worker fell through to step 4,
   else `stop_kind: drained` — reusing the two values this mode already ships
   (`checkpoint-protocol.md` § Checkpoint template), introducing no third value. `flushed` stays
   reserved for #492 and is never emitted by this issue's implementation.
7. **Report** per Exit Invariant 6, additionally naming which workers cooperated and which were
   abandoned — the resumer needs this: an abandoned worker's worktree may hold a partial,
   possibly-broken push per `worker-schemas.md` § Flush request obligation 3.

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

## Exit Invariants (verbatim from #476 — every tier, `stop --now` verified explicitly below)

- [ ] No `queue.json` entry left `in-flight` naming a worker that is not running (drain tier:
  satisfied by construction via step 3 above; `--abandon` tier: satisfied by step 2's direct
  reset, cross-checked by step 4's `recovery-protocol.md` §9 drift-heal pass — cited, never
  restated; **`stop --now` tier: satisfied by the same two paths, dispatched per worker — a
  cooperative worker's entry clears via drain-tier triage (reused at step 3 above), an
  uncooperative worker's entry clears via the `--abandon` tier's step 2, invoked per-worker by
  step 4 above**)
- [ ] Every worker return received before the boundary is persisted to the ledger — the
  never-drop rule does not suspend during a stop (**`stop --now` tier: a cooperative worker's
  flush return is a worker return like any other and is persisted the same way; an
  uncooperative worker has no return to persist — its pushed worktree, per obligation 3 below,
  is the artifact of record instead**)
- [ ] `.blackhole/campaign-checkpoint.md` written per `checkpoint-protocol.md`, naming what was
  in flight, what was killed vs drained, and what the next dispatch should be (**`stop --now`
  tier: the same file, `stop_kind` set per step 6 above, per-row `worker_state` distinguishing
  cooperative (`drained`) from fallen-through (`killed`) workers**)
- [ ] Every worktree's branch has all commits pushed to its PR branch; any dirty worktree is
  reported by path, never silently left (**`stop --now` tier: this is exactly the worker's
  obligation 3 on receipt of the ask — `worker-schemas.md` § Flush request — the invariant and
  the worker obligation are the same requirement seen from two sides**)
- [ ] Background side-processes (the memory watchdog) are terminated, using the
  variable-indirection form so `pkill` does not kill its own wrapper shell (**`stop --now` tier:
  identical to `--abandon` tier — fires only if step 4's fallback actually killed a worker; a
  fully-cooperative `stop --now` never touches the watchdog, same as drain**)
- [ ] The report states the exact command to resume and what will happen first (**`stop --now`
  tier: additionally names which workers cooperated vs. were abandoned, per step 7 above — the
  resumer needs to know which issues may carry a partial push**)

## Checkpoint fields this mode owns

See `checkpoint-protocol.md` § Fields: `stopped_by`, `stop_kind` (frontmatter), `worker_state`
(per-row, `## In-flight workers`). `stop_kind` values: `drained` | `killed` | `null` — the
`stop --now` tier reuses both non-null values (§ `stop --now` tier step 6 above), introducing no
third value. **`flushed` is reserved for #492 (leg B) — do not emit it from this issue's
implementation.**

## Non-goal

Mode dispatch is unchanged: `stop --now` itself is relayed through the exact same
chat-relay/mode-trigger machinery as `run`, `status`, `handle #N`, `stop`, `stop --abandon`,
etc. (`SKILL.md` § Modes) — no new channel for *invoking* the mode. What is new is the ask
inside `stop --now` (§ `stop --now` tier above), and it reuses the harness's existing live-worker
addressability where the fan-out primitive provides one, rather than inventing a file-based side
channel. The partial-result response schema and its orchestrator-side ingest are #492's job, not
this issue's.
