# Implementer Schemas

Structured JSON return contract for the `implementer` campaign worker agent. Split out of [`worker-schemas.md`](worker-schemas.md) (issue #802) to restore `worker-schemas.md`'s file-LOC headroom.

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
| `escalation_trigger` | `failed_attempts` \| `touch_paths_overrun` \| `merge_conflict_semantic` \| `environmental_blocker` | no, optional — only meaningful on `status: blocked` |
| `blocked_step` | string | no, optional — only meaningful when `escalation_trigger === "environmental_blocker"` |
| `evidence` | object `{ command: string, result: string }` | yes when `status: complete`; absent when `blocked`/`error` |
| `new_findings` | finding[] | no |
| `filed_issues` | number[] | no |
| `decision_records` | decision record[] (see below) | no |
| `sprint_contract_status` | `PASS` \| `PARTIAL` \| `N/A` | no, optional — Standard track only |
| `ac_results` | ac-result[] (see below) | no, optional — required non-empty when `sprint_contract_status` is present and not `N/A` |
| `visual_evidence` | visual-evidence[] (see below) | no, optional — additive, config-gated by `display_targets` |
| `companion_repairs` | `{ vcode, file, action }[]` (issue #453) | no, optional — see `companion-file-sync.md` § Ledger contract |
| `conflict_hunks` | conflict-hunk[] (see below) | when `merge_conflict_semantic` |

### `execution_mode` (optional — ADR-004)

Selects which TDD-mandate variant governs the implementer's session:

- `standard` — default (and the mode used when `execution_mode` is absent): unchanged
  failing-tests-first mandate.
- `refactor-strict` — the pre-existing test suite must pass **unmodified**; no new or
  deleted test files during the session.
- `docs-only` — failing-test-first mandate suppressed; Touch-Paths restricted to
  documentation paths. Also gates a Staleness/Drift-Check Table and per-code-block example
  verification (content spec stays in `implementer.md` § Execution Mode `docs-only` gate —
  `V-DRY`), audited by `reviewer.md` § Docs-Only Execution Mode Compliance.

**Non-goal for this issue**: no orchestrator/agent logic computes or passes
`execution_mode` yet — that derivation from `route.task_type` (`feature`/`bugfix` →
`standard`, `refactor` → `refactor-strict`, `docs` → `docs-only`) is future work (`router`
agent, #95; orchestrator dispatch, #93). This field is documentation of future intent, not
a behavior claim about the current codebase.

### `task_type` (optional — ADR-004)

Mirrors the plan frontmatter's `task_type: bugfix` stamp (`planner.md` § Quick Track) when the
implementer's Bugfix Gate applies. Values reuse `TASK_TYPES` verbatim
(`scripts/validate-worker-json.ts:21`): `feature` \| `bugfix` \| `refactor` \| `docs`.

**Non-goal**: no orchestrator/router logic computes or passes `route.task_type` to implementer at
spawn time yet — documentation of future intent, mirroring `execution_mode` above.

### `escalation_trigger` (optional — ADR-004)

`failed_attempts` \| `touch_paths_overrun` (Bugfix Gate) \| `merge_conflict_semantic` (Conflict Resolution Gate — requires non-empty `conflict_hunks[]`) \| `environmental_blocker` (delivery-boundary command failed for an infrastructure/environment reason, not a code defect — see `blocked_step` below). Single-valued. Consumers: `orchestrator-dispatch.md` § Escalation dispatch — never `investigator` for either.

### `conflict_hunks[]` (optional — issue #450)

Required when `escalation_trigger === "merge_conflict_semantic"`.

| Field | Type |
|-------|------|
| `file` | string |
| `lines` | string |
| `excerpt` | string |

See `implementer.md` § Scout Check / § Reuse Check Gate (`V-DRY`).

### `blocked_step` (optional — string, `environmental_blocker` only)
Contrast with `conflict_hunks[]` above: optional, never required, even for its own trigger value.

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
missing-`evidence` check. `reviewer.md` § 5-Field Contract & Plan Compliance's Objective Fulfillment consumes the PR-body per-AC
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
