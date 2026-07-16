---
type: plan
status: current
initiative: autonomous-thinking-routes
milestone: 3 of 5
adr: documentation/decisions/ADR-010-autonomous-thinking-routes.md
audit: documentation/audits/autonomous-workflow-parity.md
plan_base_commit: d4d978b
track: standard
review_trigger: "on ADR-010 status change or on file change to any Critical File below"
created: 2026-07-15
last_updated: 2026-07-15
related:
  - documentation/decisions/ADR-010-autonomous-thinking-routes.md
  - documentation/audits/autonomous-workflow-parity.md
---

# Milestone 3 — Per-issue analyze route (investigator `analyze` sub-mode)

> Rollout phase P3 of ADR-010 ("Analyze route: investigator `analyze` sub-mode + `needs_analysis`
> + re-route checkpoint + plan consumption"). Depends on **Milestone 1** (P1 — kernel + contract:
> the `autonomy` config block and `artifact-contract.md` that gate and define this milestone's
> promotion target).

## Objective

Give complex issues a pre-plan analysis pass. Add a third investigator sub-mode, `analyze`
(read-only evidence gathering over an issue's blast radius: conventions catalog at integration
touchpoints, architecture-coherence check, performance baselines where measurable), wire it into
the router's `route{}` schema and re-route mechanism, spawn it from Handle on the new
`needs_analysis` flag, and make the planner consume its note (`plans/issue-N-analysis.md`) into
the plan's `## Codebase Conventions` and risk sections — config-gated end-to-end by
`autonomy.enabled && autonomy.analyze_routing` (absent/false = today's behavior, unchanged).

**Scope correction from the initiative's touch-path hint**: the initiative-level scope list
omits `scripts/validate-worker-json.ts` and `scripts/validate-worker-json.test.ts`. Both must be
touched — the script is the single source that validates every worker JSON envelope (including
`investigator`'s `sub_mode` enum and `router`'s `route`/`trigger` enums) against the
`fixtures/worker-json/*.json` corpus this milestone extends. Without updating it, the new
`analyze` sub_mode and `needs_analysis`/`analysis-landed` fields would fail schema validation the
moment a real payload used them — an omission that would silently break item (g)'s "verify
green" requirement. Both files are added to Touch-Paths and Critical Files below.

## Touch-Paths

- `src/agents/investigator.md`
- `src/agents/router.md`
- `src/references/queue-dag.md`
- `src/references/phase-handle.md`
- `src/agents/planner.md` (consumption only — no new track/section, Accretion Guard compliant)
- `src/references/config-template.md`
- `src/references/worker-schemas.md`
- `scripts/validate-worker-json.ts` (scope correction — see Objective)
- `scripts/validate-worker-json.test.ts` (scope correction — see Objective)
- `fixtures/worker-json/` (new fixture files)
- Build outputs via `bun run build` (generated `.claude/`, `.cursor/`, `.agents/build/` trees —
  not hand-edited)

## Documentation Impact

- `documentation/audits/autonomous-workflow-parity.md` finding **G9** (router.md's stale claim
  that the investigator agent "has not landed") is corrected as part of Task 2 — this is a
  documentation-accuracy fix inside an existing file, not a new doc.
- No new `documentation/` file is created by this milestone. `artifact-contract.md` (the file
  that defines the `documentation/audits/analysis-issue-N.md` promotion target referenced in
  Task 1) is a **Milestone 1** deliverable; this milestone only references it by name and does
  not re-author it (DRY, dependency respected).

## Critical Files

| File | Change Type | Why |
|------|-------------|-----|
| `src/agents/investigator.md` | Modify | Add `analyze` sub-mode: preamble (ADR-010 D2 Accretion-Guard verdict), note schema (`sub_mode: analyze`), required body sections, return-format JSON example, promotion-target pointer |
| `src/agents/router.md` | Modify | Add `needs_analysis` classification guidance, `analysis` confidence key, `analysis-landed` re-route checkpoint row; fix G9 stale-claim sentence |
| `src/references/queue-dag.md` | Modify | Add `needs_analysis` field + `confidence.analysis` to the frozen `route{}` schema table and JSON example |
| `src/references/phase-handle.md` | Modify | Extend Investigator agent spawn condition to `route.needs_analysis`; extend note-landing trigger paragraph to the analysis note path and `analysis-landed` checkpoint |
| `src/agents/planner.md` | Modify | Consumption-only: when `plans/issue-N-analysis.md` exists, its conventions catalog feeds `## Codebase Conventions`, baselines feed risk framing |
| `src/references/config-template.md` | Modify | Add `analysis` key to `router_confidence_thresholds` example + Field rules row |
| `src/references/worker-schemas.md` | Modify | Extend Investigator section's `sub_mode` enum + example; extend Router section's `trigger` enum |
| `scripts/validate-worker-json.ts` | Modify | Add `'analyze'` to `SUB_MODES`, `'analysis-landed'` to `TRIGGERS`, `needs_analysis`/`confidence.analysis` to `validateRoute()` |
| `scripts/validate-worker-json.test.ts` | Modify | Assert new fixtures validate/invalidate correctly |
| `fixtures/worker-json/investigator-complete-analyze.json` | New file | Valid `analyze` sub-mode payload for schema regression coverage |
| `fixtures/worker-json/router-routed-needs-analysis.json` | New file | Valid `route` payload exercising `needs_analysis`/`confidence.analysis`/`analysis-landed` |

All "Modify" files confirmed present on disk at `plan_base_commit`.

## Codebase Conventions

| Touchpoint | Convention | Source | Required by |
|------------|------------|--------|-------------|
| Investigator sub-mode dispatch | Sub-mode is set by an explicit spawn-context directive, never self-selected from issue content (mirrors `planner.md`'s `track: skip`/`track: design` directive) | `src/agents/investigator.md:16-19` | V-INT-01..03 |
| Investigator note schema | Fixed YAML frontmatter `issue`, `sub_mode`, `confidence`, `computed_at_revision`; one note file per invocation at `plans/issue-N-{submode}.md` | `src/agents/investigator.md:58-74` | V-INT-01..03 |
| `route{}` schema extension | Additive `needs_*` boolean + matching `confidence.*` key + `router_confidence_thresholds` entry + documented cautious default (ADR-004 extension protocol) | `src/references/queue-dag.md:72-98` | V-INT-01..04 |
| Re-route checkpoint table | Each checkpoint row: trigger name, re-validated flags, one-line rationale; checkpoint reachability is gated on the producing agent having landed | `src/agents/router.md:36-43` | V-INT-01..04 |
| Config kill-switch block | New autonomy sub-features gate on `config.{block}.{sub_flag}` at the consuming agent's entry point, following the `kaizen`/`docs_governance` precedent (absent block = current behavior) | `src/references/config-template.md:52-53` | V-CONFIG-01..02 |
| Worker JSON contract mirroring | `worker-schemas.md` documents the envelope; `scripts/validate-worker-json.ts` enforces it at runtime via literal `as const` enum arrays (`SUB_MODES`, `TRIGGERS`) kept in sync by convention, verified by `validate-worker-json.test.ts` | `src/references/worker-schemas.md:381-419`, `scripts/validate-worker-json.ts:24-26` | V-INT-01..03 |
| Plan consumption of upstream notes | Design Track subsection 1 already reads `route.task_type` from `queue.json` when present, falling back to issue-body-only framing when absent — same optional-upstream-artifact pattern this milestone reuses for the analysis note | `src/agents/planner.md:102-107` | V-INT-01..03 |
| Reference cross-links | Relative `[file.md](file.md)` links between `src/**/*.md`, verified for dead links by `V-LINK-01` | `scripts/checks/core.check.ts:527-541` | V-LINK-01 |

## Task Breakdown

- [ ] **T1 — `investigator.md`: add `analyze` sub-mode.** Add a `## \`analyze\` sub-mode` section
  alongside the existing `research`/`investigate` sections: (1) preamble stating the ADR-010 D2
  Accretion-Guard split-evaluation verdict in plain prose ("same read-only evidence-gathering
  identity/caller/artifact shape as research/investigate — evaluated as a sub-mode, not a new
  agent; see ADR-010 D2"); (2) scope — conventions catalog at integration touchpoints (pattern,
  source `file:line`, usage count), architecture-coherence check, performance baselines where
  measurable; (3) extend the note schema's `sub_mode` enum documentation to `research | investigate
  | analyze` and the note-path convention to `plans/issue-N-analysis.md`; (4) a promotion-target
  pointer: "promoted to `documentation/audits/analysis-issue-N.md` per `artifact-contract.md`;
  missing promotion is `V-AUTO-02`" (pointer only — does not re-define the promotion mechanism,
  which is Milestone 1's deliverable); (5) a `sub_mode: "analyze"` JSON example in the Return
  format section.
  **Acceptance**: `investigator.md` contains a `## \`analyze\` sub-mode` heading; the note schema
  block lists `analyze` as a valid `sub_mode` value; the preamble text names ADR-010 D2 and the
  words "sub-mode" and "not a new agent" (or equivalent); the Return format section shows a JSON
  block with `"sub_mode": "analyze"`; the promotion-target sentence names both
  `documentation/audits/analysis-issue-N.md` and `V-AUTO-02`.

- [ ] **T2 — `router.md`: `needs_analysis` flag, `analysis-landed` checkpoint, G9 fix.** Add
  classification guidance for `needs_analysis` (cautious default `true` for `size:l`+ or
  `route.needs_design: true` issues, else `false` — matching ADR-010 D1 verbatim); add `analysis`
  to the `confidence.{...}` object this agent computes; add a fourth row to the Re-route
  checkpoints table, `analysis-landed`, mirroring the `research-landed`/`investigation-landed`
  rows' shape. `[NEEDS CLARIFICATION: ADR-010 D2 does not specify which route fields
  analysis-landed re-validates — mirror research-landed's set (needs_investigation, needs_design,
  plan_mode, security_review_required) as the default unless implementation turns up evidence for
  a narrower analysis-specific subset.]` Also fix audit finding **G9**: the sentence at
  `router.md:50-51` ("research-landed and investigation-landed are not reachable... the
  investigator agent... has not landed") is stale — `investigator.md` already exists and is wired
  live at `phase-handle.md:64-77`. Correct it to state research-landed/investigation-landed are
  reachable, and (once `needs_analysis` fires) analysis-landed becomes reachable the same way.
  **Acceptance**: the Re-route checkpoints table has 4 rows total including `analysis-landed`
  with a populated "Re-validated flags" column; the `confidence` object description lists
  `analysis` as a fifth key; the stale "has not landed" sentence no longer appears verbatim —
  the surrounding paragraph instead states investigator has landed and describes reachability
  accurately for all three note-landing checkpoints.

- [ ] **T3 — `queue-dag.md`: `route{}` schema extension.** Add `needs_analysis` to the `route`
  object JSON example and its Field rules table (confidence-gated per `confidence.analysis` vs.
  `router_confidence_thresholds.analysis`, cautious default `true` for `size:l`+/`needs_design`
  per ADR-010 D1); add `analysis` to the `confidence` field's documented key list.
  **Acceptance**: the `route{}` JSON example block includes a `"needs_analysis": <bool>` line and
  the `confidence` example object gains an `"analysis": <0-100>` key; the Field rules table has a
  `needs_analysis` row stating the cautious-default condition in the same format as the existing
  `needs_split`/`needs_design` rows.

- [ ] **T4 — `phase-handle.md`: spawn condition + note-landing trigger.** Extend the "Investigator
  agent (ADR-004)" § spawn-condition bullet from `route.needs_research` / `route.needs_investigation`
  to also include `route.needs_analysis`, spawning the `analyze` sub-mode. Extend the note-landing
  paragraph to also cover `plans/issue-N-analysis.md` landing as the trigger for router's
  `analysis-landed` checkpoint.
  **Acceptance**: the spawn-condition bullet lists all three flags (`needs_research`,
  `needs_investigation`, `needs_analysis`) each mapped to its sub-mode name; the note-landing
  paragraph names `plans/issue-N-analysis.md` and `analysis-landed` alongside the existing two
  paths/checkpoints.

- [ ] **T5 — `config-template.md`: `router_confidence_thresholds.analysis`.** Add `"analysis": 70`
  to the `router_confidence_thresholds` example JSON (config-template.md:21) and a corresponding
  clause in its Field rules row (config-template.md:45) documenting the new key. Explicitly note
  that `needs_analysis` dispatch is additionally gated by `autonomy.enabled && autonomy.analyze_routing`
  (Milestone 1 deliverable, referenced not re-authored here) — the threshold entry alone does not
  turn the route on.
  **Acceptance**: the `router_confidence_thresholds` JSON example contains `"analysis": 70`; the
  Field rules row's prose lists `analysis` among the keys matching `route.confidence`; a sentence
  cross-references `autonomy.analyze_routing` as the feature-level gate (not this threshold).

- [ ] **T6 — `worker-schemas.md`: envelope docs.** Extend the Investigator section's `sub_mode`
  field-values cell from `research | investigate` to `research | investigate | analyze`, and add
  a second JSON example block showing a `sub_mode: "analyze"` payload. Extend the Router section's
  `trigger` field-values cell to include `analysis-landed`.
  **Acceptance**: § Investigator's field table shows the three-value enum; an `analyze` JSON
  example block is present; § Router's `trigger` field row lists all four trigger values including
  `analysis-landed`.

- [ ] **T7 — `scripts/validate-worker-json.ts`: schema enforcement.** Add `'analyze'` to the
  `SUB_MODES` const array; add `'analysis-landed'` to the `TRIGGERS` const array; in
  `validateRoute()`, add a `requireField(errors, route, 'needs_analysis', isBoolean, 'boolean')`
  call and add `'analysis'` to the `confidence` object's required-key loop
  (`['split', 'design', 'plan_mode', 'security', 'docs', 'analysis']`).
  **Acceptance**: `SUB_MODES` and `TRIGGERS` arrays contain the two new literals; `validateRoute()`
  rejects a `route` object missing `needs_analysis` or `confidence.analysis`; `bun test
  scripts/validate-worker-json.test.ts` passes with the new assertions from T8.

- [ ] **T8 — Fixtures + test assertions.** Add
  `fixtures/worker-json/investigator-complete-analyze.json` (valid `analyze` payload matching T1's
  return format) and `fixtures/worker-json/router-routed-needs-analysis.json` (valid `route`
  payload with `needs_analysis: true`, `confidence.analysis`, `trigger: "analysis-landed"`).
  Extend `scripts/validate-worker-json.test.ts` with assertions that both new fixtures validate
  successfully, and that the pre-existing `investigator-complete-invalid-sub-mode.json` fixture
  still correctly fails against the now-three-value `SUB_MODES` enum (regression guard against a
  copy-paste enum typo).
  **Acceptance**: both new fixture files exist and are referenced by name in
  `validate-worker-json.test.ts`; `bun test scripts/validate-worker-json.test.ts` is green; the
  invalid-sub-mode negative-case assertion still fails as expected post-change.

- [ ] **T9 — `planner.md`: plan consumption (read-only).** In the Standard Track's Step 3
  ("Analyze Codebase") or the Codebase Conventions bullet, add: "when `plans/issue-N-analysis.md`
  exists (produced by `investigator`'s `analyze` sub-mode), use its conventions catalog as the
  source for this section's rows instead of independently re-discovering them, and fold its
  performance-baseline findings into risk framing — mirrors how mercure's `x-plan` consumes
  `x-analyze`'s Convention Catalog / Performance Baselines output." State explicitly that this is
  read-only consumption of an existing artifact and does not add a new planner track or template
  section (Accretion Guard compliance — investigator gained a 3rd sub-mode in T1, planner gains
  zero new tracks here).
  **Acceptance**: the Standard Track prose names `plans/issue-N-analysis.md` as an optional
  consumption source for `## Codebase Conventions`; the sentence explicitly states no new track or
  `##` heading is added; no other section of `planner.md`'s Plan Complexity Tracks list changes.

## Risk Assessment

| Risk | Severity | Mitigation |
|------|----------|------------|
| `SUB_MODES`/`TRIGGERS` enum drift between `worker-schemas.md` (docs) and `validate-worker-json.ts` (enforcement) — a future edit to one without the other silently reopens schema validation gaps | MEDIUM | T7 and T8 pin the enforcement side to a fixture-backed regression test (`bun test scripts/validate-worker-json.test.ts`) that fails loudly on drift; T6 keeps the docs side textually adjacent to the enum it mirrors |
| Cautious-default over-triggering: `needs_analysis: true` for every `size:l`+ issue could flood `documentation/audits/` with low-value per-issue analysis notes | MEDIUM | ADR-010's own mitigation is already the default scope: analyze fires only for `size:l`+ or `needs_design: true` issues (T2's classification guidance encodes this verbatim, not a looser trigger); Milestone 1's `autonomy.analyze_routing` sub-flag gives an independent kill switch without disabling the whole `autonomy` block |
| Stale-doc regression: fixing G9 in T2 without also checking `phase-handle.md`'s already-correct wording could reintroduce an inconsistency between the two files | LOW | T2's acceptance criterion requires the corrected sentence to match the reachability description already present at `phase-handle.md:64-77`, verified by a side-by-side read during Task 2, not by a new automated check (the existing `V-LINK-01` link-integrity check does not catch prose drift, only broken links) |
| `needs_analysis` re-route-checkpoint field list left under-specified (marked `[NEEDS CLARIFICATION]` in T2) could cause `router.md` and the eventual `analysis-landed` implementation to diverge if resolved differently at implementation time | MEDIUM | T2 supplies a concrete default (mirror `research-landed`'s re-validated-flags set) so the marker does not block planning; the marker surfaces the open question for explicit human confirmation before or during implementation rather than leaving it silently assumed |

No HIGH-severity item is present; `## Threat Model / STRIDE` and `## Stop Conditions` sections
are therefore omitted per the conditional-inclusion rule (ADR-082 C1) — this milestone touches no
authentication, data-mutation, or externally-exposed surface; it is additive documentation +
schema-validation-script work behind an existing config kill switch.

## Dependency Blast-Radius

| Changed File | Downstream Consumers | Blast Radius |
|--------------|----------------------|---------------|
| `src/agents/investigator.md` | `phase-handle.md` (spawn condition), `worker-schemas.md` (contract mirror), `validate-worker-json.ts` (schema enum), `planner.md` (note consumption) | MEDIUM |
| `src/agents/router.md` | `queue-dag.md` (schema truth table, referenced not duplicated), `config-template.md` (thresholds), `orchestrator.md` (route-derived dispatch — **not** a T-numbered touch path in this milestone; existing `plan_mode`/`needs_split`/`needs_design` dispatch is untouched, `needs_analysis` has no orchestrator dispatch consumer yet, same "computed and confidence-gated, no dispatch consumer" state `docs_impact` was in before its own dispatch wiring landed) | LOW |
| `src/references/queue-dag.md` | `router.md` (schema source of truth), `validate-worker-json.ts` (schema validation), `coordinator-dashboard.md` (Routing section display — **not** touched; dashboard simply will not render a `needs_analysis` column until a separate change adds it, TRANSPARENT) | LOW |
| `src/references/phase-handle.md` | Orchestrator turn sequencing (spawn timing only — no schema or contract change) | LOW |
| `src/agents/planner.md` | `implementer.md`, `reviewer.md` (both receive `PLAN_CONTEXT` extracted from planner's plan file — Codebase Conventions row content changes when an analysis note exists, but the plan file's own schema/frontmatter is unchanged) | LOW |
| `src/references/config-template.md` | `router.md` (reads the new threshold key) | LOW |
| `src/references/worker-schemas.md` | Documentation-only — no runtime consumer beyond human/agent reference reading | LOW |
| `scripts/validate-worker-json.ts` | `scripts/campaign-resume-signal.ts` and any hook invoking `validateWorker()`; `scripts/validate-worker-json.test.ts` | MEDIUM |

**Overall blast radius**: MEDIUM. Every change is additive to an optional (`route` object
already documented as `object | absent`, ADR-004) or config-gated (`autonomy.analyze_routing`)
surface; no existing field, enum value, or file path is renamed or removed, so no consumer not
listed above is affected (TRANSPARENT per ADR-010's own Refactoring Impact table, which classifies
`queue-dag.md`, `router.md`, and `phase-handle.md` as TRANSPARENT for this exact rollout phase).

## Success Criteria

- `bun test scripts/validate-worker-json.test.ts` passes, including new assertions for
  `investigator-complete-analyze.json` and `router-routed-needs-analysis.json`.
- `bun run verify` exits 0 (all checks green, including `V-LINK-01` cross-reference integrity
  across the 7 touched markdown files).
- `bun run build` regenerates build outputs with no drift-check failure.
- `router.md` no longer contains the stale G9 sentence (grep for "has not landed" returns no
  match in `router.md`'s Re-route checkpoints section).
- A manual read of `investigator.md`'s `analyze` sub-mode section and `planner.md`'s updated
  Standard Track Step 3 confirms both are legible to a contributor who has not read ADR-010 —
  each states its rationale (Accretion-Guard verdict; consumption-not-new-track) inline rather
  than only by ADR cross-reference.

## Execution Strategy

**Pattern**: Mixed — sequential core (schema + spawn-condition files must land in a fixed order
so each downstream file references an already-decided shape), then two parallel tails.

| Agent | Task(s) | Model | Delegation Contract |
|-------|---------|-------|---------------------|
| x-refactorer | T1, T2, T3, T4 | sonnet | **Objective**: Land the `analyze` sub-mode identity (investigator.md), its route-flag classification + re-route checkpoint + G9 fix (router.md), its frozen schema fields (queue-dag.md), and its spawn condition (phase-handle.md), in that order — each file after T1 references a decision made in the prior one. **Output format**: in-place markdown edits to the 4 listed files. **Scope**: read/edit only these 4 files plus read-only reference to `ADR-010-autonomous-thinking-routes.md` and `autonomous-workflow-parity.md` for citation accuracy. **Tool guidance**: Grep for exact line ranges before editing to preserve surrounding prose; Read full section before Edit to avoid duplicate-heading collisions. **Stop condition**: all 4 files pass their Task Breakdown acceptance criteria (T1-T4). |
| x-refactorer | T5, T6 | sonnet | **Objective**: Add the `analysis` confidence-threshold key (config-template.md) and extend the worker-schemas.md envelope docs (`sub_mode` enum, `trigger` enum, analyze JSON example) to match the shape T1-T3 already established. **Output format**: in-place markdown edits to the 2 listed files. **Scope**: read/edit only these 2 files; read T1-T3's committed content for the exact enum values/field names to mirror. **Tool guidance**: Grep for the existing `router_confidence_thresholds` and `sub_mode` occurrences before editing. **Stop condition**: both files pass their T5/T6 acceptance criteria. Runs in parallel with the T1-T4 sequential chain's final step is not required — T5/T6 depend only on T1's/T3's field names, which x-refactorer reads directly rather than waiting on task completion signaling. |
| x-tester | T7, T8 | sonnet | **Objective**: Extend `validate-worker-json.ts`'s enum/route-validation logic for `analyze`/`needs_analysis`/`analysis-landed`, then add the two new fixture files and their test assertions in `validate-worker-json.test.ts`, including a regression check that the existing invalid-sub-mode fixture still fails correctly. **Output format**: TS source edit + 2 new JSON fixture files + test-file edit. **Scope**: `scripts/validate-worker-json.ts`, `scripts/validate-worker-json.test.ts`, `fixtures/worker-json/*.json` only — no other script files. **Tool guidance**: run `bun test scripts/validate-worker-json.test.ts` after each edit, not only at the end, to isolate which assertion broke. **Stop condition**: `bun test scripts/validate-worker-json.test.ts` is green and includes assertions for both new fixtures. Depends on T3 (route schema fields must be finalized before the validator can enforce them). |
| x-refactorer | T9 | sonnet | **Objective**: Add the consumption-only prose to planner.md's Standard Track Step 3 / Codebase Conventions bullet, explicitly citing the mercure x-plan/x-analyze consumption precedent and stating no new track is added. **Output format**: in-place markdown edit to `src/agents/planner.md`. **Scope**: `planner.md` only — do not touch its Plan Output File Template or any other track. **Tool guidance**: Read the full Design Track subsection 1 first (existing route.task_type consumption precedent at planner.md:102-107) to match its citation style. **Stop condition**: T9's acceptance criterion passes. Depends on T1 (the note path/schema it references must already be documented). |
| x-reviewer (quality mode) | Final gate | sonnet | **Objective**: Full-diff review across all 11 touched/new files for V-INT-01..04 (convention coherence with the table above), V-LINK-01 (no dead cross-references introduced), V-DOC-GOV-02..03 (this milestone plan's own frontmatter, if audited), and general SOLID/DRY/KISS on the TS script change. **Output format**: standard x-reviewer findings table. **Scope**: the diff produced by the 4 tasks above only — no unrelated files. **Tool guidance**: run `bun run verify` and `bun test scripts/validate-worker-json.test.ts` as part of the review, not just static reading. **Stop condition**: zero CRITICAL/HIGH findings, or documented user-approved exceptions for any HIGH finding. |

**Parallelization**: T1→T2→T3→T4 sequential (Phase A, x-refactorer). T5, T6, and T9 run in
parallel with each other once T1/T3 have landed (Phase B — all three only read T1-T3's committed
field names, they do not depend on each other). T7→T8 sequential (Phase C, x-tester), starting
once T3 has landed (does not need to wait for Phase B). Final x-reviewer gate runs after Phases
B and C both complete. Maximum parallel agents in any phase: 3 (Phase B) — within the ≤4
parallel-agents-per-phase guidance.

## Sprint Contract

### Machine-verifiable
- [ ] `bun test scripts/validate-worker-json.test.ts` → all assertions pass, including new
  `analyze`/`needs_analysis`/`analysis-landed` coverage
- [ ] `bun run verify` → exits 0 (all checks green)
- [ ] `bun run build` → regenerates build outputs with no drift-check failure

### Human-verifiable
- [ ] A reviewer confirms `router.md`'s corrected G9 sentence and `phase-handle.md`'s existing
  investigator-landed description are now consistent when read side by side
- [ ] A reviewer confirms `investigator.md`'s `analyze` sub-mode preamble and `planner.md`'s T9
  consumption note are each legible standalone (state their rationale inline, not only via ADR
  cross-reference)
