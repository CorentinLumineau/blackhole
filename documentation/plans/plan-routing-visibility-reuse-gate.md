---
type: plan
summary: "Implementation plan for dashboard routing visibility and the implementer Reuse Check gate"
status: current
created: 2026-07-13
last_updated: 2026-07-13
review_trigger: "on ADR acceptance"
related:
  - documentation/decisions/ADR-008-routing-visibility-reuse-gate.md
  - documentation/audits/analysis-blackhole-routing-reuse-visibility.md
plan_base_commit: bbbf2ea
---

# Plan — Routing visibility, wave monitoring & proactive reuse enforcement (ADR-008)

## Objective

Implement ADR-008 for the blackhole plugin: make the router's persisted `route{}`
intelligence visible in the campaign dashboard (Workstream A), shift reuse enforcement
left into the implementer via a proactive "Reuse Check" PR-body artifact gate
(Workstream B), and safely roll out router re-triage so `route{}` populates on the
standing queue (Workstream C) — without touching `planner.md` or the `queue.json`
schema (deliberate ADR boundary, avoids Quick-track determinism loss and
Accretion-Guard/Extension-Tax governance gates).

All edits land in `src/**` / `scripts/**`; `bun run build` regenerates `.claude/**` —
never hand-edit build output.

## Task Breakdown

### Workstream A — Visibility (`scripts/campaign-status.ts`, TDD)

**A1. Write failing tests for `renderRouteChain(route, phase)`** in
`scripts/campaign-status.test.ts`.
Depends on: none.
Acceptance: new `describe('renderRouteChain', ...)` block with ≥4 RED cases before
implementation exists: (i) `route` absent → placeholder "not yet routed" string, no
crash; (ii) full route with all flags → renders the planned chain
`Handle → [research?] → [investigate?] → [design-gate?] → Plan(tier) → Implement →
Review([security?])` with the current `phase` bracket-marked; (iii) per-flag
`confidence.{split,design,plan_mode,security}` values shown inline; (iv)
`needs_split: true` renders only the split branch (sibling flags voided per
`queue-dag.md` route object rule), not stale flag values. Verify RED via
`bun test scripts/campaign-status.test.ts`.

**A2. Implement `renderRouteChain(route, phase)`** in `scripts/campaign-status.ts`
satisfying A1.
Depends on: A1.
Acceptance: pure function `(route: Route | undefined, phase: string | undefined) =>
string`, no side effects; all A1 cases pass GREEN.

**A3. Write failing tests for `computeWaves(issues)`**, including one shared-fixture
test asserting output matches `queue-dag.md` § Step 4 wave semantics.
Depends on: none.
Acceptance: new `describe('computeWaves', ...)` block with ≥4 RED cases: (i) linear
dependency chain → sequential waves; (ii) diamond dependency (two parents, one shared
child) → child appears only once, in the wave after both parents; (iii) every issue
with empty `depends_on` → single Wave 0 containing all of them; (iv) shared-fixture
case reproducing a representative multi-wave queue and asserting the wave grouping is
byte-for-byte identical to what `queue-dag.md` § Step 4's algorithm (Wave 0 = empty
`depends_on`; Wave N = deps `merged`/`closed` in prior waves) would produce.

**A4. Implement `computeWaves(issues)`** in `scripts/campaign-status.ts` satisfying A3.
Depends on: A3.
Acceptance: pure function, client-side topological sort, behaviorally identical to
`queue-dag.md` § Step 4 for all A3 fixtures; does **not** modify the existing
`groupIssuesByPhase` (ADR-008 constraint — `campaign-resume-signal.ts` depends on its
current signature).

**A5. Add `route?: Route` to `QueueIssue`, define `Route` type.**
Depends on: none (same file as A2/A4 — sequence to avoid merge conflicts within one
agent's session).
Acceptance: `Route` type mirrors `queue-dag.md` § `route` object SSOT exactly — field
names/enum values not renamed or added (`needs_split`, `needs_clarification`,
`needs_research`, `needs_investigation`, `needs_design`, `task_type`, `plan_mode`,
`security_review_required`, `confidence: {split, design, plan_mode, security}`,
`body_hash`, `computed_at_phase`, `revision`); `bun test` type-checks clean.

**A6. Wire `### Routing` and `### Waves` sections into `formatDashboard()`.**
Depends on: A2, A4, A5.
Acceptance: new `formatDashboard` test cases assert output contains a `### Routing`
header with one `renderRouteChain` line per issue, and a `### Waves` header with
`computeWaves`-grouped issue lists; sections are omitted when there is nothing to show
(mirrors the existing `### In-flight`/`### Blocked`/`### Ready` "only render when
non-empty" convention); all 13 pre-existing `formatDashboard` test cases remain GREEN
(no regression).

**A7. Document `### Routing` and `### Waves`** in
`src/references/coordinator-dashboard.md` § Dashboard sections.
Depends on: A6.
Acceptance: § Dashboard sections' numbered list grows from 9 to 11 items; new rows
describe the Routing section (planned chain + current-phase marker + per-flag
confidence — explicitly **not** an actual-history traversal record) and the Waves
section (topo-sorted issue groups); note that `research`/`investigate` chain steps
render as conditional route-driven steps (the `investigator` agent is implemented; only the
pre-existing dispatch-wiring doc inconsistency is out of scope — see ADR-008 § Scope boundary).

### Workstream B — Proactive reuse (agent prompts)

**B1. Add a "Reuse Check" step to `src/agents/implementer.md`.**
Depends on: none.
Acceptance: new unconditional step inserted before the existing step 3 (TDD), mirroring
the exact "recorded in the PR description... no bypass" prose pattern already used by
the Bugfix Gate's Decision Record (implementer.md:78-81) and the docs-only Drift-Check
Table (implementer.md:116-122): before writing any code, grep the issue's `touch_paths`
(from the injected `<PLAN_CONTEXT>` Touch-Paths) for existing utilities/conventions, and
record a one-line `Reuse Check: <found existing utility/convention — name + file:line>
| none found — first occurrence` entry in the PR body; step 6 ("Verify & Open PR") is
updated to list the Reuse Check entry as a required PR-body element alongside `Closes
#N`/`Fixes #N`.

**B2. Add a pointer sentence in `src/references/worker-schemas.md` § Implementer.**
Depends on: B1.
Acceptance: one new sentence pointing to `implementer.md`'s Reuse Check step, mirroring
the existing pointer at worker-schemas.md:244 ("See `implementer.md` § Bugfix Gate for
the Scout Check / Improvement Record convention the same gate also produces (content
spec stays there — `V-DRY`)"); no duplication of the Reuse Check's content spec
(`V-DRY-01`).

**B3. Extend `src/agents/reviewer.md` § 5 (Integration Coherence).**
Depends on: B1 (reviewer verifies what implementer produces).
Acceptance: two new bullet items added to § 5: (a) verify the Reuse Check artifact is
present in the PR body — **BLOCK** if absent (new intentional gate per ADR-008, not a
WARN); (b) when the injected `Codebase Conventions = (none declared)`, run a live-grep
fallback over the plan's `touch_paths` so `V-INT-01/03/04` execute instead of silently
no-oping (mirrors mercure `x-review`'s live Grep/Glob fallback pattern cited in
ADR-008). No new JSON field — findings stay in the existing
`vcode`/`severity`/`file`/`line`/`summary` shape (`worker-schemas.md` § Reviewer).

**B4. Structural regression check (no `.md`-prompt test harness exists in this repo).**
Depends on: B1, B3.
Acceptance: `bun run verify` passes with zero new failures attributable to
`implementer.md`/`reviewer.md` — specifically `V-DELEG-01` (worker agents declare
5-field/output contract) and `V-TOOLS-01` (tool-policy deny-list), both of which
structurally parse these two files.

### Workstream C — Router rollout

**C1. Verify re-triage safety (read-only, BLOCKING gate before C2).**
Depends on: none.
Acceptance: a Decision Record (Context/Alternatives/Choice/Rationale/Confidence)
confirming, from `router.md` § Re-route checkpoints and `orchestrator.md` § Route-derived
dispatch: (i) `orchestrator.md` § Route-derived dispatch step 1 ("Void route") reads
`route{}` exactly once, immediately before spawning `planner` — an issue already past
`phase: plan` never has that dispatch decision re-evaluated, so backfilling `route{}`
for such an issue is **display-only** (feeds the new Routing section from A6/A7) and has
**zero effect** on already-completed dispatch; (ii) `queue.json` has no lock strategy
(ADR-008 Constraints) — rollout scope MUST exclude `status: in-flight` issues to avoid a
concurrent-write collision with an active worker's mutation on the same issue entry;
(iii) rollout MUST execute sequentially, one `router` spawn at a time, never
parallel-batched with regular Ready-set worker spawns.
**RESOLVED (user, 2026-07-13)**: rollout scope backfills `route{}` only for **open,
non-in-flight** issues — skip `phase: done` / `status: merged` / `status: closed`. A
populated route for a closed issue adds dashboard rows with no display value. C2's scope
filter is therefore: `route` absent AND `status` ∉ {`in-flight`, `merged`, `closed`} AND
`phase != done`.

**C2. Document the rollout procedure** in `src/references/queue-dag.md` § `route`
object, updating the existing "Consumer status" note.
Depends on: C1 (and the user's answer to C1's clarification marker).
Acceptance: the "Consumer status" note (currently: "every issue in today's live queue
still falls through the void route fallback") is updated to describe the backfill
procedure: trigger = `router` spawn with `trigger: "initial"` (already a valid enum
value per `worker-schemas.md` § Router); scope = issues with `route` absent AND
`status != in-flight` (plus C1's clarification resolution for `done`/`merged`/`closed`);
cadence = one-time backfill, sequential, run before that turn's Step 2 Ready-set
computation. No change to the `route` object schema table itself (frozen per
`router.md` § Schema reference).

**C3. Execute the backfill** (operational action against the live campaign, not a
`src/**` code change).
Depends on: C2.
Acceptance: at the next campaign orchestrator turn, `router` is sequentially spawned for
each in-scope issue per C2's documented procedure; `.blackhole/queue.json` issues in
scope carry a populated `route{}` object (spot-check: `jq -e '.issues["<n>"].route |
has("needs_split")' .blackhole/queue.json`); `.blackhole/findings-ledger.json` gains one
`routing_decisions` row per backfilled issue (`router.md` § Write protocol); the
dashboard's Routing section (A6/A7) renders non-empty chains for previously void-route
issues. This step is executed by blackhole's own orchestrator/router agents at runtime —
no PR is required for C3 itself.

## Critical Files

| File | Change Type | Reason |
|------|-------------|--------|
| `scripts/campaign-status.ts` | Extend | Add `Route` type, `QueueIssue.route`, `renderRouteChain`, `computeWaves`, wire into `formatDashboard` |
| `scripts/campaign-status.test.ts` | Extend | TDD coverage for A1/A3/A6 |
| `src/references/coordinator-dashboard.md` | Extend | Document Routing + Waves sections |
| `src/agents/implementer.md` | Extend | Reuse Check step |
| `src/agents/reviewer.md` | Extend | § 5 artifact verification + live-grep fallback |
| `src/references/worker-schemas.md` | Extend | Pointer sentence for Reuse Check |
| `src/references/queue-dag.md` | Extend | Route backfill procedure note |

## Codebase Conventions

| Touchpoint | Convention | Source | Required by |
|------------|------------|--------|--------------|
| Dashboard rendering | Single formatter, pure function, markdown `lines[]` | `scripts/campaign-status.ts:107` (`formatDashboard`) | V-INT-01..03 |
| Queue row typing | `QueueIssue` type mirrors `queue.json` fields | `scripts/campaign-status.ts:8` | V-INT-01..03 |
| Route schema (SSOT) | `route{}` field names/enums frozen | `src/references/queue-dag.md:52-84` | V-INT-01..03 |
| Dashboard print policy | When/what to print (SSOT) | `src/references/coordinator-dashboard.md:17` | V-INT-01..03 |
| PR-body artifact gate | "Produced once, recorded in PR description, no bypass" — Bugfix-Gate Decision Record / docs-only Drift-Check Table pattern | `src/agents/implementer.md:78-89`, `116-122` | V-INT-01..03 |
| Reviewer artifact verification | Reviewer checks PR-body artifact presence + spot-checks accuracy, mirrors Drift-Check Table verification | `src/agents/reviewer.md:57-62` (§ 8) | V-INT-01..04 |
| worker-schemas pointer convention | One-sentence pointer to agent-file content spec, no duplication | `src/references/worker-schemas.md:244` | V-DRY-01 |

## Dependency Blast-Radius

| Changed File | Downstream Consumers | Blast Radius |
|--------------|----------------------|--------------|
| `scripts/campaign-status.ts` (`QueueIssue`, `formatDashboard`) | `campaign-resume-signal.ts` (`groupIssuesByPhase` — signature untouched), `recovery-drift.ts` (separate `QueueIssue` type — untouched), `campaign-status.test.ts`, `bun run status` consumers (coordinator/orchestrator) | LOW — additive only, existing signatures untouched |
| `src/agents/implementer.md` (Reuse Check step) | Every future implementer-spawned PR body | MEDIUM — new required PR-body element; reviewer BLOCKs if absent (intentional, but touches every future PR) |
| `src/agents/reviewer.md` § 5 | Every future PR review pass | LOW — additive checks; existing `V-INT-02` unchanged |
| `src/references/queue-dag.md` (Consumer status note) | Operators reading the route rollout procedure | LOW — documentation only, schema table untouched |

**Overall blast radius**: MEDIUM (bounded to the two agent-prompt files and their PR-body
contract; the visibility layer is LOW/additive-only).

## Edge Cases & Boundary Conditions

| Boundary Type | Scenario | Acceptance Criterion |
|----------------|----------|------------------------|
| Missing/absent route | `issue.route` is `undefined` | `renderRouteChain` renders a "not yet routed" placeholder, not a crash or blank string |
| Empty queue | `issues = {}` | `computeWaves` returns `[]`; `formatDashboard` omits `### Waves` entirely (mirrors the existing "only render when non-empty" convention) |
| Circular `depends_on` (malformed data) | Two issues depend on each other | `computeWaves` does not infinite-loop; unresolved issues after all waves are computed are surfaced in a final "unresolved" bucket, not silently dropped |
| `needs_split: true` voids siblings | `route.needs_split === true` | `renderRouteChain` shows only the split branch, not stale sibling flag values (per `queue-dag.md` route object rule) |
| No dependencies at all | Every issue has empty `depends_on` | `computeWaves` returns a single Wave 0 containing every ready issue |

## Risk Assessment

| Risk | Severity | Mitigation |
|------|----------|------------|
| Wave-algorithm drift — `computeWaves` (display) diverges from `queue-dag.md` § Step 4 (scheduling) over time | MEDIUM | A3's shared-fixture test asserts `computeWaves` output matches queue-dag §4 wave numbering for representative dependency graphs (linear + diamond); re-run this fixture test whenever `queue-dag.md` § Scheduling algorithm Step 4 changes |
| Reuse Check artifact quality — a low-effort grep in B1 could produce a hollow "none found" entry without a real search | MEDIUM | B3 requires the reviewer to independently re-verify at least one Reuse Check claim against the actual codebase before accepting it, mirroring `reviewer.md` § 8's existing Drift-Check Table accuracy spot-check |
| Router rollout concurrent-write race — spawning `router` against an issue whose entry is being concurrently mutated by an active implementer/reviewer worker could corrupt `queue.json`'s atomic `.tmp`+`mv` write (no lock strategy, ADR-008 Constraints) | HIGH | C1 restricts rollout scope to `status != in-flight` issues only, executed strictly sequentially (one `router` spawn at a time, never parallel-batched with regular worker spawns); C3 verifies `queue.json` remains valid JSON (`jq empty`) after each sequential backfill write before proceeding to the next issue |
| Rollout display-honesty gap — an issue already past `phase: plan` that receives a backfilled route may show a "planned chain" that does not match the void-route fallback path it actually took | LOW | A7 documents the "planned chain + current phase, not actual history" scope boundary (an explicit, contestable ADR-008 Key Assumption); revisit with an actual-path traversal log only if the user later needs it |
| `.claude/` build-output directory could be wiped by `bun run build`/`bun run verify`, losing `.claude/progress.md` / `.claude/initiatives/` | LOW (defense-in-depth; `scripts/build.ts:374-378` already scopes `cleanDir` to `.claude/{agents,rules,skills}` only) | Execution Strategy backs up `.claude/progress.md` and `.claude/initiatives/` before every `bun run build`/`bun run verify` invocation and restores after, per explicit project instruction |

## Stop Conditions

> On encountering any condition below, halt and report rather than improvising.

1. **Concurrent-write conflict**: if, during C3's sequential backfill, `.blackhole/queue.json`
   fails `jq empty` validation after a `router` write, halt immediately, report the issue
   number and raw write output, and do NOT continue backfilling remaining issues — the
   atomic `.tmp`+`mv` write may have raced with a concurrent worker.
2. **Wave-fixture mismatch**: if A3's shared-fixture test cannot be made to pass without
   deviating from `queue-dag.md` § Step 4's documented wave semantics (Wave 0 = empty
   `depends_on`; Wave N = deps `merged`/`closed` in prior waves), halt and report rather
   than silently reimplementing a different algorithm.
3. **Reuse Check ambiguity**: if the implementer's Reuse Check grep (B1) surfaces a
   candidate existing utility that appears to overlap with the planned new code but reuse
   is not obviously correct (different signature/behavior needed), halt and report rather
   than either silently duplicating logic or silently forcing an ill-fitting reuse.
4. **Scope drift**: if implementation requires modifying files not listed in the Critical
   Files table above, halt and report — the plan may need additional touchpoints.

## Execution Strategy

**Pattern**: Mixed — Workstreams A and B run in parallel (no file overlap); Workstream C
runs concurrently but is internally sequential and gated behind C1's clarification marker;
final verification runs last.

| Agent | Task(s) | Model | Delegation Contract |
|-------|---------|-------|----------------------|
| general-purpose | A1, A3 | sonnet | **Objective**: write failing tests for `renderRouteChain` and `computeWaves` per A1/A3 acceptance criteria. **Output format**: edits to `scripts/campaign-status.test.ts` using the existing `describe`/`test` `bun:test` style. **Scope**: `scripts/campaign-status.test.ts` only. **Tool guidance**: Read the existing test file first for style; Edit to append new `describe` blocks. **Stop condition**: new tests exist and fail (RED) via `bun test scripts/campaign-status.test.ts`. |
| mercure:x-refactorer | A2, A4, A5, A6 | sonnet | **Objective**: implement `renderRouteChain`, `computeWaves`, the `Route` type/`QueueIssue.route`, and wire `### Routing`/`### Waves` into `formatDashboard` per A2/A4/A5/A6. **Output format**: edits to `scripts/campaign-status.ts`. **Scope**: `scripts/campaign-status.ts` only; do not modify `groupIssuesByPhase`. **Tool guidance**: Edit; run `bun test scripts/campaign-status.test.ts` after each function to confirm GREEN. **Stop condition**: all A1/A3 tests plus new A6 assertions pass GREEN; all 13 pre-existing test cases remain green. |
| mercure:x-doc-writer | A7 | sonnet | **Objective**: document the `### Routing`/`### Waves` sections per A7. **Output format**: edit to `src/references/coordinator-dashboard.md` § Dashboard sections (extend to 11 items). **Scope**: `src/references/coordinator-dashboard.md` only. **Tool guidance**: Read the file first, match existing table/prose style exactly. **Stop condition**: § Dashboard sections lists 11 items consistent with A6's actual `formatDashboard()` output. |
| general-purpose | B1, B3 | sonnet | **Objective**: add the Reuse Check step to `implementer.md` and the two new `reviewer.md` § 5 checks per B1/B3. **Output format**: edits to `src/agents/implementer.md` and `src/agents/reviewer.md`, matching the existing Bugfix-Gate/Drift-Check "no bypass" prose pattern. **Scope**: `src/agents/implementer.md`, `src/agents/reviewer.md` only. **Tool guidance**: match phrasing/heading conventions exactly (both files already read in full during plan discovery). **Stop condition**: `implementer.md` has a new unconditional Reuse Check step producing a PR-body artifact; `reviewer.md` § 5 has the two new checks with explicit severities. |
| mercure:x-doc-writer | B2 | sonnet | **Objective**: add the `worker-schemas.md` pointer sentence per B2. **Output format**: edit to `src/references/worker-schemas.md` § Implementer. **Scope**: `src/references/worker-schemas.md` only. **Tool guidance**: match the existing pointer-sentence pattern at line 244 exactly; do not duplicate content spec (`V-DRY-01`). **Stop condition**: one new pointer sentence added, no content duplication. |
| general-purpose | C1 | sonnet | **Objective**: produce the Decision Record confirming router re-triage safety per C1, reading `router.md` § Re-route checkpoints and `orchestrator.md` § Route-derived dispatch. **Output format**: Decision Record (Context/Alternatives/Choice/Rationale/Confidence) plus the `[NEEDS CLARIFICATION]` resolution request surfaced to the user. **Scope**: read-only — no file edits in this task. **Tool guidance**: Grep/Read only. **Stop condition**: Decision Record produced and the user has answered the `done`/`merged`/`closed` scope question before C2 proceeds. |
| mercure:x-doc-writer | C2 | sonnet | **Objective**: document the Route backfill procedure per C2. **Output format**: edit to `src/references/queue-dag.md` § `route` object, updating the "Consumer status" note. **Scope**: `src/references/queue-dag.md` only; do not modify the `route` object schema table itself. **Tool guidance**: match existing prose style; cross-reference `worker-schemas.md`'s router `trigger` enum. **Stop condition**: "Consumer status" note describes the backfill procedure and its safety scope, gated on C1's resolved clarification. |
| (operational — blackhole orchestrator/router, not this PR's implementing agent) | C3 | n/a | **Objective**: at the next live orchestrator turn, sequentially spawn `router` for each in-scope void-route issue per C2's documented procedure. **Output format**: `queue.json`/`findings-ledger.json` mutations via `router.md` § Write protocol. **Scope**: `.blackhole/queue.json`, `.blackhole/findings-ledger.json` — operational, outside this PR's `src/**` diff. **Tool guidance**: n/a — executed by blackhole's own runtime agents. **Stop condition**: C3 acceptance criteria met (route populated for in-scope issues, one ledger row per issue) and Stop Condition 1 honored (halt on `jq empty` failure). |
| general-purpose | Final verification | sonnet | **Objective**: run the full quality gate — back up `.claude/progress.md` + `.claude/initiatives/`, run `bun run build`, `bun test`, `bun run verify`, then restore the backup — and confirm all pass with zero regressions. **Output format**: pass/fail report quoting command output per the 5-step verification-evidence gate. **Scope**: repo root, read-only except the explicit backup/restore of `.claude/progress.md`/`.claude/initiatives/`. **Tool guidance**: run commands directly via Bash — NOT the `x-tester` agent (broken `WorktreeCreate` hook in this environment). **Stop condition**: `bun run build` exits 0 with a clean git diff (`V-BUILD-01`); `bun test` exits 0 with zero failures; `bun run verify` exits 0 (all 19 checks pass; `vcode_table_rows` stays 33 — confirm no new V-code or reference file was introduced, satisfying `V-GROUND-01`). |

**Parallelization**: A-track (rows 1-3) and B-track (rows 4-5) run in parallel — no file
overlap. C-track (rows 6-8) is internally sequential (C1 gates C2 gates C3) and has no
file overlap with A/B, so it can proceed concurrently, but C2/C3 pause on C1's
`[NEEDS CLARIFICATION]` marker regardless of A/B's progress. C3 is an operational,
post-merge action and does not block the code-quality gate. Final verification runs last,
after A/B/C2 land (≤4 parallel agents per phase, per `orchestration-strategy.md`).

## Sprint Contract

### Machine-verifiable
- [ ] `bun test scripts/campaign-status.test.ts` → all tests pass, including new `renderRouteChain`/`computeWaves`/`formatDashboard` Routing+Waves assertions
- [ ] `bun run build` → exits 0, clean git diff (`V-BUILD-01`)
- [ ] `bun run verify` → exits 0, all 19 checks pass (`vcode_table_rows` unchanged at 33 — `V-GROUND-01`)
- [ ] `jq -e '.route == null or (.route | has("needs_split"))' ` spot-check on a backfilled `queue.json` issue after C3 (schema conformance)

### Human-verifiable
- [ ] Run `bun run status` against a sample `.blackhole/queue.json` fixture with a populated route and confirm the `### Routing`/`### Waves` sections render legibly and match the "planned chain + current phase" honesty framing (not claimed as actual history)
- [ ] Read the new Reuse Check step in `implementer.md` and the `reviewer.md` § 5 additions and confirm the "no bypass" phrasing matches the existing Bugfix Gate / Drift-Check Table tone

## References

- **ADR**: `documentation/decisions/ADR-008-routing-visibility-reuse-gate.md` — chosen
  approach: Option 2 (Observe + shift-left into implementer); rejected: Option 1 (Observe +
  harden review only — leaves reuse reactive), Option 3 (Full audit trail — concurrent-write
  / schema-rollout risk), pre-Gate-2 planner-side reuse gate (destroys Quick-track
  determinism, trips Accretion-Guard + Extension-Tax)
- **Audit**: `documentation/audits/analysis-blackhole-routing-reuse-visibility.md` —
  evidence base (findings A1-A3, B1-B2, C1-C3) and Convention Catalog
