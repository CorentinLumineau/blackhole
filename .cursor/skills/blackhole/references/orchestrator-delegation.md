## 5-Field Delegation Contract

Every worker subagent prompt you write MUST explicitly declare these 5 fields:

1.  **Objective**: Detailed issue goals, acceptance criteria, and specific requirements.
2.  **Output Format**: Deliverables (e.g. branch pushed, PR opened).
3.  **Scope Boundaries (Touch-Paths)**: List of files allowed to be modified (`V-SCOPE-02`). Restrict changes strictly to these. Exclusions that keep a worker off territory a sibling PR is holding follow § Contended-path exclusions below — they are derived from that PR's file list, never prosed as a bare directory.
4.  **Tool Guidance**: Specific commands to execute (e.g., project test and lint commands). **Mandate establishing a TDD Baseline** by running existing tests first before editing any files. When the plan's `execution_mode` is `standard` (default, absent == `standard`), mandate failing-tests-first; `refactor-strict`, mandate the pre-existing suite pass unmodified (no new/deleted test files); `docs-only`, suppress the failing-test-first mandate and restrict Touch-Paths to documentation paths. Must also include the § Error Classification taxonomy below, so `planner`/`implementer`/`reviewer` self-classify their own tool/spawn failures identically before returning `status: blocked`/`error`.
5.  **Stop Condition**: Criteria for task completion. **Mandate TDD**: any new logic/bug fix must have failing tests written first before implementing the code solution, ensuring tests and linter are green before completion.

**No inline return-JSON skeletons**: field 2 (Output Format) states which fields this spawn
needs filled and what to classify — it never restates the return schema's shape, field names,
or enum values as a literal JSON skeleton. Cite the SSOT instead: `worker-schemas.md § <Role>`
(e.g. `worker-schemas.md § Router`). An inlined skeleton is a second source that can drift from
the SSOT silently, and the worker faithfully follows whichever one it was given, wrong or not —
a turn-8 brief inlined `"status": "complete"` for a `router` spawn (`complete` is not a member
of `ROUTE_STATUSES`), and 7 of 8 routers correctly followed the brief into a schema-invalid
return; the one compliant router was then "corrected" into the invalid value on re-route. This
rule constrains *brief construction* only, never the return schema's own field set — a future
field addition (e.g. #613's proposed `rationale`) is unaffected.

### Contended-path exclusions

When a parallel batch puts two workers near the same territory, field 3's exclusion is
**derived, not prosed**: read the contended PR's own file list (`gh pr view <n> --json files`, or
the configured backend's equivalent) and carry those paths into the contract verbatim. Three rules
separate a real conflict guard from a manufactured coverage gap:

1. **Paths, never bare directories.** The hazard is two workers editing the same *file*; a
   directory-scoped embargo over-applies to every sibling file while doing nothing extra for the
   contended one.
2. **New files under a contended directory are permitted** — state this explicitly, every time. A
   file that exists on neither branch has no conflict risk, and the only home for a new module's
   test is usually the very directory the contended test file sits in.
3. **A directory-level embargo carries its exception in the same sentence**: "do not modify
   existing files under `<dir>`; new files there are fine" — never a bare "stay out of `<dir>`".

The failure this prevents is silent and arrives as *absence*, not as an error: a worker that obeys
a directory-scoped embargo ships a new module with no direct test and accurately says so, and the
disclosure reads as a caveat rather than a defect. Sibling issues whose declared `touch_paths`
globs already collide never reach this point — `queue-dag.md` § Step 3 — Conflict filter defers
one of them instead. An exclusion that narrows the plan's own `## Touch-Paths` is a scope change
like any other: amend the plan per `orchestrator-dispatch.md` § Spawn-Time Touch-Paths Amendment.

### Worker spawn model

Read `.blackhole/config.json` → `worker_model_policy` and `worker_effort_policy` (defaults
`cost-optimized` when absent; full matrix: `.cursor/skills/blackhole/references/model-routing.md`).

`Task` / subagent spawns must align **model cost to task**, not use one tier for every role:

| Policy | Spawn behavior |
|--------|----------------|
| `cost-optimized` | Resolve per spawn: `economy` / `standard` / `premium` from role + track + `route{}` signals, then pass the **cheapest capable** harness slug for that tier. |
| `inherit` | Omit `model` — workers inherit the parent session's harness default (v0.6.1 behavior). |

**Task-tier examples (cost-optimized):** see `model-routing.md` § Task-tier matrix and § Harness
tier ladders for model slug and tier-folded effort defaults — do not duplicate ladder rows here.

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
   `.blackhole/config.json` `docs_governance.enabled` does not resolve to `true` (per
   `config-template.md` § `docs_governance` resolution — cautious default wins) or
   `docs_governance.docs_impact_routing` is `false`, resolve to
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
**not** spawn `implementer` until **all** conditions are met:

1. Plan artifact exists on disk at `{repo_root}/.blackhole/plans/issue-N.md`
2. Planner worker JSON returned `status: ready` (not `blocked`)
3. **Reformulation posted (issue #456)** — when `track` is `quick` or `standard`, planner JSON
   includes a valid `reformulation` object and the orchestrator has posted
   `formatReformulationComment(reformulation)` to the issue thread via
   `gh issue comment <issue_number> --body "$(cat <<'EOF' ... EOF)"` before implement spawn
   (`phase-plan.md` § Reformulation posting; `confidence-gates.md` § Async Two-Band Mapping).
   Skip when `track: skip|design|brainstorm`, when `status: blocked`, or when `reformulation`
   fails validation. Vacuously satisfied for exempt tracks.
4. **`route.ui: true` condition (ADR-017, additional independent requirement — not an
   alternative to 1–3)**: when the issue's resolved `route.ui` is `true`, the plan file's
   frontmatter at `{repo_root}/.blackhole/plans/issue-N.md` must also carry `ui_gate:
   approved`. A `route.ui: true` issue must satisfy conditions 1, 2, 3, **and** condition 4,
   all four, before `implementer` dispatch — this is a conjunction, never an `OR`
   substitute for 1–3. Covers the case where the planner under-runs the UI screen (e.g.
   a stale `route.ui` classification, or a planner bug): even a `status: ready` plan
   without the approved stamp refuses dispatch. `route.ui: false`, or no `route` object
   — condition 4 is vacuously satisfied (no additional requirement).

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
`.cursor/skills/blackhole/references/campaign-prompt.md` §
PLAN_CONTEXT) containing:

1. **Plan artifact** — absolute path to `{repo_root}/.blackhole/plans/issue-N.md`
2. **Touch-Paths** — from `queue.json` `touch_paths` for this issue
3. **Codebase Conventions** — the `## Codebase Conventions` section from the plan file
   (write `(none declared)` if absent)

`planner` does **not** receive PLAN_CONTEXT — it *produces* the plan
artifact from which Touch-Paths and Conventions are extracted.

This preamble is binding: implementers must not edit outside Touch-Paths;
reviewers audit against them (`V-SCOPE-02`).

**Merge-readiness review promotion (ADR-021 D3, issue #445):** when an issue reaches LGTM and
`phase-loop.md` § Merge protocol step 2.5 applies (governance on, not `leave-open`), spawn
`implementer` with a 5-Field contract whose Objective is solely `implementer.md` § Promote Review
Artifact — Touch-Paths limited to `documentation/reviews/`, `documentation/INDEX.md`, and
`.blackhole/staged/<issue>/` staging writes. The reviewer spawn contract is unchanged; review
artifacts are never authored during the review phase.

Worker return schemas: `.cursor/skills/blackhole/references/worker-schemas.md`.
<!-- GENERATED by scripts/build.ts from src/references/orchestrator-delegation.md — do not hand-edit -->
