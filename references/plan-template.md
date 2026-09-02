# Plan Output File Template

Write to `plans/<issue-N>.md` in this format:

```markdown
---
issue: #<Issue Number>
plan_base_commit: <Short SHA of HEAD>
track: quick | standard
task_type: bugfix | null
threat_screen_passed: true | null
ui_gate: pending | approved | null
supersedes_adr: [ADR-NNN, ...] | null  # set when this plan knowingly reverses an accepted ADR decision — triggers V-ADR-06 leg 1
---

# Plan - Issue #<Number>

## Objective
...

## Touch-Paths
- `file/path/A.ts`
- `file/path/B.tsx`

## Scope Amendments
Appended by the orchestrator, not authored by the planner during Step 7 — the orchestrator
appends one line here, before spawning, whenever it authorizes a Touch-Paths change in a
worker's spawn prompt that diverges from this plan's declared `## Touch-Paths` (procedure:
`orchestrator-dispatch.md` § Spawn-Time Touch-Paths Amendment). Omit the heading entirely until
the first amendment. Format, one line per amendment, newest last:

```
- <date> — widen|narrow — `<path>` — <one-sentence reason>
```

`widen` = a path added beyond the plan's original Touch-Paths list; `narrow` = a path removed
from it. Worked example (PR #602 / issue #573):

```
- 2026-08-05 — widen — `scripts/checks/ground-truth.check.ts` — stale decision-record comment
  needed a same-PR fix alongside the touched check it documents.
```

## [If docs_governance.enabled] Documentation Impact
List companion/consumer docs the Touch-Paths affect — e.g. `ARCHITECTURE.md`, `DESIGN.md`,
`documentation/decisions/INDEX.md`, or a specific consumer doc/README — or write
`None — <justification>`. Populate only when `docs_governance.enabled` is `true`; omit the
heading entirely when the config block is absent or `enabled` is `false`. When naming a new
`documentation/` file, apply `doc-governance.md`'s search-before-write and canonical-naming
obligations, gated by `docs_governance.write_governance`.

## [Standard Only] Critical Files
List only pre-existing sensitive touchpoint files (e.g. database client, auth config). A file
this plan is about to create belongs under Touch-Paths, never here — `critical_files_exist`
(Step 8) Globs every path listed in this section and blocks on a miss.

## [Standard Only] Codebase Conventions
...

## [Standard Only] Database/API Schema Changes
...

## [Standard + security-sensitive Only] Threat Model
...

## [If route.ui and non-trivial size] UI Interpretation Gate

### Owner said
...

### I interpreted
...

### Open ambiguities
...

## [Standard + perf-sensitive Only] Performance Budget
...

## [Standard Only] Execution Strategy & Stop Conditions
...

## Task Breakdown
- [ ] **TDD Baseline Verification**: Run the project's test suite first to verify all existing tests pass before modifying any codebase files. — **AC**: baseline suite run, pass/fail counts quoted in the completion evidence.
- [ ] **Write Failing Tests**: Author new unit/integration tests covering the feature/bug fix (`V-TEST-01/02`). — **AC**: new tests exist and fail for the expected reason before implementation lands.
- [ ] **Implement Minimal Logic**: Implement code changes restricted strictly to the Touch-Paths. — **AC**: previously-failing tests now pass; no file outside Touch-Paths modified.
- [ ] **Verify Integrity**: Verify all tests and lints are clean (use the project's test and lint commands). — **AC**: full suite green, lint clean, both quoted in the completion evidence.
- [ ] Task steps (with any [NEEDS CLARIFICATION: ...] markers if needed) — **AC**: <machine-verifiable condition for this task; Standard track only, BLOCKING per Step 8's `ac_mapping` check>.

## Sprint Contract
...

## [Standard Only] Quality Gate Results
| Check | Result |
|---|---|
| `touch_paths_declared` | PASS \| FAIL |
| `schema_baseline` | PASS \| FAIL |
| `ac_mapping` | PASS \| FAIL |
| `critical_files_exist` | PASS \| FAIL |
| `mitigation_concrete` | PASS \| FAIL |
| `ac_sweep_conflict` | PASS \| ADVISORY |
| `ac_sweep_scope` | PASS \| ADVISORY |
| `touch_paths_ssot_gap` | PASS \| ADVISORY |
```

### Skip Track file template

Write to `plans/<issue-N>.md` in this format:

```markdown
---
issue: #<Issue Number>
plan_base_commit: <Short SHA of HEAD>
track: skip
route: <spawn-context route metadata, or null if not provided>
---

# Plan - Issue #<Number>

## Objective
...

## Touch-Paths
N/A — skip track makes no code changes.

## Why-no-plan
...

## Rollback
N/A
```

### Design Track file template

Write to `plans/<issue-N>-design.md` in this format — one section per subsection in the Design
Track prose above, same order:

```markdown
---
issue: #<Issue Number>
plan_base_commit: <Short SHA of HEAD>
track: design
---

# Design Note - Issue #<Number>

## Requirements Framing
...

## Options + Trade-off Matrix
...

## Adversarial Evaluation
...

## Component Decomposition
...

## Design Principles Validation
...

## Refactoring Impact Analysis
...

## Assumption Audit
...

## Gate
status: blocked | ready  <!-- ready only when scripts/design-aggregate.ts computes it, ADR-010 D4 -->
```

<!-- GENERATED by scripts/build.ts from src/references/plan-template.md — do not hand-edit -->
