---
type: plan
status: current
tracking_initiative: none
track: standard
related: [documentation/decisions/ADR-005-pr-merge-gate-dependency-ordering.md]
review_trigger: on file change
created: 2026-07-09
last_updated: 2026-07-09
---

# Plan: PR Merge-Gate and Dependency-Ordering (ADR-005)

## Objective

Implement ADR-005 in full: add a merge-time hold/ordering mechanism (`merge_hold`,
`merge_after` on `queue.json` issues; `merge_mode` on `config.json`) and a dedicated
`merge-gate.md` reference doc that owns the entire merge-eligibility algorithm —
eligibility check, cross-graph cycle detection, forge-drift reconciliation, and
gated-batch scope wait — so that a campaign can be scoped to a milestone, let every
in-scope PR reach LGTM, self-review the batch, then merge in a controlled,
dependency-respecting order. Also adds a **Campaign Launch Configuration Gate**: an
interactive coordinator prompt confirming scope (all issues | labels | milestone) and
`merge_mode` (immediate | gated-batch) at true campaign start, so the user configures
these via a quick form instead of hand-editing `.blackhole/config.json`. All changes
are additive and default-preserving (`merge_mode: "immediate"`, `merge_hold: false`,
`merge_after: []`) — zero behavior change for campaigns that don't opt in. Every edit
lands in `src/` only (per
`ARCHITECTURE.md` § Project Structure Golden rule — `.claude/`, `.cursor/`, `codex-*`,
`.gemini-plugin/`, `plugins/`, and the flat `skills/`/`agents/`/`references/`/`rules/`
mirrors are `scripts/build.ts` compiled outputs and must never be hand-edited).

## Task Breakdown

**T1 — `queue-dag.md` schema fields (`merge_hold`, `merge_after`)**
Add `merge_hold: boolean` (default `false`) and `merge_after: number[]` (default `[]`)
to the `queue.json` schema documented in `src/references/queue-dag.md` — as new rows in
the existing "Field rules" table, explicitly noting the distinction from `depends_on`
(implementation-start gate vs. merge-time gate) and that `merge_after` resolves on
`status: merged` **OR** `status: closed`, mirroring the exact rule `depends_on` already
uses (Step 2, line ~115). Add a matching example to `fixtures/queue.example.json`
following the same inline-subsection precedent already used for the `route` object
(lines 41-54).
**Depends on**: none (foundation task).
**Acceptance criteria**:
- `merge_hold` and `merge_after` appear in `queue-dag.md`'s Field rules table with
  default values stated and the merged-OR-closed resolution rule stated explicitly.
- `fixtures/queue.example.json` gains example `merge_hold`/`merge_after` values on an
  existing issue entry (following the `route` object's inline pattern).
- `bun run build && bun run verify` exits 0 after this task alone.

**T2 — `config-template.md` `merge_mode` field**
Add `merge_mode: "immediate" | "gated-batch"` (default `"immediate"`) to
`src/references/config-template.md`'s JSON example and Field table, explicitly stating
it "preserves current behavior exactly" when absent/default. Add an example value to
`fixtures/config.example.json` (use `"gated-batch"` to demonstrate the non-default path,
since the fixture already carries `scope_milestone`/`scope_labels` — showing the
scoped-batch-merge workflow the ADR was written to unlock).
**Depends on**: none (foundation task, independent of T1).
**Acceptance criteria**:
- `merge_mode` appears in `config-template.md`'s JSON example and Field table with
  default and both enum values documented.
- `fixtures/config.example.json` gains `"merge_mode": "gated-batch"`.
- `bun run build && bun run verify` exits 0 after this task alone.

**T3 — `merge-gate.md` new reference doc**
Create `src/references/merge-gate.md`, owning the full merge-eligibility algorithm as
its single responsibility (kept out of `phase-loop.md` to avoid step bloat per ADR-005's
SOLID/SRP validation). Must specify:
- `mergeEligible(issue) -> bool`: `false` if `merge_hold: true`; `false` if any
  `merge_after` entry has status other than `merged`/`closed`; `false` (only when
  `config.json.merge_mode: "gated-batch"`) if not all in-scope siblings have reached
  LGTM yet. Short-circuit on first failing condition.
- Cross-graph cycle detection across `merge_after` ∪ `depends_on`, run at the
  forge-sync boundary every turn (fail-fast). On a cycle: set both issues
  `status: blocked` with note `merge-order cycle with #N`; surface via the existing
  AskQuestion user gate.
- Forge-drift reconciliation: for issues with `merge_hold: true` or unresolved
  `merge_after`, check `gh pr view --json state,mergedAt` during forge-sync to catch a
  PR merged externally (bypassing the hold); log `V-MERGE-02` (WARN) to the ledger.
- Gated-batch scope wait: reuse the **existing** `scope_milestone`/`scope_labels`/
  `issueMatchesScope` mechanism (`scripts/forge-scope.ts` — do not reinvent). Wait until
  all in-scope issues reach LGTM, then merge strictly **one PR at a time** in
  `merge_after` topological order (never a single atomic multi-PR call) — this is what
  makes a mid-batch failure a resumable state rather than requiring rollback logic.
- Explicitly document the "oversimplified" blind spot from ADR-005's Key Assumptions
  table: gated-batch scope is re-evaluated every orchestrator turn (same as today's
  wave computation), not frozen at batch start.
**Depends on**: T1, T2 (references the field shapes those tasks add).
**Acceptance criteria**:
- All 4 sub-algorithms (eligibility, cycle detection, drift reconciliation, batch wait)
  are documented with explicit pseudocode/prose precise enough that a new contributor
  could implement `mergeEligible()` from the doc alone.
- Doc states the reused-not-reinvented `scripts/forge-scope.ts` dependency explicitly.
- Doc covers the edge cases in this plan's Edge Cases table (below).
- `bun run build && bun run verify` exits 0.

**T4 — `phase-loop.md` merge-step precondition**
Change the Phase 5 Loop checklist line
`- [ ] LGTM? → merge PR (runbook quality gates)` to
`- [ ] LGTM AND mergeEligible(issue)? → merge PR (runbook quality gates)` — delegating
the decision to `merge-gate.md` rather than embedding logic here (one new precondition,
zero other changes to merge mechanics).
**Depends on**: T3 (references `mergeEligible`).
**Acceptance criteria**:
- The checklist line is updated exactly as specified; no `mergeEligible` logic is
  duplicated inline anywhere in `phase-loop.md`.
- `bun run build && bun run verify` exits 0.

**T5 — `blackhole-vcodes.md` new V-code rows**
Add two rows to `src/references/blackhole-vcodes.md`'s table:
`V-MERGE-01 | merge executed while ineligible (hold set or merge_after unresolved) | BLOCK`
and
`V-MERGE-02 | merge-order cycle detected, or PR merged externally bypassing an active hold | WARN`.
These are audit-trail-only findings (never the enforcement mechanism — enforcement
lives entirely in `queue.json` state + `merge-gate.md` logic, per ADR-005's Option-C
rejection rationale).
**Depends on**: T3 (rows describe the algorithm T3 defines).
**Acceptance criteria**:
- Both rows present, terse (no long-form definition — matches the file's existing
  "restate, don't paste longer definitions" convention).
- `bun run build && bun run verify` exits 0 (confirms compilation into every platform
  target's `references/` dir and `.claude/rules/blackhole-vcodes.md`).

**T6 — `orchestrator.md` Phase 5 pointer**
Add one pointer reference to `merge-gate.md`'s `mergeEligible` check in
`src/agents/orchestrator.md`'s Phase 5 handling, following the file's existing
by-pointer citation style (confirmed at lines 176, 182, 197 — e.g. `` Per `queue-dag.md`
Step 4: compute execution waves via topological sort on `depends_on` before batch
selection. ``). No logic duplicated inline — this is additive only (ADR-005
Refactoring Impact: "an addition, not a modification of existing behavior").
**Depends on**: T3.
**Acceptance criteria**:
- New line/subsection added near the existing "## Wave scheduling" section, citing
  `merge-gate.md` by pointer in the same style as existing citations.
- Zero inline `mergeEligible` logic in `orchestrator.md`.
- `bun run build && bun run verify` exits 0.

**T7 — `forge-sync.md` new steps (drift reconciliation + cycle detection)**
Insert two new steps into `src/references/forge-sync.md`'s numbered sequence
(current: 1 → 1.5 → 2 → 3 → 4 → 5 → 6 → 6.5 → 7 → 8 → 9 → 10):
- **Step 5.5** "Merge-hold drift reconciliation" (mirrors the existing 6.5 numbering
  pattern), inserted after step 5 (Reconcile existing queue entries) and before step 6
  (Parse dependencies from issue body): for issues with `merge_hold: true` or an
  unresolved `merge_after`, run `gh pr view --json state,mergedAt`; on an
  externally-merged-while-held detection, log `V-MERGE-02` (WARN) to
  `findings-ledger.json`.
- A new cross-graph cycle-detection step inserted between step 6.5 (Dependency
  write-back) and step 7 (PR cross-reference) — since 6.5 already deals with
  `depends_on`, cycle checks sit naturally adjacent, before persistence (step 8): checks
  `merge_after` ∪ `depends_on` for cycles; on a cycle, sets both issues
  `status: blocked` with note `merge-order cycle with #N` per `merge-gate.md` §
  cycle detection.
Both new steps consult `merge-gate.md` by pointer rather than embedding the algorithm.
Optionally extend the sync summary (step 10) to report drift/cycle counts when material.
**Depends on**: T3.
**Acceptance criteria**:
- Step 5.5 and the new cycle-detection step (numbered to avoid renumbering 7-10 —
  e.g. 6.6) both present, each citing `merge-gate.md` by pointer, zero inline algorithm
  duplication.
- `bun run build && bun run verify` exits 0.

**T9 — Campaign Launch Configuration Gate**
Add an interactive scope/merge_mode confirmation gate at true campaign start, so the
user sets these via a quick form instead of hand-editing `.blackhole/config.json`.
Three sub-parts:
- **(a) ADR-005 amendment**: append a new `## Components` subsection,
  "Campaign Launch Configuration Gate," to
  `documentation/decisions/ADR-005-pr-merge-gate-dependency-ordering.md` documenting
  this mechanism (additive amendment, not a supersede — no existing ADR-005 content is
  replaced, so no `supersedes:`/`status: deprecated` machinery applies per
  `mercure-doc-governance.md`). Bump the ADR's own `last_updated` if its frontmatter
  carries one.
- **(b) `src/agents/coordinator.md` — Bootstrap preflight**: before running
  `bun run doctor`, when `.blackhole/config.json` does not yet exist (true first
  bootstrap), ask the user via the coordinator's existing `AskQuestion` gate:
  (1) **Scope** — "All open issues (default)" | "Specific label(s)" | "Specific
  milestone" — mapping directly onto the existing `scope_labels`/`scope_milestone`
  fields (reuse, do not reinvent); (2) **Merge mode** — "Immediate — merge each PR as
  it reaches LGTM (default)" | "Gated batch — wait for all in-scope PRs to reach LGTM,
  self-review, then merge in dependency order" — mapping onto `merge_mode` (T2). Write
  confirmed answers into `.blackhole/config.json` before proceeding to `bun run doctor`
  / orchestrator spawn. Skip the gate entirely when `.blackhole/config.json` already
  exists (covers resume and a pre-committed template per config-template.md's "do not
  overwrite existing runtime config without user confirmation").
- **(c) `src/references/phase-loop.md` — Campaign complete section**: extend the
  existing "Campaign complete" report (SHIPPED summary, LEDGER OPEN count, deferred
  issues) to also ask the user "Start a new campaign?" — a **yes** re-fires the T9(b)
  gate before the coordinator's next orchestrator spawn; **no** ends the session
  normally with no further prompting.
- **(d) `src/agents/coordinator.md` — Chat Feedback Intake Protocol**: add explicit
  handling for a mid-campaign "reconfigure scope" / "change merge mode" user message —
  routes to the T9(b) gate on demand, re-writing `.blackhole/config.json`, without
  waiting for campaign completion.
**Depends on**: T2 (`merge_mode` field must exist to reference), T4 (edits the same
"Campaign complete" section in `phase-loop.md` that T4 touches — sequenced after to
avoid conflicting edits).
**Acceptance criteria**:
- ADR-005 has a new "Campaign Launch Configuration Gate" components subsection.
- `coordinator.md`'s Bootstrap preflight section documents the two-question gate, its
  skip condition (existing `config.json`), and where answers are written.
- `phase-loop.md`'s Campaign complete section documents the "Start a new campaign?"
  follow-up question and its yes/no branches.
- `coordinator.md`'s Chat Feedback Intake Protocol documents the mid-campaign
  reconfigure path.
- None of (b)/(c)/(d) duplicate `merge-gate.md`'s eligibility/cycle/drift algorithm —
  this task is purely about *setting* `scope`/`merge_mode`, not consuming them.
- `bun run build && bun run verify` exits 0.

**T8 — Full regression verification**
No file edits — pure verification.
**Depends on**: T1, T2, T3, T4, T5, T6, T7, T9 (all prior tasks complete).
**Acceptance criteria**:
- `bun run build` exits 0 (regenerates all compiled platform targets from `src/`,
  `--gemini` included if that target is in scope).
- `bun run verify` exits 0 ("Verify build is in sync" plus all other coherence checks).
- `bun test` full suite exits 0 with zero new failures (no new `*.test.ts` files are
  expected — matches the ADR-004 step-1 precedent: a schema/fixture-only change, commit
  `1512d4c`, touched zero files under `scripts/`).
- `git diff --stat` confirms only `src/references/*.md`, `src/agents/orchestrator.md`,
  `src/agents/coordinator.md`, `fixtures/*.example.json`, and
  `documentation/decisions/ADR-005-pr-merge-gate-dependency-ordering.md` changed — zero
  hand-edits under `.claude/`, `.cursor/`, `codex-*`, `.gemini-plugin/`, `plugins/`, or
  the flat `skills/`/`agents/`/`references/`/`rules/` mirrors.

## Critical Files

| File | Change Type |
|------|-------------|
| `src/references/queue-dag.md` | Modify |
| `src/references/config-template.md` | Modify |
| `src/references/merge-gate.md` | New file |
| `src/references/phase-loop.md` | Modify |
| `src/references/blackhole-vcodes.md` | Modify |
| `src/agents/orchestrator.md` | Modify |
| `src/references/forge-sync.md` | Modify |
| `src/agents/coordinator.md` | Modify (T9) |
| `documentation/decisions/ADR-005-pr-merge-gate-dependency-ordering.md` | Modify — additive amendment (T9a) |
| `fixtures/queue.example.json` | Modify |
| `fixtures/config.example.json` | Modify |

All "Modify" files confirmed present on disk (read in full during discovery). No
changes required to `src/references/findings-ledger.md` (schema already supports
non-file:line findings via the existing `V-BRANCH-*`/`V-GIT-01` precedent), to any
`scripts/*.ts` (confirmed: `doctor.ts`'s `validateConfigJson` only checks
`REQUIRED_CONFIG_KEYS = ['repo','target_branch','forge']`; `scripts/campaign-status.ts`
dashboard visibility is an explicit, documented scope boundary — a possible fast-follow,
not part of this plan), or to `AGENTS.md` (confirmed: does not enumerate `queue.json`
field-level schema, no ripple).

## Codebase Conventions

| Touchpoint | Convention | Source | Required by |
|------------|------------|--------|--------------|
| Reference-doc cross-citation | Agents/docs reference other reference-docs by section pointer (`` Per `file.md` § Section `` / `Step N`), never duplicate logic inline | `src/agents/orchestrator.md:176,182,197` (confirmed, e.g. `` Per `queue-dag.md` Step 4: ... ``) | V-INT-01..03 |
| Compiled-artifact boundary | All hand-edits land under `src/` only; `.claude/`, `.cursor/`, `codex-*`, `.gemini-plugin/`, `plugins/`, and flat `skills/`/`agents/`/`references/`/`rules/` mirrors are `scripts/build.ts` outputs — run `bun run build && bun run verify` after every task | `ARCHITECTURE.md` § Project Structure (Golden rule); ADR-005 Source-of-truth note | Build coherence gate |
| `queue.json` optional-field documentation pattern | New optional per-issue fields documented as a JSON schema fragment plus a `### \`field\` object` subsection with its own Field table (mirrors the `route` object precedent) | `src/references/queue-dag.md:47-79` (`### \`route\` object`) | V-INT-01, V-DOC-02 |
| V-code table row format | New V-codes added as a single terse `\| Code \| Rule \| Severity \|` row — file explicitly instructs "do not paste longer definitions (token cost, drift)" | `src/references/blackhole-vcodes.md:1-11` (confirmed) | V-INT-01 |
| Findings-ledger non-file:line precedent | Scheduling-state findings with no natural file:line anchor follow the existing `V-BRANCH-*`/`V-GIT-01` precedent — omit/null file/line rather than forcing a sentinel value | `src/references/findings-ledger.md` (schema unchanged); ADR-005 Trade-offs table (Option C rejection rationale) | Ledger schema conformance |
| `forge-sync.md` decimal step-numbering | New sub-steps inserted with decimal numbers adjacent to their related concern (e.g. the existing `6.5 Dependency write-back`) rather than renumbering the whole file | `src/references/forge-sync.md:145` (`### 6.5 Dependency write-back`) | V-INT-01 |
| Coordinator gate style | User-facing choices in `coordinator.md` are asked via the file's own `AskQuestion` convention (already used for Chat Feedback Intake triage and blocker resolution), not a new mechanism | `src/agents/coordinator.md` § Chat Feedback Intake Protocol | V-INT-01 |
| ADR additive-amendment protocol | Appending a new component to an already-accepted/proposed ADR (not replacing existing content) requires no `supersedes:`/`status: deprecated` — only a `last_updated` bump | `mercure-doc-governance.md` § Supersede-on-Overwrite Protocol (scoped to substantive replacements only) | V-DOC-GOV-04 |

## Dependency Blast-Radius

| Changed File | Downstream Consumers | Blast Radius |
|--------------|----------------------|---------------|
| `src/references/queue-dag.md` (schema) | `src/agents/orchestrator.md` (reads by pointer), `src/references/forge-sync.md`, `src/references/merge-gate.md` (new) | LOW — additive fields, safe defaults |
| `src/references/config-template.md` (`merge_mode`) | Bootstrap ("copy template to runtime if missing fields"), `merge-gate.md`, `coordinator.md` (T9) | LOW — additive, safe default |
| `src/references/phase-loop.md` (merge step + Campaign complete) | `src/agents/orchestrator.md` (executes Phase 5 by pointer) | LOW — default `merge_mode: immediate` + empty `merge_after` + `merge_hold: false` means the precondition always passes for non-opted-in campaigns; the Campaign complete extension (T9c) only adds one follow-up question after an already-existing report, no change to completion detection itself |
| `src/references/blackhole-vcodes.md` | Compiled by `scripts/build.ts` into **every** platform target's `references/` dir and `.claude/rules/blackhole-vcodes.md` (single source, confirmed no other manual copy exists) | MEDIUM — every worker agent's prompt restates this table; new rows are additive-only but increase every prompt's token footprint slightly |
| `src/references/forge-sync.md` | `orchestrator.md` (Phase 0 bootstrap / every turn / Phase 5 loop / session resume triggers), every phase relying on fresh `queue.json` | MEDIUM — runs every orchestrator turn; new steps must not slow or break the existing sync loop |
| `src/agents/coordinator.md` (T9) | Sole entry point for campaign bootstrap and chat-feedback intake — no other file spawns the orchestrator | MEDIUM — gate only fires on true first-bootstrap, campaign-complete-confirm, or explicit reconfigure request; resume path (the common case) is provably unaffected since none of those three conditions hold on resume |
| `documentation/decisions/ADR-005-...md` (T9a) | `documentation/decisions/INDEX.md` (row already present, summary unaffected by an additive component amendment) | LOW — additive-only, no `supersedes` needed |

**Overall blast radius**: LOW-MEDIUM. Fully additive and default-preserving; the two
MEDIUM drivers (vcodes table's build-wide propagation, forge-sync's every-turn
execution) are both mitigated by the additive-only, pointer-citation design mandated
above.

## Edge Cases & Boundary Conditions

Scoped to the `merge-gate.md` algorithm spec (T3) since it is precise algorithmic logic
consumed by agents, not narrative documentation:

| Boundary Type | Scenario | Acceptance Criterion |
|----------------|----------|------------------------|
| Empty `merge_after` | Issue has `merge_after: []` (default) | `mergeEligible` resolves this condition as vacuously satisfied — matches `depends_on`'s existing empty-array semantics |
| Predecessor closed, not merged | A `merge_after` entry has `status: closed` (wontfix/duplicate) | Resolves as satisfied — same `merged OR closed` rule as `depends_on` (the documented deadlock fix) |
| Self-referential or mutual cycle | Issue A `merge_after: [B]`, B `merge_after: [A]` (or cross-graph via `depends_on`) | Cycle detector flags both, sets `status: blocked` with note `merge-order cycle with #N`, surfaced via AskQuestion — never silently deadlocks |
| Gated-batch, single in-scope issue | Only one issue matches `scope_milestone`/`scope_labels` | Sibling-LGTM check is vacuously true for a scope of one — behaves identically to immediate mode |
| Hold set AND `merge_after` unresolved simultaneously | Both `merge_hold: true` and an unresolved `merge_after` entry | Either condition alone is sufficient to block; `mergeEligible` short-circuits on the first failing condition (evaluation order does not affect correctness) |
| External merge while held | PR merged manually (bypassing the hold) between orchestrator turns | `forge-sync` step 5.5 (T7) detects via `gh pr view --json state,mergedAt`; logs `V-MERGE-02` WARN (audit only — the merge itself cannot be undone) |
| Launch gate fires on resume | Orchestrator restarts mid-campaign (crash recovery, session resume) | `.blackhole/config.json` already exists → T9(b) gate does not fire; none of the three trigger conditions (first-bootstrap, campaign-complete-confirm, explicit reconfigure) hold on a bare resume |
| User declines "Start a new campaign?" | Campaign-complete report (T9c) asks and user says no | Session ends normally; no orchestrator respawn, no gate re-fire — matches existing Interrupt & Management Policy (never force continuation) |

## Execution Strategy

**Pattern**: Sequential. All 9 tasks touch a small, tightly interdependent set of
reference/agent docs — T3 (`merge-gate.md`) must exist before T4/T5/T6/T7 can cite it,
T1/T2 must land before T3 can reference their field shapes, and T9 depends on T2
(`merge_mode` field) and T4 (shares `phase-loop.md`'s Campaign complete section). Task
count (9) and dependency shape do not meet the native `Workflow` tool's
≥3-5-parallel-agent, background-safe threshold — `Agent` tool with sequential
single-agent-per-batch delegation is the correct primitive (per
`mercure-agent-delegation.md` § Workflow vs. Agent).

| Agent | Task(s) | Model | Delegation Contract |
|-------|---------|-------|----------------------|
| x-doc-writer | T1, T2 | sonnet | **Objective**: add `merge_hold`/`merge_after` fields to `queue-dag.md`'s schema + Field table (mirroring the `route` object subsection pattern) and `merge_mode` to `config-template.md` + both fixtures. **Output format**: 2 reference docs + 2 fixture JSON files updated; `bun run build && bun run verify` exits 0. **Scope**: `src/references/queue-dag.md`, `src/references/config-template.md`, `fixtures/queue.example.json`, `fixtures/config.example.json` only. **Tool guidance**: read the existing `### \`route\` object` subsection first as the template. **Stop condition**: schema + fixture changes present and build/verify green. |
| x-doc-writer | T3 | sonnet | **Objective**: author `src/references/merge-gate.md` implementing `mergeEligible()`, cross-graph cycle detection, forge-drift reconciliation, and gated-batch scope wait per ADR-005 § Components and § Key Assumptions. **Output format**: new reference doc; build/verify green. **Scope**: `src/references/merge-gate.md` only (new file). **Tool guidance**: read ADR-005 in full plus the post-T1/T2 `queue-dag.md`/`config-template.md` and `scripts/forge-scope.ts` (reuse, do not reinvent) before writing. **Stop condition**: all 4 sub-algorithms documented, covering this plan's Edge Cases table; build/verify green. |
| x-doc-writer | T4, T5, T6, T7 | sonnet | **Objective**: wire the `mergeEligible()` precondition into `phase-loop.md`'s merge checklist; add `V-MERGE-01`/`V-MERGE-02` rows to `blackhole-vcodes.md`; add the `merge-gate.md` pointer to `orchestrator.md` Phase 5; insert `forge-sync.md` step 5.5 (drift reconciliation) and the cross-graph cycle-detection step (between 6.5 and 7). **Output format**: 4 reference/agent docs updated, all citing `merge-gate.md` by pointer with zero inline logic duplication; build/verify green. **Scope**: `src/references/phase-loop.md`, `src/references/blackhole-vcodes.md`, `src/agents/orchestrator.md`, `src/references/forge-sync.md` only. **Tool guidance**: match the existing by-pointer citation style at `orchestrator.md:176` and the decimal step-numbering precedent at `forge-sync.md:145` (§6.5). **Stop condition**: all 4 files updated, zero inline algorithm duplication, build/verify green. |
| x-doc-writer | T9 | sonnet | **Objective**: (a) append the "Campaign Launch Configuration Gate" component subsection to ADR-005; (b) add the two-question scope/merge_mode `AskQuestion` gate to `coordinator.md`'s Bootstrap preflight, firing only when `.blackhole/config.json` doesn't yet exist; (c) extend `phase-loop.md`'s Campaign complete report with a "Start a new campaign?" follow-up; (d) add mid-campaign reconfigure handling to `coordinator.md`'s Chat Feedback Intake Protocol. **Output format**: 1 ADR amendment + 2 agent/reference docs updated (`coordinator.md` touched twice, for (b) and (d)); build/verify green. **Scope**: `documentation/decisions/ADR-005-pr-merge-gate-dependency-ordering.md`, `src/agents/coordinator.md`, `src/references/phase-loop.md` only. **Tool guidance**: reuse `scope_labels`/`scope_milestone`/`merge_mode` field names verbatim — do not invent new config keys; match `coordinator.md`'s existing `AskQuestion` phrasing style used elsewhere in the file. **Stop condition**: all 4 sub-parts present, zero `merge-gate.md` algorithm duplicated, build/verify green. |
| x-tester | T8 | sonnet | **Objective**: run full regression verification and confirm zero hand-edits under compiled-artifact directories. **Output format**: pass/fail report quoting full command output (Verification Evidence gate). **Scope**: read-only verification, no file edits. **Tool guidance**: `bun run build && bun run verify && bun test`; `git diff --stat` to confirm only `src/`, `fixtures/`, and `documentation/decisions/` paths changed. **Stop condition**: all 3 commands exit 0 and diff scope confirmed clean. |

**Parallelization**: T1/T2 batch together (independent, no shared files). T3 is strictly
sequential after T1/T2 (needs the new field shapes to document against). T4/T5/T6/T7
are strictly sequential after T3 but mutually independent of each other (four different
files, no shared state) — safe to batch into a single delegation given their small,
low-risk, additive nature. T9 runs after T4 (shares `phase-loop.md`) but is otherwise
independent of T5/T6/T7 — safe to batch with them or run immediately after. T8 runs
last, after everything else lands.

## Sprint Contract

### Machine-verifiable
- [ ] `bun run build` → exits 0
- [ ] `bun run verify` → exits 0 ("Verify build is in sync" passes, zero drift)
- [ ] `bun test` → full suite green, zero new failures

### Human-verifiable
- [ ] `src/references/merge-gate.md` reads as a complete, unambiguous algorithm
  spec — a new contributor could implement `mergeEligible()` from the doc alone,
  without needing to read ADR-005 itself
- [ ] `coordinator.md`'s launch-config gate reads clearly enough that a user unfamiliar
  with `merge_mode`/`scope_labels` internals can answer both questions from the
  question text alone (no need to read `config-template.md` first)
- [ ] `git diff --stat` confirms only `src/references/*.md`, `src/agents/orchestrator.md`,
  `src/agents/coordinator.md`, `fixtures/*.example.json`, and
  `documentation/decisions/ADR-005-pr-merge-gate-dependency-ordering.md` changed — zero
  hand-edits under compiled-artifact directories

## Risk Assessment

Reused from ADR-005's own Risk Assessment table, with one plan-specific addition
(last row):

| Risk | Impact | Mitigation |
|------|--------|------------|
| Cross-graph cycle (`merge_after` ∪ `depends_on`) undetected until merge-time deadlock | Medium | Cycle detection runs at the forge-sync boundary every turn (T7); any cycle sets both issues `blocked` with note `merge-order cycle with #N` and surfaces via the existing AskQuestion user gate |
| Merge-order predecessor closed instead of merged, dependent stuck forever | Medium | `merge_after` uses the same `merged OR closed` satisfaction rule as `depends_on` (T3) — no new deadlock class |
| Forge drift — PR merged manually outside blackhole while held | Low-Medium | `forge-sync` step 5.5 (T7) checks `gh pr view --json state,mergedAt` for held/gated issues every turn; logs `V-MERGE-02` for audit visibility rather than silently going stale |
| Gated-batch partial failure mid-sequence | Medium | Batch mode merges one PR at a time (T3 spec); `queue.json` is persisted after each individual merge — a mid-batch failure leaves a resumable state for the next orchestrator turn, no rollback logic needed |
| DRY cost — duplicated topological-sort concept vs. git-pr's `pr-dependency-ordering.md` | Low (accepted) | Documented as a deliberate ADR-005 trade-off; revisit via a future ADR if a second consumer of issue-DAG-based merge ordering emerges elsewhere in the ecosystem |
| Decimal step-insertion in `forge-sync.md` (T7) silently orphans any hardcoded step-number citation elsewhere in the codebase | Low | Grep the repo for hardcoded `§6.5` / `step 6` / `step 7` `forge-sync.md` citations before finalizing T7's numbering; use decimal insertion (5.5, 6.6) specifically to avoid renumbering steps 7-10 |
| Launch-config gate fires unexpectedly (e.g. re-fires every resume instead of only first-bootstrap) | Medium | Gate condition is a single, testable check — `.blackhole/config.json` file existence — plus two explicit re-trigger events (campaign-complete-confirm, mid-campaign reconfigure request); T9(b)/(c)/(d) acceptance criteria require all three conditions to be stated explicitly in `coordinator.md`/`phase-loop.md`, not left implicit |

No risk item reaches HIGH severity, so `## Threat Model / STRIDE` and
`## Stop Conditions` sections are intentionally omitted (both are CONDITIONAL on ≥1
HIGH-risk item per `plan-sections.md`) — this is consistent with ADR-005's own Risk
Assessment table, which likewise contains no HIGH-severity row.

## References

- **ADR**: `documentation/decisions/ADR-005-pr-merge-gate-dependency-ordering.md` —
  chosen approach: queue-native state (Option A); rejected: delegate-to-git-pr
  (Option B, real DRY win but disproportionate coupling/governance risk), ledger-driven
  synthetic finding (Option C, ledger dedup-key mismatch and UX regression against the
  user's literal ask). Amended by T9(a) with the Campaign Launch Configuration Gate
  component.
- `ARCHITECTURE.md` § Project Structure (Golden rule) — `src/`-only edit boundary.
- `src/references/queue-dag.md` §§ Field rules, `### route object`, Status transitions.
- `src/references/forge-sync.md` §§ 5, 6, 6.5, 7 (insertion points for T7).
- `src/agents/orchestrator.md:176,182,197` — by-pointer citation style precedent
  (confirmed by direct read).
- `src/agents/coordinator.md` § Bootstrap preflight, § Chat Feedback Intake Protocol,
  § Interrupt & Management Policy (confirmed by direct read — insertion points and
  `AskQuestion` convention for T9).
- `src/references/phase-loop.md` § Campaign complete (confirmed by direct read —
  insertion point for T9c's follow-up question).
- `scripts/doctor.ts:23` (`REQUIRED_CONFIG_KEYS`) — confirms no script change needed for
  `merge_mode`.

## Plan Quality Gate (self-validation)

- [x] Task acceptance criteria: 9/9 tasks have measurable, verifiable criteria
- [x] Critical file existence: 9/11 files confirmed on disk; `merge-gate.md` correctly
  flagged as New file (not expected to exist yet); ADR-005 confirmed on disk (T9a
  amends it, does not create it)
- [x] Dependency completeness: all inter-task dependencies stated explicitly
  (T3←T1,T2; T4-T7←T3; T9←T2,T4; T8←T1-T7,T9)
- [x] Risk mitigation concreteness: 7/7 mitigations are concrete actions (no unqualified
  "monitor"/"be careful"/"consider" language)
- [x] Success criteria measurability: all reference exit codes, `bun` commands, or
  `git diff` output
- [x] Boundary conditions (advisory): Edge Cases & Boundary Conditions section present,
  covering T3's algorithm spec plus T9's gate-timing edge cases (resume, decline)
- [x] Stop conditions (advisory): correctly omitted — no HIGH-risk item in Risk
  Assessment
- [x] Codebase conventions at integration touchpoints: present, 8 rows covering the
  by-pointer citation style, `src/`-only boundary, schema-documentation pattern,
  V-code row format, ledger non-file:line precedent, forge-sync decimal-numbering
  convention, coordinator gate style, and ADR additive-amendment protocol

**Result**: PASS — all blocking checks (1, 8) pass for this Standard-track plan;
retry_count 0.
