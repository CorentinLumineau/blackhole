---
type: plan
status: current
review_trigger: "on ADR acceptance"
created: 2026-09-02
last_updated: 2026-09-02
related:
  - documentation/plans/plan-retrospective-v0.21.0-remediation.md
---

# Plan — Issue #716: plan-quality-gate CLI invoked at plan time

Part of #703, item R-11 of `documentation/plans/plan-retrospective-v0.21.0-remediation.md`.

## Objective

`scripts/checks/plan-quality-gate.check.ts` already exports `findMissingCriticalFiles` and
`findVagueMitigations`, but only its own fixture test calls them — `planner.md` step 8
re-implements the same Glob-miss / vague-mitigation logic as prose the planner performs
manually. Add a small CLI (`scripts/plan-quality-gate.ts`) that reuses those exports (plus
`splitTaskBreakdownBullets`, already exported, for the `ac_mapping` check) against a plan file
on disk, printing `{ac_mapping, critical_files_exist, mitigation_concrete}` as JSON; wire
`planner.md` step 8 to invoke it and copy the result into the return JSON instead of
re-deriving it in prose; align the check file's header comment and
`worker-schemas.md` § Plan quality gate checks with the new architecture. No new quality check,
no new V-code — this is a mechanical-vs-judgment split, same shape as R-10's
`carry-staged-artifacts.ts` and the `companion-file-sync.ts` CLI precedent.

## Touch-Paths

- `scripts/plan-quality-gate.ts` (new CLI entrypoint)
- `scripts/plan-quality-gate.test.ts` (new)
- `scripts/checks/plan-quality-gate.check.ts` (header comment only — no new export, no new
  `CheckResult`, no new V-code row)
- `src/agents/planner.md` (Step 8 prose → CLI invocation), plus all generated dist trees per
  `scripts/lib/build/targets.ts`
- `src/references/worker-schemas.md` (§ Plan quality gate checks, `ac_mapping` row only), plus
  all generated dist trees per `scripts/lib/build/targets.ts`

Out of scope (per issue Scope): no new quality-gate checks, no new V-code, no change to
`ac_sweep_conflict` / `ac_sweep_scope` / `touch_paths_ssot_gap` advisory heuristics, no change to
`runChecks()`'s three grounding `CheckResult`s (`V-PLANGATE-01/02/03`) in
`plan-quality-gate.check.ts` — those stay as-is; only the file's top header comment (lines 11-18)
changes.

## Documentation Impact

`docs_governance.enabled: true`. None — this issue's `documentation/` footprint is fully covered
by the Touch-Paths above (`worker-schemas.md` is itself the affected reference doc); no new file
under `documentation/` is created and no existing `documentation/**` doc besides the touched
`src/references/worker-schemas.md` source needs a companion update.

## Codebase Conventions

| Concern | Convention | Citation |
|---|---|---|
| CLI argv shape | `--flag value` pairs parsed by a local `parseCliArgs`, guarded by `if (import.meta.main)`, `Usage:` message + `process.exit(2)` on missing required flag | `scripts/lib/companion-file-sync.ts` (invoked as `bun run scripts/lib/companion-file-sync.ts --repo-root <path> --diff-file <paths.txt>`, see `src/agents/implementer.md:483`) |
| Pure-function / CLI split | Detection logic stays a pure, fixture-testable exported function in the `.check.ts` file (or a `lib/`); the CLI wrapper does the `fs` read + JSON print, so unit tests never touch disk | `scripts/checks/plan-quality-gate.check.ts`'s existing `findMissingCriticalFiles(section, exists)` — `exists` is injected for exactly this reason |
| JSON stdout contract | `console.log(JSON.stringify(result, null, 2))` as the sole stdout output on success | `scripts/lib/companion-file-sync.ts` tail; `scripts/design-aggregate.ts` |
| Mechanical-vs-prose split precedent | A check's pure functions live in `scripts/checks/*.check.ts`; a thin script under `scripts/` wires them to real `fs`/argv and is what the agent's markdown step actually invokes | R-10 (`scripts/carry-staged-artifacts.ts` wrapping `implementer.md`'s prose), this same plan's R-11 |
| Section extraction from a plan body | No existing helper extracts an arbitrary `## Heading` block from a rendered plan file (`extractStandardTrackSection` in this same check file is planner.md-template-specific, not reusable here) — the new CLI needs a small local `extractSection(content, heading)` using the same "next `## ` line or EOF" boundary rule `parseSectionLineCounts` already uses in `content-gates.check.ts`, but simpler (single heading, not full section map) | `scripts/checks/content-gates.check.ts` `parseSectionLineCounts` (pattern reference only — do not import; that function returns a full line-count map, not section text, and lives in a different domain) |

## Design Decision — `ac_mapping` has no existing exported detector

**Context.** The issue's AC groups `ac_mapping` with `critical_files_exist` /
`mitigation_concrete` as if all three already have a reusable export, but only the latter two do
(`findMissingCriticalFiles`, `findVagueMitigations`). `ac_mapping` today lives purely as planner
judgment: "does every `## Task Breakdown` item carry a `— **AC**:` marker."

**Easy path.** Skip `ac_mapping` in the CLI, print only the two backed checks, leave
`ac_mapping` as planner-only prose forever.

**Hard path (chosen).** Add a minimal `findMissingAcMapping(taskBreakdownSection)` that reuses
the *already-exported* `splitTaskBreakdownBullets` (no new parsing primitive) and flags any task
whose text lacks a `**AC**:` marker. This fulfills the issue's literal `{ac_mapping, ...}` output
shape without inventing a new check — the check already exists as documented behavior in
`worker-schemas.md` line 61 and `planner.md` step 8; this only makes it mechanical, exactly R-11's
stated purpose for the other two fields.

**Placement.** `findMissingAcMapping` is added to `scripts/plan-quality-gate.ts` (the new,
budget-unconstrained CLI file), **not** to `scripts/checks/plan-quality-gate.check.ts` — that
file has only 3 lines of headroom to its `maxFileLoc: 218` content-gate budget (215/218 today;
see § Execution Strategy) and the issue's scope line ("Out: new quality checks") reads more
safely as "do not add a new `CheckResult`/V-code to `runChecks()`" than as "do not add any new
function anywhere," so keeping the new function out of the budget-constrained file honors both
the letter and the tight-budget spirit. `splitTaskBreakdownBullets` is imported from
`plan-quality-gate.check.ts` into the CLI unchanged.

**Rationale.** Short-term cost: one extra ~6-line function in a new, unbudgeted file. Long-term
benefit: the CLI's output shape matches the issue's literal AC instead of silently dropping a
field, and the next reader of `worker-schemas.md` line 61 sees a script they can run, not three
fields where only two are real. **Confidence: High** — the marker convention (`**AC**:`) is
already the plan-template's own contract (`plan-template.md`, Sprint Contract), so detecting its
absence is not new judgment, only new mechanization of an existing one.

## Execution Strategy & Stop Conditions

Two of the five Touch-Paths sit at hard content-gate ceilings (`CONTENT_GATE_BUDGETS`,
`scripts/lib/build/facts.ts:108-117`) — **never raise these values** (ground rule #4):

- `scripts/checks/plan-quality-gate.check.ts`: 215/218 `maxFileLoc` — **3 lines of headroom**.
  If the header-comment rewrite (lines 11-18, replacing the now-false "planner performs both
  itself" claim with a description of the CLI wrapper) cannot be done as a same-or-fewer-line
  edit, abort and extract instead of exceeding 218 lines — do not touch the check functions
  (`checkPlanQualityGateGrounding` et al.) or their `runChecks()` array; none of those need to
  change for this issue.
- `src/references/worker-schemas.md`: 940/950 `maxFileLoc` (**10 lines of headroom**) and its
  containing `## Planner` section is 175/179 `maxSectionLoc` (lines 16-191, **4 lines of
  headroom**). The required edit (citing `scripts/plan-quality-gate.ts` on the `ac_mapping` row,
  worker-schemas.md:61) MUST be done by extending the existing line's prose in place — appending
  a clause to line 61 — never by inserting a new `-` bullet line. If the citation genuinely
  cannot fit on the existing line without harming readability, stop and flag `mitigation_concrete`
  in this plan's own re-read rather than force a line-budget violation.
- `src/agents/planner.md`'s `## Workflow & Planning Steps` section (lines 16-88, currently ~72
  lines against a 350-line section budget) has ample room for the Step 8 rewrite — no ceiling
  risk there. Do not touch `## Plan Complexity Tracks & Sections` (lines 88-438): that section is
  **already exactly at its 350-line budget** (350/350) and is unrelated to this issue's scope —
  if any edit here is even considered, halt and re-scope; this issue's Step 8 changes live
  entirely inside the preceding section.
- No new V-code row and no new `CheckResult` are added by this issue (§ Design Decision above),
  so `VCODE_TABLE_ROW_COUNT` and `EXPECTED_CHECK_COUNT` in `facts.ts` stay untouched — the ground
  rule #2 bump only applies when a new check/V-code row is added, which this issue explicitly is
  not (issue Scope: "Out: new quality checks").
- If `bun run build` (required by `V-BUILD-01` after editing `src/`) regenerates a dist tree file
  that itself would cross a content-gate budget, abort the build-commit step and report — do not
  hand-edit a generated tree to route around the gate.

## Task Steps

1. **Add `findMissingAcMapping` and its test fixtures.** In `scripts/plan-quality-gate.ts` (new
   file), import `splitTaskBreakdownBullets` from `./checks/plan-quality-gate.check.ts` and add
   `export const findMissingAcMapping = (taskBreakdownSection: string): string[] =>
   splitTaskBreakdownBullets(taskBreakdownSection).filter(t => !/\*\*AC\*\*:/.test(t.text)).map(t
   => t.label)`. Add a local `extractSection(content: string, heading: string): string` helper
   (next `^## ` line or EOF is the boundary, mirroring `parseSectionLineCounts`'s rule but
   returning text, not a count) used to pull `## Critical Files`, `## Execution Strategy & Stop
   Conditions`, and `## Task Breakdown` out of the target plan file.
   — **AC**: `bun test scripts/plan-quality-gate.test.ts` passes with fixtures covering (a) a
   task missing `**AC**:` is flagged, (b) a task carrying it is not, (c) a `## Critical Files`
   section naming a nonexistent path is flagged, (d) an `## Execution Strategy & Stop Conditions`
   bullet containing a vague word without a stop condition is flagged.
2. **Wire the CLI entrypoint.** Add `parseCliArgs(argv)` requiring `--plan-file <path>` (argv
   shape and `Usage:`/`process.exit(2)` fallback per `scripts/lib/companion-file-sync.ts`); on
   `import.meta.main`, read the plan file, extract the three sections, call
   `findMissingCriticalFiles`, `findVagueMitigations`, `findMissingAcMapping`, and print
   `{ ac_mapping: boolean, critical_files_exist: boolean, mitigation_concrete: boolean }` (each
   `true` = pass, i.e. the corresponding missing-list is empty) via
   `console.log(JSON.stringify(result, null, 2))`.
   — **AC**: `bun run scripts/plan-quality-gate.ts --plan-file <fixture-plan-path>` printed on
   stdout is valid JSON with exactly the three boolean keys named in the issue AC; missing
   `--plan-file` exits 2 with a `Usage:` line on stderr.
3. **Update `plan-quality-gate.check.ts`'s header comment only.** Rewrite lines 11-18 to state:
   the check file exports pure detection functions; `scripts/plan-quality-gate.ts` is the CLI
   that wraps them against real `fs`/argv; the planner agent invokes that CLI at plan time
   (issue #716) instead of re-deriving the checks in prose. Keep the rewrite at 8 lines or fewer
   (current comment is 8 lines) — see § Execution Strategy's 3-line headroom note. Do not touch
   any code below line 18.
   — **AC**: `wc -l scripts/checks/plan-quality-gate.check.ts` reports ≤218; the header no longer
   contains the sentence "The planner agent performs both itself at plan time."
4. **Rewrite `planner.md` Step 8.** Replace the inline re-derivation of the critical-file-Glob
   and vague-mitigation-word-list logic with: an instruction to invoke `bun run
   scripts/plan-quality-gate.ts --plan-file <path-to-the-plan-being-written>` and copy its
   `{ac_mapping, critical_files_exist, mitigation_concrete}` result directly into
   `failing_checks`/the `## Quality Gate Results` PASS/FAIL rows, rather than performing the Glob
   call and word-list scan by hand. Preserve the section-presence-gating paragraph (both checks
   stay inert on Quick Track, which never emits `## Critical Files` or `## Execution Strategy &
   Stop Conditions`) and the advisory heuristics (`ac_sweep_conflict`/`ac_sweep_scope`/
   `touch_paths_ssot_gap`, out of scope for this issue) verbatim.
   — **AC**: `grep -n 'scripts/plan-quality-gate.ts' src/agents/planner.md` matches at least one
   line inside Step 8; `grep -c '"monitor"' src/agents/planner.md` (the restated word list) drops
   to zero prose restatements outside a citation of the CLI/check file.
5. **Align `worker-schemas.md` § Plan quality gate checks.** Extend line 61 (the `ac_mapping`
   row) in place — same line, no new line — to cite `scripts/plan-quality-gate.ts --plan-file
   <path>` as the mechanism that now computes all three fields, per § Execution Strategy's
   4-line section-headroom constraint.
   — **AC**: `grep -n 'plan-quality-gate.ts' src/references/worker-schemas.md` matches; `wc -l
   src/references/worker-schemas.md` reports ≤950 and the `## Planner` section (lines 16 to the
   next `## ` heading) is ≤179 lines.
6. **Build and commit dist trees (`V-BUILD-01`).** After steps 1-5 (tests green first, per
   ground rule #5 / TDD), run `bun run build` and commit the regenerated mirrors of
   `src/agents/planner.md` and `src/references/worker-schemas.md` alongside the source edit in
   the same PR.
   — **AC**: `git status --porcelain` after `bun run build` shows only the expected mirrored
   dist-tree paths (per `scripts/lib/build/targets.ts`) plus the 5 source/new-file touch paths —
   no unrelated file changed.
7. **Verify, scoped.** Run `bun test scripts/plan-quality-gate.test.ts
   scripts/verify.plan-quality-gate.test.ts` (existing fixture test for the check file) and the
   content-gate check scoped to the touched files:
   `bun run scripts/checks/content-gates.check.ts` is not directly invokable standalone — instead
   run the full `bun run verify` **only if** the workstation resource gate in
   `resource-frugal-testing.md` clears (this plan does not run it; the implement-phase worker
   runs it under its own pre-flight gate).
   — **AC**: the two scoped `bun test` invocations above exit 0; their output is quoted in the
   implementation's verification evidence.

## Quality Gate Results

Quick Track — `## Critical Files` and `## Execution Strategy & Stop Conditions` are Standard
Track headings not present in this plan's own structure (this section documents the touched
files' *own* content-gate ceilings for the implementer, not a Standard-track subsection of this
plan). `critical_files_exist` / `mitigation_concrete` are therefore inert for this plan
(Quick Track, per planner.md step 8's section-presence-gating rule) — not evaluated, not failed.

- `touch_paths_declared`: PASS — see § Touch-Paths.
- `schema_baseline`: PASS (N/A) — no config/frontmatter/schema key changes; `ac_mapping`,
  `critical_files_exist`, `mitigation_concrete` are pre-existing `failing_checks` vocabulary
  (`worker-schemas.md` line 61), not new schema.
- `clarification_limit`: PASS — 0 markers used.
- `base_commit`: PASS — `plan_base_commit: 100b812455d171c7b27bd9a8b09cb9525306b13a` stamped.

## References

- `documentation/plans/plan-retrospective-v0.21.0-remediation.md` § R-11 (evidence, AC, touch
  paths) and § Ground rules (build/verify sequence, content-gate discipline, test-first).
- `scripts/lib/companion-file-sync.ts` — CLI argv-shape precedent.
- `scripts/checks/plan-quality-gate.check.ts` — functions reused verbatim:
  `findMissingCriticalFiles`, `findVagueMitigations`, `splitTaskBreakdownBullets`.
- `scripts/lib/build/facts.ts:108-117` — `CONTENT_GATE_BUDGETS` (never raised).
