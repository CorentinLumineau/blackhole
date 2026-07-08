# Worker Return Schemas

Structured JSON contracts for campaign worker agents. The orchestrator validates worker output against these shapes before mutating state.

Optional: consumers may install the Cursor SubagentStop hook below for machine-enforced structural validation at subagent handoff.

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
| `new_findings` | finding[] | no |
| `filed_issues` | number[] | no |

### `execution_mode` (optional — ADR-004)

Selects which TDD-mandate variant governs the implementer's session:

- `standard` — default (and the mode used when `execution_mode` is absent): unchanged
  failing-tests-first mandate.
- `refactor-strict` — the pre-existing test suite must pass **unmodified**; no new or
  deleted test files during the session.
- `docs-only` — failing-test-first mandate suppressed; Touch-Paths restricted to
  documentation paths.

**Non-goal for this issue**: no orchestrator/agent logic computes or passes
`execution_mode` yet — that derivation from `route.task_type` (`feature`/`bugfix` →
`standard`, `refactor` → `refactor-strict`, `docs` → `docs-only`) is future work (`router`
agent, #95; orchestrator dispatch, #93). This field is documentation of future intent, not
a behavior claim about the current codebase.

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
  ]
}
```

| Field | Values | Required |
|-------|--------|----------|
| `status` | `complete` \| `error` | yes |
| `findings` | finding[] | yes (empty array = no issues found) |
| `error` | string | when `status: error` |

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
    "confidence": { "split": 95, "design": 80, "plan_mode": 70, "security": 90 },
    "body_hash": "<sha of issue title+body at classification time>",
    "computed_at_phase": "handle",
    "revision": 1
  },
  "trigger": "initial"
}
```

| Field | Values | Required |
|-------|--------|----------|
| `status` | `routed` \| `error` | yes |
| `route` | object | when `routed` (`null` when `error`) |
| `trigger` | `initial` \| `clarify-resolved` \| `research-landed` \| `investigation-landed` | when `routed` |
| `error` | string | when `status: error` |

`route`'s own field names, enum values, and types are frozen — see `queue-dag.md` § `route`
object (not re-tabulated here). The `routing_decisions` ledger row this write produces is
documented in `findings-ledger.md` § "Routing decision records".

```json
{
  "status": "error",
  "route": null,
  "trigger": "initial",
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
