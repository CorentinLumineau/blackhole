---
type: plan
summary: "Exempt the regenerated documentation/INDEX.md from V-STACK-02 overlap at the prefilter and inside the merge-tree decider, so unrelated doc-carrying PRs stop stacking while a real source conflict still stacks (issue #1303)"
status: current
review_trigger: "on a change to the V-STACK-02 overlap predicate or to the set of regenerated files"
created: 2026-11-18
last_updated: 2026-11-18
related:
  - documentation/decisions/ADR-055-regenerated-files-exempt-from-stack-overlap.md
  - documentation/decisions/ADR-051-stacking-only-overlap-strategy.md
  - documentation/plans/plan-mandatory-stacking.md
---

# Plan - Issue #1303

## Objective

Every doc-carrying campaign PR shares `documentation/INDEX.md`, because the carry-step regenerates it wholesale. That shared file alone makes V-STACK-02 stack unrelated PRs (#1302 on #1299).

Make that one regenerated, order-independent file count as no overlap, in all four decision sites:
- `stack-check` git channel
- `stack-check` mcp channel
- `stack-parent --pr` recheck
- dispatch-time `pickStackParent`

A conflict in any other file must still stack.

The predicate stays a real `git merge-tree` conflict between the two heads, with the shared file as a prefilter only. There is no toggle and no config key, and the gate stays (owner ruling **R-005**, ADR-051 D1, V-STACK-03).

The design is Option A of `.blackhole/plans/issue-1303-design.md`, recorded as ADR-055. `design-aggregate.ts` returned `blocked` on dominance margin only (all three scorers chose A). **The owner approved the full Option A design on 2026-11-18** (decision gate answer "Approve full design", recorded in `owner-decisions.json`), including reading an INDEX-only merge-tree conflict as clean under R-005, disposition "proceed".

Incident evidence (`gh pr view --json files`, 2026-11-18): every pairwise intersection of the changed files of open PRs #1299, #1300, #1301 and #1302 is exactly `documentation/INDEX.md`. The one-path set fully unstacks the observed PRs.

Router correction: `stack-overlap.test.ts:88-91` does not document the INDEX pair as a conflict. It pins `always('clean')` → `none`.

## Touch-Paths
- `scripts/lib/doc-index-generate.ts`: export `ROOT_DOC_INDEX_PATH` (new symbol) and a pure `renderRootIndexFile(existing: string | null, docsDir: string): string` (title-block preservation, extracted from the carry-step; no I/O, so `writeCarryTarget` stays with its caller)
- `scripts/lib/doc-index-generate.test.ts`: test for `renderRootIndexFile`
- `scripts/generate-doc-index.ts`: `--write` mode: read the existing file, `renderRootIndexFile`, write it
- `scripts/lib/carry-staged-artifacts.ts`: replace the literals at L359 and L394 with the constant, and the title-block assembly at L388-392 with `renderRootIndexFile` (it keeps `writeCarryTarget`; behaviour identical)
- `scripts/lib/stack-overlap.ts`:
  - `REGENERATED_PATHS` constant
  - prefilter drop in `pickParent`
  - confinement test in `mergeTreeVerdict` (`--name-only`, optional third parameter)
- `scripts/lib/stack-overlap.test.ts`: red-first tests
- `scripts/lib/stack-parent.ts`: in `pickStackParent` (L95-125), drop exact `REGENERATED_PATHS` members from both issues' `touch_paths` (`mine`, `matchable`, `theirs`). A parent `files` list that was non-empty but filters to empty is a known no-overlap, so it does not fall back to `touchPathsOverlap`.
- `scripts/lib/stack-parent.test.ts`: dispatch test
- `scripts/stack-check.ts`: usage text only (the `--open-prs` line: "a shared file other than a regenerated one counts as the overlap")
- `documentation/decisions/ADR-055-regenerated-files-exempt-from-stack-overlap.md`: new, carried verbatim from `.blackhole/staged/1303/`
- `documentation/decisions/INDEX.md`: ADR-055 row, carried (`append_row`)
- `ARCHITECTURE.md`: one `## Active Constraints` bullet citing ADR-055, carried (`append_row`)
- `documentation/decisions/ADR-051-stacking-only-overlap-strategy.md`:
  - append a `## Post-acceptance amendments` entry citing #1303, R-005 and ADR-055
  - bump `last_updated`
- `src/references/merge-conflict-protocol.md`: classification item 1 names `documentation/INDEX.md` with `bun run scripts/generate-doc-index.ts --write` as its self-verifying regenerate
- `src/references/blackhole-vcodes.md`: V-STACK-02 row reads "conflict outside `REGENERATED_PATHS`"
- `src/references/doc-governance.md`: one sentence in § INDEX.md Maintenance pointing to the stacking exemption and the regenerate class
- plus all generated dist trees per `scripts/lib/build/targets.ts` (for the three `src/references/*.md` edits)
- `documentation/INDEX.md`: carry-step regenerated only (the ADR-051 `summary` is unchanged)

## Documentation Impact
- New ADR-055 (staged; carried by the implementer's carry-step with its `decisions/INDEX.md` row and an `ARCHITECTURE.md` Active Constraints bullet). `artifact-contract.md` maps the design route to an ADR, so the earlier amendment-only choice was replaced. ADR-055 was the next free number at `origin/main` a98beb4, and no open PR adds a `documentation/decisions/ADR-*` file. The implementer re-checks the number at carry time (V-ADR-05) and renumbers the staged file, row and bullet together if it was taken.
- ADR-051 gets a post-acceptance amendment pointing to ADR-055, because D1's predicate is refined (it stays `accepted`).
- `merge-conflict-protocol.md`, `blackhole-vcodes.md` and `doc-governance.md` get the updates listed above.
- R-005 in `product-principles.md` is **not** edited; the ledger is the owner's. It is reported as a ruling to note.
- No new file under `documentation/` beyond the carry-step's staged plan doc. Search-before-write: `documentation/plans/` has no stacking-exemption plan; `plan-mandatory-stacking.md` covers #1113, not this concern.

## Critical Files
- `scripts/lib/stack-overlap.ts`: the V-STACK-02 predicate. Masking a real conflict here silently breaks R-005.
- `scripts/lib/carry-staged-artifacts.ts`: the regenerate write every campaign PR depends on.
- `documentation/decisions/ADR-051-stacking-only-overlap-strategy.md`: the accepted decision being refined.

## Codebase Conventions

| Convention | Source | Apply as |
|---|---|---|
| Stacking limits are code constants, never config keys (V-STACK-03) | `STACK_DEPTH_CAP`, `stack-overlap.ts:8`; `scripts/checks/stacking-only.check.ts` | `export const REGENERATED_PATHS: ReadonlySet<string> = new Set([ROOT_DOC_INDEX_PATH]);` with a one-line invariant comment: "regenerated wholesale from the merged tree, and a blocking verify check fails when stale" |
| Fail closed: an undecidable verdict is never `clean` | `mergeTreeVerdict` doc comment, `stack-overlap.ts:83-92` | Exit 1 with an empty conflicted list, or a non-OID first line → stays `'conflict'` / `'unknown'` exactly as today |
| The pure engine takes its deciders as inputs | `PickParentOptions.conflicts`, `GitResult` injection | The new `mergeTreeVerdict` parameter `regenerated: ReadonlySet<string> = REGENERATED_PATHS` keeps call sites unchanged and lets tests inject a set |
| Real-git tests for git deciders | `describe('mergeTreeVerdict (real git)')`, `stack-overlap.test.ts:234-273` | New confinement tests build a temp repo the same way |
| Comment discipline (V-DOC-05/06) | `mercure-implementation-rules.md` | Rationale once at `REGENERATED_PATHS`. No issue numbers in comments; test titles may carry `#1303` |
| Generated-artifact pattern: regenerate the whole file, never patch | `doc-governance.md` § INDEX.md Maintenance; `carry-staged-artifacts.ts:383-396` | `renderRootIndexFile` is the one pure renderer shared by the carry-step and the CLI `--write`; each caller keeps its own file write (V-INT-02, no second render path) |
| argv parsing | `generate-doc-index.ts` uses `process.argv.includes('--check')` (not on the V-ARGV-01 allowlist) | `--write` follows the same local style; no `parseFlags` migration in this PR |

## Database/API Schema Changes

None to schemas. Public TS surface:
- `ROOT_DOC_INDEX_PATH`, `renderRootIndexFile(existing: string | null, docsDir: string): string` (new, `doc-index-generate.ts`; pure).
- `REGENERATED_PATHS` (new, `stack-overlap.ts`).
- `mergeTreeVerdict(git, a, b, regenerated?)`: additive optional parameter.

The CLI exit contracts of `stack-check.ts` (0/1/2/3) and `generate-doc-index.ts` are unchanged; `--write` exits 0, or 1 on write failure.

## Dependency Blast-Radius

| Consumer | Classification | Note | Verification |
|---|---|---|---|
| `scripts/stack-check.ts:93` | TRANSPARENT | `mergeTreeVerdict` call unchanged; the default set applies | reasoned: signature additive; covered by the new real-git tests on the decider |
| `scripts/stack-parent.ts:44` (`verifiedPrMergeTree`) | TRANSPARENT | delegates to `mergeTreeVerdict` | reasoned: `verifiedPrMergeTree (real git)` suite unchanged |
| `scripts/lib/stack-lifecycle.ts:159` | TRANSPARENT | `pickParent` signature unchanged | reasoned: `stack-lifecycle.test.ts` unchanged |
| `scripts/lib/stack-parent.ts:110` | TRANSPARENT | filtered `parentFiles` | reasoned: new dispatch test |
| `scripts/pr-lint.sh:59` | TRANSPARENT | exit contract unchanged | reasoned |
| `scripts/lib/carry-staged-artifacts.ts:359,394` | TRANSPARENT | constant and helper, byte-identical output | reasoned: `carry-staged-artifacts.test.ts` L290-443 INDEX assertions unchanged |

The implementer records `executed:` lines in the PR's `## Blast-Radius Evidence` (V-INT-05). Each is one focused spec through `with-test-lock` (`stack-overlap.test.ts`, `stack-parent.test.ts`, `carry-staged-artifacts.test.ts`, `doc-index-generate.test.ts`); CI runs the rest.

## Execution Strategy & Stop Conditions
- **Stop on**: dispatch is gated on design approval. If the orchestrator has not recorded approval of Option A for #1303, then halt before Task 1. The verdict artifact is `blocked` (dominance).
- **Stop on**: parse shape. If `git merge-tree --write-tree --no-messages --name-only` on the CI git version prints anything other than the OID line followed by conflicted paths, then abort the confinement leg and keep the prefilter-only change. Detect it via the real-git test, with a red run quoted.
- **Stop on**: any new test showing a conflict in a non-`REGENERATED_PATHS` file read as `'clean'`. If that happens, revert the `mergeTreeVerdict` change and halt; that is an R-005 violation, not a tolerable regression.
- **Stop on**: carry output drift. If extracting `renderRootIndexFile` changes any byte of the carry-step's INDEX output (any `carry-staged-artifacts.test.ts` INDEX assertion turns red), then revert the extraction and keep the inline block, calling the constant only.
- **Stop on**: scope pressure. If `REGENERATED_PATHS` would need a second member to make a test pass, then stop and report. Adding `documentation/decisions/INDEX.md` (hand-appended, `append_row`) or a build-tree prefix is out of scope (YAGNI; Option B was rejected for masking consumer source).

## Task Breakdown
- [ ] **TDD Baseline Verification**: run the four focused specs (`scripts/lib/stack-overlap.test.ts`, `scripts/lib/stack-parent.test.ts`, `scripts/lib/carry-staged-artifacts.test.ts`, `scripts/lib/doc-index-generate.test.ts`) one at a time through `with-test-lock`. — **AC**: each spec's pass/fail counts quoted in the completion evidence; the full suite is left to CI.
- [ ] **Write failing tests (red first)** in `scripts/lib/stack-overlap.test.ts`:
  - (a) mcp channel: `pickParent(9, snapshot(spr(7, ['documentation/INDEX.md','x.ts']), spr(9, ['documentation/INDEX.md','y.ts'])), {conflicts: always('conflict')})` → `{kind:'none'}`, and the `conflicts` spy is never called.
  - (b) git channel, real git, mixed pair: both branches edit `a.ts` in non-overlapping hunks and insert adjacent INDEX rows. `mergeTreeVerdict(run,'p1','p2')` → `'clean'`.
  - (c) git channel, real git, INDEX-only pair: no other shared file. `mergeTreeVerdict` → `'clean'`, and through `pickParent` with the real decider → `{kind:'none'}`.
  - (d) real source conflict still stacks: both edit the same line of `a.ts` plus INDEX rows. `mergeTreeVerdict` → `'conflict'`, and `pickParent` with `always('conflict')` on `['a.ts','documentation/INDEX.md']` → `{kind:'stack'}`.
  - (e) fail closed: an injected `git` returning `{code:1, stdout:'<40-hex>\n'}` (empty list) → `'conflict'`; existing `'no-such-rev'` → `'unknown'` unchanged.

  Add two tests in `scripts/lib/stack-parent.test.ts`:
  - A parent with `pr` set whose `parentFiles` is `['documentation/INDEX.md']`, against a child whose `touch_paths` is `['documentation/INDEX.md', 'scripts/x.ts']`, yields `null`. It is red on the plan base through `globsMatchFiles` (`stack-parent.ts:110`).
  - A parent with no `parentFiles` and `touch_paths: ['documentation/INDEX.md']`, against the same child, yields `null`. It is red on the plan base through `touchPathsOverlap` (`stack-parent.ts:112`). — **AC**: tests (a), (b), (c) and both dispatch tests fail on the plan-base code for the expected reason (a: `kind:'stack'`; b/c: `'conflict'`). (d) and (e) pass on the plan base too, as regression guards. The red run output is quoted in the PR's `## Proof`.
- [ ] **Generator SSOT**:
  1. Export `ROOT_DOC_INDEX_PATH = 'documentation/INDEX.md'` and the pure `renderRootIndexFile(existing, docsDir)` from `doc-index-generate.ts`. Move the title-block assembly from `carry-staged-artifacts.ts:388-392` into it; the carry-step keeps `writeCarryTarget`. Replace the L359 and L394 literals with the constant.
  2. Add a `--write` mode to `generate-doc-index.ts`. — **AC**:
     - `rg -n "'documentation/INDEX.md'" scripts/lib/carry-staged-artifacts.ts` returns 0 matches. Scope: that file only; test files are exempt.
     - `carry-staged-artifacts.test.ts` is green unchanged.
     - A new `doc-index-generate.test.ts` case shows `renderRootIndexFile(existing, tmpDocs)` keeps the first two lines of `existing` and its row block equals `renderDocIndexTable(buildDocIndexRows(tmpDocs))`.
- [ ] **Overlap exemption** in `stack-overlap.ts`:
  - `REGENERATED_PATHS`.
  - `pickParent` filters both PRs' file lists through it before `shares()`.
  - `mergeTreeVerdict` adds `--name-only`. On exit 1 with an OID first line, it reads the conflicted paths (lines after line 1, up to the first empty line). It returns `'clean'` only when that list is non-empty and every path is in `regenerated`.
  - `stack-parent.ts` (lib) `pickStackParent`: drop exact `REGENERATED_PATHS` members from `me.touch_paths` and `v.touch_paths`, filter them out of `parentFiles`, and treat a non-empty list that filters to empty as a known no-overlap (`stack-parent.ts:109-110`; today `files?.length` falls back to `touchPathsOverlap`). — **AC**:
    - All tests from the red-first task pass.
    - Existing `stack-overlap.test.ts`, `stack-parent.test.ts` and `stack-lifecycle.test.ts` cases are unchanged and green.
    - `rg -n "REGENERATED_PATHS" scripts/` shows exactly one definition, in `stack-overlap.ts`.
- [ ] **Docs** (R-005 resolved: the owner approved reading an INDEX-only conflict as clean, 2026-11-18, disposition "proceed"; no edit to the owner's ledger):
  - Carry ADR-055, its `decisions/INDEX.md` row and the `ARCHITECTURE.md` bullet via `carry-staged-artifacts.ts` (V-AUTO-02/03).
  - ADR-051 `## Post-acceptance amendments`, 2026-11-18, #1303, pointing to ADR-055. Content:
    - D1 refined: a path in `REGENERATED_PATHS` is no overlap; a merge-tree conflict confined to it is clean.
    - Rationale: R-005's purpose; the gap analysis in design note §3.1.
    - Who regenerates and when: on a clean textual merge, the sorted rows union correctly. On a same-gap conflict after a sibling merges, the PR goes CONFLICTING, and Step 0.5's `implementer` in conflict-resolution mode runs `generate-doc-index.ts --write`. V-DOCHEALTH-04 on the PR head and on `main` is the blocking backstop.
  - The `merge-conflict-protocol.md` class 1 entry.
  - The `blackhole-vcodes.md` V-STACK-02 row text.
  - The `doc-governance.md` sentence.
  - `bun run build` to regenerate the dist trees. — **AC**:
    - `bun run scripts/checks/adr-supersession.check.ts`, or the verify leg that runs V-ADR-06, reports no finding for ADR-051.
    - `rg -n "Post-acceptance amendments" documentation/decisions/ADR-051-stacking-only-overlap-strategy.md` = 1.
    - `test -f documentation/decisions/ADR-055-regenerated-files-exempt-from-stack-overlap.md` and `rg -n "ADR-055" documentation/decisions/INDEX.md ARCHITECTURE.md` ≥ 2; `bun run scripts/checks/adr-status.check.ts` reports no V-ADR-01..05 finding for ADR-055.
    - `rg -n "generate-doc-index.ts --write" src/references/merge-conflict-protocol.md` ≥ 1.
    - The build is idempotent: a second `bun run build` leaves `git status --porcelain` empty.
    - The `stacking-only.check.ts` sentence check (V-STACK-03) is still green.
- [ ] **Verify integrity**: lint/typecheck the changed `scripts/**` files locally. Push and read CI: the full suite, verify and V-DOCHEALTH-04. — **AC**: CI job names and green status on the pushed head are quoted in the PR's `## Proof`; no file outside Touch-Paths in `git diff --name-only origin/main...HEAD`.

## Test Strategy
- **Red first**: two PRs sharing only `documentation/INDEX.md` give no stack in BOTH channels:
  - mcp: test (a), prefilter.
  - git: test (c), real merge-tree.
  - Plus the mixed pair (b), where only the INDEX hunk conflicts.
- **A real source conflict still stacks**: (d).
- **Fail-closed guard**: (e).
- **Dispatch site**: the `stack-parent.test.ts` case.
- Unit tests for the pure branching (`pickParent`, filter). Real-git tests for the decider, following the existing `(real git)` suites. No E2E.
- Locally: one focused spec at a time through `with-test-lock`, after the pre-flight gate. Full suite and coverage in CI only (ci-first-verification).
- V-TEST-11 guard: fixtures (b) and (c) must produce a genuine INDEX conflict on the plan base (asserted red). Then the test cannot pass vacuously.

## Sprint Contract
1. INDEX-only overlap → no stack in the mcp and git channels and at dispatch.
2. Any conflict outside `REGENERATED_PATHS` → stack, unchanged.
3. An empty or unparseable conflicted list → never clean.
4. The carry-step's INDEX output is byte-identical.
5. ADR-055 is carried and ADR-051 carries the amendment, naming who regenerates INDEX after merges (Step 0.5 implementer, `generate-doc-index.ts --write`) with V-DOCHEALTH-04 as the backstop.

Tasks without a narrower AC: all tests and linters pass.

## Rulings check
- `rulings_checked_at`: 7.
- `ruling_conflicts`: R-005, one entry. The plan refines the literal predicate ("real conflict between heads") for one regenerated path, and in the same-gap case a regenerate commit re-runs CI and ai-review. No toggle, no gate removal, merge-tree stays the predicate.
- Disposition: **proceed**, approved by the owner 2026-11-18 ("Approve full design"); recorded in ADR-055 and an ADR-051 amendment, with no edit to the owner's ledger.

## Follow-ups (not this PR; the orchestrator files them, subject to the Pareto gate)
- Review carry for regenerate-only commits: let LGTM survive a push whose diff against the reviewed head touches only `REGENERATED_PATHS`. This closes the remaining R-005 cost.

## Pareto
Gain 8 (unblocks every doc-carrying PR from owner-held chains), Effort 4. Priority = 8 × (11 − 4) = 56 ≥ 30.

## Quality Gate Results
| Check | Result |
|---|---|
| `touch_paths_declared` | PASS |
| `schema_baseline` | PASS |
| `ac_mapping` | PASS (plan-quality-gate.ts) |
| `critical_files_exist` | PASS (plan-quality-gate.ts) |
| `mitigation_concrete` | PASS (plan-quality-gate.ts) |
| `ac_sweep_conflict` | PASS |
| `ac_sweep_scope` | PASS (both grep ACs state scope) |
| `touch_paths_ssot_gap` | ADVISORY: flagged `scripts/lib/build/facts.ts` (VCODE_TABLE_ROW_COUNT) for the blackhole-vcodes.md edit — the V-STACK-02 row text is edited in place, no row added, so the count is unchanged; if a row is ever added, re-derive the count live |
| `ac_facts_literal_bump` | PASS |
