---
type: plan
review_trigger: "on milestone completion"
created: 2026-07-15
last_updated: 2026-07-15
plan_base_commit: d4d978b
related:
  - documentation/decisions/ADR-010-autonomous-thinking-routes.md
  - documentation/audits/autonomous-workflow-parity.md
initiative: autonomous-thinking-routes
milestone: 4 of 5 (Brainstorm route)
track: standard
---

# Milestone 4 — Brainstorm route (planner `track: brainstorm`, child-issue terminal semantics)

## Objective

Give vague/idea-stage issues a bounded development path instead of clarify-blocking on first
contact, per ADR-010 D3 (Rollout P4). Add a **5th planner track**, `track: brainstorm`, entered
only on an explicit spawn directive (mirroring the existing `track: design` precedent — never
self-selected from issue content). The track expands a vague issue into a requirements framing
plus 2-3 options with a provisional recommendation, reusing Design Track subsections 1-2
machinery (`src/agents/planner.md` §4.1-4.2) at reduced depth. **Terminal semantics**: a
brainstorm issue never produces a mergeable code PR. The track returns the brainstorm artifact
plus proposed child issues (title, body, AC, size estimate, suggested route, Gain/Effort); the
orchestrator files children through the **existing** discovery path (`phase-loop.md` §
Continuous Discovery of Improvements — V-PARETO-02 gate, dedup, `gh issue create`), then closes
the brainstorm issue as satisfied-by-children (mirroring the standing #152/#916 close-as-satisfied
precedent). Status resolves per the confidence kernel: proceed (`status: ready`) → children
proposed; low confidence on the final product choice → `status: blocked` with the specific
product question surfaced to the user.

Pareto value 10% / effort 15% — a small, additive slice: one new track, one new route flag, one
config sub-flag, one JSON contract extension. Everything is gated by
`autonomy.enabled && autonomy.brainstorm_routing`; absent/false preserves today's behavior
exactly (zero-regression guarantee, same kill-switch pattern as `kaizen`/`incident_mode`).

**Hard dependency**: Milestone 1 (config + artifact contract + confidence kernel — `autonomy`
config block, `confidence-gates.md`, `artifact-contract.md`). Soft dependency on Milestone 2
(reuses the blind-critic/rubric-formatting *conventions*, not `design-aggregate.ts` itself — the
brainstorm track's status resolution is confidence-gated, not aggregate-scored). See
`## Preconditions` below — none of these files exist in `src/references/` as of this plan's base
commit; this milestone's tasks assume they land first and halt rather than reimplementing them
inline (Stop Condition 2).

**Out of scope** (do not touch in this milestone): `needs_analysis` / the investigator `analyze`
sub-mode (Milestone 3's concern — a sibling route flag on the same `route{}` object, planned
independently); `design-aggregate.ts` and the Design Track §4.8 gated rewrite (Milestone 2); the
`retrospective` hunter kind (Milestone 5). Where this milestone's tasks touch a shared file
(`queue-dag.md`, `worker-schemas.md`) also touched by a sibling milestone, this plan's tasks are
scoped to the `needs_brainstorm`/brainstorm-track rows only — reconciliation of concurrent edits
to the same file across milestones happens at implementation time, not in this plan.

## Preconditions

- `src/references/confidence-gates.md` and `src/references/artifact-contract.md` must exist
  (Milestone 1 deliverables) before Task 7 wires the dispatch gate — Stop Condition 2 governs
  what to do if they are absent when this milestone starts.
- `src/references/config-template.md` must already carry the `autonomy` block skeleton (`enabled`,
  `confidence_threshold`, `never_bypass`, ADR-010 D8) from Milestone 1; Task 6 only adds/confirms
  the `brainstorm_routing` sub-flag row inside that block — it does not create the block itself.
- `ARCHITECTURE.md` is absent at the project root (V-ADA-01, WARN per `blackhole-vcodes.md`) —
  flagged for awareness, not a blocker for this milestone (no procedural BLOCK gate applies
  outside `x-rearchitect`).
- `documentation/decisions/ADR-010-autonomous-thinking-routes.md` is `status: Proposed`, not yet
  Accepted — no `documentation/decisions/INDEX.md` row update is owed by this milestone; that
  happens when the ADR itself is accepted.

## Hard Choice: Artifact Delivery Path (Decision Record)

- **Context**: ADR-010 D5 says durable thinking-route artifacts ship inside the issue's PR
  ("merge = approval"). But D3's terminal semantics say a brainstorm issue *never* produces a
  mergeable PR. These two rules conflict unless the delivery mechanism is made explicit.
- **Alternatives**:
  - **Easy path** — attach the rendered artifact markdown directly to the issue-closing comment.
    No PR, no reviewer audit, no git history for the artifact.
  - **Hard path** — spawn `implementer` with the **existing** `execution_mode: docs-only`
    (`phase-implement.md:52`, already wired end-to-end: Touch-Paths restricted to documentation
    paths, no failing-test-first mandate, `reviewer.md` § 8 audits it directly per
    `orchestrator.md` § Review pipeline's docs-only branch) to commit the working draft from
    `.blackhole/plans/issue-N-brainstorm.md` into `documentation/brainstorms/{slug}.md` on the
    brainstorm issue's own branch, open a PR, let it merge normally through `merge-gate.md`, and
    only then file children / close the issue.
- **Choice**: Hard path — reuse the existing docs-only execution mode end-to-end.
- **Rationale**: The docs-only PR path already has git history, a real diff for the reviewer to
  audit (V-DOC-GOV-01..04, V-ADA-02 against `documentation/decisions/INDEX.md` when relevant),
  atomic-write discipline, and honors D5's "merge = approval" contract verbatim — with **zero new
  machinery**, closing the loop that "existing utility, don't reimplement" (V-INT-02) already
  demands. The comment-attachment alternative would need its own audit path, its own diffability
  story, and produces an un-reviewable content dump — strictly worse traceability for a
  meaningfully higher short-term cost (bypassing already-built review/governance machinery is not
  actually cheaper once the missing audit trail is accounted for).
- **Confidence**: High — `docs-only` execution mode and its reviewer audit path are already
  landed and exercised by non-brainstorm docs-only PRs today; this milestone adds a second,
  structurally identical caller, not a new code path.

## Task Breakdown

**Dependency order**: Task 1 → {Task 2, Task 3, Task 5, Task 6} → Task 4 (needs 3) → Task 7
(needs 3, 4, 5, 6) → {Task 8, Task 9} (need 5, 7, and 1 for Task 9) → Task 10.

### Task 1 — `scripts/validate-worker-json.ts` + `scripts/validate-worker-json.test.ts` (TDD, schema authority)

This is the schema authority every other task's JSON examples must match byte-for-byte — do this
first. Write failing tests in `scripts/validate-worker-json.test.ts` **before** touching the
implementation (TDD baseline, `V-TEST-01/02`):

- `TRACKS` (`scripts/validate-worker-json.ts:17`): append `'brainstorm'` →
  `['quick', 'standard', 'skip', 'design', 'brainstorm'] as const`.
- `validateRoute` (`scripts/validate-worker-json.ts:245-287`): add
  `requireField(errors, route, 'needs_brainstorm', isBoolean, 'boolean')` alongside the existing
  `needs_split`/`needs_design` block (line 253-257); add `'brainstorm'` to the `confidence` tuple
  at line 277 (`['split', 'design', 'plan_mode', 'security', 'docs', 'brainstorm']`).
- `validatePlanner` (`scripts/validate-worker-json.ts:135-178`): new branches, mirroring the
  existing `track === 'design'` handling at lines 153-155/170-172 but **not** copy-pasted
  verbatim (the design track's "must never report ready" rule does not apply here — brainstorm
  *can* return `ready`):
  - `status === 'ready' && data.track === 'brainstorm'` → require `artifact_path` (string) and
    `children` (array); each `children[i]` validated by a new `validateBrainstormChild(child, i)`
    helper requiring `title` (non-empty string), `body` (non-empty string),
    `acceptance_criteria` (string[], non-empty), `size_estimate` (enum `xs|s|m|l|xl`, reusing
    the existing hunt-filing size vocabulary from `phase-loop.md` § Kaizen hunt dispatch step 3),
    `suggested_route` (object `{task_type, plan_mode}`, values from the existing `TASK_TYPES`/
    `PLAN_MODES` enums — no new enum), `gain` (number 1-10), `effort` (number 1-10). Cap
    enforcement (`children.length <= 5`) is a **planner-authoring** convention documented in Task
    5, not a validator-level structural error — the validator accepts any array length; do not
    add a hard array-length check here (keeps the schema forward-compatible if the cap is ever
    tuned via config, consistent with how `kaizen.max_issues_per_wave` is a config value, not a
    hardcoded validator constant).
  - `status === 'blocked' && data.track === 'brainstorm'` → require `blocking_question` (non-empty
    string).

**Acceptance criteria**: `bun test scripts/validate-worker-json.test.ts` is red before the
implementation edit and green after, with ≥6 new cases (valid ready-brainstorm, valid
blocked-brainstorm, missing `artifact_path`, missing `children`, malformed child object, missing
`blocking_question`); `grep -c "'brainstorm'" scripts/validate-worker-json.ts` returns ≥3 (TRACKS,
route confidence tuple, track-branch checks).

### Task 2 — `fixtures/worker-json/*.json` (new fixtures)

**Depends on**: Task 1 (fixture shapes must match the validator's exact field names).

Add, following the existing `planner-ready*.json` / `planner-blocked*.json` naming convention
(`fixtures/worker-json/`):
- `planner-ready-brainstorm.json` — valid `status: ready`, `track: brainstorm`, 2 children.
- `planner-blocked-brainstorm.json` — valid `status: blocked`, `track: brainstorm`,
  `blocking_question` populated, no `children`/`artifact_path`.
- `planner-ready-brainstorm-missing-children.json` — invalid negative fixture (omits `children`),
  mirroring the existing `planner-ready-missing-plan-path.json` pattern.

**Acceptance criteria**: all three new fixtures parse under `jq empty`; `bun test
scripts/validate-worker-json.test.ts` (extended in Task 1 to read these fixtures, if the existing
test harness loads fixtures by filename convention — confirm via `grep -n "fixtures/worker-json"
scripts/validate-worker-json.test.ts` before assuming the pattern) reports the valid fixtures pass
and the invalid one fails with the expected error message.

### Task 3 — `src/references/queue-dag.md` (`route{}` schema — single source of truth)

**Depends on**: Task 1 (field names/types must match the validator).

In the `### \`route\` object` subsection (`queue-dag.md:52-86`):
- Add `needs_brainstorm` to the example JSON block (line 54-70) and to the field-rules table
  (line 72-86), directly under the existing `needs_design` row. Wording pattern: "Confidence-gated
  (`confidence.brainstorm` vs. `router_confidence_thresholds.brainstorm`, default 70);
  low-confidence cautious default: `true` when the issue body lacks testable AC **and** lacks a
  concrete mechanism (ADR-010 D1)." Add a second sentence stating the voiding rule precisely (do
  not overclaim — this is narrower than `needs_split`'s "voids all sibling flags"): "Hard rule:
  when resolved `true` (post confidence-gate), voids `plan_mode`/`needs_design` for this
  dispatch — the issue is never directly planned; other flags (`needs_research`,
  `needs_investigation`, `security_review_required`, `docs_impact`) are unaffected."
- Add `brainstorm` to the `confidence` field's object shape (line 65, 83).
- Update the "**Consumer status**" paragraph (line 88-98) to note `needs_brainstorm` is
  router-computed as of this milestone but has no dispatch consumer until Task 7 lands (mirrors
  the existing `docs_impact` precedent wording exactly — same sentence shape, `V-DRY-01`).

**Acceptance criteria**: the field-rules table has exactly one new row (`needs_brainstorm`); the
example JSON block's `confidence` object lists `brainstorm` alongside the existing 5 keys; no
existing row's wording changes (diff-scoped, `V-SCOPE-01`).

### Task 4 — `src/agents/router.md` (`needs_brainstorm` computation)

**Depends on**: Task 3 (schema is frozen there — router.md's own § Schema reference line 25-31
explicitly forbids re-tabulating it, `V-DRY-01`).

Add a `needs_brainstorm` computation rule alongside the existing `docs_impact` classification
subsection (`router.md:60-68`, same "content-derived, cautious tie-break" shape): classify `true`
when the issue body (a) lacks testable, machine-verifiable acceptance criteria, **and** (b) lacks
a concrete technical mechanism (no named files, APIs, or approach — pure idea-stage prose).
`false` when either (a) or (b) is satisfied. Add `confidence.brainstorm` to the § Confidence
section's field list (line 53-58, currently `{split,design,plan_mode,security,docs}`). Update the
Return format example JSON (line 164-189) to include `needs_brainstorm` and
`confidence.brainstorm`.

**Acceptance criteria**: `router.md`'s Return format example JSON validates against Task 1's
updated `validateRoute` (manually cross-checked, or via a `bun run scripts/validate-worker-json.ts`
dry run against a fixture built from the example); no re-tabulation of the frozen schema table
(the classification rule references `queue-dag.md` § `route` object, it does not repeat the field
list).

### Task 5 — `src/agents/planner.md` (Brainstorm Track — 5th track)

**Depends on**: Task 1 (return-format contract).

Add "### 5. Brainstorm Track" after the existing Design Track subsection (`planner.md:88-150`),
entered **only** on an explicit `track: brainstorm` spawn directive (never self-selected — same
Step 2 exception list as Skip/Design, `planner.md:22-26`). Structure, in order:

1. **Requirements Framing** — reuse Design Track subsection 1's mechanics verbatim (route-first,
   content-fallback pattern, `planner.md:102-107`) — do not restate the prose, cross-reference it
   (`V-DRY-01`).
2. **Options + provisional recommendation** — reuse Design Track subsection 2's mechanics
   (`planner.md:108-111`) at **reduced depth**: 2-3 options, no forced trade-off-matrix column
   count, one provisional recommendation. Explicitly state this is shallower than the Design
   Track's full analysis — no adversarial-evaluation-via-multiplicity step (that stays Design
   Track-only; do not extend the 2-invocation critique pattern to brainstorm, keeping the
   Accretion Guard's multiplicity cap meaningful).
3. **Child issue proposals** — at most 5 proposed children (DoS/backlog-flood mitigation, see Risk
   Assessment), each with `title`, `body`, `acceptance_criteria[]`, `size_estimate`,
   `suggested_route: {task_type, plan_mode}`, `gain` (1-10), `effort` (1-10) — exact shape from
   Task 1's `validateBrainstormChild`.
4. **Gate**: status resolves per `confidence-gates.md` (Milestone 1 dependency — if this file is
   absent, halt per Stop Condition 2 rather than inventing an inline confidence formula):
   composite confidence ≥ `autonomy.confidence_threshold` → `status: ready`, children proposed;
   below threshold → `status: blocked`, `blocking_question` set to the specific product ambiguity
   (not a generic "needs clarification" — the actual open product question). This is a genuine
   difference from Design Track's unconditional `status: blocked` (`planner.md:95-98`) — do not
   copy that unconditional-block sentence into this subsection.

Also add the artifact delivery instruction per the Hard Choice decision record above: the
planner writes its working draft to `.blackhole/plans/issue-N-brainstorm.md` (gitignored working
state, mirrors the `-design.md` suffix convention) — it does **not** write directly to
`documentation/brainstorms/`; that durable copy is `implementer`'s job in Task 7's terminal
handling, not planner's.

Update the Accretion Guard note (`planner.md:161-167`) to record that the 5th track has landed
and the standing rule (any 6th track/4th sub-mode re-triggers split evaluation) still applies —
one sentence, do not restate the rule's full text (`V-DRY-01`).

Add both return-format JSON examples (ready-with-children, blocked-with-question) to the ###
Return format section (`planner.md:290-337`), matching Task 1's schema exactly.

**Acceptance criteria**: `track: brainstorm` is entered only via explicit directive (Step 2
exception list updated to include it); both return-format examples validate against Task 1's
schema; no adversarial-evaluation-via-multiplicity language appears in the new subsection; the
gate subsection references `confidence-gates.md` by name rather than restating its formula
inline.

### Task 6 — `src/references/config-template.md` (`autonomy.brainstorm_routing`)

Assumes Milestone 1 already landed the `autonomy` block skeleton (`enabled`,
`confidence_threshold`, `never_bypass`, per ADR-010 D8). Add/confirm one row in the field table
(`config-template.md:31-67` pattern) for `autonomy.brainstorm_routing` — "no | Gates the router
`needs_brainstorm` dispatch (`router.md`, `orchestrator.md` § Route-derived dispatch); default
`true`; when `false` (or `autonomy.enabled: false`), `needs_brainstorm` is still computed by
`router` but never consumed for dispatch — resolves as if the flag were absent, identical to the
`docs_governance.docs_impact_routing` precedent (`config-template.md:49`)." Add one sentence to
the (Milestone-1-authored) `autonomy` contract note paragraph confirming
`brainstorm_routing: false` is a no-op, mirroring the existing `docs_governance`/`kaizen`/
`incident_mode` contract-note pattern (`config-template.md:68-96`) — do not restate those three
paragraphs, add a fourth sentence to the (already-existing, post-M1) `autonomy` paragraph.

**If Task 6 starts before Milestone 1 has landed** (the `autonomy` block is entirely absent):
halt per Stop Condition 2 — do not create the `autonomy` block from scratch here; that is
Milestone 1's declared scope, and duplicating it risks two independently-evolving copies of the
same config contract (`V-INT-03`).

**Acceptance criteria**: exactly one new field-table row (`autonomy.brainstorm_routing`); the
contract-note sentence added is additive to the existing `autonomy` paragraph, not a new
standalone paragraph (consistency with the three sibling kill-switch precedents already in the
file).

### Task 7 — `src/agents/orchestrator.md` (dispatch precedence + terminal handling)

**Depends on**: Task 3, Task 4, Task 5, Task 6.

**Dispatch precedence** — insert a new step into § Route-derived dispatch
(`orchestrator.md:55-107`) between the existing Step 2 (Split precedence) and Step 3 (per-flag
confidence gate / `needs_design`): "**Step 2.5 — Brainstorm precedence.** When
`autonomy.enabled && autonomy.brainstorm_routing` are both true (config-template.md), compare
`route.confidence.brainstorm` against `router_confidence_thresholds.brainstorm` (default 70);
below threshold, resolve to `needs_brainstorm`'s cautious default (`true`) instead of the computed
value. If the resolved value is `true`: spawn `planner` with an explicit `track: brainstorm`
directive; dispatch stops here — `plan_mode`/`needs_design` are not evaluated for this issue
(queue-dag.md's voiding rule, Task 3). If `false`, or the config gate is off, continue to Step 3
unchanged (zero-regression — this is the identical shape as the existing `docs_impact` config-gate
precedent at line 84-89)." Renumber the existing steps 3-6 accordingly, or use `2.5` as a
non-renumbering insert — pick whichever keeps the smallest diff against the existing numbered
list (do not renumber steps whose content is otherwise unchanged, to keep this a scoped diff,
`V-SCOPE-01`).

**Terminal handling** — new subsection "## Brainstorm terminal handling" after § Route-derived
dispatch, fixed ordering (Stop Condition 3 governs violations of this order):

1. On `planner` returning `status: ready, track: brainstorm`: spawn `implementer` with
   `execution_mode: docs-only`, Touch-Paths restricted to
   `documentation/brainstorms/{slug}.md`, Objective "commit the working draft from
   `.blackhole/plans/issue-N-brainstorm.md` into the durable artifact path, open a PR" — reusing
   the existing docs-only 5-Field Delegation Contract shape unchanged (no new fields).
2. Reviewer audits the PR per the **existing** docs-only branch of § Review pipeline
   (`orchestrator.md:202-211`, unchanged — no new reviewer logic).
3. Wait for the artifact PR to reach `status: merged` (existing `merge-gate.md` path, unchanged).
4. Only after step 3: file the `children[]` from the planner's return through the **existing**
   § Continuous Discovery of Improvements path (`phase-loop.md:114-127`) — one Priority
   computation and one `gh issue create` per child clearing the `>= 30` gate; children below the
   gate are logged `archived` in the ledger, never filed (identical rule, not a new one).
5. Close the original brainstorm issue: `queue.json` status transition `* → closed`
   (`queue-dag.md:114-122`, existing enum, no new status value) with `notes:
   "satisfied-by-children:<n1>,<n2>,..."` (extends the existing free-text `notes` convention, e.g.
   `"overlap with #N"` — not a new schema field) and an issue-closing comment referencing the
   merged artifact PR number and every filed child issue number (audit trail, mirrors the #152/
   #916 precedent).

On `planner` returning `status: blocked, track: brainstorm`: do **not** run terminal handling —
set `notes: awaiting-user-clarification` and surface `blocking_question` via the existing HITL
Blocker Gate mechanism (`orchestrator.md:305-311`), unchanged.

**Acceptance criteria**: the new Step 2.5 uses the identical config-gate/confidence-gate wording
pattern as the existing `docs_impact` step (structural parity, grep-diffable); the terminal
handling subsection's 5 steps do not duplicate `review-core.md` § Docs-only PRs or
`phase-loop.md` § Continuous Discovery content — each step is a cross-reference plus the ordering
constraint, not a restatement (`V-DRY-01`).

### Task 8 — `src/references/phase-plan.md` (Plan approval gate row)

**Depends on**: Task 5, Task 7.

Add a row to the § Plan approval gate table (`phase-plan.md:34-47`): "Brainstorm track (ADR-010)
| Confidence-gated — AskQuestion only on `status: blocked` (low-confidence product choice);
`status: ready` proceeds to terminal handling without a human gate, unlike Design track's
unconditional block." This is a deliberate contrast with the existing Design track row directly
above it — do not merge the two rows or imply brainstorm shares Design's unconditional-block
semantics.

**Acceptance criteria**: exactly one new table row; the existing Design track row's wording is
byte-for-byte unchanged (diff-scoped).

### Task 9 — `src/references/worker-schemas.md` (Planner Brainstork contract doc)

**Depends on**: Task 1, Task 5.

Add a "### Brainstorm track (optional — ADR-010 D3)" subsection under `## Planner` (after the
existing "### Plan quality gate checks" subsection, `worker-schemas.md:162-178`), mirroring that
subsection's structure: both JSON examples (ready-with-children, blocked-with-question,
byte-for-byte matching Task 1's validator and Task 5's planner examples), a field table for
`artifact_path`, `children[]` (with its own nested field table: `title`, `body`,
`acceptance_criteria`, `size_estimate`, `suggested_route`, `gain`, `effort`), and
`blocking_question`. Add one `failing_checks` value to the existing quality-gate-checks list
(`worker-schemas.md:162-178`): `brainstorm_confidence_below_threshold`.

**Acceptance criteria**: every field name/type in this subsection matches Task 1's TypeScript
validator exactly (cross-check via `grep -n "children\|artifact_path\|blocking_question"` across
both files — no drift between the doc and the code); the new subsection does not restate the
`## Planner` header's existing `status`/`plan_path`/`track` field table, only the
brainstorm-specific additions.

### Task 10 — Regression verification

**Depends on**: all above.

Run `bun test` (full suite, including Task 1's new cases), `bun run build --all`, `bun run
verify`. This milestone touches no compiled-mirror generation logic (`scripts/build.ts`,
`scripts/tree-shape.ts`) — the expectation is zero diff in generated output trees, since all
edits are markdown agent-definition content plus one validator script; confirm this by running
`bun run build --all` before and after on a clean tree and diffing output, same discipline as the
`blackhole-scoped-extraction` initiative's Task 6/Task 5 precedent.

**Acceptance criteria**: `bun test` exits 0 with the new brainstorm-track cases counted in the
total; `bun run build --all` exits 0 with zero diff in generated output trees; `bun run verify`
exits 0.

## Critical Files

| File | Change Type |
|------|-------------|
| `scripts/validate-worker-json.ts` | Modify |
| `scripts/validate-worker-json.test.ts` | Modify |
| `fixtures/worker-json/planner-ready-brainstorm.json` | New file |
| `fixtures/worker-json/planner-blocked-brainstorm.json` | New file |
| `fixtures/worker-json/planner-ready-brainstorm-missing-children.json` | New file |
| `src/references/queue-dag.md` | Modify |
| `src/agents/router.md` | Modify |
| `src/agents/planner.md` | Modify |
| `src/references/config-template.md` | Modify |
| `src/agents/orchestrator.md` | Modify |
| `src/references/phase-plan.md` | Modify |
| `src/references/worker-schemas.md` | Modify |

## Codebase Conventions

| Touchpoint | Convention | Source | Required by |
|------------|------------|--------|-------------|
| Planner track dispatch | Explicit spawn directive only, never self-selected from issue content | `src/agents/planner.md:19-26` (Step 2) | V-INT-01..03 |
| Route flag + confidence + cautious default | Additive `route{}` field, `router_confidence_thresholds.<flag>` gate, documented cautious default | `src/references/queue-dag.md:72-86`, `src/agents/router.md:53-58` | V-INT-01..03 |
| Config-gated dispatch consumption (computed-always, dispatch-gated) | A route flag is computed by `router` unconditionally; a separate config sub-flag gates whether the orchestrator *consumes* it for dispatch | `src/agents/orchestrator.md:83-89` (`docs_impact` precedent) | V-INT-01..03 |
| Discovery/issue filing | `gh issue create` with `V-PARETO-02` Priority gate, ledger `deferred`/`archived` split | `src/references/phase-loop.md:114-127` | V-INT-02 |
| Docs-only PR execution mode | `execution_mode: docs-only`, Touch-Paths restricted to documentation paths, reviewer audits directly (no new reviewer logic) | `src/references/phase-implement.md:52`, `src/agents/orchestrator.md:202-211` | V-INT-01..03 |
| Worker JSON schema validation | Enum arrays + per-status/per-track `requireField` branches | `scripts/validate-worker-json.ts:17,135-178,245-287` | V-INT-02 |
| Track-specific terminal-return contract | Each track's status semantics documented once in `planner.md` § Return format, mirrored (not restated) in `worker-schemas.md` | `src/agents/planner.md:290-337` | V-INT-01, V-DRY-01 |

## Threat Model / STRIDE

Security-sensitive touchpoints: autonomous `gh issue create` (API exposure) and autonomous issue
closing (data/state mutation) without a per-item human confirmation on the `status: ready` path.

| Threat | Category | Severity | Mitigation | Status |
|--------|----------|----------|------------|--------|
| N/A — no new identity/auth surface | Spoofing | LOW | Uses the existing `gh` CLI auth context, unchanged | N/A |
| Router misclassifies a well-specified issue as `needs_brainstorm: true`, diverting it from direct planning | Tampering | MEDIUM | Confidence-gate + `autonomy.brainstorm_routing` kill switch (Task 6/7); reversible — misrouted issue re-enters Handle with its own route on the next cycle | Mitigated |
| Brainstorm issue closed as satisfied-by-children with no verifiable link to what was actually filed/merged | Repudiation | MEDIUM | Fixed terminal-handling ordering (Task 7 steps 1-5): closing comment always references the merged artifact PR number and every filed child issue number | Mitigated |
| Child-issue bodies or the durable artifact expose internal reasoning not intended for the (already-public) forge | Information Disclosure | LOW | No new exposure surface — children are filed via the identical existing discovery path already used for reactive/kaizen discoveries on the same forge | Mitigated |
| Runaway child-issue proposals flood the backlog | Denial of Service | MEDIUM | Hard cap of 5 proposed children per brainstorm resolution (Task 5) plus the existing `V-PARETO-02` Priority gate on each | Mitigated |
| N/A — no permission/role changes | Elevation of Privilege | LOW | No new tool grants; `planner`/`orchestrator`/`implementer`/`reviewer` tool policies are unchanged | N/A |

## Dependency Blast-Radius

| Changed File | Downstream Consumers | Blast Radius |
|--------------|----------------------|---------------|
| `scripts/validate-worker-json.ts` | `scripts/validate-worker-json.test.ts`, `fixtures/worker-json/*`, SubagentStop hook (`worker-schemas.md:29`) | MEDIUM |
| `src/references/queue-dag.md` | `src/agents/router.md` (schema reference), `src/agents/orchestrator.md` (dispatch), `coordinator-dashboard.md` (Routing section display) | MEDIUM |
| `src/agents/router.md` | `src/agents/orchestrator.md` (route consumption), `src/references/phase-handle.md` (spawn point, unchanged) | MEDIUM |
| `src/agents/planner.md` | `src/agents/orchestrator.md` (spawn + terminal handling), `src/references/phase-plan.md` (approval gate), `src/references/worker-schemas.md` (return contract) | MEDIUM |
| `src/agents/orchestrator.md` | `src/references/phase-loop.md` (discovery-filing reuse), `src/references/review-core.md` (docs-only PR reuse), `src/references/merge-gate.md` (PR merge path) | HIGH |
| `src/references/config-template.md` | `src/agents/orchestrator.md`, `src/agents/router.md` (gate consumption) | LOW |
| `src/references/worker-schemas.md` | `scripts/validate-worker-json.ts` (must stay in sync manually — no codegen), reviewer/implementer (no direct consumption this milestone) | LOW |

**Overall blast radius**: MEDIUM. Fully additive and config-gated (`autonomy.enabled &&
autonomy.brainstorm_routing`); when either is false/absent, every touched file's pre-existing
behavior is byte-for-byte unchanged.

## Stop Conditions

> On encountering any condition below, halt and report rather than improvising.

1. **Scope drift**: if implementation requires modifying a file not listed in `## Critical Files`
   (e.g., a new script beyond `scripts/validate-worker-json.ts`), halt and report — the plan may
   need an additional touchpoint.
2. **Missing Milestone 1 dependency**: if `src/references/confidence-gates.md`,
   `src/references/artifact-contract.md`, or the `autonomy` config block in
   `src/references/config-template.md` are absent when Task 5/6/7 starts, halt and report — do
   not fabricate an inline confidence formula or a parallel `autonomy` block; this milestone
   extends Milestone 1's kernel, it does not reimplement it.
3. **Terminal-handling ordering violated**: if an implementation detail would close the brainstorm
   issue, or file children, before the artifact PR reaches `status: merged` (Task 7's fixed
   5-step order), halt and report rather than reordering silently — this ordering is what keeps
   the audit trail intact (see Threat Model, Repudiation row).

## Execution Strategy

**Pattern**: Mixed — Task 1 is a hard prerequisite for everything else; Task 6 is independent and
runs in parallel with Tasks 1-5; Task 7 is a hard join point.

| Agent | Task(s) | Model | Delegation Contract |
|-------|---------|-------|---------------------|
| general-purpose | T1 | sonnet | **Objective**: extend `scripts/validate-worker-json.ts`'s `TRACKS`/`validateRoute`/`validatePlanner` for the new `brainstorm` track, TDD (failing tests first). **Output format**: passing `scripts/validate-worker-json.test.ts` plus the implementation diff. **Scope**: `scripts/validate-worker-json.ts`, `scripts/validate-worker-json.test.ts` only. **Tool guidance**: `bun test` to confirm red→green; `Grep` to re-confirm exact line numbers before editing (they may have shifted from this plan's base commit). **Stop condition**: `bun test scripts/validate-worker-json.test.ts` green with ≥6 new brainstorm-track cases. |
| general-purpose | T2 | sonnet | **Objective**: add 3 new fixtures matching T1's schema. **Output format**: 3 new JSON files under `fixtures/worker-json/`. **Scope**: `fixtures/worker-json/*.json` new files only — no edits to existing fixtures. **Tool guidance**: `jq empty` each new file; run T1's test suite against them. **Stop condition**: all 3 fixtures present and correctly classified (2 valid, 1 invalid) by T1's validator. |
| general-purpose | T3, T4 | sonnet | **Objective**: add the `needs_brainstorm` route field to `queue-dag.md`'s schema, then the router classification logic in `router.md`. **Output format**: two file diffs. **Scope**: `src/references/queue-dag.md`, `src/agents/router.md` only. **Tool guidance**: `Grep` for the exact `needs_design` row before inserting `needs_brainstorm` immediately after it, to match table ordering conventions. **Stop condition**: both docs updated; `router.md`'s Return format example JSON includes `needs_brainstorm` and `confidence.brainstorm`. |
| general-purpose | T5 | sonnet | **Objective**: add the Brainstorm Track subsection to `planner.md`, including the artifact-delivery instruction from the Hard Choice decision record. **Output format**: one file diff. **Scope**: `src/agents/planner.md` only. **Tool guidance**: cross-reference (do not restate) Design Track subsections 1-2 and the Accretion Guard section. **Stop condition**: Brainstorm Track subsection present with both return-format JSON examples matching T1's schema. |
| x-doc-writer | T6 | sonnet | **Objective**: add the `autonomy.brainstorm_routing` config row and contract-note sentence. **Output format**: one file diff. **Scope**: `src/references/config-template.md` only. **Tool guidance**: match the existing `docs_governance.docs_impact_routing` row's wording pattern exactly. **Stop condition**: one new field-table row plus one added sentence to the existing `autonomy` contract-note paragraph (per Stop Condition 2 — halt if that paragraph doesn't exist yet). |
| general-purpose | T7 | sonnet | **Objective**: wire Step 2.5 dispatch precedence and the Brainstorm terminal handling subsection into `orchestrator.md`. **Output format**: one file diff. **Scope**: `src/agents/orchestrator.md` only. **Tool guidance**: cross-reference (do not restate) `review-core.md` § Docs-only PRs and `phase-loop.md` § Continuous Discovery. **Stop condition**: Step 2.5 present with the `docs_impact`-parity config-gate wording; terminal handling subsection present with the fixed 5-step order. |
| x-doc-writer | T8, T9 | sonnet | **Objective**: add the Brainstorm row to `phase-plan.md`'s Plan approval gate table, and the Brainstorm track JSON-contract subsection to `worker-schemas.md`. **Output format**: two file diffs. **Scope**: `src/references/phase-plan.md`, `src/references/worker-schemas.md` only. **Tool guidance**: cross-check every field name against T1's TypeScript validator before writing the doc table. **Stop condition**: both docs updated; zero field-name drift against T1's validator (verified by grep cross-check). |
| x-tester | T10 | sonnet | **Objective**: run the full regression suite after all edits land. **Output format**: pass/fail report with command + result evidence per task. **Scope**: read-only except running build/test commands — no source edits. **Tool guidance**: `bun test`, `bun run build --all` (diff generated trees before/after), `bun run verify`. **Stop condition**: all three commands exit 0, reported with verbatim command output per the Sprint Contract. |

**Parallelization**: T1 first (schema authority). T2 depends on T1. T3→T4 sequential. T5 depends
only on T1 (may run parallel with T3/T4). T6 is fully independent — runs in parallel with T1-T5.
T7 is a hard join on T3, T4, T5, T6. T8/T9 depend on T5, T7 (T9 also on T1). T10 last. Peak
parallelism: 3 concurrent agents (T3/T4 chain, T5, T6) — within the `orchestration-strategy.md`
≤4-parallel-agents-per-phase cap.

## Sprint Contract

### Machine-verifiable
- [ ] `bun test scripts/validate-worker-json.test.ts` → all pass, including new brainstorm-track cases
- [ ] `bun test` (full suite) → exits 0
- [ ] `bun run build --all` → exits 0, zero diff in generated output trees vs. pre-change snapshot
- [ ] `bun run verify` → exits 0
- [ ] `grep -c "'brainstorm'" scripts/validate-worker-json.ts` → returns ≥3 (TRACKS, confidence tuple, track-branch checks)

### Human-verifiable
- [ ] A reviewer reads `src/agents/planner.md` § Brainstorm Track and confirms it cross-references
      (rather than restates) Design Track subsections 1-2 and the Accretion Guard section
      (`V-DRY-01` self-check).
- [ ] A reviewer confirms the Hard Choice decision record's docs-only-PR delivery path requires
      zero new logic in `review-core.md` or `merge-gate.md` — the artifact PR is audited and
      merged exactly like any other existing docs-only PR.

## References

- `documentation/decisions/ADR-010-autonomous-thinking-routes.md` — D1 (route flags), D3
  (brainstorm track + terminal semantics), D5 (durable artifact contract), D6 (confidence
  kernel), D8 (`autonomy` config block), Rollout P4
- `documentation/audits/autonomous-workflow-parity.md` — G11 (no brainstorm route gap)
- `#152`/`#916` close-as-satisfied precedent (campaign history, per Shared Discovery Block) —
  reused verbatim for the terminal-handling close semantics, not a new mechanism
- `phase-implement.md:43-53` docs-only execution-mode precedent — reused verbatim for artifact
  delivery, per the Hard Choice decision record above
