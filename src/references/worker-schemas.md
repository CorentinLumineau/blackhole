# Worker Return Schemas

Structured JSON contracts for campaign worker agents. The orchestrator validates worker output against these shapes before mutating state.

Optional: consumers may install the Cursor SubagentStop hook below for machine-enforced structural validation at subagent handoff.

On a harness with a native orchestration primitive (Pattern C, see
[claude-code-native.md](claude-code-native.md)), a `schema:` option on the fan-out tool call can
mechanically enforce these same contracts at the tool-call layer — the JSON shapes below are the
schema source, unchanged. This complements, not replaces, the SubagentStop hook / `validate-worker-json.ts`
path documented below for harnesses without a native fan-out primitive.

## SubagentStop hook (Cursor)

**Install:** Merge the `hooks` block from [`templates/hooks/subagent-stop-validate.json`](../../templates/hooks/subagent-stop-validate.json) into your project's `.cursor/hooks.json`. Requires `bun` on `PATH`; hook `command` paths are relative to the repo root.

**Behavior:** On `subagentStop`, when the hook `matcher` hits `planner`, `implementer`, or `reviewer`, Cursor runs `bun run scripts/validate-worker-json.ts --hook` with the stop payload on **stdin**. Non-zero exit blocks handoff (`failClosed: true`). Subagent stops with `status` `error` or `aborted`, or non-campaign subagents, pass through (exit `0`).

**Extraction order:** Worker JSON is parsed from (1) a fenced ` ```json ` block in `summary`, (2) the last brace-balanced `{...}` object in `summary`, or (3) the tail of `agent_transcript_path` when readable.

**Exit codes:** `0` = valid or pass-through; `1` = validation or JSON extraction failure; `2` = hook stdin JSON parse failure.

### Orchestrator / harness fallback (non-Cursor)

Harnesses without Cursor hooks can validate worker output before mutating `queue.json`:

```bash
# Full structural validation (preferred)
bun run scripts/validate-worker-json.ts --role planner --file handoff.json
bun run scripts/validate-worker-json.ts --role implementer --json '{"status":"complete",...}'

# Quick spot-check only (not a substitute for full validation)
jq -e '.status and .plan_path' handoff.json
```

Fixture pairs for each role live under [`fixtures/worker-json/`](../../fixtures/worker-json/). Validator implementation: [`scripts/validate-worker-json.ts`](../../scripts/validate-worker-json.ts).

## SubagentStop resume hook (Cursor, #154)

**Install:** Merge the `hooks` block from [`templates/hooks/subagent-stop-resume.json`](../../templates/hooks/subagent-stop-resume.json) **after** the validate hook entry in `.cursor/hooks.json`. Install guide: [`templates/hooks/README.md`](../../templates/hooks/README.md).

**Behavior (Option C — hybrid):** On `subagentStop`, when the hook `matcher` hits `orchestrator`, `router`, `planner`, `implementer`, `reviewer`, or `investigator`, Cursor runs `bun run scripts/campaign-resume-signal.ts --hook` with the stop payload on **stdin**. The hook always evaluates resume gates first, then atomically upserts `.blackhole/resume-request.json`. Exit is always `0` (`failClosed: false`).

| Stopping agent | `followup_message` | File write |
|----------------|-------------------|------------|
| `orchestrator` | **Yes** — coordinator doorbell only | `resume-request.json` when gates pass |
| `router` / `planner` / `implementer` / `reviewer` / `investigator` | **No** | `resume-request.json` only when **stale barrier** detected |
| Non-campaign subagents | No | No |
| `status: error` / `aborted` | No | No |

**Ordering rule:** validate hook entry **must** appear first in the `subagentStop` array.

### Resume gates (all must pass)

1. `.blackhole/queue.json` exists and parses as JSON.
2. **Work remains:** at least one issue with `status: ready` or `status: in-flight`, or checkpoint `## Ready set` non-empty, or checkpoint `## In-flight workers` non-empty.
3. **No user gate:** no issue `notes` matching `awaiting-user`, `awaiting-plan`, or `awaiting-design` while `status` is `blocked` or `in-flight`.
4. **Orchestrator doorbell:** stdout `followup_message` emitted only when `subagent_type` resolves to `orchestrator` and file write succeeds.
5. **Stale barrier (workers only):** checkpoint `## In-flight workers` has active entries **and** stopping worker JSON validates — writes file with `reason: stale_barrier`, no `followup_message`.

Hook **must not** mutate `queue.json`, `findings-ledger.json`, or plan files.

### `.blackhole/resume-request.json` schema

```json
{
  "version": 1,
  "requested_at": "2026-07-09T12:00:00.000Z",
  "reason": "orchestrator_turn_complete",
  "target": "coordinator",
  "dedupe_key": "turn-12",
  "coalesce_until": "2026-07-09T12:00:05.000Z",
  "stopping_agent": "orchestrator",
  "queue_refreshed_at": "2026-07-09T11:59:00.000Z",
  "orchestrator_turn_id": 12
}
```

| Field | Values | Required |
|-------|--------|----------|
| `version` | `1` | yes |
| `requested_at` | ISO-8601 | yes |
| `reason` | `orchestrator_turn_complete` \| `stale_barrier` | yes |
| `target` | `coordinator` | yes |
| `dedupe_key` | string | yes — `turn-{id}` or `stale-wave-{turn}-{issue-set-hash}` |
| `coalesce_until` | ISO-8601 | yes — now + 5s; concurrent stops merge into one record |
| `stopping_agent` | agent role string | yes |
| `queue_refreshed_at` | string | yes |
| `orchestrator_turn_id` | number \| null | when checkpoint present |

**Write protocol:** read-modify-write via `.blackhole/resume-request.json.tmp` + `mv`. If existing record has `coalesce_until` in the future and same `dedupe_key`, refresh timestamp only (dedup). Coordinator **acks** by deleting the file or writing `{ "acked_at": ... }` after successful resume.

**Doorbell message (orchestrator stop only):**

```json
{
  "followup_message": "Blackhole: pending resume-request.json. Run coordinator turn flow — bun run status (full dashboard), then resume orchestrator with interrupt:false if work remains and queue is not user-blocked. Ack resume-request.json after resume."
}
```

### Manual test runbook (WAVE spawn)

| Step | Actor | Action | Expected |
|------|-------|--------|----------|
| 1 | maintainer | Merge validate + resume hook fragments into `.cursor/hooks.json` | Hooks tab shows both entries |
| 2 | coordinator | Phase 0 + spawn orchestrator `run_in_background: true` | orchestrator live |
| 3 | orchestrator | WAVE 0: spawn 2–4 `router` workers, barrier-wait, triage, turn-end | checkpoint workers empty |
| 4 | orchestrator | END TURN with ready work remaining | `subagentStop` fires |
| 5 | resume hook | writes `resume-request.json`, emits coordinator `followup_message` | file present; coordinator wakes |
| 6 | coordinator | `bun run status` → full dashboard → resume orchestrator | next turn without user chat |
| 7 | coordinator | delete/ack `resume-request.json` | file absent |
| 8 | negative | set `notes: awaiting-plan-approval` on in-flight issue, repeat step 4 | hook exits 0, **no** file, **no** followup |

```bash
bun test scripts/campaign-resume-signal.test.ts
# Manual: after orchestrator turn-end with work remaining:
test -f .blackhole/resume-request.json && jq -e '.target == "coordinator"' .blackhole/resume-request.json
```

Fixtures: [`fixtures/resume-signal/`](../../fixtures/resume-signal/). Implementation: [`scripts/campaign-resume-signal.ts`](../../scripts/campaign-resume-signal.ts).

## Planner (`planner`)

```json
{
  "status": "ready",
  "plan_path": "plans/issue-298.md",
  "track": "standard",
  "failing_checks": [],
  "clarification_markers": 0
}
```

| Field | Values | Required |
|-------|--------|----------|
| `status` | `ready` \| `blocked` \| `error` | yes |
| `plan_path` | string | when `ready`, **or** when `blocked` and `track: design` |
| `track` | `quick` \| `standard` \| `skip` \| `design` | when `ready`, or when `blocked` and caller knows the track |
| `failing_checks` | string[] | when `blocked` |
| `clarification_markers` | number | when `ready` or `blocked` |

```json
{
  "status": "ready",
  "plan_path": ".blackhole/plans/issue-298.md",
  "track": "skip",
  "failing_checks": [],
  "clarification_markers": 0
}
```

```json
{
  "status": "blocked",
  "plan_path": ".blackhole/plans/issue-298-design.md",
  "track": "design",
  "failing_checks": ["design_pending_approval"],
  "clarification_markers": 0
}
```

### Plan quality gate checks

When `status: blocked`, `failing_checks` lists failed items:

- `touch_paths_declared` — Touch-Paths section present (`V-SCOPE-02`)
- `schema_baseline` — API/schema changes specified for standard track (`V-API-01`)
- `tdd_tasks` — TDD baseline and failing-test tasks present (`V-TEST-01/02`)
- `ac_mapping` — acceptance criteria mapped to tasks
- `clarification_limit` — at most 2 `[NEEDS CLARIFICATION]` markers
- `base_commit` — `plan_base_commit` stamped in frontmatter
- `design_pending_approval` — design track artifact produced at `plan_path`; blocked pending the
  **mandatory** human gate (ADR-004: "no confidence bypass, human always decides"). Not a
  quality-gate failure — the design track is *always* blocked by design, regardless of how
  complete or unambiguous the design note is. The artifact at `plan_path` carries the full
  analytical substance (Options + trade-off matrix, adversarial evaluation via multiplicity,
  component decomposition, design principles validation, refactoring impact analysis, assumption
  audit) per `planner.md`'s Design Track template — content only, no JSON field change.

## Implementer (`implementer`)

```json
{
  "status": "complete",
  "pr_number": 42,
  "branch": "blackhole/issue-298",
  "tests_passed": true,
  "touch_paths_honored": true,
  "execution_mode": "standard",
  "evidence": { "command": "bun test scripts/campaign-status.test.ts", "result": "42 pass, 0 fail" },
  "new_findings": [],
  "filed_issues": []
}
```

| Field | Values | Required |
|-------|--------|----------|
| `status` | `complete` \| `blocked` \| `error` | yes |
| `pr_number` | number | when `complete` |
| `branch` | string | when `complete` |
| `tests_passed` | boolean | when `complete` |
| `touch_paths_honored` | boolean | when `complete` |
| `execution_mode` | `standard` \| `refactor-strict` \| `docs-only` | no, optional — absent defaults to `standard` |
| `task_type` | `feature` \| `bugfix` \| `refactor` \| `docs` | no, optional |
| `escalation_trigger` | `failed_attempts` \| `touch_paths_overrun` | no, optional — only meaningful on `status: blocked` |
| `evidence` | object `{ command: string, result: string }` | yes when `status: complete`; absent when `blocked`/`error` |
| `new_findings` | finding[] | no |
| `filed_issues` | number[] | no |

### `execution_mode` (optional — ADR-004)

Selects which TDD-mandate variant governs the implementer's session:

- `standard` — default (and the mode used when `execution_mode` is absent): unchanged
  failing-tests-first mandate.
- `refactor-strict` — the pre-existing test suite must pass **unmodified**; no new or
  deleted test files during the session.
- `docs-only` — failing-test-first mandate suppressed; Touch-Paths restricted to
  documentation paths. Also gates a Staleness/Drift-Check Table and per-code-block example
  verification (content spec stays in `implementer.md` § Execution Mode `docs-only` gate —
  `V-DRY`), audited by `reviewer.md` § 8.

**Non-goal for this issue**: no orchestrator/agent logic computes or passes
`execution_mode` yet — that derivation from `route.task_type` (`feature`/`bugfix` →
`standard`, `refactor` → `refactor-strict`, `docs` → `docs-only`) is future work (`router`
agent, #95; orchestrator dispatch, #93). This field is documentation of future intent, not
a behavior claim about the current codebase.

### `task_type` (optional — ADR-004)

Mirrors the plan frontmatter's `task_type: bugfix` stamp (`planner.md` § Quick Track) when the
implementer's Bugfix Gate applies. Values reuse `TASK_TYPES` verbatim
(`scripts/validate-worker-json.ts:21`): `feature` \| `bugfix` \| `refactor` \| `docs`.

**Non-goal for this issue**: no orchestrator/router logic computes or passes `route.task_type`
to implementer at spawn time yet — this field is documentation of future intent, not a behavior
claim about the current codebase, mirroring `execution_mode`'s own disclaimer above.

### `escalation_trigger` (optional — ADR-004)

Signals why an implementer session stopped and returned `status: blocked` for one of the Bugfix
Gate's two escalation triggers (`implementer.md` § Bugfix Gate): `failed_attempts` (2 distinct
failed fix attempts) or `touch_paths_overrun` (fix needs 3+ files beyond the plan's declared
Touch-Paths). Single-valued (unlike the array-shaped `failing_checks`) — the worker stops at the
first trigger it hits, it does not accumulate multiple in one session.

**Consumer status**: `escalation_trigger` is now read by the orchestrator's escalation dispatch
(`orchestrator.md` § Escalation dispatch, #137) — an `implementer` returning `status: blocked`
with this field set is routed to a direct `investigator` (`sub_mode: investigate`) spawn instead
of a blind `implementer` re-spawn.

See `implementer.md` § Bugfix Gate for the Scout Check / Improvement Record convention the same
gate also produces (content spec stays there — `V-DRY`).

### `evidence` (required for `status: complete` — ADR: verification-evidence gate, issue #204)

Object `{ command: string, result: string }` produced by `implementer.md` § Verification
Evidence Gate's RUN/READ/VERIFY steps: `command` is the primary verification command actually
executed (test suite, or lint+test combined for a Quick-track doc change); `result` is the
verbatim last/summary result line of that command's output — not a paraphrase.

**Non-goal for this issue**: `scripts/validate-worker-json.ts` does not yet structurally
enforce this field's presence or shape, and no fixture under `fixtures/worker-json/`
exercises it — both are out of this issue's declared Touch-Paths. Wiring structural
enforcement (a `verify.evidence-gate.test.ts` content-assertion check plus a fixture update)
is recommended as a follow-up issue.

## Reviewer (`reviewer`)

```json
{
  "status": "complete",
  "findings": [
    {
      "vcode": "V-KISS-03",
      "severity": "BLOCK",
      "file": "src/db/client.ts",
      "line": 42,
      "summary": "Empty catch block in query wrapper"
    }
  ],
  "recheck": [
    { "finding_id": "F-00042", "verdict": "fixed", "evidence": "L.128 now validates input before query" }
  ]
}
```

| Field | Values | Required |
|-------|--------|----------|
| `status` | `complete` \| `error` | yes |
| `findings` | finding[] | yes (empty array = no issues found) |
| `error` | string | when `status: error` |
| `recheck` | `{finding_id, verdict, evidence}[]` | required only when the reviewer was dispatched in recheck mode (`review-core.md` § Recheck mode); absent/omitted for a normal full-audit review |

### `recheck` (optional — recheck-mode fast path, issue #214)

Carries one entry per prior finding named in the recheck-mode prompt, verifying whether the
fix commits resolved it:

- `finding_id` — the existing ledger `F-NNNNN` id (`findings-ledger.md`) of the prior finding
  being rechecked, not a new id scheme.
- `verdict` — `fixed` \| `not_fixed`. `not_fixed` is treated identically to a `BLOCK` finding
  for that same `finding_id` — the reviewer must also emit a corresponding `findings` entry
  when `verdict: not_fixed`, so the aggregate script and LGTM gate need no special-casing for
  `recheck`.
- `evidence` — a short concrete pointer (e.g. `file:line` + what changed) showing why the
  finding is judged fixed or not — not a restatement of the original finding summary.

### Finding shape (shared)

```json
{
  "vcode": "V-DRY-01",
  "severity": "BLOCK",
  "file": "lib/foo.ts",
  "line": 42,
  "summary": "Description",
  "gain": 7,
  "effort": 2
}
```

`gain` and `effort` required only for `V-PARETO-02` findings.

## Router (`router`)

```json
{
  "status": "routed",
  "route": {
    "needs_split": false,
    "needs_clarification": false,
    "needs_research": false,
    "needs_investigation": true,
    "needs_design": false,
    "task_type": "bugfix",
    "plan_mode": "quick",
    "security_review_required": false,
    "docs_impact": false,
    "confidence": { "split": 95, "design": 80, "plan_mode": 70, "security": 90, "docs": 85 },
    "body_hash": "<sha of issue title+body at classification time>",
    "computed_at_phase": "handle",
    "revision": 1
  },
  "trigger": "initial",
  "local_analyze": null
}
```

| Field | Values | Required |
|-------|--------|----------|
| `status` | `routed` \| `error` | yes |
| `route` | object | when `routed` (`null` when `error`) |
| `trigger` | `initial` \| `clarify-resolved` \| `research-landed` \| `investigation-landed` | when `routed` |
| `local_analyze` | object \| `null` | when `routed` (`null` when `error`, or when the confidence-boost mechanism did not trigger) |
| `error` | string | when `status: error` |

`route`'s own field names, enum values, and types are frozen — see `queue-dag.md` § `route`
object (not re-tabulated here). `local_analyze`'s shape (`triggered`, `reason`,
`touch_paths_scanned`, `matches[]`, `security_review_required_raised`,
`plan_mode_confidence_boosted`) is frozen — see `findings-ledger.md` § "Routing decision
records" (not re-tabulated here). The router never writes `queue.json` or
`findings-ledger.json` directly (single-writer-orchestrator invariant, `blackhole-state.md` §
Single-writer invariant): the orchestrator constructs and appends the `routing_decisions`
ledger row — assigning `id` from `next_routing_id`, `issue_ref` from spawn context, and
`created_at` = now — from this returned JSON, at triage time (`orchestrator.md` § Triage).

```json
{
  "status": "error",
  "route": null,
  "trigger": "initial",
  "local_analyze": null,
  "error": "gh issue view failed: not found"
}
```

## Investigator (`investigator`)

```json
{
  "status": "complete",
  "note_path": "plans/issue-298-investigation.md",
  "sub_mode": "investigate",
  "confidence": 85,
  "computed_at_revision": 2
}
```

| Field | Values | Required |
|-------|--------|----------|
| `status` | `complete` \| `error` | yes |
| `note_path` | string | when `complete` |
| `sub_mode` | `research` \| `investigate` | when `complete` |
| `confidence` | number 0-100 | when `complete` |
| `computed_at_revision` | number (= `route.revision` at spawn time) | when `complete` |
| `error` | string | when `status: error` |

```json
{
  "status": "error",
  "note_path": null,
  "sub_mode": "investigate",
  "confidence": null,
  "computed_at_revision": null,
  "error": "gh issue view failed: not found"
}
```

The note file itself (not this JSON envelope) carries its own fixed frontmatter — `issue`,
`sub_mode`, `confidence`, `computed_at_revision` — plus required sections per sub-mode
(`investigate` → Symptoms/Hypotheses/Root Cause/Resolution; `research` → Executive
Summary/Findings/Sources). Full behavioral spec: `investigator.md` (not duplicated here).

**Path convention**: `plans/issue-N-research.md` (research sub-mode) or
`plans/issue-N-investigation.md` (investigate sub-mode) — co-located with `plans/issue-N.md`,
mirroring `planner.md`'s Design Track sibling-artifact convention (`plans/issue-N-design.md`).

## Hunter (`hunter`)

```json
{
  "status": "complete",
  "kind": "quickwins",
  "wave": 3,
  "territory": {
    "bands_scanned": ["src/agents", "src/references"],
    "exhausted": false
  },
  "findings": [
    {
      "kind": "quickwins",
      "file": "src/agents/orchestrator.md",
      "line": 88,
      "summary": "Dead conditional branch never reached after ADR-004 routing landed",
      "evidence_snippet": "if (route.needs_split && false) { ... }",
      "rationale": "The `&& false` makes this branch unreachable; safe deletion reduces confusion for future readers",
      "gain": 4,
      "effort": 1,
      "severity": "LOW",
      "verification": "CONFIRMED"
    }
  ]
}
```

| Field | Values | Required |
|-------|--------|----------|
| `status` | `complete` \| `error` | yes |
| `kind` | one of `kaizen.kinds` (e.g. `quickwins`, `best-practices`, `coverage`, `refactor`, `bug`) | yes |
| `wave` | number | yes — matches `hunt_state.kinds.<kind>.waves` at spawn time + 1 |
| `territory.bands_scanned` | string[] | yes — bands scanned during this wave, merged into `hunt_state.kinds.<kind>.bands_done` on completion |
| `territory.exhausted` | boolean | yes — whether no unscanned bands remain for this kind |
| `findings` | finding[] | yes (empty array = nothing found this wave) |
| `error` | string | when `status: error` |

### Finding shape (Hunter)

| Field | Values | Required |
|-------|--------|----------|
| `kind` | matches envelope `kind` | yes |
| `file` | string | yes |
| `line` | number | yes |
| `summary` | string | yes |
| `evidence_snippet` | string | yes — verbatim excerpt proving the finding is real, not hypothetical |
| `rationale` | string | yes |
| `gain` | number 1-10, per the kind's calibration table | yes |
| `effort` | number 1-10, per the kind's calibration table | yes |
| `severity` | `LOW` \| `MEDIUM` \| `HIGH` \| `BLOCK` | yes |
| `verification` | `CONFIRMED` \| `STALE` | yes |

The hunter runs its verification pass unconditionally before returning: only `CONFIRMED`
findings may be filed as issues — filing an unverified finding is `V-HUNT-01` (BLOCK).
`STALE` findings (evidence no longer matches current source) are dropped, never filed.
`gain`/`effort` are 1-10, anchored by the kind's calibration table (`src/references/hunt/`,
issue #198) — the hunter itself does not compute `Priority`; the orchestrator computes
`Priority = Gain * (11 - Effort)` and gates filing against `kaizen.min_priority` and
`kaizen.max_issues_per_wave` — a wave that files more issues than `max_issues_per_wave`, or
below `min_priority`, is `V-HUNT-02` (WARN). One wave per spawn: the hunter never loops
internally across waves.

```json
{
  "status": "error",
  "kind": "quickwins",
  "wave": null,
  "territory": null,
  "findings": [],
  "error": "gh issue view failed: not found"
}
```

## Review aggregate (`scripts/review-aggregate.ts`)

Orchestrator invokes after `reviewer` completes. Not a worker agent — deterministic script output:

```json
{
  "status": "approved",
  "findings": [],
  "blockers_count": 0,
  "lgtm": true,
  "pareto_candidates": []
}
```

| Field | Values | Required |
|-------|--------|----------|
| `status` | `approved` \| `changes_requested` \| `error` | yes |
| `findings` | finding[] | yes |
| `blockers_count` | number | yes |
| `lgtm` | boolean | yes |
| `pareto_candidates` | `{ summary, priority, file }[]` | yes (may be empty) |
| `error` | string | when `status: error` |

CLI: `bun run scripts/review-aggregate.ts --reviewer-file <path> --issue-ref <N> [--pr-ref <P>] [--prior-file <ledger-rows.json>]`

## Orchestrator validation

Before ledger append or phase transition:

1. Parse worker JSON; on parse failure → treat as worker error, do not advance phase
2. For implementer: reject if `touch_paths_honored === false` or `tests_passed === false`
3. Run `scripts/review-aggregate.ts` on reviewer output; route to implement only when `lgtm === false` and `review_iteration < 5`
4. Append aggregate `findings` to ledger with `phase: review` and `pr_ref` set

### Barrier triage

After a background worker batch barrier completes (`orchestrator.md` § Background worker barrier):

1. **Barrier complete** → validate each worker JSON (`scripts/validate-worker-json.ts`) **before** mutating `queue.json`.
2. **Idempotency:** if `route{}`, plan file, or PR already satisfies the phase gate, log skip and advance without re-spawn.
3. **Validation failure:** classify per `orchestrator.md` § Error Classification (sole
   taxonomy, not restated here) before deciding retry vs escalate — **Transient** → retry
   ≤2 with backoff; **Permanent** → report with actionable context and append a
   Failed-Approaches entry (`checkpoint-protocol.md` § Failed-Approaches Log);
   **Partial/Corruption** → verify artifacts, resume from checkpoint. Keep the issue
   `in-flight`, do not end the orchestrator turn until the error is routed.

The SubagentStop **validate** hook checks JSON at handoff; the **resume** hook (#154) automates the outer coordinator loop via `resume-request.json` and an orchestrator→coordinator doorbell only. Inner-loop continuity remains the orchestrator in-turn `Await` barrier (#151) — worker stops do not inject `followup_message` to the orchestrator.

### Blocked-iteration escalation (orchestrator → coordinator)

**Not a new worker JSON contract** — no `status`/`route` fields. A plain-text signal
riding on the existing `CHECKPOINT` session-handoff line
(`checkpoint-protocol.md` § Session handoff), fired when the Blocked-Iteration
Escalation rule (`orchestrator.md` § Human-in-the-Loop (HITL) & Blocker Gating) trips at
count `3` for one or more issues: the `CHECKPOINT` line's optional
`| BLOCKED-ESCALATED: #<issue>[,#<issue>...]` trailing segment lists them, so the
campaign never loops silently on a blocked issue.
