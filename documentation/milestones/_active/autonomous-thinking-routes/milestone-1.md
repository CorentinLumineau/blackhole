---
type: plan
status: current
plan_base_commit: d4d978b
created: 2026-07-15
last_updated: 2026-07-15
review_trigger: "on milestone completion"
---

# Milestone 1 — Confidence Kernel + Artifact Contract + Autonomy Config (ADR-010 P1)

**Initiative**: autonomous-thinking-routes
**Milestone**: 1 of 5
**Track**: Standard
**Pareto Value**: 40% | **Estimated Effort**: 20%
**Dependencies**: None — independently deployable, inert while `autonomy.enabled: false`
**ADR Reference**: `documentation/decisions/ADR-010-autonomous-thinking-routes.md`
**Audit Reference**: `documentation/audits/autonomous-workflow-parity.md`

## Objective

Land the shared foundations for ADR-010's autonomous thinking routes with **zero behavior
change** while `autonomy.enabled: false` (or the block absent): a ported confidence-gating
kernel (`confidence-gates.md`), a durable per-route artifact contract
(`artifact-contract.md`), an opt-in `autonomy` config block following the `kaizen` kill-switch
contract verbatim, two new V-codes (`V-AUTO-01`, `V-AUTO-02`) registered in
`blackhole-vcodes.md` with the `build.ts` fact-count bumped to match, and a `supersedes`
pointer from `clarify-gates.md` to the new kernel. This milestone ships no wired consumers —
routing/planner/hunter changes that *read* these files land in Milestones 2–5 (ADR-010
Rollout P2–P5). Success is measured by: the new reference files existing and internally
consistent with ADR-010 D6/D5/D8, `bun test` green, and `bun run verify` reporting zero new
warnings (in particular no `V-GROUND-01` fact mismatch on `VCODE_TABLE_ROW_COUNT`).

## Task Breakdown

### T1 — Port confidence-gates.md (5-dimension kernel)

Create `src/references/confidence-gates.md`, porting mercure's interview confidence model
(source: mercure `skills/interview/references/confidence-model.md` and `bypass-conditions.md`,
v9.6.0) into blackhole's route vocabulary:

- 5 weighted dimensions: Problem Understanding, Context Completeness, Technical Clarity, Scope
  Definition, Risk Awareness (ported verbatim — same dimension names as mercure, per ADR-010's
  "port weights/thresholds verbatim into confidence-gates.md with source attribution" risk
  mitigation).
- Per-route weight profiles for blackhole's five routing surfaces: `analyze` (investigator
  sub-mode), `brainstorm` (planner track), `design` (Design Track autonomy tier), `implement`
  (default plan/build path), `epic go-no-go`. Map each to the closest mercure profile with a
  1-sentence rationale (e.g., `design` → mercure's "x-plan design" profile 20/15/40/10/15,
  Technical-heavy; `brainstorm` → mercure's "x-brainstorm" profile 40/30/10/15/5,
  Problem-heavy) — document as a starting default, explicitly tunable from campaign data (ADR-010
  Key Assumptions row: "30% dominance delta... configurable, tune from campaign data" sets the
  precedent for this kind of tunable default).
- Composite threshold: `autonomy.confidence_threshold`, default 80 (matches ADR-010 D8).
- **Async two-band mapping** (ADR-010 D6, verbatim): composite ≥ threshold → proceed, post
  reformulated understanding as an issue comment (audit trail + async veto surface); composite <
  threshold → at most 2 `[NEEDS CLARIFICATION]` markers if deferrable (issue proceeds to plan,
  blocks before implement — reuses the existing planner marker convention already used in
  `plans/issue-N.md`), otherwise `status: blocked` + AskQuestion (today's unchanged behavior).
- **Never-bypass list** (ADR-010 D6, verbatim, always blocks regardless of confidence):
  destructive/irreversible operations, credentials/KYC/account actions, epic go/no-go, and
  anything matching the existing security-adjacent cautious defaults already documented in
  `clarify-gates.md`. Cross-reference the `never_bypass` config array (T3) by value:
  `["destructive", "credentials", "epic-go-no-go"]`.
- **Dimension-input note**: state explicitly that `clarify-gates.md`'s categorical triggers are
  NOT deleted — they become dimension inputs (e.g., "missing AC" caps the Problem dimension;
  "multiple valid approaches" caps Technical). This is the load-bearing text T5's supersedes
  pointer links back to.

**Done when**: file exists at `src/references/confidence-gates.md`; contains all 5 dimensions,
a weight-profile table for all 5 blackhole routes, the two-band mapping, and the never-bypass
list with the exact three string values from D8. **Verified by**: `Read` the file and grep for
`never_bypass`, `confidence_threshold`, and each of the 5 dimension names — all present;
`bun test scripts/router-local-analyze.test.ts` still passes (no regression to existing
V-SEC-09/10/V-UX-01 registration assertions in that file).

**Dependencies**: None.

### T2 — Create artifact-contract.md (durable per-route artifacts)

Create `src/references/artifact-contract.md` documenting, per ADR-010 D5 verbatim:

| Route | Artifact |
|-------|----------|
| analyze | `documentation/audits/analysis-issue-N.md` |
| brainstorm | `documentation/brainstorms/{concern-slug}.md` |
| design (auto- or human-approved) | `documentation/decisions/ADR-{NNN}-{slug}.md` + `documentation/decisions/INDEX.md` row |
| investigate | `documentation/investigations/{concern-slug}.md` |

Document the delivery mechanism: the write-capable worker (investigator/planner at thinking
time; the implementer carries the note into the PR branch) commits the artifact **inside the
issue's PR** — no draft→final flip machinery, no orchestrator file writes, no post-merge
mutation. **Merge = approval**: the reviewer audits the artifact like code
(`V-DOC-GOV-01..04`, `V-ADA-02`). State explicitly this whole contract is gated by
`docs_governance.write_governance` (absent/false ⇒ inert, per the existing `doc-governance.md`
kill-switch contract) and honors search-before-write + repo-convention precedence already
documented there. Note the working/durable split: the gitignored `.blackhole/plans/` copy
remains working state; the `documentation/` copy is the durable record (ADR-010 Design
Principles: Separation of Concerns row).

**Done when**: file exists at `src/references/artifact-contract.md` with the 4-row table above,
the "merge = approval" delivery mechanism paragraph, and an explicit `docs_governance.write_governance`
gating statement. **Verified by**: `Read` the file and grep for each of the 4 route names and
`write_governance`.

**Dependencies**: None.

### T3 — autonomy config block (config-template.md + fixtures/config.example.json)

Add the opt-in `autonomy` block to `src/references/config-template.md`, following the `kaizen`
kill-switch contract verbatim (the existing template already has this pattern at
`config-template.md:23` for `kaizen` and `:24` for `incident_mode` — reuse the same structure:
committed JSON block + per-field table rows + a "contract note" paragraph):

```json
"autonomy": {
  "enabled": false,
  "confidence_threshold": 80,
  "design_dominance_delta": 30,
  "design_autonomy": true,
  "analyze_routing": true,
  "brainstorm_routing": true,
  "never_bypass": ["destructive", "credentials", "epic-go-no-go"]
}
```

Add field-table rows for `autonomy`, `autonomy.enabled` (default `false` — opt-in like
`kaizen`, unlike `docs_governance`), `autonomy.confidence_threshold`,
`autonomy.design_dominance_delta`, `autonomy.design_autonomy`, `autonomy.analyze_routing`,
`autonomy.brainstorm_routing`, `autonomy.never_bypass`. Add an "`autonomy` contract note"
paragraph mirroring the existing `kaizen`/`incident_mode` notes: absent block or
`enabled: false` ⇒ every dependent feature (design autonomy tier, analyze/brainstorm routing,
confidence-gated escalation) is a no-op and current behavior is preserved exactly — no route
flag changes dispatch, no `design-aggregate.ts` invocation (that script does not exist until
Milestone 2), no confidence math runs. This is the same obligation `docs_governance.enabled`
and `kaizen.enabled` already impose on their own features.

Add the same `autonomy` block (with `enabled: false`, matching the existing `kaizen` block's
`enabled: false` in the fixture) to `fixtures/config.example.json`, immediately after the
existing `kaizen` block, to keep the fixture demonstrating every documented config surface.

**Done when**: `config-template.md` has an `autonomy` JSON block + 8 field-table rows + 1
contract-note paragraph; `fixtures/config.example.json` parses as valid JSON and contains an
`autonomy` key with `enabled: false`. **Verified by**: `bun test
scripts/checks/core.check.ts` — specifically the `V-SCHEMA-01` fixture-shape check
(`validateConfigFixtureShape`, `core.check.ts:278-294`) continues to pass unchanged (it only
asserts `repo`/`target_branch`/`forge`/`scope_milestone`/`scope_labels`, so the additive
`autonomy` key cannot break it — confirmed by reading the validator before writing this task);
`JSON.parse(read('fixtures/config.example.json'))` succeeds.

**Dependencies**: None.

### T4 — Register V-AUTO-01/02 + bump build.ts fact

Add two rows to `src/references/blackhole-vcodes.md`'s V-code table (append after the
`V-HUNT-02` row, following the existing plain two-column-rule-description format):

| Code | Rule | Severity |
|------|------|----------|
| V-AUTO-01 | Autonomous design proceeds without a `design-aggregate.ts` verdict artifact | BLOCK |
| V-AUTO-02 | Thinking-route artifact missing from PR when the route fired | WARN |

Bump `scripts/build.ts:277` — `export const VCODE_TABLE_ROW_COUNT = 44;` → `46` (current table
has 44 `| V-...` rows, confirmed by reading `blackhole-vcodes.md`; +2 for V-AUTO-01/02). This is
the single ground-truth declaration `scripts/checks/core.check.ts:642`
(`findRowCountMismatch('vcode table rows', VCODE_TABLE_ROW_COUNT, vcodeRows)`) compares against
at `bun run verify` time (V-GROUND-01) — do not add a second hardcoded row-count literal
anywhere else (the codebase already retired a duplicate doc-counter check for this exact
invariant — see `router-local-analyze.test.ts:73-79` comment history).

**Done when**: `blackhole-vcodes.md` has both new rows with exact severities BLOCK/WARN;
`build.ts`'s `VCODE_TABLE_ROW_COUNT` equals 46. **Verified by**:
`bun test scripts/router-local-analyze.test.ts` (new assertions added in T6 below) passes;
`bun run verify` reports zero `V-GROUND-01` warnings (was previously silent on this row — a
mismatch surfaces as a console warning per `verify.ts:30-31`, not a hard failure, so this must
be checked by reading verify output, not just exit code).

**Dependencies**: T2 (soft — V-AUTO-02's rule text references "thinking-route artifact... when
the route fired", which should read consistently with T2's per-route artifact table; no shared
file, but content review should happen after T2 lands for wording coherence).

### T5 — clarify-gates.md supersedes pointer

Add a short note near the top of `src/references/clarify-gates.md` (after the existing intro
paragraph, before "## Default: clarify before commit") stating: `confidence-gates.md`
(src/references/confidence-gates.md) supersedes this file **as the escalation mechanism** —
this file's categorical triggers are preserved and now feed the Problem/Technical dimension
inputs of the confidence kernel (ADR-010 D6, Refactoring Impact table: "`clarify-gates.md` —
DEPRECATION — Superseded as mechanism by `confidence-gates.md`; triggers preserved as dimension
inputs; file kept with supersedes pointer"). Do **not** delete or restructure any existing
content in `clarify-gates.md` — this is an additive pointer note only, consistent with the ADR's
"file kept" instruction. Note explicitly in the plan (for the reviewer) that this file does not
live under `documentation/` and therefore does not carry the `type:`/`status:` frontmatter
schema from `doc-governance.md` — this is a `src/references/` skill-reference file, and the
`supersedes` relationship is expressed as prose, not frontmatter, matching how other
`src/references/` cross-links are already expressed (relative `[file.md](file.md)` links, no
frontmatter anywhere in this directory).

**Done when**: `clarify-gates.md` contains a supersession note naming `confidence-gates.md` and
using the word "mechanism" (not "deleted"/"removed"). **Verified by**: `Read` the file and grep
for `confidence-gates.md`.

**Dependencies**: T1 (soft — the pointer note should name the dimension-input mechanism T1
documents; no shared file).

### T6 — Tests + verify green

Extend test coverage and confirm the full quality gate:

1. Extend `scripts/router-local-analyze.test.ts`'s existing `describe('blackhole-vcodes.md — ...')`
   block pattern (see the V-SEC-09/10 and V-UX-01 registration tests at lines 66-86) with a new
   `describe('blackhole-vcodes.md — V-AUTO-01/V-AUTO-02 registration')` block asserting
   `/\| V-AUTO-01 \|.*\| BLOCK \|/` and `/\| V-AUTO-02 \|.*\| WARN \|/` match against
   `src/references/blackhole-vcodes.md`.
2. Add a new colocated test file `scripts/autonomy-config.test.ts` asserting: (a)
   `fixtures/config.example.json` parses and its `autonomy.enabled` is `false`; (b)
   `src/references/config-template.md` contains the string `"autonomy"` and each of the 6
   sub-field names from T3; (c) `src/references/confidence-gates.md` exists and contains all 5
   dimension names, `confidence_threshold`, and the 3 `never_bypass` values; (d)
   `src/references/artifact-contract.md` exists and contains all 4 route names from the T2
   table.
3. Run `bun run build` to regenerate all `.claude/`, `.cursor/`, `codex-*`, `plugins/*` mirrors
   from the edited `src/` files (this repo's own rule: `src/` is the only edit surface, mirrors
   are build output — never hand-edit them).
4. Run `bun test` (full suite) and `bun run verify` — both must be green, with `verify` output
   read in full (not just exit code) to confirm no new `V-GROUND-01`/`V-SCHEMA-01` warnings.

**Done when**: all 4 sub-steps complete. **Verified by**: pasted `bun test` summary line (all
pass, 0 fail) and `bun run verify` output showing no new warnings beyond pre-existing baseline.

**Dependencies**: T1, T2, T3, T4, T5 (all — this task validates their combined output).

## Critical Files

| File | Change Type | Note |
|------|-------------|------|
| `src/references/confidence-gates.md` | New file | 5-dimension kernel, per-route weights, two-band mapping, never-bypass list (T1) |
| `src/references/artifact-contract.md` | New file | Per-route durable artifact table + merge-= -approval delivery mechanism (T2) |
| `src/references/config-template.md` | Modify | Add `autonomy` JSON block + field-table rows + contract note (T3) |
| `fixtures/config.example.json` | Modify | Add `autonomy` block with `enabled: false` (T3) |
| `src/references/blackhole-vcodes.md` | Modify | Append `V-AUTO-01` (BLOCK), `V-AUTO-02` (WARN) rows (T4) |
| `scripts/build.ts` | Modify | `VCODE_TABLE_ROW_COUNT`: 44 → 46 (T4, line 277) |
| `src/references/clarify-gates.md` | Modify | Add supersedes pointer note (T5) |
| `scripts/router-local-analyze.test.ts` | Modify | Add V-AUTO-01/02 registration assertions (T6) |
| `scripts/autonomy-config.test.ts` | New file | Config schema + new-reference-file structural assertions (T6) |

All "Modify" files confirmed to exist on disk at plan time (read during pre-discovery); all
"New file" targets confirmed to NOT exist yet (`Glob` returned no match for
`src/references/confidence-gates.md`, `src/references/artifact-contract.md`, and
`scripts/autonomy-config.test.ts`).

## Codebase Conventions

| Touchpoint | Convention | Source | Required by |
|------------|------------|--------|-------------|
| Opt-in config block (kill switch) | Block carries its own `enabled` flag defaulting per feature risk (`kaizen`/`incident_mode` default `false`; `docs_governance` defaults `true`); absent block or `enabled: false` ⇒ dependent features are a no-op, current behavior preserved exactly; documented as JSON block + field table + "contract note" paragraph in `config-template.md` | `src/references/config-template.md:22-27` (kaizen/incident_mode examples), `:82-96` (contract notes) | V-INT-01 (T3) |
| V-code table row format | `\| V-{DOMAIN}-{NN} \| {one-line rule text} \| BLOCK\|WARN \|` — no wrapped/multi-line cells, restated verbatim (not paraphrased) in agent prompts | `src/references/blackhole-vcodes.md:13-58` | V-INT-01 (T4) |
| V-code fact-count ground truth | Row-count invariant declared exactly once as a named export in `scripts/build.ts` (`VCODE_TABLE_ROW_COUNT`), checked at `verify` time by an independent live scan (`core.check.ts:642`) — never restated as a second hardcoded literal at any consumption site (this exact duplicate-check pattern was already retired once, see `router-local-analyze.test.ts:73-79`) | `scripts/build.ts:276-277`, `scripts/checks/core.check.ts:642` | V-INT-02, V-GROUND-01 (T4) |
| Reference cross-links | Relative `[file.md](file.md)` links between `src/references/*.md` files; no YAML frontmatter in this directory (unlike `documentation/`) | `src/references/*.md` (directory-wide convention) | V-INT-01 (T1, T2, T5) |
| Deprecation/supersede note (non-`documentation/` files) | Expressed as prose stating what supersedes the file and what is preserved — never deletes content, never uses `documentation/`'s frontmatter `supersedes:`/`status: deprecated` schema (that schema is scoped to the `documentation/` tree per `doc-governance.md` and `blackhole-protocol.md`) | ADR-010 Refactoring Impact table (`clarify-gates.md` row) | T5 |
| Test colocation + fixture-factory pattern | `*.test.ts` colocated with the module/domain it tests (not under a separate `tests/` dir); vcodes-table registration assertions live in `router-local-analyze.test.ts` by established precedent (V-SEC-09/10, V-UX-01 rows) rather than a dedicated `blackhole-vcodes.test.ts` | `scripts/router-local-analyze.test.ts:66-86` | V-INT-01 (T6) |
| Src-is-edit-surface | `src/` is the only edit surface; `.claude/`, `.cursor/`, `codex-*`, `plugins/*` are `bun run build` output — never hand-edit | `AGENTS.md` / `blackhole-protocol.md` § Campaign state vs. agent handoff dirs | V-INT-02 (T6 step 3) |

## Dependency Blast-Radius

| Changed File | Downstream Consumers | Blast Radius |
|--------------|----------------------|--------------|
| `src/references/confidence-gates.md` | None yet — no agent/skill reads this file in Milestone 1; wired by router/planner/orchestrator in Milestones 2–4 | LOW |
| `src/references/artifact-contract.md` | None yet — same as above, wired by investigator/planner in Milestones 3–4 | LOW |
| `src/references/config-template.md` | `fixtures/config.example.json` (doc/example parity, kept in sync by T3 itself) | LOW |
| `fixtures/config.example.json` | `scripts/checks/core.check.ts` `V-SCHEMA-01` fixture-shape validator (additive key, validator does not enumerate a closed key set — confirmed non-breaking) | LOW |
| `src/references/blackhole-vcodes.md` | `scripts/checks/core.check.ts` (`VCODE_TABLE_ROW_COUNT` comparison), `scripts/build.ts` mirror compilation to 6 build targets (`.claude/rules/`, `.cursor/rules/`, `skills.sh` root, Gemini/Antigravity workspace + distribution, Codex, Claude marketplace bundle) | MEDIUM |
| `scripts/build.ts` | `scripts/verify.ts` (imports `EXPECTED_CHECK_COUNT`, unaffected by this change), `scripts/checks/core.check.ts` (imports `VCODE_TABLE_ROW_COUNT`), every `compile*Target()` function that mirrors `blackhole-vcodes.md` | MEDIUM |
| `src/references/clarify-gates.md` | `src/agents/router.md`, `orchestrator.md`, `planner.md` (all reference clarify-gates.md via `blackhole-protocol.md`) — additive pointer note only, no removed/renamed content, so these consumers are unaffected | LOW |

**Overall blast radius**: LOW. The only row touching live enforcement machinery is the
`blackhole-vcodes.md` / `build.ts` pair (MEDIUM), and that risk is a simple count-mismatch,
caught immediately by `bun run verify`'s `V-GROUND-01` warning (non-fatal, human-visible) —
not a silent failure mode.

## Risk Assessment

| Risk | Severity | Mitigation |
|------|----------|------------|
| `VCODE_TABLE_ROW_COUNT` bumped to the wrong value (off-by-one from a miscount) | MEDIUM | T4 states the exact current count (44, confirmed by reading the file during pre-discovery) and the exact new count (46); T6 step 4 requires reading full `bun run verify` output (not just exit code) to catch a `V-GROUND-01` warning before considering the milestone done |
| Confidence-model port drifts from mercure semantics (wrong weights, renamed dimensions) | MEDIUM | T1 requires porting dimension names verbatim from the source file and documenting the rationale for each per-route weight-profile mapping inline, per ADR-010's explicit source-attribution mitigation |
| `autonomy` block added to `config-template.md` but omitted from `fixtures/config.example.json` (or vice versa), breaking doc/fixture parity | LOW | T3 explicitly scopes both files in one task with a single "done when" covering both; T6 step 2(b) asserts the fixture's `autonomy.enabled` is `false` independently of the template |
| Reviewer misreads T5's prose-only supersede note as requiring `documentation/`-style frontmatter on a `src/references/` file | LOW | T5 explicitly documents the frontmatter-scope distinction (`doc-governance.md` applies to the `documentation/` tree only) so the reviewer has the rationale inline, not just the diff |
| `bun run build` (T6 step 3) surfaces an unrelated pre-existing mirror drift, obscuring this milestone's own changes | LOW | Run `bun run build` immediately before `bun test`/`bun run verify` in T6, and diff only the files this milestone touches when interpreting output; do not fix unrelated drift found here (V-SCOPE-01 — out of diff boundary, file separately if found) |

No HIGH-severity risk items — `## Stop Conditions` is not required for this milestone
(all risks are MEDIUM/LOW and confined to additive, currently-inert surface area).

## Success Criteria

- [ ] `src/references/confidence-gates.md` and `src/references/artifact-contract.md` exist and contain all content specified in T1/T2
- [ ] `src/references/config-template.md` and `fixtures/config.example.json` both carry the `autonomy` block; `JSON.parse` succeeds on the fixture
- [ ] `src/references/blackhole-vcodes.md` has `V-AUTO-01` (BLOCK) and `V-AUTO-02` (WARN) rows; `scripts/build.ts`'s `VCODE_TABLE_ROW_COUNT` equals 46
- [ ] `src/references/clarify-gates.md` carries the supersession pointer note, with no other content removed
- [ ] `bun test` — full suite passes, 0 failures (includes new `scripts/autonomy-config.test.ts` and the extended `router-local-analyze.test.ts` assertions)
- [ ] `bun run verify` — 0 new warnings (specifically no `V-GROUND-01` mismatch on vcode table rows, no `V-SCHEMA-01` fixture-shape failure)
- [ ] `bun run build` completes without error and regenerates all mirror targets from the edited `src/` files
- [ ] `autonomy.enabled: false` (default/absent) produces **zero** behavior change anywhere in the campaign — no new file this milestone is read by any agent/script at runtime (confirmed by the Dependency Blast-Radius table: all consumers are either doc-parity checks or the additive vcode-count fact)

## Execution Strategy

**Pattern**: Mixed — one parallel authoring phase (4 agents, independent files), one small
sequential follow-up (content-coherence dependent), one sequential closing verification phase.

| Agent | Task(s) | Model | Delegation Contract |
|-------|---------|-------|---------------------|
| x-doc-writer | T1 | sonnet | **Objective**: Port mercure's 5-dimension confidence model into `src/references/confidence-gates.md` per ADR-010 D6, mapping mercure's workflow weight profiles onto blackhole's 5 routes (analyze, brainstorm, design, implement, epic go-no-go). **Output format**: New markdown reference file, no frontmatter, relative-link style matching sibling `src/references/*.md` files. **Scope**: Write only `src/references/confidence-gates.md`. **Tool guidance**: Read the mercure source files cited in T1 for verbatim dimension names; read `src/references/clarify-gates.md` for the dimension-input cross-reference. **Stop condition**: Return after the file contains all 5 dimensions, all 5 route weight profiles with rationale, the two-band mapping, and the 3-value never-bypass list. |
| x-doc-writer | T2 | sonnet | **Objective**: Create `src/references/artifact-contract.md` documenting the per-route durable artifact table and merge-=-approval delivery mechanism per ADR-010 D5. **Output format**: New markdown reference file matching sibling file conventions. **Scope**: Write only `src/references/artifact-contract.md`. **Tool guidance**: Quote ADR-010 D5's table and delivery-mechanism paragraph near-verbatim; read `doc-governance.md` for the `write_governance` gating language. **Stop condition**: Return after the file contains the 4-route table, delivery mechanism paragraph, and `write_governance` gating statement. |
| x-refactorer | T3 | sonnet | **Objective**: Add the opt-in `autonomy` config block to `src/references/config-template.md` (JSON block + 8 field-table rows + contract note, mirroring the existing `kaizen` block structure) and to `fixtures/config.example.json`. **Output format**: In-place edits to both existing files, preserving surrounding structure. **Scope**: `src/references/config-template.md`, `fixtures/config.example.json` only. **Tool guidance**: Read `core.check.ts:278-294`'s `validateConfigFixtureShape` before editing the fixture to confirm the additive key is safe. **Stop condition**: Return after both files contain the `autonomy` block and `JSON.parse` on the fixture succeeds. |
| x-refactorer | T4 | sonnet | **Objective**: Register `V-AUTO-01` (BLOCK) and `V-AUTO-02` (WARN) in `src/references/blackhole-vcodes.md` and bump `scripts/build.ts`'s `VCODE_TABLE_ROW_COUNT` from 44 to 46. **Output format**: Two in-place edits, one row-count constant change. **Scope**: `src/references/blackhole-vcodes.md`, `scripts/build.ts` line 277 only. **Tool guidance**: Count existing table rows with `Grep -c '^\| V-'` before editing to confirm the pre-edit count is 44. **Stop condition**: Return after both rows exist with exact severities and the constant equals 46. |
| x-doc-writer | T5 | sonnet | **Objective**: Add a prose supersession pointer note to `src/references/clarify-gates.md` naming `confidence-gates.md` as the new escalation mechanism, preserving all existing content. **Output format**: In-place addition near the top of the file, no deletions. **Scope**: `src/references/clarify-gates.md` only. **Tool guidance**: Quote ADR-010's Refactoring Impact table row for `clarify-gates.md` for exact framing ("superseded as mechanism... triggers preserved as dimension inputs... file kept"). **Stop condition**: Return after the note is present and no existing content is altered or removed. |
| x-tester | T6 | sonnet | **Objective**: Extend `scripts/router-local-analyze.test.ts` with V-AUTO-01/02 registration assertions, create `scripts/autonomy-config.test.ts` with the 4 structural assertions specified in T6, run `bun run build`, then run the full `bun test` + `bun run verify` suite and report full output. **Output format**: Two test-file diffs plus a verification report quoting `bun test` and `bun run verify` output in full. **Scope**: `scripts/router-local-analyze.test.ts`, `scripts/autonomy-config.test.ts`, plus running (not editing) `bun run build`. **Tool guidance**: Follow the existing `describe`/`test` block pattern in `router-local-analyze.test.ts:66-86` for the vcodes assertions. **Stop condition**: Return after all tests pass and `bun run verify` output has been read in full and confirmed to show no new warnings. |

**Parallelization**:
- **Phase 1 (parallel, 4 agents)**: T1, T2, T3, T5 — no shared files, no content dependency that blocks starting (T5's soft dependency on T1 is a wording-coherence nicety, not a blocker; T5 can start immediately and be lightly revised if T1's final dimension-input phrasing differs).
- **Phase 2 (sequential, 1 agent)**: T4 — runs after Phase 1 completes, for wording coherence with T2's artifact table (soft dependency) and to avoid a spurious mid-air row-count edit race with any other table change.
- **Phase 3 (sequential, 1 agent)**: T6 — runs after Phase 1 and Phase 2 both complete; validates the combined output of all five prior tasks.

## Sprint Contract

### Machine-verifiable
- [ ] `bun test` → all pass, 0 failures
- [ ] `bun run verify` → exits 0, output contains no new `V-GROUND-01` or `V-SCHEMA-01` warning lines
- [ ] `bun run build` → exits 0, regenerates all mirror targets without error
- [ ] `JSON.parse(read('fixtures/config.example.json'))` → succeeds, `.autonomy.enabled === false`

### Human-verifiable
- [ ] `confidence-gates.md`'s per-route weight-profile rationale reads as a defensible mapping from mercure's profiles, not an arbitrary guess (spot-check the `design` and `brainstorm` rows against ADR-010 D3/D4 framing)
- [ ] `clarify-gates.md`'s supersession note does not read as a deletion or deprecation of the file itself — only of its role as the sole escalation mechanism
