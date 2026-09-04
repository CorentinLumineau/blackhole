# Worker Return Schemas

Structured JSON contracts for campaign worker agents. The orchestrator validates worker output against these shapes before mutating state.

Optional: consumers may install the Cursor SubagentStop hook documented in [`hook-schemas.md`](hook-schemas.md) for machine-enforced structural validation at subagent handoff.

On a harness with a native orchestration primitive (Pattern C, see
[claude-code-native.md](claude-code-native.md)), a `schema:` option on the fan-out tool call can
mechanically enforce these same contracts at the tool-call layer — the JSON shapes below are the
schema source, unchanged. This complements, not replaces, the SubagentStop hook / `validate-worker-json.ts`
path documented in [`hook-schemas.md`](hook-schemas.md) for harnesses without a native fan-out primitive.

See [`hook-schemas.md`](hook-schemas.md) for the Cursor SubagentStop validate/resume hook
install specs and the PreToolUse `.blackhole/hook-events/` schema (split out, issue #473).

See [`implementer-schemas.md`](implementer-schemas.md) for the `implementer` worker's JSON
return contract (split out, issue #802).

## Planner (`planner`)

```json
{
  "status": "ready",
  "plan_path": "plans/issue-298.md",
  "track": "standard",
  "failing_checks": [],
  "clarification_markers": 0,
  "reformulation": {
    "understood": "What the planner understood the issue requires.",
    "assumed": "Assumptions taken to proceed without live confirmation.",
    "if_wrong": "What would change if an assumption is wrong — enough for an owner veto."
  }
}
```

| Field | Values | Required |
|-------|--------|----------|
| `status` | `ready` \| `blocked` \| `error` | yes |
| `plan_path` | string | when `ready`, **or** when `blocked` and `track: design` |
| `track` | `quick` \| `standard` \| `skip` \| `design` \| `brainstorm` | when `ready`, or when `blocked` and caller knows the track |
| `failing_checks` | string[] | when `blocked` |
| `clarification_markers` | number | when `ready` or `blocked` |
| `reformulation` | object — `reformulation.understood`, `reformulation.assumed`, `reformulation.if_wrong` (each non-empty string) | when `status: ready` and `track` is `quick` or `standard` — async veto surface; orchestrator posts per `phase-plan.md` § Reformulation posting (`confidence-gates.md`); absent when `blocked`; exempt for `skip`/`design`/`brainstorm` |
| `rulings_checked_at` | number | no — present only when the ledger was read |
| `ruling_conflicts` | `ruling_conflict[]` | no — defaults to `[]`; required (possibly empty) when `rulings_checked_at` is present — see § Rulings ledger (planner read-input) below |

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
- `ac_mapping` — acceptance criteria mapped to tasks; sibling mechanical checks `critical_files_exist` / `mitigation_concrete` — Critical Files Glob-miss and Execution Strategy vague-mitigation (Standard track only, mercure `x-plan` parity, issue #459); all three computed by `bun run scripts/plan-quality-gate.ts --plan-file <path>` (issue #716), copied verbatim into `failing_checks`
- `ac_sweep_conflict` / `ac_sweep_scope` / `touch_paths_ssot_gap` — advisory-only plan-time heuristics (sweep/retain overlap, unscoped sweep AC, Touch-Paths SSOT gaps via `findTouchPathSsotGaps`) — `ADVISORY:` rows or Quick Track `## Touch-Paths Completeness Advisory`; never `failing_checks` (#575)
- `clarification_limit` — at most 2 `[NEEDS CLARIFICATION]` markers
- `base_commit` — `plan_base_commit` stamped in frontmatter
- `design_pending_approval` — design track artifact produced at `plan_path`; blocked pending the
  **mandatory** human gate (ADR-004: "no confidence bypass, human always decides"). Not a
  quality-gate failure — the design track is *always* blocked by design, regardless of how
  complete or unambiguous the design note is. The artifact at `plan_path` carries the full
  analytical substance (Options + trade-off matrix, adversarial evaluation via multiplicity,
  component decomposition, design principles validation, refactoring impact analysis, assumption
  audit) per `planner.md`'s Design Track template — content only, no JSON field change.
  **ADR-010 D4 amendment**: when `autonomy.design_autonomy` is `true`, this
  check is replaced by `scripts/design-aggregate.ts`'s deterministic verdict — see
  `planner.md` §4.8 and the `design-aggregate` schema below. `design_pending_approval` remains
  the unconditional outcome whenever that sub-flag is off.
- `brainstorm_confidence_below_threshold` — brainstorm track composite confidence
  (`confidence-gates.md`) fell below `autonomy.confidence_threshold`; `blocking_question` names
  the specific product ambiguity (see § Brainstorm track below).
- `ui_pending_approval` — Quick/Standard track plan produced a `## UI Interpretation Gate`
  section (mockup + Owner said/I interpreted/Open ambiguities); blocked pending the owner's
  review of the interpretation, stamped `ui_gate: pending` in frontmatter (ADR-017). **Narrower
  than `design_pending_approval`**: `design_pending_approval` blocks *unconditionally* regardless
  of plan completeness (Design Track's whole point); `ui_pending_approval` fires only when
  `route.ui: true` **and** the issue is above trivial size (`size:xs` exempt) — the plan itself
  is otherwise complete and ready, the block is narrowly on the human interpretation-review, not
  on plan quality generally. The orchestrator, not the planner, flips `ui_gate: pending` →
  `ui_gate: approved` after the owner signals approval via the existing clarify gate — see
  `orchestrator-delegation.md` § Planner gate.

### Brainstorm track (optional — ADR-010 D3)

```json
{
  "status": "ready",
  "plan_path": ".blackhole/plans/issue-298-brainstorm.md",
  "track": "brainstorm",
  "artifact_path": "documentation/brainstorms/cashflow-v3-idea.md",
  "children": [
    {
      "title": "Add CSV export for cashflow ledger",
      "body": "Users need to export the cashflow ledger as CSV for offline analysis.",
      "acceptance_criteria": [
        "Export button present on the ledger view",
        "CSV includes date, amount, category columns"
      ],
      "size_estimate": "s",
      "suggested_route": { "task_type": "feature", "plan_mode": "quick" },
      "gain": 6,
      "effort": 3
    }
  ],
  "failing_checks": [],
  "clarification_markers": 0
}
```

| Field | Values | Required |
|-------|--------|----------|
| `artifact_path` | string | when `status: ready` and `track: brainstorm` |
| `children` | `child[]` | when `status: ready` and `track: brainstorm` |

`children[]` field shape (`validateBrainstormChild`, `scripts/validate-worker-json.ts`):

| Field | Values | Required |
|-------|--------|----------|
| `title` | non-empty string | yes |
| `body` | non-empty string | yes |
| `acceptance_criteria` | non-empty string[] | yes |
| `size_estimate` | `xs` \| `s` \| `m` \| `l` \| `xl` | yes |
| `suggested_route` | object `{ task_type, plan_mode }` — values from the existing `TASK_TYPES`/`PLAN_MODES` enums | yes |
| `gain` | number 1-10 | yes |
| `effort` | number 1-10 | yes |

```json
{
  "status": "blocked",
  "track": "brainstorm",
  "blocking_question": "Should the cashflow forecast be per-account or aggregated across all accounts?",
  "failing_checks": ["brainstorm_confidence_below_threshold"],
  "clarification_markers": 0
}
```

| Field | Values | Required |
|-------|--------|----------|
| `blocking_question` | non-empty string | when `status: blocked` and `track: brainstorm` |

### Rulings ledger (read-input)

`planner.md` § Step 3 reads `documentation/reference/product-principles.md` (the owner-rulings
ledger) as read-input when present, gated by `docs_governance.companion_files`. A plan conflicting
with an `active`-status ruling still surfaces as a `[NEEDS CLARIFICATION]` marker in the plan
output, counted by the existing `clarification_markers` field above.

**Issue #422 — ruling watermark + phase-gate re-validation** adds two optional fields, consuming
the § Step 3 read above rather than a second read path (`V-DRY-01`), so the orchestrator can stamp
a per-issue watermark and aggregate an owner-facing conflict list:

```json
{
  "status": "ready",
  "plan_path": ".blackhole/plans/issue-422.md",
  "track": "standard",
  "failing_checks": [],
  "clarification_markers": 0,
  "rulings_checked_at": 7,
  "ruling_conflicts": [
    {
      "ruling_id": "R-007",
      "summary": "Plan task T4 adds expense rows to the monthly TODO; ruling R-007 excludes expenses from the TODO.",
      "suggested_disposition": "amend"
    }
  ]
}
```

`ruling_conflicts[]` field shape (`validateRulingConflictEntry`, `scripts/lib/worker-json/validators/planner.ts`):

| Field | Values | Required |
|-------|--------|----------|
| `ruling_id` | string matching `^R-\d{3}$` | yes |
| `summary` | non-empty string | yes |
| `suggested_disposition` | `close` \| `amend` \| `proceed` (`RULING_DISPOSITIONS`) | yes |

`rulings_checked_at` is the frontmatter `rulings_revision` the planner read (absent means the
ledger was not read). An empty `ruling_conflicts` alongside `rulings_checked_at` is the explicit
all-clear that authorizes the orchestrator to stamp `queue.json`'s `rulings_checked_at` watermark
(§ Barrier triage below; `queue-dag.md` field rules); a non-empty array instead sends the issue to
`status: blocked`, `notes: awaiting-ruling-recheck`.

## Design Track Critic (blind sub-invocation)

Returned by the Design Track's two critique-only sub-invocations described in `planner.md` §4.3
(Adversarial Evaluation) — **not** a new agent identity: still `subagent_type: planner`, no
`disallowedTools`/matcher change to the SubagentStop hook. Extracted from the sub-invocation's
final plain-text response using the same fenced-block-first / brace-balanced-fallback order
documented in `hook-schemas.md` (SubagentStop hook § Extraction order, `hook-schemas.md:11`).

```json
{
  "per_option_scores": {
    "Option A": { "Risk": 4, "Maintainability": 3 },
    "Option B": { "Risk": 2, "Maintainability": 5 }
  },
  "findings": [
    {
      "option": "Option A",
      "tag": "discriminating",
      "severity": "CRITICAL",
      "note": "Option A introduces an unreviewed auth bypass under concurrent writes"
    }
  ],
  "adr_citations": [
    { "adr": "ADR-007", "option": "Option A", "amendment_acknowledged": true }
  ]
}
```

| Field | Values | Required |
|-------|--------|----------|
| `per_option_scores` | `{ [option]: { [column]: number } }` — one entry per option in the primary's provisional trade-off matrix (stripped of the primary's Chosen field before spawn), scored 1-5 against `design-rubric.md`'s fixed columns/weights for this decision's type | yes |
| `findings` | `{ option, tag, severity, note }[]` | yes (empty array = no findings) |
| `adr_citations` | `{ adr, option, amendment_acknowledged }[]` — one entry per ADR a `findings[].note` cites as evidence (`planner.md` §4.3's ADR citation check, issue #775); critics score independently and cannot rely on the primary planner having done this check | no (omit when no finding cites an ADR) |

### Finding shape (Design Track Critic)

| Field | Values | Required |
|-------|--------|----------|
| `option` | string, matches a key in `per_option_scores` | yes |
| `tag` | `discriminating` \| `domain-inherent` | yes |
| `severity` | `CRITICAL` \| `NOTABLE` \| `MINOR` | yes |
| `note` | string | yes |

Consumed by `scripts/design-aggregate.ts` (see below) as one of the 2 blind-critic inputs
alongside the primary's own weighted matrix — never as free-text critique. A `discriminating` +
`CRITICAL` finding tagged on the winning option blocks the verdict; a `domain-inherent` +
`CRITICAL` finding on the winner does not (see the `design-aggregate` schema's reasons vocabulary
below).

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
      "summary": "Empty catch block in query wrapper",
      "verification_mode": "executed"
    }
  ],
  "recheck": [
    { "finding_id": "F-00042", "verdict": "fixed", "evidence": "L.128 now validates input before query" }
  ],
  "verification": [
    { "finding_id": "V1", "verdict": "refuted", "evidence": "input is validated at L.40 — exploit path not reproducible" }
  ],
  "verification_legs": [
    { "direction": "Authorization bypass via role param tampering", "mode": "reasoned", "evidence": "Read role-check middleware; no probe run — with-test-lock was contended" }
  ]
}
```

| Field | Values | Required |
|-------|--------|----------|
| `status` | `complete` \| `error` | yes |
| `findings` | finding[] | yes (empty array = no issues found) |
| `error` | string | when `status: error` |
| `recheck` | `{finding_id, verdict, evidence}[]` | required only when the reviewer was dispatched in recheck mode (`review-core.md` § Recheck mode); absent/omitted for a normal full-audit review |
| `verification` | `{finding_id, verdict, evidence}[]` | required only when the reviewer was dispatched in independent security verification mode (`review-core.md` § Independent security verification, `reviewer.md` § 24); absent/omitted for every other dispatch |
| `verification_legs` | `{direction, mode, evidence}[]` | optional — ADR-036 (issue #815); a clean/negative investigation leg that produced no `Finding` object |

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

`--prior-file` rows passed to `review-aggregate.ts` must carry the ledger `id` field (issue
#485) for a `recheck[]` `verdict: fixed` entry to resolve against them; a missing or mismatched
`id` surfaces in `unresolved_recheck` above, not silently.

### `verification` (optional — independent security verification mode, issue #439)

Carries one entry per stamped `V-SEC-*` finding the reviewer was dispatched to independently
judge (`review-core.md` § Independent security verification, `reviewer.md` § 24) — a sibling
shape to `recheck` above, distinct meaning: `recheck` verifies whether a fix commit resolved a
*prior, ledgered* finding; `verification` verifies whether a *fresh, same-pass* finding
independently holds up.

- `finding_id` — the temporary, review-pass-scoped id (e.g. `V1`, `V2`, ...) the orchestrator
  stamped onto the finding before including it in this dispatch's prompt — not a ledger
  `F-NNNNN` id (none exists yet at this point in the pipeline; see `review-core.md` §
  Independent security verification step 3).
- `verdict` — `confirmed` \| `refuted`. `refuted` downgrades the matching `BLOCK` finding to
  `WARN` before `applyConfidenceGate`/`dedupeFindings` run (`scripts/review-aggregate.ts`'s
  exported `applyVerificationDowngrades`) — it never excludes the finding outright, unlike
  `recheck`'s `fixed` verdict; a `confirmed` verdict, or a `finding_id` with no match among the
  primary's stamped findings, is a no-op.
- `evidence` — a concrete pointer showing what was checked and why the exploit path did or did
  not hold — not a restatement of the original finding's summary.

Passed to `review-aggregate.ts` via `--verification-file` (see § Review aggregate below) as a
plain JSON array — distinct from `--prior-file`'s ledger-row shape.

### `verification_legs` (optional — executed vs. reasoned disclosure, ADR-036 / issue #815)

A JSON home for a **clean/negative investigation leg** (checked something, found no `Finding`) — not named `verification`, already used twice (the array above, `hunter`'s `CONFIRMED`/`STALE` field). Fields: `direction`, `mode` (`executed` \| `reasoned`), `evidence` (for `reasoned`, why execution was unavailable, e.g. `with-test-lock` contention). Never grounds to bypass `with-test-lock`. See `reviewer.md` § 32 / `review-core.md` § Security-mode review (`V-SEC-12`).

### Rulings ledger (read-input)

`reviewer.md` § 19 "Owner-Ruling Violation Audit" reads `documentation/reference/
product-principles.md` (the owner-rulings ledger) when present, gated by
`docs_governance.companion_files`. A diff contradicting an `active`-status ruling's
`Interpretation` field surfaces as a normal `findings[]` entry with `vcode: "V-RULE-01"`,
`severity: "BLOCK"` — no dedicated JSON field beyond the shared Finding shape below.

### Finding shape (shared)

```json
{
  "vcode": "V-DRY-01",
  "severity": "BLOCK",
  "file": "lib/foo.ts",
  "line": 42,
  "summary": "Description",
  "gain": 7,
  "effort": 2,
  "verification_mode": "executed"
}
```

`gain` and `effort` required only for `V-PARETO-02` findings.

`verification_mode` (optional — `executed` \| `reasoned`, ADR-036 / issue #815): execution vs. reasoning-only basis; absence means no claim made.

## Router (`router`)

<!-- shape: exhaustive -->
```json
{
  "status": "routed",
  "route": {
    "needs_split": false,
    "needs_clarification": false,
    "needs_research": false,
    "needs_investigation": true,
    "needs_design": false,
    "needs_brainstorm": false,
    "needs_analysis": false,
    "task_type": "bugfix",
    "plan_mode": "quick",
    "security_review_required": false,
    "docs_impact": false,
    "ui": false,
    "confidence": { "split": 95, "design": 80, "plan_mode": 70, "security": 90, "docs": 85, "brainstorm": 20, "analysis": 70, "ui": 85 },
    "body_hash": "<sha of issue title+body at classification time>",
    "computed_at_phase": "handle",
    "revision": 1
  },
  "trigger": "initial",
  "local_analyze": null,
  "rationale": "plan_mode confidence 55 is below threshold 70; cautious full plan_mode default applies pending local-analyze scan."
}
```

| Field | Values | Required |
|-------|--------|----------|
| `status` | `routed` \| `error` | yes |
| `route` | object | when `routed` (`null` when `error`) |
| `trigger` | `initial` \| `clarify-resolved` \| `research-landed` \| `investigation-landed` \| `analysis-landed` | when `routed` |
| `local_analyze` | object \| `null` | when `routed` (`null` when `error`, or when the confidence-boost mechanism did not trigger) |
| `rationale` | string (≤500 chars, non-empty when present) | no — when any `route.confidence.<flag>` is below its threshold; orchestrator copies verbatim into `routing_decisions` |
| `error` | string | when `status: error` |

`route`'s own field names, enum values, and types are frozen — see `queue-dag.md` § `route`
object (not re-tabulated here). `local_analyze`'s shape (`triggered`, `reason`,
`touch_paths_scanned`, `matches[]`, `security_review_required_raised`,
`plan_mode_confidence_boosted`) is frozen — see `findings-ledger.md` § "Routing decision
records" (not re-tabulated here). The router never writes `queue.json` or
`findings-ledger.json` directly (single-writer-orchestrator invariant, `blackhole-state.md` §
Single-writer invariant): the orchestrator constructs and appends the `routing_decisions`
ledger row — assigning `id` from `next_routing_id`, `issue_ref` from spawn context, and
`created_at` = now — from this returned JSON, at triage time (`orchestrator-runtime.md` § Triage).

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

Analyze sub-mode example:

```json
{
  "status": "complete",
  "note_path": "plans/issue-298-analysis.md",
  "sub_mode": "analyze",
  "confidence": 75,
  "computed_at_revision": 1
}
```

| Field | Values | Required |
|-------|--------|----------|
| `status` | `complete` \| `blocked` \| `error` | yes |
| `note_path` | string | when `complete` or `blocked` |
| `sub_mode` | `research` \| `investigate` \| `analyze` | when `complete` or `blocked` |
| `confidence` | number 0-100 | when `complete` or `blocked` |
| `computed_at_revision` | number (= `route.revision` at spawn time) | when `complete` or `blocked` |
| `escalation_trigger` | `hypotheses_exhausted` | when `blocked` (`investigate` sub-mode's only blocked path) |
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
Summary/Findings/Sources; `analyze` → Conventions Catalog/Architecture Coherence/Performance
Baselines). Full behavioral spec: `investigator.md` (not duplicated here).

**Path convention**: `plans/issue-N-research.md` (research sub-mode),
`plans/issue-N-investigation.md` (investigate sub-mode), or `plans/issue-N-analysis.md` (analyze
sub-mode) — co-located with `plans/issue-N.md`, mirroring `planner.md`'s Design Track
sibling-artifact convention (`plans/issue-N-design.md`).

### `escalation_trigger` (required when `blocked` — `investigate` sub-mode only, issue #454)

Shares the Implementer section's field/shape (`V-INT-03`). Always set to `hypotheses_exhausted`
when the ranked hypothesis set — including the regenerated attempt (`investigator.md` §
`investigate` sub-mode) — is fully refuted without a confirmed root cause; `note_path` is still
present (the investigator always writes its note). The investigator never omits this field and
never tracks its own escalation history — it reports exhaustion identically every time. Whether
this is a first or bounded second exhaustion is orchestrator-side state, tracked solely via
`queue.json` `notes` by `orchestrator-dispatch.md` § Investigator Escalation Dispatch, and never
signaled through this field's presence or absence.

```json
{
  "status": "blocked",
  "note_path": "plans/issue-298-investigation.md",
  "sub_mode": "investigate",
  "confidence": 40,
  "computed_at_revision": 2,
  "escalation_trigger": "hypotheses_exhausted"
}
```

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
  "pareto_candidates": [],
  "unresolved_recheck": []
}
```

| Field | Values | Required |
|-------|--------|----------|
| `status` | `approved` \| `changes_requested` \| `error` | yes |
| `findings` | finding[] | yes |
| `blockers_count` | number | yes |
| `lgtm` | boolean | yes |
| `pareto_candidates` | `{ summary, priority, file }[]` | yes (may be empty) |
| `unresolved_recheck` | `{ finding_id, verdict, reason }[]` | yes (may be empty) — issue #485: a `recheck[]` `verdict: fixed` entry whose `finding_id` could not be linked to any prior finding's ledger `id`; non-empty forces `lgtm: false` |
| `error` | string | when `status: error` |

Each `findings[]` entry additionally carries `issue_ref: number` and `pr_ref: number | null`
stamped by the script (issue #754) — never present on the raw `reviewer` input's Finding shape
above, only on this aggregator's stamped output.

CLI: `bun run scripts/review-aggregate.ts --reviewer-file <path> --issue-ref <N> [--pr-ref <P>] [--prior-file <ledger-rows.json>] [--verification-file <verification-entries.json>]`

`--verification-file` (issue #439, § `verification` above) points to the independent security
verification spawn's own `verification[]` array, serialized as a plain JSON array — omitted
entirely on every review pass that is not a security-mode PR's verification spawn, with no
change to `AggregateOutput`'s shape either way.

## Design aggregate (`scripts/design-aggregate.ts`)

Orchestrator/planner invokes when `autonomy.design_autonomy` is `true`
(`planner.md` §4.8, ADR-010 D4). Not a worker agent — deterministic script output the planner
reads but never overrides:

```json
{
  "status": "blocked",
  "winner": null,
  "reasons": ["dominance"],
  "scorer_results": [
    { "scorer": "primary", "winner": "Option A", "margin": 20 },
    { "scorer": "critic_a", "winner": "Option A", "margin": 20 },
    { "scorer": "critic_b", "winner": "Option A", "margin": 20 }
  ]
}
```

| Field | Values | Required |
|-------|--------|----------|
| `status` | `ready` \| `blocked` | yes |
| `winner` | string \| `null` — the winning option name when `ready`; always `null` when `blocked` | yes |
| `reasons` | `("dominance" \| "disagreement" \| "critical-finding" \| "breaking-consumer" \| "unverified-adr-citation" \| "malformed-input")[]` — every failed condition, `[]` when `ready` | yes |
| `scorer_results` | `{ scorer: "primary" \| "critic_a" \| "critic_b", winner: string \| null, margin: number \| null }[]` — `[]` on `malformed-input` (scoring never ran) | yes |
| `detail` | string | when a `malformed-input` reason needs a human-readable diagnostic |

`unverified-adr-citation` (issue #775) fires when any declared `adr_citations[]` entry — primary
or either critic — names an ADR whose ground-truth `has_amendment` (resolved from the live ADR
tree by the CLI entrypoint's `resolveAdrAmendmentTruth`, never self-reported) is `true` while
`amendment_acknowledged` is `false`. No new V-code — same convention as the four other reasons,
none of which carry one either.

CLI: `bun run scripts/design-aggregate.ts --input-file <path> [--repo-root <path>]`

## Partial result (`status: partial`, `stop --now` leg B, issue #492)

A worker's answer to the Flush Request (`orchestrator-handoff.md` § Flush request) — the response shape that
section deliberately left undefined. `status: partial` is now a valid value on every role's
status enum (`planner`, `implementer`, `reviewer`, `router`, `investigator`, `hunter`) via one
shared `PARTIAL_STATUS` constant appended to each role's enum array
(`scripts/lib/worker-json/constants.ts`) — composed onto each role's existing return shape,
never a parallel schema (`V-DRY-01`, the issue's own framing: "a partial result is not a
smaller complete result").

```json
{
  "status": "partial",
  "phase_reached": "implement",
  "partial_result": {
    "work_done": "Implemented the endpoint and its unit tests; PR not yet opened.",
    "work_remaining": "Open PR, run lint, write PR description.",
    "worktree_disposition": "pushed",
    "branch": "blackhole/issue-492"
  }
}
```

| Field | Values | Required |
|-------|--------|----------|
| `status` | `partial` | yes |
| `phase_reached` | `handle` \| `plan` \| `implement` \| `review` (`queue-dag.md`'s phase enum, reused) | yes |
| `partial_result.work_done` | non-empty string | yes |
| `partial_result.work_remaining` | non-empty string | yes |
| `partial_result.worktree_disposition` | `pushed` \| `clean` \| `dirty-uncommitted` | yes |
| `partial_result.branch` | string \| `null` | required when `worktree_disposition: pushed`, else `null` |

**Not a smaller `complete`.** `evidence` and `sprint_contract_status`/`ac_results[]` (§§ above)
stay absent — both hold conditions key on `status: complete` specifically
(`phase-implement.md` §§ Unverified-claim hold, Sprint Contract hold), which a partial return
never claims. The honesty bar is narrative (`work_done`/`work_remaining` non-empty,
structurally enforced by `scripts/validate-worker-json.ts`), deliberately weaker than
`evidence`'s `{command,result}` pair: a worker mid-flush inside its 20-minute grace window
(`phase-stop.md` § `stop --now` tier step 2) cannot always re-run verification before
returning.

**`worktree_disposition: dirty-uncommitted`** names the genuinely-incomplete case the issue
calls out — the Flush Request's obligation 3 ("commit and push whatever is already changed")
was not satisfiable in the grace window. It never authorizes worktree removal:
`blackhole-protocol.md` § Branch & Worktree Hygiene's dirty-check refusal applies exactly as to
any other dirty tree.

**Consumer**: `orchestrator-runtime.md` § Triage's Partial-result ingest procedure — queue
phase never advances past `phase_reached`; disposition and branch are recorded via the
existing free-form `notes` convention (`queue-dag.md`), never a new queue schema field.
<!-- GENERATED by scripts/build.ts from src/references/worker-schemas.md — do not hand-edit -->
