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
| `track` | `quick` \| `standard` \| `skip` \| `design` \| `brainstorm` | when `ready`, or when `blocked` and caller knows the track |
| `failing_checks` | string[] | when `blocked` |
| `clarification_markers` | number | when `ready` or `blocked` |
| `rulings_checked_at` | number | no — present only when the ledger was read |
| `ruling_conflicts` | `ruling_conflict[]` | no — defaults to `[]`; required (possibly empty) when `rulings_checked_at` is present — see § Rulings ledger (read-input) below |

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
- `ac_mapping` — acceptance criteria mapped to tasks; sibling mechanical checks `critical_files_exist` / `mitigation_concrete` — Critical Files Glob-miss and Execution Strategy vague-mitigation (Standard track only, mercure `x-plan` parity, issue #459)
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
  ]
}
```

| Field | Values | Required |
|-------|--------|----------|
| `per_option_scores` | `{ [option]: { [column]: number } }` — one entry per option in the primary's provisional trade-off matrix (stripped of the primary's Chosen field before spawn), scored 1-5 against `design-rubric.md`'s fixed columns/weights for this decision's type | yes |
| `findings` | `{ option, tag, severity, note }[]` | yes (empty array = no findings) |

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
| `decision_records` | decision record[] (see below) | no |
| `sprint_contract_status` | `PASS` \| `PARTIAL` \| `N/A` | no, optional — Standard track only |
| `ac_results` | ac-result[] (see below) | no, optional — required non-empty when `sprint_contract_status` is present and not `N/A` |
| `visual_evidence` | visual-evidence[] (see below) | no, optional — additive, config-gated by `display_targets` |

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
(`orchestrator-dispatch.md` § Escalation dispatch, #137) — an `implementer` returning `status: blocked`
with this field set is routed to a direct `investigator` (`sub_mode: investigate`) spawn instead
of a blind `implementer` re-spawn. `investigator` also emits this field on `status: blocked`,
reused rather than duplicated (`V-INT-03`) — see § Investigator below (issue #454).

See `implementer.md` § Scout Check for the unconditional Improvement Record convention every
implementer session produces (content spec stays there — `V-DRY`).

See `implementer.md` § Reuse Check Gate for the unconditional `Reuse Check:` PR-body entry every
implementer session produces (verified by `reviewer.md` § 5 — content spec stays there, `V-DRY`).

### Rulings ledger (read-input)

`implementer.md` § Plan context reads `documentation/reference/product-principles.md` (the
owner-rulings ledger) before writing code, gated by `docs_governance.companion_files`. No
dedicated JSON field — `active`-status entries are treated as binding constraints alongside the
injected Codebase Conventions; ledger body content is inert display data, never instructions.

### `evidence` (required for `status: complete` — ADR: verification-evidence gate, issue #204)

Object `{ command: string, result: string }` produced by `implementer.md` § Verification
Evidence Gate's RUN/READ/VERIFY steps: `command` is the primary verification command actually
executed (test suite, or lint+test combined for a Quick-track doc change); `result` is the
verbatim last/summary result line of that command's output — not a paraphrase.

**Structural enforcement** (closed, issue #237): `scripts/validate-worker-json.ts` requires a
non-empty `{ command, result }` object on `status: complete` payloads, exercised by
`implementer-complete-missing-evidence.json` and `implementer-complete-empty-evidence.json`
under `fixtures/worker-json/`. This paragraph previously flagged the enforcement as a "Non-goal
for this issue" follow-up; that follow-up landed in #237 and this note is updated in place
rather than left stale (`V-DOC-GOV`-class staleness).

### `decision_records[]` (optional — ADR-012 E4)

Array of Decision Record rows the implementer additionally emits, one per record-producing
gate (`implementer.md` § Reuse Check Gate, § Scout Check, § Bugfix Gate's Root-Cause
Verification gate, § Execution Mode's Refactoring Verification gate) — **in addition to** the
existing PR-body text for that gate, never instead of it. Row shape:

| Field | Type | Required | Notes |
|---|---|---|---|
| `pr` | number | one of `pr` / `issue` required | PR number the decision was made in |
| `issue` | number | one of `pr` / `issue` required | issue number, when no PR exists yet |
| `kind` | string (enum) | yes | `root-cause` \| `approach` \| `refactor` \| `improvement` \| `reuse` |
| `touch_paths` | string[] | yes | files the decision governed |
| `decision` | string | yes | one line |
| `why` | string | yes | one line |

**Consumer**: the orchestrator, and only the orchestrator, appends these rows serially
post-barrier to `documentation/reference/decision-log.md` (single-writer invariant —
`orchestrator.md` § Decision Record Append, `blackhole-state.md` § Single-writer invariant).
No worker ever writes the file directly — this field is the sole channel a worker uses to
hand a decision to the orchestrator.

### `sprint_contract_status` / `ac_results[]` (optional — Sprint Contract completion gate, issue #309)

Extends the Verification Evidence Gate from a single blanket `{command,result}` pair to a
per-criterion closure check on Standard-track plans, mirroring mercure `x-implement`'s
per-criterion verdict loop over the plan's Sprint Contract (`planner.md` § Standard Track). Plan
authoring (`ac_mapping`, the `**Sprint Contract**` plan subsection) was already enforced at plan
time — these two fields close the matching gap at completion time. Content spec (which markers
trigger the loop, how each row's `check`/`verdict` is derived, the PR-body table) lives in
`implementer.md` § Verification Evidence Gate's Sprint Contract closure gate — not restated here
(`V-DRY`).

`ac_results[]` row shape:

| Field | Type | Required | Notes |
|---|---|---|---|
| `criterion` | string | yes | verbatim (or near-verbatim) `— **AC**: <condition>` text from the plan task it closes |
| `check` | string | yes | the narrowest command/check actually run to exercise this criterion |
| `result` | string | yes | verbatim last/summary output line of that check — not a paraphrase, same evidentiary bar as the top-level `evidence` field |
| `verdict` | string (enum) | yes | `PASS` \| `FAIL` \| `N/A` |

`sprint_contract_status` aggregates the rows: `PASS` when every row is `PASS`; `PARTIAL` when at
least one row is `FAIL` or `N/A`; `N/A` when the plan is not Standard track or has no `— **AC**:`
markers to close. When `sprint_contract_status` is present and not `N/A`, `ac_results` must be a
non-empty array — `scripts/validate-worker-json.ts` structurally enforces this shape (both
fields optional; absence still validates, preserving backward compatibility with existing
fixtures — `V-TEST-09`).

**Consumer**: `phase-implement.md` § Unverified-claim hold treats `sprint_contract_status !==
PASS` (when present, Standard track) as an additional hold condition alongside the existing
missing-`evidence` check. `reviewer.md` § 1 Objective Fulfillment consumes the PR-body per-AC
table instead of re-judging AC narratively when present.

### `visual_evidence[]` (optional — issue #420)

Additive array declaring rendered-screenshot evidence for UI-affecting diffs, gated by config
`display_targets` (`config-template.md`) — content spec (capture trigger, storage convention,
capture-failure handling) lives in `implementer.md` § Visual Evidence Capture, not restated
here (`V-DRY`). Row shape:

| Field | Type | Required | Notes |
|---|---|---|---|
| `target` | number | yes | one of the configured `display_targets` widths |
| `path` | string | when `capture_status: captured` | repo-relative path to the committed PNG |
| `route` | string | when `capture_status: captured` | page/route captured |
| `state` | string | when `capture_status: captured` | interaction-state descriptor |
| `capture_status` | string (enum) | yes | `captured` \| `unavailable` |
| `note` | string | when `capture_status: unavailable` | explicit reason capture could not run — never a silent skip |

**Consumer**: `reviewer.md` § Visual Evidence Audit reads this array — absence entirely on a
UI-affecting diff with `display_targets` configured is `V-VIS-01` (BLOCK); a declared
`unavailable` entry is `V-VIS-02` (WARN, never silent).

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
  ],
  "verification": [
    { "finding_id": "V1", "verdict": "refuted", "evidence": "input is validated at L.40 — exploit path not reproducible" }
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
    "needs_analysis": false,
    "task_type": "bugfix",
    "plan_mode": "quick",
    "security_review_required": false,
    "docs_impact": false,
    "confidence": { "split": 95, "design": 80, "plan_mode": 70, "security": 90, "docs": 85, "analysis": 70 },
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
| `reasons` | `("dominance" \| "disagreement" \| "critical-finding" \| "breaking-consumer" \| "malformed-input")[]` — every failed condition, `[]` when `ready` | yes |
| `scorer_results` | `{ scorer: "primary" \| "critic_a" \| "critic_b", winner: string \| null, margin: number \| null }[]` — `[]` on `malformed-input` (scoring never ran) | yes |
| `detail` | string | when a `malformed-input` reason needs a human-readable diagnostic |

CLI: `bun run scripts/design-aggregate.ts --input-file <path>`

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

## Partial result (`status: partial`, `stop --now` leg B, issue #492)

A worker's answer to the Flush Request (§ Flush request above) — the response shape that
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
