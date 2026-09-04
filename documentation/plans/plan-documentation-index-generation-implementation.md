---
type: plan
summary: "Standard Track implementation plan for ADR-031 (documentation/INDEX.md generation): Phase 1 task breakdown — summary: frontmatter schema addition, one-time migration, generate-doc-index.ts, advisory round-trip parity signal; Phase 2 (breaking call-site retirement + blocking check + prose updates) deferred as a follow-up"
status: current
review_trigger: "on file change"
created: 2026-09-04
last_updated: 2026-09-04
related: [decisions/ADR-031-generate-documentation-index.md]
---


# Plan - Issue #811

## Objective

ADR-031 (`documentation/decisions/ADR-031-generate-documentation-index.md`, staged) decided
`documentation/INDEX.md` becomes a generated build artifact instead of a hand-appended file, to
close the campaign's highest-contention merge-conflict class (13 commits/6h, ~1 rebase per 2
merges, sole-file conflicts on PR #819/#824 this session). The Design Track note
(`.blackhole/plans/issue-811-design.md`) produced the trade-off analysis and Refactoring Impact
Analysis but deliberately stopped before a task breakdown (`status: blocked` gate, overridden by
the orchestrator under `autonomy.mode: full`). This plan produces that task breakdown.

**Split decision (this plan covers Phase 1 only)** — see `## Notes for Phase 2` at the end. The
cutover from hand-append to generated-and-enforced cannot safely land as a first PR: `bun run
verify`'s new drift-blocking check (design point 8) can only be turned on once (a) every doc
already carries a `summary:` frontmatter field and (b) both hand-append call sites
(`carry-staged-artifacts.ts`, `companion-file-sync.ts`) have stopped writing rows to
`documentation/INDEX.md` — otherwise the very next PR to land a plan/review artifact via the
unretired append path would immediately desync the committed file from the generator's output
and trip the blocking check for everyone. Phase 1 below is the safe, purely-additive half: add
the frontmatter field, migrate existing docs, build the generator, and prove byte-identical
round-trip parity with a non-blocking advisory signal — all of which coexists with the current
hand-append mechanism without changing its behavior. Phase 2 (the two breaking call-site changes,
flipping the check to blocking, and updating the 5 DEPRECATION-classified prose surfaces) is a
distinct follow-up PR once Phase 1's round-trip parity is proven merged and stable — this is
exactly the "a generator existing but not yet being the sole writer is a safe, working
intermediate state" case `wave_scheduling` values over a single mega-PR.

**Live re-measurement (do not trust the issue's 77 or the design note's 108 — both are already
stale)**: at this plan's base commit, `documentation/INDEX.md` carries **116** data rows
(verified via the repo's own `check-common.ts` row-parsing logic, not a naive grep — see
`## Task Breakdown` Task 5 for the re-derivation command every implementer must re-run live,
never hardcode this number).

## Touch-Paths

- `src/references/doc-governance.md` (plus all generated dist trees per `scripts/lib/build/targets.ts`) — add `summary` to the Lifecycle Frontmatter schema table
- `scripts/lib/check-common.ts` — export the existing `byPathByteOrder` comparator and `renderIndexRowLine` helper (currently private) for reuse by the new generator (`V-INT-02` — no new sort/render logic)
- `scripts/lib/doc-index-generate.ts` (new) — pure function: tree walk + frontmatter read + sorted row build, reusing `check-common.ts` primitives
- `scripts/generate-doc-index.ts` (new) — thin CLI wrapper: prints the generated table; `--check` flag diffs against the committed `documentation/INDEX.md` and exits 1 on mismatch (not yet wired into `bun run verify` — that wiring is Phase 2)
- `scripts/migrate-doc-index-summaries.ts` (new) — one-time migration CLI: computes `{path, summary}` pairs by joining live `documentation/INDEX.md` rows with each doc's current frontmatter, then inserts a YAML-safe `summary:` field into every doc missing one (idempotent — a doc that already has `summary:` is left untouched)
- `scripts/checks/doc-health.check.ts` — add a new advisory-only parity signal folded into the existing `V-DOCHEALTH-03` umbrella (`evaluateDocTreeHealth`'s sibling), diffing generator output against the committed file; `ok: true` always in this phase (never blocking) — reuses the existing always-advisory V-DOCHEALTH-03 contract rather than minting a new V-code (`V-KISS-01`/`V-YAGNI-01`)
- `documentation/**/*.md` — scope: every file under `documentation/` **excluding** `documentation/decisions/**`, `documentation/milestones/_archived/**`, and `documentation/INDEX.md` itself (the migration's sweep-to-zero target: every file in scope gains a `summary:` frontmatter field; **no other exemptions** — a file in scope with no corresponding `documentation/INDEX.md` row is a pre-existing `V-DOCHEALTH-02` orphan and is out of this plan's scope, flagged not fixed)
- Tests: `scripts/lib/doc-index-generate.test.ts` (new), `scripts/migrate-doc-index-summaries.test.ts` (new), `scripts/verify.doc-health.test.ts` (extend), `scripts/lib/check-common.test.ts` (extend — new exports)

## Documentation Impact

- `src/references/doc-governance.md` — direct edit (Lifecycle Frontmatter schema gains `summary`); this is itself the doc being updated, not a downstream consumer
- `documentation/decisions/INDEX.md`, `ARCHITECTURE.md` — already carry their ADR-031 entries (staged by the orchestrator's override, `.blackhole/staged/811/decisions-index-row.md` and `architecture-active-constraint.md`); this plan does not re-stage those
- `src/references/blackhole-vcodes.md` — **not touched**: Phase 1 reuses the existing `V-DOCHEALTH-03` advisory umbrella rather than minting a new V-code, so no table row addition is needed
- `src/references/blackhole-state.md`, `src/references/artifact-contract.md`, `src/agents/planner.md`, `src/agents/investigator.md`, `src/agents/implementer.md` — **deliberately NOT touched in this PR.** These describe today's hand-append mechanism, which Phase 1 does not change (both call sites keep writing rows exactly as before). Updating this prose now, before the cutover ships, would itself introduce stale/inaccurate documentation in the other direction. They become Phase 2 Touch-Paths, updated in the same PR that retires the two call sites (`V-DOC-04` compliance at that point, not this one).

## Critical Files

- `scripts/lib/check-common.ts` — shared primitive; `appendIndexRowIfAbsent`/`parseIndexTableRows` remain load-bearing for `documentation/decisions/INDEX.md`'s sorted-insert mechanism (untouched, out of scope) — the export addition must not alter existing behavior for that consumer
- `scripts/checks/doc-health.check.ts` — houses the existing blocking `V-DOCHEALTH-01`/`V-DOCHEALTH-02` checks; the new advisory addition must not change their pass/fail semantics

## Codebase Conventions

| Concern | Convention | Touchpoint |
|---|---|---|
| Generated-artifact + drift-check pattern | `<!-- GENERATED by ... — do not hand-edit -->` marker + `bun run verify` regenerate-and-diff, already used by every platform build target (`.claude/`, `.cursor/`, `skills/`, `codex-*`, `.agents/build/`) | `scripts/build.ts`, `Makefile` targets — Phase 1 builds the generator half of this pattern only; the blocking-check half is Phase 2 |
| Root-INDEX row parsing/rendering/sorting | `parseIndexTableRows`, `appendIndexRowIfAbsent`, `byPathByteOrder` (byte-order, not `localeCompare`) | `scripts/lib/check-common.ts` — reuse via new exports, no new sort/parse (`V-INT-02`) |
| Doc-tree walking | `walkMdFilesAbs` | `scripts/lib/check-common.ts` — the generator's tree walk reuses this, not a new recursive walker |
| Frontmatter parsing | `parseMdFrontmatter` / `parseFrontmatterFields` | `scripts/lib/build/content.ts` — reused by both the generator and the migration script |
| Lifecycle frontmatter schema | 5 required fields today (`type`, `status`, `review_trigger`, `created`, `last_updated`) plus optional `supersedes`/`related` | `src/references/doc-governance.md` § Lifecycle Frontmatter — this plan adds `summary` as a 6th documented field, inserted immediately after `type` in the schema table |
| Canonical doc naming | `{concern-slug}.md`, no date stamp; `scripts/lib/concern-slug.ts` is the slug SSOT | `doc-governance.md` § Canonical Naming — this plan's own durable copy uses a distinguishing slug from the design note's (see `## Notes`) since both are legitimate, separate artifacts for the same concern |

No `## Database/API Schema Changes` section — this plan touches no database or public API surface.

## Execution Strategy & Stop Conditions

- **Never hardcode a doc/row count.** Every count (live `documentation/INDEX.md` row count, live doc-tree file count for the migration sweep) is re-derived at implement time via the commands in Task 5/Task 8 below. If the implementer's live re-derivation produces a different number than this plan's 116 (because more PRs merged rows in the interim, which is expected — that's the whole problem this issue exists to fix), use the freshly measured number; **if that re-derivation cannot be run or produces an error, halt and escalate rather than guessing or reusing 116.**
- **Comparator reuse is mandatory, not advisory.** If `scripts/lib/check-common.ts`'s `byPathByteOrder` is not exported cleanly as a pure function by the time Task 2 starts (e.g. it has been refactored to close over module state since this plan's base commit), **abort and re-plan** rather than writing a second, parallel sort in the generator — a second sort is exactly the `V-INT-02` failure mode this plan exists to avoid.
- **Migration is all-or-nothing per file, never partial.** If a doc's frontmatter fails to parse cleanly (malformed YAML) either before or after the `summary:` insertion, **stop migrating that specific file, leave it untouched, and add it to a reported exceptions list** — never force-write a `summary:` field into a file whose frontmatter block the migration script cannot round-trip-parse. Do not silently skip without reporting; the Task 8 AC requires the exceptions list to be empty before this plan's tasks are considered complete (an empty exceptions list *is* the AC, not an assumption).
- **Round-trip parity must be verified byte-for-byte before this PR is considered done.** After migration, run the generator against the live (now-migrated) `documentation/` tree and diff its rendered table against the current `documentation/INDEX.md` row block. **If the diff is non-empty, halt before merging** — do not paper over a mismatch by hand-editing either the generator or the committed file to force agreement; investigate the specific row(s) that differ (this is precisely the "malformed/dropped frontmatter could silently misrender a row" risk both Design Track blind critics flagged).
- **A mid-implementation rebase is expected and unremarkable in Phase 1.** Because the two hand-append call sites are untouched, a concurrent merge that appends a new row to `documentation/INDEX.md` during this PR's lifetime is a normal conflict, resolved normally (this plan does not change that mechanism). After any such rebase, re-run the Task 9 round-trip verification — the newly-landed row's doc also needs migrated `summary:` frontmatter before parity holds again.
- **Do not begin any Phase 2 work in this PR.** If, while implementing, the two breaking call-site changes or the blocking-check flip start to feel small enough to fold in "while we're here," stop — that is the scope-creep rationalization the split above exists to prevent. File Phase 2 as its own tracked follow-up (see `## Notes`).

## Task Breakdown

- [ ] **TDD Baseline Verification**: Run `bun test` and `bun run verify` to confirm the current suite and check set are green before any change. — **AC**: baseline run completes, pass/fail counts quoted in the completion evidence; zero pre-existing failures attributed to this plan's changes.

- [ ] **Task 1 — Failing tests for `check-common.ts` new exports**: Write tests asserting `byPathByteOrder` and `renderIndexRowLine` are importable from `scripts/lib/check-common.ts` and behave identically to their current private usage (byte-order comparison on `path`, exact `| p | s | t | st | rt |` line rendering). — **AC**: new tests exist in `scripts/lib/check-common.test.ts` and fail (import error) before the export change lands.

- [ ] **Task 2 — Export the comparator and row renderer**: Add `byPathByteOrder` and `renderIndexRowLine` to `check-common.ts`'s export surface. No behavior change to `appendIndexRowIfAbsent` or any existing consumer. — **AC**: Task 1's tests pass; existing `check-common.test.ts` assertions for `appendIndexRowIfAbsent`'s sorted-insert behavior (`documentation/decisions/INDEX.md`'s consumer path) are unchanged and still pass.

- [ ] **Task 3 — Failing tests for the generator**: Write tests for a new pure function (e.g. `buildDocIndexRows(docsDir): RootIndexRow[]`) in `scripts/lib/doc-index-generate.ts`, against a small fixture directory: confirms `decisions/` and `milestones/_archived/` are excluded, confirms `INDEX.md` itself is excluded, confirms row `summary`/`type`/`status`/`reviewTrigger` are sourced from each fixture doc's frontmatter, confirms output is sorted via the imported `byPathByteOrder` (not a re-implemented comparator). — **AC**: tests exist in `scripts/lib/doc-index-generate.test.ts` and fail before the generator is implemented.

- [ ] **Task 4 — Implement the generator**: Implement `buildDocIndexRows` and a `renderDocIndexTable(rows): string` wrapper in `scripts/lib/doc-index-generate.ts`, reusing `walkMdFilesAbs`, `parseMdFrontmatter`/`parseFrontmatterFields`, `byPathByteOrder`, and `renderIndexRowLine` from existing modules — no new tree-walk, parse, sort, or render logic. — **AC**: Task 3's tests pass.

- [ ] **Task 5 — Live re-measurement (do not hardcode)**: Before writing the CLI wrapper or running the migration, re-derive the current row count live: `bun -e "const fs=require('fs');const c=fs.readFileSync('documentation/INDEX.md','utf-8');let n=0;for(const l of c.split('\n')){if(!l.trim().startsWith('|'))continue;const cells=l.split('|').map(s=>s.trim());if(cells.length<6)continue;const p=cells[1];if(!p||p.toLowerCase()==='path'||/^:?-+:?\$/.test(p))continue;n++;}console.log(n);"` — record the output as this task's evidence (verified 116 at plan time; the live number at implement time is authoritative regardless of match). — **AC**: a live count is printed and quoted in the completion evidence; this count, not 116, drives Task 8's migration scope.

- [ ] **Task 6 — CLI wrapper**: Implement `scripts/generate-doc-index.ts` — default invocation prints the full generated markdown table (header + separator + `renderDocIndexTable` output) to stdout; `--check` flag reads committed `documentation/INDEX.md`, diffs against generated output, prints the diff and exits 1 on mismatch, exits 0 on match. Not yet invoked by `bun run verify` (Phase 2 wiring). — **AC**: `bun run scripts/generate-doc-index.ts` against the current tree (pre-migration) prints a diff via `--check` showing every row missing a `summary:`-sourced value differs from its hand-written cell (expected — proves the tool works before migration closes the gap).

- [ ] **Task 7 — Failing tests for the migration's pure planning function**: Write tests for `computeSummaryMigrationPlan(docsDir, indexContent): { path: string; summary: string; skipped: boolean }[]` in `scripts/migrate-doc-index-summaries.test.ts`: joins parsed INDEX.md rows with each doc's current frontmatter; marks a doc `skipped: true` (idempotent no-op) when it already has a non-empty `summary:` field; correctly YAML-escapes a summary value containing a colon, a double quote, or a backtick (fixture cases for each). — **AC**: tests exist and fail before the planning function is implemented.

- [ ] **Task 8 — Implement and run the migration**: Implement `computeSummaryMigrationPlan` and an `applySummaryMigration` step that inserts a YAML-safe, double-quoted `summary: "..."` line immediately after each doc's `type:` frontmatter line (matching the Task-updated `doc-governance.md` schema position), for every file in the plan not marked `skipped`. Run it against the **live** `documentation/` tree (scope: Task 5's live-derived file set, excluding `decisions/**` and `milestones/_archived/**`). Any file whose frontmatter fails to parse before or after insertion goes into a reported exceptions list, per the Execution Strategy stop condition above — **AC**: exceptions list is empty; every in-scope doc now has a `summary:` frontmatter field whose value, when YAML-unescaped, is byte-identical to its current `documentation/INDEX.md` row's summary cell.

- [ ] **Task 9 — Round-trip parity verification**: Run `scripts/generate-doc-index.ts --check` against the now-migrated live tree. — **AC**: exit code 0, zero diff between generated output and committed `documentation/INDEX.md` (this is the concrete proof that Phase 2's blocking check will not misfire the moment it is turned on).

- [ ] **Task 10 — Failing test for the advisory parity signal**: Write a test for a new `evaluateGeneratedIndexParity(docsDir)` function in `scripts/verify.doc-health.test.ts`: against a fixture where generated output matches committed content, returns `{ id: 'V-DOCHEALTH-03', ok: true }` with no detail; against a mismatched fixture, still returns `ok: true` (never blocking in Phase 1) but with a `detail` string naming the differing path(s). — **AC**: test exists and fails before the function is implemented.

- [ ] **Task 11 — Implement the advisory signal**: Add `evaluateGeneratedIndexParity` to `doc-health.check.ts`, reusing `buildDocIndexRows`/`renderDocIndexTable` from Task 4 — do not re-implement the diff logic. Add it to the module's `runChecks()` export alongside the existing 5 checks. — **AC**: Task 10's tests pass; `bun run verify` still passes end-to-end (this is an additive, always-`ok:true` check, so it must never turn a green `verify` run red).

- [ ] **Verify Integrity**: Run `bun test` and `bun run verify` in full. — **AC**: full suite green, `bun run verify` green, both quoted in the completion evidence; no file outside this plan's Touch-Paths modified.

## Sprint Contract

- Task 1/2: `check-common.ts` exports `byPathByteOrder` + `renderIndexRowLine` with zero behavior change to existing consumers — AC per Task 2.
- Task 3/4: `doc-index-generate.ts` produces correct, sorted, frontmatter-sourced rows against a fixture, excluding `decisions/`/`milestones/_archived/`/`INDEX.md` — AC per Task 3/4.
- Task 5: live row count re-derived and quoted, never hardcoded — AC per Task 5.
- Task 6: `generate-doc-index.ts --check` correctly diffs pre-migration (expected mismatch) — AC per Task 6.
- Task 7/8: migration is idempotent, YAML-safe, and produces zero unresolved exceptions across the live doc set — AC per Task 7/8.
- Task 9: post-migration round-trip parity is byte-exact — AC per Task 9.
- Task 10/11: advisory parity signal is wired into `doc-health.check.ts` without changing any existing check's pass/fail outcome — AC per Task 10/11.
- Tasks without a narrower AC above fall back to "all tests and linters pass."

## Quality Gate Results

| Check | Result |
|---|---|
| `touch_paths_declared` | PASS |
| `schema_baseline` | PASS |
| `ac_mapping` | PASS |
| `critical_files_exist` | PASS |
| `mitigation_concrete` | PASS |
| `ac_sweep_conflict` | PASS |
| `ac_sweep_scope` | PASS |
| `touch_paths_ssot_gap` | PASS |
| `ac_facts_literal_bump` | PASS |

(Populated by `bun run scripts/plan-quality-gate.ts --plan-file .blackhole/plans/issue-811.md` — see tool output; copied verbatim, not hand-derived.)

## Notes for Phase 2 (follow-up, not this PR — orchestrator to file as a separate tracked issue)

Phase 2 scope, once Phase 1 is merged and its round-trip parity has held stable across at least
one normal campaign merge cycle:

1. Re-verification per the Design Track's Assumption Audit #5: grep `appendIndexRowIfAbsent` and
   the literal target path `documentation/INDEX.md` again, live, to confirm no third undiscovered
   production consumer exists beyond `carry-staged-artifacts.ts` and `companion-file-sync.ts`
   before removing anything.
2. `scripts/lib/carry-staged-artifacts.ts`: add a `target_path === 'documentation/INDEX.md'`
   branch in the `append_row` dispatch (currently line ~322-325) that no-ops instead of calling
   `appendPipeTableRowIfAbsent` — `documentation/decisions/INDEX.md` keeps using that function
   unchanged (a target-path branch, not a function removal).
3. `scripts/lib/companion-file-sync.ts`: `repairJourneysIndexRow` stops appending
   `JOURNEYS_INDEX_ROW`; becomes a frontmatter-only repair (ensures `journeys.md` carries
   `summary:`).
4. Flip `scripts/generate-doc-index.ts --check` from a manually-run tool into a blocking `bun run
   verify` gate; retarget `doc-health.check.ts`'s `V-DOCHEALTH-01`/`V-DOCHEALTH-02` to diff
   committed-vs-regenerated content (staleness) instead of row-existence.
5. Update the 5 DEPRECATION-classified prose surfaces in the same PR (`V-DOC-04` compliance):
   `src/references/blackhole-state.md`, `src/references/doc-governance.md` (describe the file as
   generated, not hand-appended), `src/references/artifact-contract.md`, and the
   `plan`/`analyze`/`investigate` route staging conventions in `src/agents/planner.md`,
   `src/agents/investigator.md`, `src/agents/implementer.md` (stop instructing an `append_row`
   staging entry for the now-inert root-INDEX target).
6. AC(5)-style post-change measurement should be framed as "rebase-agent dispatches avoided,"
   per Design Track Assumption Audit #2 — not "conflict count," since PR branches still commit
   their own regenerated snapshot and a rebase-level git conflict on the file itself is not
   literally eliminated by this design, only made mechanical to resolve.

## Staging note (ADR-021 D3)

This plan's durable copy is staged as a **second, distinct** `plan`-route pair from the Design
Track's own existing plan-route entries in `.blackhole/staged/811/manifest.json` (declared at
19:21:53, targeting `documentation/plans/plan-documentation-index-md-serializes-the-campaign-6-
rebases-per-11-merges-all-on-on.md` — the design record's own durable copy). This
implementation plan is staged separately as
`documentation/plans/plan-documentation-index-generation-implementation.md`, using a
deliberately distinguishing filename from the design-record copy (both describe the same
concern but are different artifact types — design record vs. task breakdown — per this
campaign's explicit instruction that both are legitimate, separate files).
