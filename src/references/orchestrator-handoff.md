# Orchestrator Handoff

Split out of [`worker-schemas.md`](worker-schemas.md) (issue #726), mirroring `hook-schemas.md`'s
(#473) and `implementer-schemas.md`'s (#802) extractions — these sections describe what the
orchestrator does before and after a worker's turn, not the worker JSON return contract that file
documents.

## Flush request (`stop --now`, the ask — leg A, issue #491)

Not a worker-authored JSON return — the reverse direction: what the orchestrator sends to a
still-running worker when the `stop --now` tier fires (`phase-stop.md` § `stop --now` tier).
Delivered via the harness's live worker-message channel where the fan-out primitive keeps a
spawned worker addressable while running (`phase-stop.md` § Signalling channel); on a harness
without that capability there is nothing to send and the worker is treated as uncooperative
immediately (§ Uncooperative fallback below).

**Not the `.blackhole/resume-request.json` shape** (`hook-schemas.md` § SubagentStop resume
hook): that channel is worker-written, orchestrator-read, and fires only *after* a worker has
already stopped naturally. This request is the opposite direction and timing — orchestrator-
written, worker-read, delivered to a worker that is still running. Reusing its shape would mean
writing a file no running worker is polling for, so this is a new, purpose-fit message rather
than a repurposed file (`V-INT-02` — Reuse Check: none found, first occurrence of "push a
message into a still-running worker", repo-wide).

```json
{
  "flush_requested_at": "2026-08-10T18:00:00.000Z",
  "grace_window_minutes": 20,
  "instruction": "stop_now"
}
```

| Field | Values | Notes |
|-------|--------|-------|
| `flush_requested_at` | ISO-8601 | when the orchestrator delivered the ask |
| `grace_window_minutes` | `20` (fixed — `phase-stop.md` § `stop --now` tier step 2; matches `merge-gate.md`'s CI-wait cap, sized for a worker queued behind another campaign's `with-test-lock` holder) | how long the worker has before the orchestrator falls back to killing it |
| `instruction` | `"stop_now"` (fixed) | distinguishes this message from ordinary chat feedback so a worker's own instructions can pattern-match on it |

### What the worker owes on receipt

Binding on every worker role (`planner`, `implementer`, `reviewer`, `router`, `investigator`,
`hunter`) — a protocol obligation, not a per-role schema field, so it is stated once here
instead of duplicated in each role's section above (`V-DRY-01`):

1. **Stop starting new work** — no new sub-task, no file the worker had not already begun
   touching before the ask arrived.
2. **Do not finish the current unit of work either** — this is what distinguishes `--now` from
   drain (`phase-stop.md` § Drain tier): drain lets the in-flight unit complete naturally,
   `--now` cuts at the worker's current position regardless of whether that unit is done.
3. **Commit and push whatever is already changed**, even if incomplete or broken — a partial
   push the orchestrator can see beats clean work it loses. This directly narrows what issue
   #524's worktree-removal guard has to catch: a worker that reliably pushes on request leaves
   less unpushed history behind (cited, not duplicated — #524 owns the orchestrator-side removal
   check itself).
4. **State plainly what is done and what is not**, in whatever channel the worker's natural
   return already uses. An inaccurate "done" costs more than an accurate "half" — a
   completion-honesty obligation, not a schema requirement; the structured shape a flush report
   actually takes is leg B's (#492) job, out of scope here.
5. **Return through the normal stop path** — the harness's own SubagentStop event, not a special
   exit. `stop --now` changes what the worker does before stopping, not how it stops.

### Uncooperative fallback

A worker is uncooperative when either: the harness provides no live message channel to a
running worker at all (nothing was ever asked), or `grace_window_minutes` elapses with no
return. Both resolve identically — the orchestrator falls back to `--abandon` tier semantics
(`phase-stop.md` § `--abandon` tier, cited not restated) for that worker only; sibling workers
that did cooperate are unaffected.

### Non-goal for this issue (leg B boundary)

No JSON envelope is defined here for what a flushed worker's *return* looks like structurally —
a partial `status`, how it differs from `complete` / `blocked` / `error` — that shape and its
orchestrator-side ingest/validation is #492's deliverable. This section documents only the ask;
the response stays whatever shape the worker's role already returns today until #492 lands.

## Orchestrator validation

Before ledger append or phase transition:

1. Parse worker JSON; on parse failure → treat as worker error, do not advance phase
2. For implementer: reject if `touch_paths_honored === false` or `tests_passed === false`
3. Run `scripts/review-aggregate.ts` on reviewer output; route to implement only when `lgtm === false` and `review_iteration < 5`
4. Append aggregate `findings` to ledger with `phase: review` and `pr_ref` set

### Barrier triage

After a background worker batch barrier completes (`orchestrator-runtime.md` § Background worker barrier):

1. **Barrier complete** → validate each worker JSON (`scripts/validate-worker-json.ts`) **before** mutating `queue.json`.
2. **Idempotency:** if `route{}`, plan file, or PR already satisfies the phase gate, log skip and advance without re-spawn.
3. **Validation failure:** classify per `orchestrator-runtime.md` § Error Classification (sole
   taxonomy, not restated here) before deciding retry vs escalate — **Transient** → retry
   ≤2 with backoff; **Permanent** → report with actionable context and append a
   Failed-Approaches entry (`checkpoint-protocol.md` § Failed-Approaches Log);
   **Partial/Corruption** → verify artifacts, resume from checkpoint. Keep the issue
   `in-flight`, do not end the orchestrator turn until the error is routed.
4. **Ruling conflicts (issue #422):** a planner return with a non-empty `ruling_conflicts[]` sends
   the issue to `status: blocked`, `notes: awaiting-ruling-recheck` instead of advancing the
   phase; an empty `ruling_conflicts[]` alongside `rulings_checked_at` stamps the queue watermark
   and advances normally (`orchestrator.md` § Human-in-the-Loop (HITL) & Blocker Gating, Ruling
   Re-Check Gate).

**Missing return (recoverable):** when a worker signals completion but no return arrives, see
`orchestrator-runtime.md` § Background worker barrier → Triage and `recovery-protocol.md` §10 —
never collapse into "worker returned nothing to report."

The SubagentStop **validate** hook checks JSON at handoff; the **resume** hook (#154) automates the outer coordinator loop via `resume-request.json` and an orchestrator→coordinator doorbell only. Inner-loop continuity remains the orchestrator in-turn `Await` barrier (#151) — worker stops do not inject `followup_message` to the orchestrator.

### Blocked-iteration escalation (orchestrator → coordinator)

**Not a new worker JSON contract** — no `status`/`route` fields. A plain-text signal
riding on the existing `CHECKPOINT` session-handoff line
(`checkpoint-protocol.md` § Session handoff), fired when the Blocked-Iteration
Escalation rule (`orchestrator.md` § Human-in-the-Loop (HITL) & Blocker Gating) trips at
count `3` for one or more issues: the `CHECKPOINT` line's optional
`| BLOCKED-ESCALATED: #<issue>[,#<issue>...]` trailing segment lists them, so the
campaign never loops silently on a blocked issue.
