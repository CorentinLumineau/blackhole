## Error Classification (Transient / Permanent / Partial-Corruption)

This section is the **single source** for campaign tool/spawn failure classification —
`recovery-protocol.md` and `worker-schemas.md` cross-reference it, they do not restate the
table.

| Class | Examples | Action |
|-------|----------|--------|
| **Transient** | CI run `cancelled` with no real error; `Base branch was modified` merge race; network timeouts | Retry ≤2 with backoff, then reclassify **Permanent** |
| **Permanent** | `escalation_trigger: touch_paths_overrun`; missing command (exit `127`) | Report with actionable context; skip optional steps with a warning; append a Failed-Approaches entry (`checkpoint-protocol.md` § Failed-Approaches Log) |
| **Partial/Corruption** | Partial DB write without compensation; desynced state journal | Verify artifacts before trusting them, resume from checkpoint, data safety first |

Before respawning `planner`/`implementer` for an issue that already has
Failed-Approaches entries in `campaign-checkpoint.md`, include those entries verbatim in
the 5-Field Delegation Contract's **Objective** field — so a resumed campaign never
re-attempts a known dead end on the same issue.

---

## Background worker barrier (Cursor / Pattern B)

When this turn spawns one or more workers with `run_in_background: true` (router wave,
parallel planners, implementers, reviewers):

### Spawn

1. Log `WAVE <N>: issues [...]` before the first spawn.
2. Record each worker in `campaign-checkpoint.md` `## In-flight workers` with role, issue `#N`, spawn turn id, and (issue #422, gated by `docs_governance.enabled`/`companion_files`) the rulings ledger's `rulings_revision` at spawn time — see `checkpoint-protocol.md` § In-flight workers row format.

### Barrier

Block **in-turn** until every worker in the batch completes. On Cursor, use `Await` on
each background task ID (canonical harness pattern). Do **not** end the turn and wait for
notifications — Cursor does not deliver worker-completion notifications to a parent
orchestrator that has already ended its turn.

### Triage (idempotent)

For each completed worker:

1. Parse and validate return JSON (`scripts/validate-worker-json.ts` or harness hook output) — see `worker-schemas.md` § Orchestrator validation and § Barrier triage.
1b. **Hook event ingestion** (issue #447): glob `.blackhole/hook-events/*.json` **before** validating this worker's return JSON — a PreToolUse refusal is written by non-agent code precisely because the worker's own report cannot be relied on to mention it. For each event, resolve `issue_ref` by matching its `worktree` field against `queue.json`'s in-flight `worktree` paths, append a `V-HOOK-01` (`tier: block`) or `V-HOOK-02` (`tier: warn`) findings-ledger row with `phase: "implement"` via the dedup-then-append protocol (`findings-ledger.md` § Write protocol — never re-derived here), then delete the ingested file. Event schema: `hook-schemas.md` § PreToolUse hook events. An event whose `worktree` matches no in-flight issue is still appended, with `issue_ref: null` — never dropped.
2. **Ruling-revision quarantine** (issue #422, gated by `docs_governance.enabled`/`companion_files`): before applying this worker's mutations, compare its recorded spawn-time `rulings_revision` (step 2 above) against the ledger's current `rulings_revision`. On mismatch — **quarantine**: do not advance the phase; set `status: blocked`, `notes: awaiting-ruling-recheck`; add the issue to the coordinator's conflict list instead of applying the worker's normal mutations (step 3 below).
3. Apply queue/ledger mutations per role, **serially, one completed worker at a time** — even
   though the batch itself ran in parallel, the orchestrator never parallelizes the
   `queue.json`/`findings-ledger.json` writes (router → `route{}`; planner → plan gate;
   implementer → PR linkage; reviewer → aggregate pipeline). This is the
   single-writer-orchestrator invariant (`blackhole-state.md` § Single-writer invariant):
   parallel-batch workers (e.g. a router wave) never write these two files directly — they
   return computed data, and the orchestrator alone applies it. For each completed `router`,
   construct the full `routing_decisions` row from its returned JSON before appending: assign
   `id` from `next_routing_id`, `issue_ref` from spawn context, `created_at` = now, and copy
   `route`, `trigger`, and `local_analyze` verbatim from the return (`worker-schemas.md` §
   Router).
4. Remove the worker from `## In-flight workers`.
5. **Idempotency:** if the artifact already satisfies the gate before spawn (e.g. `route{}` present, plan file on disk, PR open), skip re-spawn and advance phase. When checkpoint lists workers as active but artifacts already landed, run `recovery-protocol.md` §9 drift heal at turn start (`detectArtifactDrift`) — do not re-spawn completed workers when artifacts match the current revision.

### Turn-end gate

Run the **Checkpoint protocol** turn-end checklist only when `## In-flight workers` is
empty. If any worker is still in-flight, **do not** increment `orchestrator_turn_id` or
end the turn.

Per `merge-gate.md` § 1: before merging an LGTM'd issue's PR, evaluate `mergeEligible(issue)` — hold/merge_after/gated-batch checks, never duplicated inline here. The CI-wait itself (`phase-loop.md` § Merge protocol step 2) follows this same § Background worker barrier idiom — a detached poll the orchestrator barriers on in-turn, never a foreground sleep — not a new, parallel background-task concept.

---

## Session resume & recovery

On **every orchestrator turn start** (including compaction recovery and session resume),
after reading checkpoint and forge sync:

1. Run `recovery-protocol.md` **§9** artifact-vs-queue drift heal for all
   `status: in-flight` issues — **before** Wave scheduling and **before** any `Task` spawn.
   Use `scripts/recovery-drift.ts` (`detectArtifactDrift`) to detect drift; apply heal
   mutations (clear stale notes/checkpoint rows, advance phase) before spawning workers.
2. Cross-link **§8** (staleness) and **§9** (drift): staleness forces re-route when
   `route.body_hash` no longer matches; drift advances without re-run when artifacts match
   the current revision and are not stale.
3. Inspect worktrees per `recovery-protocol.md` §2.

**MUST** complete `recovery-protocol.md` §5 orchestrator checklist before spawning
`implementer` when any in-flight issue has a dirty worktree or recovery stash. Do not spawn
implementer until worktree scope matches a single issue.


## Incident Mode

A stricter, campaign-wide variant of the blocker gating above — consult this section before
§ Continuous Discovery & Pareto Sorting runs.

**Trigger signals**: a prod outage report, a data-loss risk, or a CRITICAL-severity bug on a
live surface. A concrete, already-observable instance of the third signal: a
**`Permanent`**-classified Blocked-Iteration Escalation (`notes:
blocked-escalated:Permanent:<reason>` — § Human-in-the-Loop (HITL) & Blocker Gating above,
composed with § Error Classification) on an issue whose Touch-Paths/labels mark it as
touching a live/production surface. This section does not invent a second, parallel severity
taxonomy — it reuses the landed § Error Classification / § HITL Blocker Gating machinery as
its sole machine-observable signal.

**Entry mechanism**: a human/coordinator arms `config.json.incident_mode.enabled: true`
(`config-template.md`) upon recognizing one of the trigger signals above. Entry is manual,
not automatic detection — no severity-label taxonomy exists in this repo to key an automatic
detector off.

**Effect while active**: `parallel_max` is treated as `incident_mode.parallel_max_override`
(default `1`) regardless of `config.json.parallel_max` — the consumer is `phase-loop.md`'s
"Spawn parallel batch" checklist line; only the declared incident issue(s) may be
`in-flight`. `blackhole-state.md`'s existing "at most one `migration_slot: true` in-flight"
rule is strictly binding (zero tolerance) while incident mode is active — this restates, it
does not duplicate, that rule. `phase-loop.md`'s "## Continuous Discovery of Improvements
(Backlog Growth)" section is paused entirely for the duration.

**Exit criteria**: incident mode reverts to normal dispatch when, and only when, the declared
incident issue reaches `status: merged`, its merge record carries verification evidence
(`phase-loop.md` § Merge protocol step 5 "deploy verify per runbook"), **and** the issue
carries no outstanding Blocked-Iteration Escalation and no unresolved `Permanent`
Failed-Approaches entry (`checkpoint-protocol.md` § Failed-Approaches Log). There is no
auto-exit on a timeout or on the next turn alone — all three conditions must hold together.

<!-- GENERATED by scripts/build.ts from src/references/orchestrator-runtime.md — do not hand-edit -->
