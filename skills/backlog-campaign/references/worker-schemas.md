# Worker Return Schemas

Structured JSON contracts for campaign worker agents. The orchestrator validates worker output against these shapes before mutating state.

Optional: consumers may install `templates/hooks/subagent-stop-validate.json` for Cursor SubagentStop structural validation.

## Planner (`backlog-planner`)

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
| `plan_path` | string | when `ready` |
| `track` | `quick` \| `standard` | when `ready` |
| `failing_checks` | string[] | when `blocked` |
| `clarification_markers` | number | when `ready` or `blocked` |

### Plan quality gate checks

When `status: blocked`, `failing_checks` lists failed items:

- `touch_paths_declared` — Touch-Paths section present (`V-SCOPE-02`)
- `schema_baseline` — API/schema changes specified for standard track (`V-API-01`)
- `tdd_tasks` — TDD baseline and failing-test tasks present (`V-TEST-01/02`)
- `ac_mapping` — acceptance criteria mapped to tasks
- `clarification_limit` — at most 2 `[NEEDS CLARIFICATION]` markers
- `base_commit` — `plan_base_commit` stamped in frontmatter

## Implementer (`backlog-implementer`)

```json
{
  "status": "complete",
  "pr_number": 42,
  "branch": "campaign/issue-298",
  "tests_passed": true,
  "touch_paths_honored": true,
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
| `new_findings` | finding[] | no |
| `filed_issues` | number[] | no |

## Reviewer (`backlog-reviewer`)

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

## Synthesizer (`backlog-synthesizer`)

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
| `pareto_candidates` | `{ summary, priority, file }[]` | no |
| `error` | string | when `status: error` |

## Orchestrator validation

Before ledger append or phase transition:

1. Parse worker JSON; on parse failure → treat as worker error, do not advance phase
2. For implementer: reject if `touch_paths_honored === false` or `tests_passed === false`
3. For synthesizer: route to implement only when `lgtm === false` and `review_iteration < 5`
4. Append synthesizer `findings` to ledger with `phase: review` and `pr_ref` set
