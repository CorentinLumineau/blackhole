## Error Classification (Transient / Permanent / Partial-Corruption)

This section is the **single source** for campaign tool/spawn failure classification —
`recovery-protocol.md`, `merge-conflict-protocol.md`, and `worker-schemas.md` cross-reference it,
they do not restate the table.

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

**Three-case distinction (issue #566)**: a worker's completion/idle notification and its return
payload are **independent channels** — a batch can deliver every completion signal while
delivering zero payloads (observed empirically: 7 idle notifications for 7 `router` spawns, 0
returns). Never treat notification receipt as evidence a return arrived. Before running step 1
below, classify each worker into exactly one of:

- **(A) Return arrived** — the normal case; proceed to step 1 unchanged.
- **(B) Worker signaled completion (idle/available notification or harness completion signal)
  but no return payload arrived** — run the Recovery ladder below; on success, treat the
  recovered JSON identically to case A and proceed to step 1. Never collapse this case into
  "worker returned nothing to report."
- **(C) Neither signal arrived** — the worker is still genuinely in-flight; attempt no recovery;
  the Barrier above keeps waiting.

**Recovery ladder (case B only, stop at first success)**:

1. If `$CLAUDE_CODE_SESSION_ID` is set in the orchestrator's Bash environment, glob
   `~/.claude/projects/*/$CLAUDE_CODE_SESSION_ID/subagents/agent-a<name>-*.jsonl`, where `<name>`
   is the exact spawn `name` this worker was given (`orchestrator-delegation.md` § Worker spawn
   model, deterministic spawn name). On more than one match, take the most recently modified; on
   a tied or unavailable `mtime`, abort this rung and fall through to rung 2 rather than risk
   applying a stale prior-turn return. Run `bun run scripts/validate-worker-json.ts
   --recover-transcript <path> --role <role>`. Exit `0` → parse stdout as the recovered return
   JSON, tag `notes: recovered-via-transcript`, done. If `$CLAUDE_CODE_SESSION_ID` is unset —
   skip this rung entirely (a harness-capability check, not a fault) and go straight to rung 2.
2. On rung 1's absence or failure (unset env var, empty glob, or the script's non-zero exit for
   any reason — missing file, no assistant text, extraction failure, schema-validation failure)
   — **do not retry the same transcript file.** `SendMessage` the worker by its spawn `name`
   asking it to re-emit its final status JSON verbatim; wait for the next idle/completion signal;
   retry rung 1 once against any new transcript content. On success, tag `notes:
   recovered-via-resend`.
3. If both rungs fail, classify **Permanent** (§ Error Classification above), append a
   Failed-Approaches entry (`checkpoint-protocol.md` § Failed-Approaches Log) naming the worker
   and both failed recovery attempts, tag `notes: lost-respawned`, and re-spawn the worker fresh
   rather than loop — never leave the issue silently stuck `in-flight` past this point.

Full retrieval-path table and observed outcomes: `recovery-protocol.md` §10 — cross-referenced,
not restated here.

For each completed worker (case A, or case B after a successful recovery):

1. Parse and validate return JSON (`scripts/validate-worker-json.ts` or harness hook output) — see `worker-schemas.md` § Orchestrator validation and § Barrier triage. This validation is unconditional across every arrival path — direct return (case A), transcript-recovered (Recovery ladder rung 1), and resend-recovered (rung 2): the orchestrator never applies a worker's JSON to `queue.json`/`findings-ledger.json` from a hand-extracted or otherwise unvalidated payload (`V-BRIEF-01`, BLOCK).
1b. **Hook event ingestion** (issue #447): glob `.blackhole/hook-events/*.json` **before** validating this worker's return JSON — a PreToolUse refusal is written by non-agent code precisely because the worker's own report cannot be relied on to mention it. Invoke `scripts/lib/hook-event-triage.ts` (`ingestHookEvents`) to perform the mechanical ingest: for each event, resolve `issue_ref` by matching its `worktree` field against `queue.json`'s in-flight `worktree` paths, append a `V-HOOK-01` (`tier: block`), `V-HOOK-02` (`tier: warn`), or `V-HOOK-03` (`tier: error` — wrapper fail-open / `hook-exec-failure`) findings-ledger row with `phase: "implement"` via the dedup-then-append protocol (`findings-ledger.md` § Write protocol — never re-derived here), then delete the ingested file. Event schema: `hook-schemas.md` § PreToolUse hook events. An event whose `worktree` matches no in-flight issue is still appended, with `issue_ref: null` — never dropped.
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
   `route`, `trigger`, `local_analyze`, and `rationale` (when present on the return) verbatim
   from the return (`worker-schemas.md` § Router). **Exception**: a completed worker returning
   `status: partial`
   (`worker-schemas.md` § Partial result) skips this per-role branch entirely — see §
   Partial-result ingest below.
4. Remove the worker from `## In-flight workers`.
5. **Idempotency:** if the artifact already satisfies the gate before spawn (e.g. `route{}` present, plan file on disk, PR open), skip re-spawn and advance phase. When checkpoint lists workers as active but artifacts already landed, run `recovery-protocol.md` §9 drift heal at turn start (`detectArtifactDrift`) — do not re-spawn completed workers when artifacts match the current revision.

### Partial-result ingest (`status: partial`, `stop --now` leg B, issue #492)

Applies instead of step 3's normal per-role mutation branch, still serially, one worker at a
time (`blackhole-state.md` § Single-writer invariant, unchanged):

1. **Phase**: leave `queue.json`'s `phase` at `partial_result.phase_reached` — never advance on
   a partial return, however much work looks done.
2. **Status & notes**: set `status: blocked`, `notes:` the string built by
   `scripts/lib/worker-json/partial-ingest.ts`'s `buildPartialFlushNotes()` — reusing the
   existing free-form `notes` convention (`queue-dag.md`), same pattern as
   `awaiting-ruling-recheck`/`blocked-escalated:Permanent:<reason>`, not a new queue schema
   field. `status: blocked` is a scheduling label ("needs a human or a resumed worker"), not a
   claim about the work.
3. **Worktree safety**: `worktree_disposition: dirty-uncommitted` never authorizes worktree
   removal — `blackhole-protocol.md` § Branch & Worktree Hygiene's dirty-check refusal applies
   unchanged. `pushed` leaves the worktree eligible for the same mergeable-release conditions
   as any other worktree; a partial branch with no open PR simply never meets them yet.
4. **Never drop**: append `new_findings` (if any) exactly as any other return would
   (`blackhole-protocol.md` § Never drop findings does not suspend for a partial return).
5. **Resume**: the next turn that dispatches this issue reads the `notes` string from step 2,
   re-spawns the same role at `phase_reached`, and briefs it with `work_done`/`work_remaining`
   verbatim in the 5-Field Delegation Contract's Objective field — the same
   Failed-Approaches-entries convention already used to avoid re-attempting dead ends (§ Error
   Classification above, cited not restated) — so the resumed worker continues instead of
   restarting from zero.

### Interaction with the Unverified-claim hold (#204) and Sprint Contract hold (#309)

Both holds key on `status: complete` specifically, not any other value — a `status: partial`
return never claims completion, so neither hold can fire on it. See `phase-implement.md` §§
Unverified-claim hold, Sprint Contract hold for each hold's own stated trigger; this is the
direct consequence of that trigger, not a bypass by omission. The gap that would otherwise open
— a worker dodging both holds' evidence bar by returning `partial` instead of an
under-verified `complete` — is closed structurally:
`scripts/validate-worker-json.ts` requires `partial_result.work_done`/`work_remaining`
non-empty (`worker-schemas.md` § Partial result), and step 1 above's phase-freeze means the
issue re-enters the very same phase's `complete`-time gate (evidence, Sprint Contract) on its
next genuine completion — #204 and #309 are deferred past a partial return, never permanently
bypassed.

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
4. Refresh the advisory plugin-cache drift signal (issue #800, ADR-030): run
   `bun run scripts/plugin-drift-signal.ts`, existence-gated on `scripts/plugin-drift-signal.ts`
   being present (a consumer repo without the script simply has nothing to run — no error).
   Surfaced on the `bun run status` dashboard when it reports content drift; full mechanism:
   `blackhole-state.md` § Plugin-Drift Signal.

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
