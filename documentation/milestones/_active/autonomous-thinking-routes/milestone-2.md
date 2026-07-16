---
type: plan
status: planned
plan_base_commit: d4d978b
track: standard
initiative: autonomous-thinking-routes
milestone: 2 of 5 (Design autonomy)
related:
  - documentation/decisions/ADR-010-autonomous-thinking-routes.md
  - documentation/audits/autonomous-workflow-parity.md
  - documentation/milestones/_active/autonomous-thinking-routes/milestone-1.md
review_trigger: "on milestone completion"
created: 2026-07-15
last_updated: 2026-07-15
---

# Milestone 2 — Design autonomy: blind critics + deterministic design-aggregate verdict (ADR-010 P2)

## Objective

Replace the Design Track's unconditional `status: blocked` (`planner.md` §4.8) with a
config-gated autonomous path, closing ADR-010's CRITICAL "self-graded homework" finding: the
planner must never choose its own scoring axes, and it must never certify its own recommendation.
Three components do this, mirroring the proven `review-aggregate.ts` pattern (ADR-003):

1. A **fixed rubric** (`src/references/design-rubric.md`) — trade-off matrix columns and weights
   per decision type, defined once, outside the planner's control.
2. **Blind critics** — the Design Track's two existing critique-only planner sub-invocations
   (§4.3, unchanged multiplicity cap of 2) stop receiving the primary's provisional Chosen and
   instead independently score every option against the fixed rubric, returning structured JSON.
3. A **deterministic verdict script** (`scripts/design-aggregate.ts`) that computes `ready` or
   `blocked` from the primary's matrix plus both critic JSONs — the planner cannot self-certify;
   the orchestrator applies only the script's output.

This is gated end-to-end by `autonomy.enabled && autonomy.design_autonomy` (both default `false`,
shipped in Milestone 1). With the block absent or either flag `false`, `planner.md` §4.8 behaves
byte-for-byte as it does today — unconditional `status: blocked`, no confidence bypass. Pareto
value 30% / effort 30% — the highest-risk milestone in the initiative (it is the one place a
backlog campaign could merge an architectural decision with no human in the loop), matched by the
heaviest verification bar: TDD-first on the verdict script, a fail-safe default on every
aggregation-input anomaly, and a still-mandatory human review of the ADR the ready path produces
(merge = approval, per M1's `artifact-contract.md`).

**Out of scope** (do not touch): the `needs_analysis`/`needs_brainstorm` route flags (M3/M4), the
`confidence-gates.md` kernel used elsewhere in the initiative (M1 — this milestone consumes only
the `autonomy` config block M1 already ships, not the confidence kernel), the hunter
`retrospective` kind (M5), and Component Decomposition / Design Principles Validation / Assumption
Audit subsections of the Design Track template — those three keep their current unblind, primary-
authored form; only §4.3 (Adversarial Evaluation) and §4.8 (Gate) change.

## Task Breakdown

**Dependency order**: Task 1 → Task 2 → {Task 3, Task 4} → Task 5 → {Task 6, Task 7} → Task 8 →
Task 9. Task 2 depends on Task 1 (TDD: failing tests before implementation). Tasks 3 and 4 depend
on Task 2 (the rubric and schema must exist before the planner template that references them).
Task 5 depends on Tasks 3–4 (the rewritten Design Track cites both). Tasks 6–7 depend on Task 5
(dispatch and the approval-gate table both branch on the new §4.8 contract). Task 8 depends on
Tasks 5–7 (the grounding check asserts markers across all three files). Task 9 is the full-suite
regression gate and depends on everything above.

- [ ] **Task 1 — `scripts/design-aggregate.test.ts` (TDD RED, write first)**: Author the full test
  suite before any implementation exists, mirroring `review-aggregate.test.ts`'s fixture-factory
  convention (`baseFinding` → `baseCriticScore`/`basePrimaryInput` with `Partial<T>` overrides).
  Cases: (1) all three scorers (primary + 2 critics) agree the winner dominates by more than
  `design_dominance_delta` → `ready`; (2) dominance holds on 2 of 3 scorers, tie/near-tie on the
  third → `blocked`; (3) critic disagreement — one critic ranks a different option as winner →
  `blocked`; (4) a discriminating `CRITICAL` finding tagged on the winning option → `blocked` even
  when dominance and Refactoring Impact both pass; (5) a domain-inherent `CRITICAL` finding (not
  discriminating) on the winner → does NOT block; (6) Refactoring Impact table contains ≥1
  `BREAKING` consumer → `blocked` regardless of scores; (7) tie score (0% dominance) → `blocked`;
  (8) exactly at the `design_dominance_delta` threshold (boundary) → `blocked` (delta must be
  exceeded, not met — document this as the exercised boundary); (9) missing/malformed critic JSON
  (only 1 of 2 critics returned, or a critic returned invalid shape) → `blocked`, fail-safe
  default, matching ADR-010's "any aggregation-input anomaly → blocked" contract; (10) custom
  `design_dominance_delta` (e.g. 15) changes the verdict for a case that would `block` at the
  default 30; (11) empty/zero-row trade-off matrix → `blocked` with a descriptive error, not a
  throw. **Verify: RED** — `bun test scripts/design-aggregate.test.ts` fails with "Cannot find
  module" (module does not exist yet).
- [ ] **Task 2 — `scripts/design-aggregate.ts` (TDD GREEN)**: Implement the minimal deterministic
  verdict function satisfying Task 1's suite. Same shape as `review-aggregate.ts:1-207` — typed
  input/output (`CriticScore`, `PrimaryDesignInput`, `DesignAggregateInput`,
  `DesignAggregateOutput`), a pure `aggregateDesign(input): DesignAggregateOutput` export, a
  `parseArgs`/`import.meta.main` CLI entrypoint reading via the shared `readJsonFile` helper
  (`./lib/fs.ts` — do not reimplement JSON-file reads, `V-INT-02`), no side effects beyond
  `stdout`. Verdict logic: compute each scorer's weighted total per option using
  `design-rubric.md`'s weights (Task 3), take the winning option per scorer, require the SAME
  option to win under all three scorers with weighted-total margin over the runner-up exceeding
  `design_dominance_delta` (percentage, default 30) for all three, AND zero discriminating
  `CRITICAL` findings tagged on the winner across both critic JSONs, AND zero `BREAKING` rows in
  the primary's Refactoring Impact Analysis input → `status: "ready"`; any single failed condition
  → `status: "blocked"` with a `reasons: string[]` field naming which condition(s) failed (dominance,
  disagreement, critical-finding, breaking-consumer, malformed-input). **Verify: GREEN** — `bun
  test scripts/design-aggregate.test.ts` → all cases pass, zero regressions in
  `bun test scripts/review-aggregate.test.ts` (shared `lib/fs.ts` import).
- [ ] **Task 3 — `src/references/design-rubric.md` (new file)**: Fixed trade-off matrix columns
  and per-column weights, keyed by decision type — do not let the planner or the aggregate script
  choose axes at runtime. Content: (a) a decision-type taxonomy table (e.g. `architecture-choice`,
  `library-selection`, `refactor-strategy`, `data-model-change` — derive concrete types from the
  6 columns `planner.md:110` already names: Complexity, Maintainability, Risk, Effort,
  Reversibility, Consistency-with-existing-pattern); (b) for each decision type, the fixed subset
  of those columns that applies plus an explicit weight per column (weights sum to 100 per
  decision type — document the sum-to-100 invariant so `design-aggregate.ts` can validate it);
  (c) the weighted-total formula: `weighted_total(option) = Σ(column_score × column_weight) / 100`
  for column scores on a fixed 1–5 scale (document the scale's anchor meanings, e.g. 1=worst,
  5=best, so all three scorers apply it identically — this consistency is what makes "blind"
  scoring comparable across primary and both critics). Cross-reference `planner.md:110-111`'s
  existing "pick 3-5 relevant columns" language — this file is what makes that pick fixed-per-type
  rather than ad hoc, closing the exact gap ADR-010 D4.1 names.
- [ ] **Task 4 — Extend `src/references/worker-schemas.md` (Design Track Critic schema)**: Add a
  new `## Design Track Critic (blind sub-invocation)` subsection immediately after `## Planner
  (\`planner\`)` (currently `worker-schemas.md:125-186`), following that section's exact
  convention (fenced JSON example, then a field table). Schema: `{ per_option_scores:
  { [option: string]: { [column: string]: number } }, findings: [{ option: string, tag:
  "discriminating" | "domain-inherent", severity: "CRITICAL" | "NOTABLE" | "MINOR", note: string
  }] }`. Document that this is returned by the critique-only sub-invocations described in
  `planner.md` §4.3 (Task 5) as plain-text-wrapped JSON in their final response (same extraction
  discipline as the existing SubagentStop hook's fenced-block-first / brace-balanced-fallback
  order documented earlier in this file, `worker-schemas.md:17`) — not a new agent identity, not a
  new validator role in the SubagentStop hook matcher (the sub-invocations are still `planner`
  type; no `disallowedTools`/matcher change needed).
- [ ] **Task 5 — Rewrite `planner.md` Design Track §4.3 and §4.8**: (a) §4.3 (Adversarial
  Evaluation, currently `planner.md:112-127`): keep the 2-invocation multiplicity cap and the
  critique-only/no-write/no-recursion constraints verbatim; change what each invocation receives
  and returns — receives the Options list from subsection 2 WITHOUT the primary's provisional
  Chosen (strip that field from the sub-invocation's context before spawn) and the fixed rubric
  columns/weights for this decision's type (Task 3); returns the Task 4 JSON schema instead of
  free-text critique. The primary still synthesizes both critiques into this subsection's prose
  (for human readability in the artifact) AND passes the raw critic JSONs plus its own weighted
  matrix to `design-aggregate.ts` (Task 2) as the deciding input — the primary's own synthesis
  text is display-only, never the verdict source. (b) §4.8 (Gate, currently `planner.md:147-149`):
  replace the unconditional `status: blocked` with: when `autonomy.enabled && autonomy.
  design_autonomy` is true, invoke `design-aggregate.ts` with the primary matrix + both critic
  JSONs + Refactoring Impact rows; on `status: "ready"`, promote the design note into
  `documentation/decisions/ADR-{NNN}-{slug}.md` plus an INDEX.md row per M1's
  `artifact-contract.md` delivery mechanism (commit inside the issue's PR — no orchestrator file
  write, no draft/final flip; ADR-010 D5), and return `status: "ready"` in the worker JSON with
  `track: "design"`; on `status: "blocked"` (from the script) OR when the config gate is off/
  absent, return `status: "blocked"` exactly as today — unconditional, no confidence bypass, same
  code path the block currently uses. State explicitly in the section prose that the planner
  reads the script's verdict and MUST NOT substitute its own judgment (V-AUTO-01 — Task 8 grounds
  this).
- [ ] **Task 6 — Update `orchestrator.md` Route-derived dispatch**: In the section covering
  `needs_design: true` dispatch (currently `orchestrator.md:90-93`, which points to `phase-plan.md`
  § Plan approval gate for the unconditional human sign-off), add: when the returned planner JSON
  carries `track: "design"` and `status: "ready"` (only possible when Task 5's gate produced it),
  the orchestrator treats this exactly like any other `status: ready` plan — proceeds toward
  implement/PR dispatch without an `AskQuestion` gate. State explicitly that the orchestrator
  applies only the worker JSON's `status` field as returned (which already encodes the script's
  verdict per Task 5) — the orchestrator never re-derives or second-guesses the verdict itself
  (ADR-010's "orchestrator applies the script verdict, never the planner's own claim" — mechanically
  this means the orchestrator's dispatch logic has no branch that inspects design-note *content*,
  only the JSON `status` field, so there is no code path where the orchestrator could be fooled by
  planner prose independent of the script).
- [ ] **Task 7 — Update `phase-plan.md` § Plan approval gate table**: Add one row to the table at
  `phase-plan.md:34-43` for the autonomy branch: `| Design track, autonomy gate ready
  (\`autonomy.enabled ∧ design_autonomy\`, \`design-aggregate.ts\` verdict \`ready\`) | No
  AskQuestion — proceeds like standard/quick \`status: ready\` |`. Keep the existing "Design track
  (ADR-004)" row unchanged directly above it (still "ALWAYS AskQuestion" — that row now implicitly
  reads as "when the autonomy gate is off, or the script verdict is blocked"). Update the
  paragraph directly below the table (`phase-plan.md:44-47`) to note the new row does not change
  the *mechanics* of the AskQuestion path when it does fire — same wording pattern the existing
  paragraph uses for the design-track content-depth disclaimer.
- [ ] **Task 8 — V-AUTO-01 enforcement wiring**: Extend `scripts/checks/design-track.check.ts`
  with a second check function (alongside the existing `checkDesignTrackTemplate`) asserting the
  gated-verdict markers are present in `planner.md` (using the same
  `findMissingGateMarkers`-style helper `single-writer.check.ts` re-exports from
  `core.check.ts` — reuse it, do not write a third marker-scan implementation, `V-INT-02`) and in
  `orchestrator.md`. Required markers (exact substrings, chosen from Task 5/6's prose so the check
  fails if either task's wording is later stripped): planner.md — `"design-aggregate.ts"`, `"MUST
  NOT substitute its own judgment"`; orchestrator.md — `"applies only the worker JSON's \`status\`
  field"` (or the literal wording actually written in Task 6 — align this task's asserted strings
  to Task 6's final prose once written, not the other way around). Emit as check id `V-DESIGN-02`
  (new — sibling to the existing `V-DESIGN-01` heading check, same file, same non-formal grounding
  namespace — confirm neither id appears in `src/references/blackhole-vcodes.md`'s severity table
  before assuming this, since `V-DESIGN-01` today is a build-grounding check, not a table row).
  Add the new check to the file's `runChecks()` array. Bump `scripts/build.ts:288`
  `EXPECTED_CHECK_COUNT` from `27` to `28` (one check function added; `VCODE_TABLE_ROW_COUNT`
  stays `44` — this milestone wires enforcement of V-AUTO-01, it does not add a new row to
  `blackhole-vcodes.md`'s formal severity table; that row ships with Milestone 1's kernel work).
- [ ] **Task 9 — Full regression + build**: Run `bun run build` (regenerate every compiled mirror
  — `.claude/`, `.cursor/`, `.gemini-plugin/`, `.codex-plugin/`, `codex-agents/`, `codex-skills/`,
  `plugins/` — from the `src/` edits in Tasks 3–8; CI rejects drift between `src/` and these
  targets), then `bun test` (full suite — zero regressions, Tasks 1–2's new suite green), then
  `bun run verify` (28/28 checks, no "expected N, ran M" warning). Manually exercise the
  human-verifiable check in Sprint Contract below.

## Critical Files

| File | Change Type | Note |
|------|-------------|------|
| `scripts/design-aggregate.test.ts` | New file | Task 1 — written before Task 2 (TDD) |
| `scripts/design-aggregate.ts` | New file | Task 2 — mirrors `review-aggregate.ts` shape |
| `src/references/design-rubric.md` | New file | Task 3 — fixed columns + weights + formula |
| `src/references/worker-schemas.md` | Modify | Task 4 — new Design Track Critic subsection, inserted after the existing Planner section (`worker-schemas.md:125-186`) |
| `src/agents/planner.md` | Modify | Task 5 — §4.3 (`planner.md:112-127`) and §4.8 (`planner.md:147-149`) only; subsections 1, 4, 5, 6, 7 unchanged |
| `src/agents/orchestrator.md` | Modify | Task 6 — Route-derived dispatch, `needs_design: true` branch (`orchestrator.md:90-93`) |
| `src/references/phase-plan.md` | Modify | Task 7 — Plan approval gate table (`phase-plan.md:34-47`) |
| `scripts/checks/design-track.check.ts` | Modify | Task 8 — new `V-DESIGN-02` check function + `runChecks()` array entry |
| `scripts/build.ts` | Modify | Task 8 — `EXPECTED_CHECK_COUNT` 27 → 28 (`build.ts:288`) |
| `scripts/lib/fs.ts` | Read-only reuse | `readJsonFile` helper consumed by Task 2, not modified |
| `src/references/blackhole-vcodes.md` | Read-only reference | V-AUTO-01/02 rows land with Milestone 1; this milestone reads, does not write, that table |

## Codebase Conventions

| Touchpoint | Convention | Source | Required by |
|------------|------------|--------|-------------|
| Deterministic aggregation script | Pure `aggregateX(input): Output` core, typed I/O, `import.meta.main`-guarded CLI entrypoint reading via the shared `readJsonFile` helper, zero side effects beyond `stdout` | `scripts/review-aggregate.ts:1-207` | V-INT-01..03 |
| Aggregation test suite | `describe`/`test` (bun:test), a `baseX` fixture factory taking `Partial<T>` overrides, one `describe` block per pure function, 15+ parametric cases | `scripts/review-aggregate.test.ts:1-11` | V-TEST-01/02, V-INT-01 |
| Worker JSON schema addition | New contract documented as a fenced JSON example + field table appended after the nearest existing role section, never forked into a new file | `src/references/worker-schemas.md:125-186` | V-INT-01..03 |
| Config kill-switch gating | `config.{block}.enabled && config.{block}.{subflag}` checked at agent/script entry; block absent or `false` = unchanged current behavior, byte-for-byte | `fixtures/config.example.json:15-33` (`kaizen`, `docs_governance`); ADR-010 D8 (`autonomy`) | V-INT-01..03 |
| `verify` check-file domain | `scripts/checks/{domain}.check.ts` exports a pure `runChecks(): CheckResult[]`, glob-discovered by `verify.ts` — no central registry file; marker-presence checks reuse `findMissingGateMarkers`/`findMissingDesignTrackHeadings`, never a third local reimplementation | `scripts/checks/single-writer.check.ts:1-40`, `scripts/checks/design-track.check.ts:1-41` | V-INT-01/02 |
| Grounding fact single-source | Any check-count / table-row-count fact used for a warning/assertion lives solely in `build.ts`, exported once, never restated as a literal at any consumption site | `scripts/build.ts:276-288` (`VCODE_TABLE_ROW_COUNT`, `EXPECTED_CHECK_COUNT`) | V-GROUND-01, V-INT-04 |

## Threat Model / STRIDE

**Trigger**: the Design Track's `status: ready` path removes an existing, unconditional human
review gate (`phase-plan.md` "Design track (ADR-004) | ALWAYS AskQuestion") for a category of
change — architectural decisions — that previously always had one. ADR-010's own Risks table names
this explicitly ("Autonomous design picks a defensible-but-wrong approach"); STRIDE below is the
mechanical breakdown of that named risk plus the categories a control-removal always warrants.

| Threat | Category | Severity | Mitigation | Status |
|--------|----------|----------|------------|--------|
| A malformed or partial critic JSON silently counted as a "pass" (e.g. missing `findings` array treated as empty rather than rejected) lets a bad design through | Tampering | HIGH | Task 1 case 9 — malformed/missing critic input is an explicit test case forcing `blocked`, not a default-pass; Task 2 requires the aggregate function to validate shape before scoring, not merely destructure-and-hope | Mitigated |
| Design-track `ready` skips the `phase-plan.md` AskQuestion gate, removing the only human checkpoint before implementation starts for that issue | Elevation of Privilege | HIGH | The gate is config-off by default (`autonomy.enabled: false`, shipped false in M1); when on, the ADR still lands inside the issue's PR where the reviewer audits it like code and `merge_hold`/PR-close remain human veto points (ADR-010 D5/D6, M1 scope) — this milestone does not weaken those M1-shipped veto surfaces, it only adds the trigger condition that can reach them | Mitigated |
| Two "blind" critics are the same `planner` agent identity spawned twice — correlated bias (both critics share training/prompt biases the primary also has) could produce false dominance | Repudiation (of independent review) | MEDIUM | Named directly in ADR-010's Key Assumptions as "~ Contestable"; out of this milestone's fix scope by design (ADR-010: "if campaign data shows rubber-stamping, escalate critics to a distinct model tier before reaching for a new agent") — recorded here, not silently dropped | Open (tracked in ADR-010, not blocking) |
| `design_dominance_delta` misconfigured very low (e.g. 1%) by a repo operator effectively disables the dominance requirement | Tampering | MEDIUM | Task 1 case 10 exercises delta-sensitivity so the behavior is at least deterministic and testable; no additional clamp is added this milestone (operator-owned config, same trust boundary as every other `.blackhole/config.json` value) | Mitigated (by design — operator trust boundary, not a new attack surface) |
| A future edit strips the Task 5/6 prose markers without anyone noticing, silently reverting §4.8 to always-blocked or, worse, always-ready | Repudiation | MEDIUM | Task 8 — `V-DESIGN-02` grounding check fails `bun run verify` if the required markers disappear from either file | Mitigated |
| Information Disclosure | N/A | — | Design notes are already committed into the issue's PR under current behavior when they exist; this milestone changes *whether a human reviews first*, not *what* gets written or *who* can read it | N/A |
| Denial of Service | N/A | — | No new network/resource surface; `design-aggregate.ts` is a synchronous, bounded, local computation on data already produced by existing spawns | N/A |

## Dependency Blast-Radius

| Changed File | Downstream Consumers | Blast Radius |
|--------------|----------------------|---------------|
| `src/agents/planner.md` | Every `track: design` issue dispatch (`orchestrator.md` Route-derived dispatch), `phase-plan.md`'s approval-gate table, the compiled mirrors (`.claude/agents/planner.md`, `.cursor/agents/planner.md`, etc. via `bun run build`) | HIGH file-reach / LOW behavioral (gated off by default, identical byte-for-byte when `autonomy` absent or `design_autonomy: false`) |
| `src/agents/orchestrator.md` | Every issue's dispatch path (all five phases route through this file), same compiled-mirror fan-out | HIGH file-reach / LOW behavioral (new branch only fires on the new `status: ready`+`track: design` combination, unreachable when the gate is off) |
| `src/references/worker-schemas.md` | The SubagentStop hook validator (`validate-worker-json.ts`), every worker's return-JSON contract reference, restated conceptually in every campaign prompt | MEDIUM (additive subsection only — no existing schema shape changes) |
| `scripts/build.ts` (`EXPECTED_CHECK_COUNT`) | `scripts/verify.ts`'s drift warning only | LOW (single consumer, warning not failure) |
| `scripts/checks/design-track.check.ts` | `scripts/verify.ts` glob-discovery, its paired `verify.design-track.test.ts` (ADR-007 T5/R2′ convention) | LOW (isolated domain file) |

**Overall blast radius**: LOW. The two widest-reach files (`planner.md`, `orchestrator.md`) are
touched at points that are structurally unreachable while the `autonomy` config block is absent or
`design_autonomy: false` — the kill-switch precedent (`kaizen`, `docs_governance`) this milestone
follows verbatim. File-reach is wide because these are core dispatch files; behavioral risk is not,
by construction.

## Stop Conditions

> On encountering any condition below, halt and report rather than improvising.

1. **Verdict script produces a result that contradicts a written test case during manual
   spot-check** (Task 9's human-verifiable step): if `design-aggregate.ts` returns `ready` for a
   fixture that Task 1's suite says should be `blocked` (or vice versa) when run outside the test
   harness, halt and report — do not adjust the fixture to match the script's actual behavior;
   the test suite is the specification here (TDD-first per Task 1/2 ordering).
2. **`EXPECTED_CHECK_COUNT` mismatch after Task 8**: if `bun run verify` reports a check count
   other than 28 after Task 8, halt and report rather than silently editing the constant again to
   match whatever number appeared — investigate whether a check was accidentally duplicated or
   dropped in `design-track.check.ts`'s `runChecks()` array.
3. **`bun run build` reports drift** after Tasks 3–8: if the compiled-mirror diff includes files
   outside the expected fan-out targets (`.claude/`, `.cursor/`, `.gemini-plugin/`,
   `.codex-plugin/`, `codex-agents/`, `codex-skills/`, `plugins/`), halt and report — do not hand-
   edit a compiled-mirror file to suppress the drift warning (`blackhole-protocol.md` § Campaign
   state vs. agent handoff dirs: "edit `src/` and rebuild, do not hand-edit").

## Execution Strategy

**Pattern**: Sequential (dependency chain is nearly linear — see Task Breakdown's dependency-order
note; Tasks 3 and 4 are the only pair that can run in parallel, since both only depend on Task 2
and neither reads the other's output).

| Agent | Task(s) | Model | Delegation Contract |
|-------|---------|-------|---------------------|
| general-purpose subagent | T1, T2 | sonnet | **Objective**: Write `scripts/design-aggregate.test.ts` first (RED), then implement `scripts/design-aggregate.ts` to pass it (GREEN), mirroring `review-aggregate.ts`'s pure-function + typed-I/O + CLI-entrypoint shape exactly. **Output format**: two TypeScript files; report pass/fail counts from `bun test scripts/design-aggregate.test.ts`. **Scope**: `scripts/design-aggregate.ts`, `scripts/design-aggregate.test.ts` only; read (do not modify) `scripts/review-aggregate.ts`, `scripts/lib/fs.ts`. **Tool guidance**: Read the reference file before writing tests; reuse `readJsonFile`, do not reimplement. **Stop condition**: after `bun test scripts/design-aggregate.test.ts` is green and `bun test scripts/review-aggregate.test.ts` shows zero regressions. |
| general-purpose subagent | T3, T4 | sonnet | **Objective**: Author `src/references/design-rubric.md` (fixed columns/weights/formula per decision type) and extend `src/references/worker-schemas.md` with the Design Track Critic JSON schema subsection. **Output format**: one new markdown file, one modified markdown file (additive subsection only). **Scope**: `src/references/design-rubric.md`, `src/references/worker-schemas.md` only. **Tool guidance**: Match `worker-schemas.md`'s existing fenced-JSON-then-field-table convention exactly (see the Planner section immediately above the insertion point). **Stop condition**: after both files are written and the rubric's weight-sum-to-100 invariant is documented per decision type. |
| general-purpose subagent | T5, T6, T7 | sonnet | **Objective**: Rewrite `planner.md` §4.3/§4.8 for blind critics + gated verdict, then propagate the resulting contract into `orchestrator.md`'s dispatch branch and `phase-plan.md`'s approval-gate table. **Output format**: three modified markdown files with the exact prose markers Task 8 will assert against. **Scope**: `src/agents/planner.md` (§4.3, §4.8 only), `src/agents/orchestrator.md` (Route-derived dispatch section only), `src/references/phase-plan.md` (approval-gate table + its trailing paragraph only). **Tool guidance**: Do not touch Design Track subsections 1, 4, 5, 6, 7 in `planner.md`; do not touch any other `orchestrator.md` section (error classification, escalation dispatch, wave scheduling, etc. are all out of scope). **Stop condition**: after all three files are written and the exact marker strings used are recorded for Task 8's consumption. |
| general-purpose subagent | T8 | sonnet | **Objective**: Wire `V-DESIGN-02` grounding enforcement — assert Task 5/6's markers exist, bump `EXPECTED_CHECK_COUNT`. **Output format**: modified `scripts/checks/design-track.check.ts` (new check function + `runChecks()` entry), modified `scripts/build.ts` (27 → 28). **Scope**: those two files only. **Tool guidance**: Reuse `findMissingGateMarkers` from `core.check.ts` (via `single-writer.check.ts`'s re-export pattern) — do not write a third marker-scan function; confirm the exact marker strings against what Task 5/6 actually wrote, not this plan's illustrative wording. **Stop condition**: after `bun run verify` reports exactly 28 checks, all passing. |
| mercure:x-tester (sonnet) | T9 | sonnet | **Objective**: Run the full regression gate — `bun run build`, `bun test`, `bun run verify` — after all prior tasks land, and fix any failure surfaced (including pre-existing tests broken by the §4.3/§4.8 rewrite, e.g. `verify.design-track.test.ts` if it asserts exact prior wording). **Output format**: pass/fail report with full command output for each of the three commands. **Scope**: whole repo, read/fix any test file; do not modify `src/agents/`, `src/references/`, or `scripts/design-aggregate.ts` production logic — route any production-logic failure back to the owning task's agent rather than patching it directly. **Stop condition**: after all three commands are green with zero drift and zero regressions. |

**Parallelization**: T1→T2 sequential (TDD ordering is load-bearing, not just convention). T3 and
T4 may run in parallel with each other once T2 lands, but not before (both are read-only against
T2's output — `design-rubric.md`'s formula section and the critic schema's score-shape both need
the finalized `CriticScore` type from T2 to stay consistent). T5 depends on both T3 and T4; T6 and
T7 may run in parallel with each other once T5 lands (both only read T5's final prose, neither
touches the other's file). T8 depends on T5+T6+T7 all being final (its marker strings must match
their actual final wording). T9 is the terminal full-suite gate. ≤3 parallel agents at any phase
boundary, within the ≤4-parallel-agents-per-phase ceiling.

## Sprint Contract

### Machine-verifiable
- [ ] `bun test scripts/design-aggregate.test.ts` → all cases pass (11+ cases per Task 1)
- [ ] `bun test` (full suite) → zero regressions vs. pre-milestone baseline
- [ ] `bun run verify` → 28/28 checks pass, no "expected N, ran M" warning
- [ ] `bun run build` → exits 0, zero drift between `src/` and every compiled-mirror target

### Human-verifiable
- [ ] With `autonomy.enabled: true, autonomy.design_autonomy: true` set in a scratch
  `.blackhole/config.json`, manually construct a design-track fixture where all three scorers
  agree on a winner by >30% margin, zero discriminating CRITICAL findings, and zero BREAKING
  consumers — confirm the planner's returned JSON is `status: "ready"` and an ADR file plus
  INDEX.md row are produced.
- [ ] With the same config, construct a second fixture with a BREAKING consumer row present —
  confirm the result is `status: "blocked"` even though scores would otherwise dominate.
- [ ] With `autonomy.enabled: false` (or the block entirely absent), confirm the Design Track
  still returns `status: "blocked"` unconditionally for both fixtures above — the pre-milestone
  behavior is unchanged when the gate is off.

## Risk Assessment

| Risk | Severity | Mitigation |
|------|----------|------------|
| Autonomous design picks a defensible-but-wrong approach once the gate is enabled | HIGH | Triple-scorer dominance requirement + zero-discriminating-CRITICAL + zero-BREAKING triple gate (Task 2); ADR still ships inside the PR for reviewer audit; `merge_hold`/PR-close human veto points remain (M1-shipped, unchanged by this milestone); default `enabled: false` |
| `EXPECTED_CHECK_COUNT`/`VCODE_TABLE_ROW_COUNT` grounding facts drift from actual file state after Task 8's edit | MEDIUM | Task 9's `bun run verify` run surfaces any mismatch as an explicit warning before the milestone is considered done; Stop Condition 2 forbids silently re-numbering the constant to match an unexplained count |
| Blind-critic prose rewrite in `planner.md` §4.3 accidentally changes the multiplicity cap, no-write, or no-recursion constraints that are unrelated to blindness | MEDIUM | Task 5 explicitly states "keep... constraints verbatim"; Task 9's full-suite run includes any existing test asserting those constraints (if `verify.design-track.test.ts` or an equivalent covers them) |
| Marker-based `V-DESIGN-02` check is brittle to future copy-editing of `planner.md`/`orchestrator.md` prose | LOW | Same trade-off already accepted by the existing `V-DESIGN-01`/`V-WRITE-01` marker checks (ADR-007 T5/R2′ precedent) — not a new risk class this milestone introduces |

## Success Criteria

- [ ] `design-aggregate.ts` exists, is pure/typed/tested, and is never invoked by the planner to
  self-certify — the planner only ever reads its returned `status`.
- [ ] `design-rubric.md` exists with fixed columns and weights per decision type; the planner's
  §4.3 no longer implicitly permits ad hoc axis selection for a decision type this file covers.
- [ ] The two critique-only sub-invocations receive Options without the provisional Chosen and
  return the Task 4 JSON schema.
- [ ] `planner.md` §4.8 is unconditional `status: blocked` exactly as before when
  `autonomy.enabled` is absent/false or `design_autonomy: false`; gated `ready` is reachable only
  through `design-aggregate.ts`'s verdict.
- [ ] `orchestrator.md` applies only the returned worker JSON `status` field for design-track
  dispatch — no code path re-derives or overrides the script's verdict.
- [ ] `phase-plan.md`'s approval-gate table documents the new branch without altering the existing
  unconditional-AskQuestion row's meaning when the gate is off.
- [ ] `bun run verify` reports 28/28 checks passing, including the new `V-DESIGN-02` grounding
  check.
- [ ] `bun run build` produces zero drift; `bun test` full suite is green with zero regressions.
