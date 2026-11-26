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

Every spawn round, and again at Triage, refreshes the peer heartbeat (§ Session resume & recovery
step 8), so a long turn keeps its claims live.

1. Every spawn round, run `bun run scripts/pace-gate.ts --current <planned batch> --max <parallel_max>`,
   which reads the cached statusline `rate_limits`, and
   `bun run scripts/usage-budget.ts --parallel-max <parallel_max> [--usage '<usage-probe JSON>']`,
   whose `--usage` is the harness usage probe's output (#1201; without it the same cache is read).
   When `ci_capacity.enabled` is `true`, first run `timeout 60 bun run scripts/ci-capacity-read.ts` (the reader makes up to 13 sequential forge calls with no
   timeout of its own) and pass its
   stdout, when it printed any, as `usage-budget.ts --ci-capacity '<reading JSON>'`. It reads the consumer's
   runners and queued jobs in the configured `ci_capacity.lanes`; no output, a non-zero exit or a warning
   means no reading, so log the warning and keep the usage `workers` (fail-open, never a pause). A CI cap
   shows in the verdict's `reasons` (`ci capacity: ...`) and can only lower `workers`.
   This round's target is the **smallest** of the pace target, the usage `workers` and (step 2) the
   resource `batch_size`.
   Pace gate: `STOP-NEW` spawns nothing (let in-flight workers finish, checkpoint, tell the owner),
   `THROTTLE` targets one, `HOLD` keeps the planned batch, `SCALE-UP` targets one more (only when
   another ready issue exists, never above `parallel_max`), and `unavailable` or a non-zero exit
   keeps the planned batch and logs the reason. Thresholds: `resource_policy.pace`
   (`config-template.md`).
   Usage gate (`usage_budget`, `config-template.md`), every verdict:

   | Verdict | Behaviour |
   |---------|-----------|
   | `GO` | Cap the target at `workers` |
   | `unavailable` or a non-zero exit | No cut (`workers` is `parallel_max`); log the reason |
   | `NO-NEW-STARTS` | Start no new issue (none leaves `ready`); workers that continue an issue already past handle still spawn at the other gates' target |
   | `NO-SPAWN` | Spawn nothing this round; in-flight workers finish; the next turn re-runs the gates (no wake, the verdict carries no `wake_at`) |
   | `STOP-WORKERS`, `PACE-WAIT` | **Drain and wake**: spawn nothing, let in-flight workers finish, then run `phase-stop.md` § Usage stop with the verdict's `wake_at` |
   | `STOP-CAMPAIGN` | Drain and stop: `phase-stop.md` § Usage stop with `wake_at: null`, and tell the owner the weekly line was crossed |

   Every usage verdict is a pause, the same as `STOP-NEW`.
   Never on a usage stop:
   - mark a queue entry `failed` or `blocked`, or write a ledger row for the stop
   - bump `failed_attempts` or any retry counter
   - route to `stop --abandon`, or kill or abort a worker
2. When the round includes test/build-bearing workers (implementers, or any worker that runs
   `build`/`verify`/`test`), run `bun run scripts/resource-gate.ts --requested <target>` and spawn
   at most its `batch_size`; it can only cut the target, never raise it: `go` keeps it, `degrade`
   cuts it to one, `defer` spawns none this turn (log the reasons and retry next turn),
   `unavailable` keeps it and logs the reason. A non-zero exit (bad flags or a malformed config)
   is handled as `unavailable`, with its stderr line logged. Thresholds: `resource_policy.gate`.
3. Record the round: `bun run scripts/pace-log.ts --planned <planned batch> --pace '<pace-gate JSON>'
   [--resource '<resource-gate JSON>'] [--usage '<usage-budget JSON>']` appends the pace verdict,
   resource verdict, usage verdict (with its 5-hour %, weekly %, `workers` and `wake_at`), planned
   batch, effective concurrency (the smallest of the gates) and reasons to
   `.blackhole/pace-log.jsonl` (newest 200 rounds kept). Pass the usage-budget stdout unchanged.
   Run it even when a gate said `STOP-NEW`, `defer` or a usage pause; a non-zero exit is logged and
   the turn goes on.
   **STOP-NEW is a pause, never a failure**: the round spawns nothing, in-flight workers finish
   and are triaged as usual, `queue.json` and `findings-ledger.json` stay untouched (no issue
   marked `failed` or `blocked`, no ledger row, no retry counter bumped), the checkpoint notes
   "paused by pace gate" with the reason, and the turn ends. The next turn re-runs step 1 and
   resumes normally the first time the verdict is no longer `STOP-NEW`; `unavailable` resumes too.
   Issues left `ready` stay `ready`. A `defer` from the resource gate and a `NO-SPAWN` from the
   usage gate are handled the same way; the usage drain-and-wake verdicts add the wake below.
4. Log `WAVE <N>: issues [...]` before the first spawn.
5. Take the keep-awake hold for the workers now in flight:
   `bun scripts/campaign-record.ts keep-awake --workers <n>` (`keep-awake.md`); idempotent, and an
   inhibitor problem is reported in one line, never a reason not to spawn.
6. Record each worker in `campaign-checkpoint.md` `## In-flight workers` with role, issue `#N`, spawn turn id, and (issue #422, gated by `docs_governance.enabled`/`companion_files`) the rulings ledger's `rulings_revision` at spawn time — see `checkpoint-protocol.md` § In-flight workers row format.

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
   JSON, tag `notes: recovered-via-transcript`, done. **Claude desktop**: there the transcript is
   the session's `tasks/<task id>.output` (`/tmp/claude-<uid>/<project slug>/$CLAUDE_CODE_SESSION_ID/tasks/`,
   `<task id>` being the id the spawn returned; a symlink to that session's
   `subagents/agent-<task id>.jsonl`), and the return is the worker's last `SubagentHandback`
   tool input rather than assistant text — pass that file to the same command, which prefers a
   handback input in the last assistant turn over that turn's text. If `$CLAUDE_CODE_SESSION_ID` is unset —
   skip this rung entirely (a harness-capability check, not a fault) and go straight to rung 2.
2. On rung 1's absence or failure (unset env var, empty glob, or the script's non-zero exit for
   any reason — missing file, neither assistant text nor a `SubagentHandback` call, extraction
   failure, schema-validation failure) — **do not retry the same transcript file.** `SendMessage` the worker by its spawn `name`
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

1. Parse and validate return JSON (`scripts/validate-worker-json.ts` or harness hook output) — see `orchestrator-handoff.md` § Orchestrator validation and § Barrier triage. This validation is unconditional across every arrival path — direct return (case A), transcript-recovered (Recovery ladder rung 1), and resend-recovered (rung 2): the orchestrator never applies a worker's JSON to `queue.json`/`findings-ledger.json` from a hand-extracted or otherwise unvalidated payload (`V-BRIEF-01`, BLOCK).
1a. **Enum-source pin** (issue #738): when the return's own PR modifies `scripts/lib/worker-json/**`, run step 1's validator with `--enum-source <PR worktree>`. The role enums (`scripts/lib/worker-json/constants.ts`) are otherwise read from the tree the validator runs in — the orchestrator's clone at the pre-merge commit — so a return whose PR *widens* an enum is rejected for a value its own branch legitimately declares, and the reject is indistinguishable from a genuinely malformed payload. Flag contract, default (the validator's own tree) and the exit-2 unresolvable-tree case: `scripts/validate-worker-json.ts` usage output. Validating an enum-widening return against the pre-merge tree and applying the result anyway is `V-BRIEF-01`. **Trust boundary**: the path passed to `--enum-source` is always the orchestrator's own recorded worktree for that issue (`queue.json`'s `worktree` field), never a path echoed from the worker's return JSON — the flag selects which tree's validator code runs, so a worker-supplied path would let a return choose the validator that judges it.
1b. **Hook event ingestion** (issue #447, identity corrected by ADR-042/issue #893): glob `.blackhole/hook-events/*.json` **before** validating this worker's return JSON — a PreToolUse refusal is written by non-agent code precisely because the worker's own report cannot be relied on to mention it. Invoke `scripts/lib/hook-event-triage.ts` (`ingestHookEvents`) to perform the mechanical ingest: for each event, resolve `issue_ref` by matching its `worktree` field against `queue.json`'s in-flight `worktree` paths, then append or bump a `V-HOOK-01` (`tier: block`), `V-HOOK-02` (`tier: warn`), or `V-HOOK-03` (`tier: error` — wrapper fail-open / `hook-exec-failure`) findings-ledger row with `phase: "implement"`. Finding identity is **per class**, `(vcode, pattern_id, worktree)`, not per event (ADR-042) — a recurrence of a class already carrying an `open` row increments that row's `occurrences` and bumps `last_seen_at` rather than appending a second row; a class whose only prior row was `deferred` still gets a fresh `open` row, never a silent bump onto the deferred one. Full write mechanics: `findings-ledger.md` § Write protocol — never re-derived here. The consumed event file is then moved to `.blackhole/archive/hook-events-<turn-timestamp>/`, never unlinked. Event schema: `hook-schemas.md` § PreToolUse hook events. An event whose `worktree` matches no in-flight issue is still appended, with `issue_ref: null` — never dropped.
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

1. **Main-clone freshness refresh, turn-start safety net (issue #792)**: run
   `git fetch origin main && git merge --ff-only origin/main` in the orchestrator's own main
   clone, before any of steps 2-5 below run. `.blackhole/` is fully `.gitignore`-excluded, so
   this cannot conflict with campaign state; `--ff-only` fails closed (non-zero exit, no merge
   attempted) on a dirty tracked-file working tree. Treat a non-zero exit as a blocker: resolve
   it via the turn-start `git status --porcelain` dirty-check (`orchestrator.md` § Git &
   Worktree Hygiene) before proceeding with this turn's recovery sequence. This runs **first**
   in this list, ahead of step 5's plugin-drift-signal scan specifically, because that scan
   compares plugin-cache content against the live tree — the analysis note's highest-risk,
   unmitigated call site (a stale live tree makes a real drift look absent, or an absent drift
   look present). This step is a secondary net alongside `phase-loop.md`'s post-merge refresh
   (Merge protocol step 4.5): the post-merge refresh closes the window opened by blackhole's own
   merges; this step additionally bounds staleness to at most one turn's worth of drift from any
   other cause (e.g. a human push to the shared branch mid-campaign, or the very first turn
   before any merge has happened yet).
2. Run `recovery-protocol.md` **§9** artifact-vs-queue drift heal for all
   `status: in-flight` issues — **before** Wave scheduling and **before** any `Task` spawn.
   Use `scripts/recovery-drift.ts` (`detectArtifactDrift`) to detect drift; apply heal
   mutations (clear stale notes/checkpoint rows, advance phase) before spawning workers.
3. Cross-link **§8** (staleness) and **§9** (drift): staleness forces re-route when
   `route.body_hash` no longer matches; drift advances without re-run when artifacts match
   the current revision and are not stale.
4. Inspect worktrees per `recovery-protocol.md` §2.
5. Refresh the advisory plugin-cache drift signal (issue #800, ADR-030): run
   `bun run --cwd <abs repo-root> scripts/plugin-drift-signal.ts --repo-root <abs repo-root>`,
   where `<abs repo-root>` is the campaign repo's main clone. `--repo-root` is required in a
   consumer: without it the script describes its own folder, which is the plugin cache there,
   not the campaign repo, and the script refuses to run. Existence-gated on
   `scripts/plugin-drift-signal.ts` being present: inert when no blackhole install provides the
   script — no error.
   **Local-only**: skip it when the run context routes `state_store: branch`. That machine
   installed the plugin fresh for this session and is reclaimed afterwards, so there is no
   long-lived cache to drift; say "plugin drift: skipped (ephemeral machine)" once in the turn.
   Surfaced on the `bun run scripts/campaign-status.ts` dashboard when it reports content drift; full mechanism:
   `blackhole-state.md` § Plugin-Drift Signal.
6. **Ingest hook events at turn start** (ADR-042, issue #893): run
   `bun run scripts/lib/hook-event-triage.ts`, existence-gated on that script being present
   (a consumer repo without it simply has nothing to run — no error). This closes the gap Triage
   step 1b alone leaves open — a fail-open recorded between worker batches (or in a turn that
   spawns no workers at all) previously sat unread until the next background-worker barrier;
   this step surfaces it within the current turn instead. Mechanics — class identity, dedup,
   archive-then-delete — are identical to step 1b's `ingestHookEvents` call, never re-derived
   here. **On-throw disposition**: a non-zero exit is logged and the turn proceeds — this step
   never blocks the orchestrator's own turn on a state-write-guard refusal or a missing/malformed
   `.blackhole/findings-ledger.json`; the live ledger is left untouched by the write guard on
   any refusal (`blackhole-state.md` § Write protocol), so a failed ingest here is a missed
   visibility opportunity, never a corruption risk. The next turn's step 1b (when workers spawn)
   or this same step 6 (next turn) will retry against whatever events remain on disk.

7. **Resume after a pace or usage pause**: when the latest `.blackhole/pace-log.jsonl` line has
   `rate_limit_stop: true` (a pace `STOP-NEW`, or a usage `NO-SPAWN`, `STOP-WORKERS`, `PACE-WAIT`
   or `STOP-CAMPAIGN`), or the checkpoint carries `stopped_by: usage`, treat the previous turn as a
   pause: run no recovery action and no re-route. A turn that starts
   before the checkpoint's `wake_at` spawns nothing and ends (re-arming the wake if none is
   scheduled, `phase-stop.md` § Usage stop); otherwise run the spawn-round gates (§ Background
   worker barrier, Spawn steps 1-3) as usual, and clear `stopped_by`, `stop_kind` and `wake_at` the
   first time the round spawns again. The campaign continues from `queue.json` exactly as it was
   left.
   Never on a usage stop:
   - mark a paused issue `failed` or `blocked`
   - bump `failed_attempts` or any retry counter
   - kill, abort or `--abandon` a worker

8. **Peer heartbeat** (ADR-057): run `bun run scripts/peer-campaigns.ts heartbeat --turn <n>`
   (`--host-session <id>` where the host has a cross-session transport, `claude-code-native.md`
   § Cross-session budget transport), then `detect`: a live peer naming this `solo` session as
   its `manager_session` makes it act as manager (`multitask-mode.md` § Shared usage budget),
   and an uncoordinated peer or an `unknown` verdict mid-campaign is handled this turn:
   - report it to the owner in the turn's status line, naming the peer worktrees or the unreadable
     files `detect` lists;
   - dispatch no issue in a live peer's `claims[]`; with `unknown`, whose claims cannot be read,
     spawn no new worker this turn (in-flight workers finish) and check again next turn, since a
     corrupt, non-regular or read-denied entry that still has an mtime lapses one lease after it. An entry the registry listed but whose `lstat` was refused
     (EACCES) has no mtime and stays `unknown` until its permissions are corrected or the file is
     removed: dating it by the registry directory's mtime would let unrelated writes refresh or
     age out an unreadable entry, which loosens the read;
   - in an unattended invocation (`--unattended`), park it once with `launch-gate.md` § Print-only mode's fixed question and
     option set; a re-park on a later turn merges into the same pending decision.

   Nothing refreshes the record between
   turns: it is written at turn start, at each spawn round and at Triage only. A campaign whose
   next turn starts more than 40 minutes after its last heartbeat (a usage pause, an idle wait,
   a host with no wake scheduled inside the lease) lapses and is invisible to peers until that
   turn. A stopped campaign releases its record (`phase-stop.md`) and is invisible until it is
   resumed. A non-zero exit is logged and the turn proceeds. Registry: `multitask-mode.md` §
   Peer campaign registry.

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

