---
type: plan
status: current
review_trigger: "on ADR-010 acceptance"
created: 2026-07-15
last_updated: 2026-07-15
related:
  - documentation/decisions/ADR-010-autonomous-thinking-routes.md
  - documentation/audits/autonomous-workflow-parity.md
plan_base_commit: d4d978b
track: quick
---

# Milestone 5 — Campaign retrospective: hunter `retrospective` kind

Initiative: `autonomous-thinking-routes` · Milestone 5 of 5
Pareto Value: 5% | Estimated Effort: 15%
Dependencies: Milestone 1 (config block conventions) — independent of M2–M4

## Objective

Add cross-issue architectural synthesis as a new kaizen hunt kind, `retrospective` (ADR-010
D7 / P5), so the campaign can surface systemic redesign candidates from its own history —
recurring V-codes by file/module, review-iteration outliers, and touch-path hotspots — instead
of relying on manual mercure-style retrospection (the coverage-epic spiral in audit finding
G5). The kind's territory is the **campaign itself** (`findings-ledger.json`, merged-PR
history, `queue.json`), never the codebase. It is a pure additive kind: it reuses every
existing kaizen mechanism (`V-HUNT-01` CONFIRMED gate, `V-PARETO-02` scoring, per-wave caps,
dedup, watermarking) verbatim and must not modify ledger schema or filing machinery.

## Task Breakdown

### T1 — Author `src/references/hunt/retrospective.md` (new kind reference file)

Create the kind reference file, mirroring the structure of the four existing kind files
(`src/references/hunt/bug.md`, `refactor.md`, `coverage.md`, `best-practices.md`): a `# Hunt
Kind: Retrospective` heading, `## Scan heuristics`, `## Calibration table`, and `## Scoring —
V-PARETO-02 SSOT` sections (the shared `Priority = Gain * (11 - Effort) >= 30` formula —
`src/references/blackhole-vcodes.md` `V-PARETO-02` — no alternate formula).

**Acceptance criteria** — the file must document, with a worked example per heuristic
(gain/effort/severity values feeding the Priority formula, mirroring `bug.md`'s calibration
table rows):

1. **Recurring V-code clusters** — 3+ `findings-ledger.json` rows (current file plus rotated
   snapshots under `.blackhole/archive/`, per `src/references/blackhole-state.md:18`) sharing
   the same `vcode` and file/module prefix → candidate summarized as e.g. "V-DRY-02 ×5 in
   `scripts/checks/*` → extract shared helper epic".
2. **Touch-path hotspots** — the same file path modified across 3+ **merged** issues, derived
   from `gh pr list --state merged --json number,files,mergedAt --limit 100` (the established
   `gh pr list --state <x> --json ...` convention already used for `--state open` in
   `src/references/forge-sync.md:77` and `src/references/phase-loop.md:133` — this kind is the
   first `--state merged` consumer of that pattern, not a second filing/query mechanism).
3. **Review-iteration outliers** — **must not** read `queue.json`'s `review_iteration` field
   as a post-merge signal: `src/references/phase-loop.md` § Ledger cleanup on merge resets
   `review_iteration` to `0` on every merge, so it is authoritatively zeroed by the time a
   retrospective wave runs and would silently manufacture false "no outliers" findings. The
   heuristic instead derives review-round counts from the merged PR's own activity —
   `gh pr view <n> --json reviews` review-submission count — never from `queue.json`.
4. **`needs_design: true` flagging** — candidates whose fix is architectural in scope (coupling
   hotspot, cross-cutting extraction) are tagged `needs_design: true` in the returned finding,
   closing the loop into the M2 autonomous design tier (ADR-010 D4); candidates that are a
   contained, single-file fix are left untagged.

The file must also carry a **Severity-term reconciliation note** identical in spirit to
`bug.md`'s (`src/references/hunt/bug.md` § Severity-term reconciliation note): the hunter's
`severity` enum stays `LOW | MEDIUM | HIGH | BLOCK` (`worker-schemas.md` § Hunter, Finding
shape) — no new `CRITICAL` tier is introduced for this kind either.

**Do NOT**: introduce a new scoring formula, a new ledger field, a new finding schema, or any
change to `V-HUNT-01`/`V-HUNT-02` gating logic — every candidate passes through the existing
CONFIRMED verification pass (`hunter.md` § Verification pass) and the existing
`phase-loop.md` § Kaizen hunt dispatch 5-step wave protocol unmodified.

### T2 — Register `retrospective` in `src/references/config-template.md`

Append `"retrospective"` to the `kaizen.kinds` default array in the committed JSON template
(currently `["quickwins", "best-practices", "coverage", "refactor", "bug"]`) and extend the
`kaizen.kinds` field-description row to note it is included by default whenever
`kaizen.enabled: true`.

**Acceptance criteria**: `kaizen.kinds` default reads
`["quickwins", "best-practices", "coverage", "refactor", "bug", "retrospective"]`; no other
field in the `kaizen` block changes; the two existing contract notes ("kaizen contract note",
`kaizen.min_priority` raise-only rule) are left untouched verbatim.

### T3 — Sync `fixtures/config.example.json`

Append `"retrospective"` to the `kaizen.kinds` array in the test fixture so it matches T2's
template default (`fixtures/config.example.json` currently mirrors the same 5-entry array).

**Acceptance criteria**: the fixture's `kaizen.kinds` array is byte-identical in content and
order to `config-template.md`'s default array after T2. Note: `scripts/checks/core.check.ts`'s
`validateConfigFixtureShape` (line 278) does not assert on `kaizen.kinds` contents — this is a
documentation-consistency requirement, not a script-enforced one, so the equality must be
verified by manual diff, not by a passing test alone.

### T4 — Extend `src/agents/hunter.md`'s illustrative kind list

`hunter.md:16` reads: `` Your `kind` (one of `kaizen.kinds` — e.g. `quickwins`,
`best-practices`, `coverage`, `refactor`, `bug`); it is never self-selected. `` Append
`` `retrospective` `` to that illustrative list.

**Acceptance criteria**: the sentence's meaning and every other word are unchanged — this is a
one-token addition to an `e.g.` list, not a rewrite. No other line in `hunter.md` changes: the
kind-dispatch contract (spawn-context directive, one wave per spawn, verification pass, wave
note schema, return format) is already fully generic and requires zero behavioral edits for a
new kind (ADR-010 Refactoring Impact table: `hunter.md` — TRANSPARENT).

### T5 — Verify `phase-loop.md` § Kaizen hunt dispatch requires no edit

Confirm (do not edit) that `src/references/phase-loop.md`'s `## Kaizen hunt dispatch` section
is fully kind-agnostic: the round-robin selection, 5-step wave protocol, and all four stop
conditions operate generically over `kaizen.kinds` with no kind name hard-coded except the
`bug`-specific severity floor in step 3 (unrelated to this milestone). Confirmed by grep: the
only kind-literal in the file is `` `kind: bug` `` at line ~200. Retrospective joins the
rotation automatically once T2 lands — this task's acceptance criterion is a `git diff` showing
**zero** changes to `src/references/phase-loop.md`.

Also confirm `src/agents/orchestrator.md`'s own `## Kaizen hunt dispatch` section (line 362)
needs no edit for the same reason, and explicitly stays untouched: that section is
grow-never-gated at 38 LOC by `scripts/checks/core.check.ts`'s `ORCHESTRATOR_CONTENT_GATE_BASELINE`
(`V-CONTENTGATE-01`) — any edit risks tripping that gate for zero functional benefit, since the
section already reads "the `kind` to scan (one of `kaizen.kinds`)" generically.

### T6 — Verify `src/SKILL.md` hunt mode row requires no edit

Confirm (do not edit) that `src/SKILL.md`'s Modes table row —
`` `hunt [kind]` | `hunt`, `hunt <kind>` | Orchestrator — manual kaizen wave... `` (line 40) —
already covers `hunt retrospective` generically; it enumerates no kind names. Acceptance
criterion: `git diff` shows **zero** changes to `src/SKILL.md`.

### T7 — Regenerate build outputs and verify green

Run `bun run build` to propagate `retrospective.md` and the T2/T3/T4 edits into every build
target (`compileFolder('references', ...)` in `scripts/build.ts` copies the whole
`src/references/` tree, including the `hunt/` subdirectory, recursively — no per-file
enumeration exists for hunt kind files, so no `build.ts` code change is needed). Then run
`bun run verify` and `bun test`.

**Acceptance criteria**:
- `bun run build` exits 0 and `Glob(".claude/skills/blackhole/references/hunt/retrospective.md")`
  (and the equivalent path under `codex-skills/`, `.cursor/`, `plugins/blackhole/`,
  `plugins/blackhole-claude/`, `skills/`, `references/`) returns a match.
- `bun run verify` exits 0 — in particular `checkContentGate` (`V-CONTENTGATE-01`) stays green
  with zero diff to `orchestrator.md`, and `checkFixtures` (`V-SCHEMA-01`) stays green.
- `bun test` exits 0 with no regressions (existing suite; this milestone adds no new script
  logic, so no new `.test.ts` file is required per T1–T6 being pure markdown/JSON content).

## Critical Files

| File | Change Type |
|------|-------------|
| `src/references/hunt/retrospective.md` | New file |
| `src/references/config-template.md` | Modify |
| `fixtures/config.example.json` | Modify |
| `src/agents/hunter.md` | Modify (one-token addition, line 16) |
| `src/references/phase-loop.md` | Verify only — expected zero diff |
| `src/SKILL.md` | Verify only — expected zero diff |
| `src/agents/orchestrator.md` | Do not touch — grow-never gated (`V-CONTENTGATE-01`) |
| Build outputs (`.claude/`, `.cursor/`, `codex-skills/`, `codex-agents/`, `references/`, `skills/`, `plugins/blackhole/`, `plugins/blackhole-claude/`, `agents/`, `rules/`) | Regenerated via `bun run build` — never hand-edited |

## Codebase Conventions

| Touchpoint | Convention | Source | Required by |
|------------|------------|--------|--------------|
| Hunt kind reference file | One file per kind under `src/references/hunt/<kind>.md`: `# Hunt Kind: <Name>` heading, `## Scan heuristics`, `## Calibration table`, `## Scoring — V-PARETO-02 SSOT`; severity enum stays `LOW\|MEDIUM\|HIGH\|BLOCK`, no new tier | `src/references/hunt/bug.md` (full file) | V-INT-01, V-INT-03 |
| Kaizen kind roster | `kaizen.kinds` is a plain string array in `config-template.md`'s JSON default, mirrored verbatim in `fixtures/config.example.json` | `src/references/config-template.md:17`, `fixtures/config.example.json` | V-INT-01 |
| `gh pr list`/`gh pr view` forge queries | `gh <cmd> --json <fields> [--limit N]`, never a second CLI wrapper | `src/references/forge-sync.md:77`, `phase-loop.md:133` | V-INT-02 |
| Issue filing | All hunt kinds file through the one `filing.md` template and the one `gh issue create ... $(bun scripts/forge-scope.ts create-args)` path — never a second filing code path | `src/references/phase-loop.md` § Kaizen hunt dispatch step 3 | V-INT-02 |
| Content-gate baseline | `src/agents/orchestrator.md`'s `##` sections are grow-never gated per-header at their landing-commit LOC (`V-CONTENTGATE-01`); new/changed content belongs in `phase-loop.md` or a `references/hunt/*.md` file, never grown inline in `orchestrator.md` | `scripts/checks/core.check.ts:766` (`ORCHESTRATOR_CONTENT_GATE_BASELINE`) | V-CONTENTGATE-01 |

## Dependency Blast-Radius

| Changed File | Downstream Consumers | Blast Radius |
|--------------|----------------------|---------------|
| `src/references/hunt/retrospective.md` | `hunter` agent (spawn-time kind reference read), build pipeline (copies verbatim) | LOW — new file, no existing consumer reads it until `kaizen.kinds` lists it |
| `src/references/config-template.md` | Every consumer repo's `.blackhole/config.json` bootstrap (only affects **new** campaign bootstraps; existing `.blackhole/config.json` files are never auto-overwritten per `SKILL.md` Phase 0 step 1) | LOW |
| `fixtures/config.example.json` | `scripts/checks/core.check.ts` `checkFixtures` (shape-only, not content-equality) | LOW |
| `src/agents/hunter.md` | `hunter` agent identity (all kinds); one-token addition to an illustrative list, no dispatch logic touched | LOW |

**Overall blast radius**: LOW — additive kind following an established, fully data-driven
contract; zero edits to shared dispatch logic, ledger schema, or filing machinery.

## Quick Threat Check

| Question | Answer |
|----------|--------|
| Does this change handle authentication or authorization? | No |
| Does this change read or write user data? | No |
| Does this change expose a new endpoint or modify an existing one? | No |

All three answers are "No" — `hunter` is a read-only agent (`disallowedTools: [Write, Edit,
Delete]`), the retrospective kind reads campaign metadata (`findings-ledger.json`, `gh pr
list`/`gh pr view` output) it is already permitted to read, and files candidates through the
existing orchestrator-owned issue-filing path. No full `## Threat Model / STRIDE` section is
required.

## Execution Strategy

**Pattern**: Sequential (T1 must land before T2's default array references a kind whose
reference file doesn't yet exist; T7 must run last to validate the full set).

| Agent | Task(s) | Model | Delegation Contract |
|-------|---------|-------|----------------------|
| general-purpose | T1 | sonnet | **Objective**: Author `src/references/hunt/retrospective.md` per the T1 acceptance criteria, mirroring `bug.md`'s structure. **Output format**: New markdown file at the given path. **Scope**: `src/references/hunt/retrospective.md` only — read `bug.md`, `refactor.md`, `phase-loop.md`, `findings-ledger.md`, `blackhole-state.md` for grounding; do not modify them. **Tool guidance**: Read the four sibling kind files first for structural parity; Write the new file. **Stop condition**: File written with all four required scan heuristics, calibration table, and scoring SSOT section present. |
| general-purpose | T2, T3, T4 | sonnet | **Objective**: Append `"retrospective"` to the `kaizen.kinds` array in `config-template.md` and `fixtures/config.example.json`, and to the illustrative kind list in `hunter.md:16`. **Output format**: Three targeted edits, no other content changed. **Scope**: `src/references/config-template.md`, `fixtures/config.example.json`, `src/agents/hunter.md` only. **Tool guidance**: Use Edit for minimal, surgical diffs — do not rewrite surrounding prose. **Stop condition**: All three files show only the single intended addition each, verified by `git diff --stat` (1 line changed per file, or 2 for `config-template.md`'s array + description row). |
| general-purpose | T5, T6 | sonnet | **Objective**: Confirm `phase-loop.md` and `SKILL.md` require zero edits for this milestone. **Output format**: A short confirmation note (no file changes). **Scope**: Read-only — `src/references/phase-loop.md`, `src/SKILL.md`, `src/agents/orchestrator.md`. **Tool guidance**: `grep` for kind-name literals; confirm none exist outside the pre-existing `bug` severity-floor reference. **Stop condition**: Confirmation that `git diff` for both files is empty after T1–T4. |
| x-tester (sonnet) | T7 | sonnet | **Objective**: Regenerate build outputs and run the full verification suite. **Output format**: Command output confirming exit codes. **Scope**: Run `bun run build`, `bun run verify`, `bun test` at repo root; do not hand-edit any build output. **Tool guidance**: Use Bash; if `bun run verify` fails on `V-CONTENTGATE-01` or `V-SCHEMA-01`, halt and report — do not patch the check itself. **Stop condition**: All three commands exit 0, with `Glob` confirmation that `retrospective.md` propagated to at least the `.claude/skills/blackhole/references/hunt/` build target. |

## Risk Assessment

| Risk | Severity | Mitigation |
|------|----------|------------|
| Retrospective's "review-iteration outliers" heuristic naively reads `queue.json.review_iteration`, which `phase-loop.md` § Ledger cleanup resets to `0` on every merge — producing a heuristic that always reports zero outliers | MEDIUM | T1's acceptance criteria explicitly mandate sourcing review-round counts from `gh pr view <n> --json reviews` (merged-PR activity) instead; call this out by name in `retrospective.md` so the wrong data source is never wired in during implementation |
| Editing `orchestrator.md`'s `## Kaizen hunt dispatch` section trips the grow-never content gate (`V-CONTENTGATE-01`, 38 LOC baseline) for zero functional benefit | LOW | T5 explicitly forbids touching `orchestrator.md`; T7's verification step re-confirms `git diff` on that file is empty before declaring success |
| `config-template.md`'s default array and `fixtures/config.example.json`'s array drift out of sync (no automated equality check exists between them) | LOW | T3 requires a manual diff check as its acceptance criterion, in addition to `checkFixtures`'s shape-only pass; both files are edited in the same task batch (T2+T3) to avoid a partial-landing window |
| A retrospective candidate's `needs_design: true` flag is set inconsistently (too eager, flooding the design tier; too conservative, missing real architectural candidates) | LOW | T1 requires the flagging rule to be a concrete, worked-example criterion ("coupling hotspot, cross-cutting extraction" vs. "contained, single-file fix"), not a vague heuristic — reviewable against the calibration table's worked examples at review time |
| Ledger schema or `V-HUNT-01`/`V-HUNT-02` filing machinery accidentally touched, violating the milestone's explicit "must NOT modify ledger schema or filing machinery" constraint | MEDIUM | T1 states this constraint as a "Do NOT" list item; T7's `bun test` run exercises the existing ledger/filing test suite (`scripts/validate-worker-json.test.ts` and siblings) unchanged, which would fail on any accidental schema drift |

## Success Criteria

- `bun run build` exits 0 and `retrospective.md` is present under every build target's
  `references/hunt/` (or equivalent) path.
- `bun run verify` exits 0, with `V-CONTENTGATE-01` showing zero diff on
  `src/agents/orchestrator.md` and `V-SCHEMA-01` (`checkFixtures`) passing.
- `bun test` exits 0 with no regressions against the pre-milestone baseline (`d4d978b`).
- `git diff --stat` for this milestone touches exactly: `src/references/hunt/retrospective.md`
  (new), `src/references/config-template.md`, `fixtures/config.example.json`,
  `src/agents/hunter.md`, plus regenerated build-output paths — and **nothing** under
  `src/agents/orchestrator.md`, ledger/finding schema files, or `scripts/checks/*.ts`.
- `kaizen.kinds` in both `config-template.md` and `fixtures/config.example.json` reads
  `["quickwins", "best-practices", "coverage", "refactor", "bug", "retrospective"]`.

## Plan Quality Gate

- [x] Task acceptance criteria: 7/7 tasks (T1–T7) have explicit, verifiable acceptance criteria
- [x] Critical file existence: all "Modify"/"Verify only" files confirmed to exist on disk by
      `Glob` during discovery (`src/references/config-template.md`, `fixtures/config.example.json`,
      `src/agents/hunter.md`, `src/references/phase-loop.md`, `src/SKILL.md`); T1's file is
      correctly typed "New file"
- [x] Dependency completeness: T2/T3/T4 depend on T1 (kind must exist before being registered);
      T7 depends on T1–T6 (verifies the completed set); stated explicitly in Execution Strategy
      ordering
- [x] Risk mitigation concreteness: all 5 mitigations name a specific file, task, or check —
      no "monitor"/"be careful"/"consider" language
- [x] Success criteria measurability: every criterion references a command exit code, a `Glob`
      match, or a literal array-content comparison
- [ ] Boundary conditions: advisory, does not apply — this milestone has no input-parsing/state-
      transition code (pure markdown/JSON content addition)
- [ ] Stop conditions: advisory — no HIGH-risk item in the Risk Assessment table, so a
      `## Stop Conditions` section is not required
- [x] Codebase conventions: 5 touchpoints catalogued (hunt kind file shape, kaizen kind roster,
      `gh pr` query convention, filing template reuse, content-gate baseline) — advisory for
      Quick track, included for completeness given `hunter.md`/`config-template.md` are
      genuine integration touchpoints
