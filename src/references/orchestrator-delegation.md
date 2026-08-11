## 5-Field Delegation Contract

Every worker subagent prompt you write MUST explicitly declare these 5 fields:

1.  **Objective**: Detailed issue goals, acceptance criteria, and specific requirements.
2.  **Output Format**: Deliverables (e.g. branch pushed, PR opened).
3.  **Scope Boundaries (Touch-Paths)**: List of files allowed to be modified (`V-SCOPE-02`). Restrict changes strictly to these.
4.  **Tool Guidance**: Specific commands to execute (e.g., project test and lint commands). **Mandate establishing a TDD Baseline** by running existing tests first before editing any files. When the plan's `execution_mode` is `standard` (default, absent == `standard`), mandate failing-tests-first; `refactor-strict`, mandate the pre-existing suite pass unmodified (no new/deleted test files); `docs-only`, suppress the failing-test-first mandate and restrict Touch-Paths to documentation paths. Must also include the § Error Classification taxonomy below, so `planner`/`implementer`/`reviewer` self-classify their own tool/spawn failures identically before returning `status: blocked`/`error`.
5.  **Stop Condition**: Criteria for task completion. **Mandate TDD**: any new logic/bug fix must have failing tests written first before implementing the code solution, ensuring tests and linter are green before completion.

### Worker spawn model

Read `.blackhole/config.json` → `worker_model_policy` (default `cost-optimized` when absent;
full matrix: `{{AGENT_DIR}}/skills/blackhole/references/model-routing.md`).

`Task` / subagent spawns must align **model cost to task**, not use one tier for every role:

| Policy | Spawn behavior |
|--------|----------------|
| `cost-optimized` | Resolve per spawn: `economy` / `standard` / `premium` from role + track + `route{}` signals, then pass the **cheapest capable** harness slug for that tier. |
| `inherit` | Omit `model` — workers inherit the parent session's harness default (v0.6.1 behavior). |

**Task-tier examples (cost-optimized):**

| Spawn | Typical tier |
|-------|----------------|
| `router`, `investigator` (investigate), `planner` skip | `economy` |
| `planner` quick/standard, `reviewer`, `orchestrator`, `implementer` (default), `hunter` | `standard` |
| `planner` design, `implementer` + security/`size:xl`, `reviewer` at high `review_iteration` | `premium` |

Do **not** read `model:` from agent markdown frontmatter (`V-AGENT-01`). On
`escalation_trigger` blocked returns, bump one tier on the next respawn for that role (cap `premium`).

**Deterministic spawn name (mandatory)**: every background `Agent` spawn for a campaign worker
(`router`, `planner`, `implementer`, `reviewer`, `investigator`, `hunter`) MUST pass an explicit
`name: "<role>-<issue-number>"` — matching the existing `## In-flight workers` row convention
`"<role> on #<issue>"` in `checkpoint-protocol.md` § In-flight workers (no new field there). This
is what makes a worker's Claude Code subagent transcript deterministically locatable at recovery
time (`agent-a<name>-*.jsonl`, `recovery-protocol.md` §10) — an undiscoverable transcript is an
undiscoverable return.

### Route-derived dispatch (ADR-004 step 3)

Before spawning `planner`, derive its spawn directive from the issue's `queue.json`
`route{}` object (schema: `queue-dag.md` § `route` object). Evaluate in this precedence
order — each step is a hard gate over the ones below it:

1. **Void route** — `route` absent, or `.blackhole/config.json` `adaptive_routing: false`
   → send no explicit `track` directive; `planner` self-assesses Quick/Standard exactly
   as today (`plan_mode: full` semantics, zero behavior change). This is every issue in
   today's queue — the `router` agent (#95) has landed (PR #118) but has not yet
   re-triaged any issue already in today's queue, so no `route` object is populated yet —
   and is byte-for-byte identical to pre-ADR-004 dispatch.
2. **Split precedence** — before consulting `route.needs_split`, compare
   `route.confidence.split` against `.blackhole/config.json`
   `router_confidence_thresholds.split` (default 70). Below threshold, resolve to
   `needs_split`'s cautious default (`true`) instead of the computed value; at or above
   threshold, use the computed value as-is. If the resolved value is `true`, it voids
   every other route flag on this parent issue (hard rule, not an ordering). Dispatch
   stops here: hand off to the existing Phase 1 split mechanism (`issue-splitting.md`,
   referenced from `phase-handle.md`) — no new split code path is introduced. Children
   re-enter at dedup with their own independent `route`. If `false`, continue to step 3.
2.5. **Brainstorm precedence (ADR-010 D3)** — see § Brainstorm dispatch precedence below.
3. **Per-flag confidence gate** — before consulting `plan_mode` or `needs_design`,
   compare `route.confidence.<flag>` against `.blackhole/config.json`
   `router_confidence_thresholds.<flag>` (default 70 per flag). Below threshold, resolve
   to that flag's cautious default instead of the computed value: `plan_mode` low
   confidence → treat as `full` (no directive); `needs_design` low confidence → treat as
   `true` (dispatch to design track — never skip the human design gate on an uncertain
   classification). Note for completeness: `security_review_required`'s cautious default
   is `true`; its dispatch is out of scope for this step (#98). `docs_impact`'s confidence
   gate follows the identical rule — compare `route.confidence.docs` against
   `router_confidence_thresholds.docs` (default 70); below threshold, **or** when
   `.blackhole/config.json` `docs_governance.enabled` does not resolve to `true` (absent block,
   absent field, or explicit `false` — SSOT: `config-template.md`'s `docs_governance.enabled`
   row, issue #477) or `docs_governance.docs_impact_routing` is `false`, resolve to
   `docs_impact`'s cautious default (`true`) instead of the computed value. Its dispatch —
   enriching planner/reviewer prompts — is out of scope for this step (see #177 scope note;
   mirrors `security_review_required`'s #98 precedent).
4. **`needs_design: true`** (post-confidence-gate) → spawn `planner` with an explicit
   `track: design` directive (track already implemented, #94/#101). See
   `phase-plan.md` § Plan approval gate, "Design track (ADR-004)" row, and § Design
   Autonomy Dispatch below (ADR-010 D4's gated-verdict amendment) for the full contract.
5. **`plan_mode: skip`** (post-confidence-gate, only when `needs_design` did not already
   claim the dispatch) → spawn `planner` with an explicit `track: skip` directive (track
   already implemented, #94/#101). The Planner gate below still applies unmodified — the
   `skip` track's `planner` spawn still produces a plan artifact on disk and returns
   `status: ready` per `worker-schemas.md`, so gate conditions 1–2 are satisfied exactly
   like any other track. Tool-policy constraint restated: the orchestrator never writes
   this artifact itself (`disallowedTools: [Write, Edit, Delete]`, line 5, this file) —
   `planner`'s `skip` track is the write-capable agent in this handoff (ADR-004
   Trade-offs table, "Who writes the skip rationale record").
6. **`plan_mode: quick` or `plan_mode: full`** (post-confidence-gate) → send no explicit
   `track` directive; `planner` performs its existing Quick/Standard self-assessment
   unchanged. This is a deliberate, documented scope boundary — `planner.md` Step 2
   scopes explicit-directive-only behavior to Skip/Design — not an oversight; forcing an
   explicit `quick`/`full` directive is out of scope for this step.
7. **`route.ui` pass-through (ADR-017)** — before spawning `planner`, confidence-gate
   `route.ui` the same way as step 3: compare `route.confidence.ui` against
   `.blackhole/config.json` `router_confidence_thresholds.ui` (default 70); below
   threshold, resolve to `ui`'s cautious default (`true`) instead of the computed value.
   Pass the resolved value into the `planner` spawn context — **no explicit `track`
   directive** (this does not select Quick vs. Standard; `planner`'s own Quick/Standard
   UI Interpretation Gate bullets read the resolved value from spawn context and act on
   it within whichever track Step 2 already selected). This is a per-issue enrichment
   step, not a track-selection step, same class as `needs_brainstorm`'s dispatch (§
   Brainstorm dispatch precedence).

**Planner gate (always enforced — never bypassed, including `plan_mode: skip`):** Do
**not** spawn `implementer` until **both** conditions are met:

1. Plan artifact exists on disk at `{repo_root}/.blackhole/plans/issue-N.md`
2. Planner worker JSON returned `status: ready` (not `blocked`)
3. **`route.ui: true` condition (ADR-017, additional independent requirement — not an
   alternative to 1–2)**: when the issue's resolved `route.ui` is `true`, the plan file's
   frontmatter at `{repo_root}/.blackhole/plans/issue-N.md` must also carry `ui_gate:
   approved`. A `route.ui: true` issue must satisfy conditions 1, 2, **and** condition 3,
   all three, before `implementer` dispatch — this is a conjunction, never an `OR`
   substitute for 1–2. Covers the case where the planner under-runs the UI screen (e.g.
   a stale `route.ui` classification, or a planner bug): even a `status: ready` plan
   without the approved stamp refuses dispatch. `route.ui: false`, or no `route` object
   — condition 3 is vacuously satisfied (no additional requirement).

**Explicit skip exception (ADR-004):** (i) when `route.plan_mode: skip` selected the
`planner` `skip` track, this gate is satisfied by the skip track's own deliverable — a
4-section rationale record at the same `plans/issue-N.md` path, `status: ready` in the
worker JSON; (ii) the skip track does **not** bypass this gate — it is a
`planner`-produced artifact like any other track; (iii) the gate's "never skip
verification" guarantee is unconditional across `quick`/`standard`/`skip`; only `design`
is exempt from *this specific implement-readiness gate* because it never returns
`status: ready` (unconditional `status: blocked` — see `phase-plan.md` § Plan approval
gate).

`bun run verify` enforces the same plan-on-disk rule via **V-PLAN-01** for any
queue entry in `plan`, `implement`, or `review` with `status: in-flight` (use
`--campaign-dir .blackhole` for live campaign state).

If either is missing, stay in Phase 2 Plan — spawn or re-spawn `planner`.
Queue entry must be `phase: implement`, `status: ready` before implement spawn.

**Before spawning a `implementer` or `reviewer`**, prepend a
`<PLAN_CONTEXT>` block (see
`{{AGENT_DIR}}/skills/blackhole/references/campaign-prompt.md` §
PLAN_CONTEXT) containing:

1. **Plan artifact** — absolute path to `{repo_root}/.blackhole/plans/issue-N.md`
2. **Touch-Paths** — from `queue.json` `touch_paths` for this issue
3. **Codebase Conventions** — the `## Codebase Conventions` section from the plan file
   (write `(none declared)` if absent)

`planner` does **not** receive PLAN_CONTEXT — it *produces* the plan
artifact from which Touch-Paths and Conventions are extracted.

This preamble is binding: implementers must not edit outside Touch-Paths;
reviewers audit against them (`V-SCOPE-02`).

Worker return schemas: `{{AGENT_DIR}}/skills/blackhole/references/worker-schemas.md`.
