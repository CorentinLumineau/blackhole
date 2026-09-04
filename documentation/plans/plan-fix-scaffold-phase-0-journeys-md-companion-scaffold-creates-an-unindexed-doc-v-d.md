---
type: plan
summary: "Implementation plan for closing the Phase-0 journeys.md companion-scaffold INDEX gap and correcting its documented target path (issue #728)"
status: current
review_trigger: "on file change"
created: 2026-09-02
last_updated: 2026-09-02
issue: 728
---


# Plan - Issue #728

## Objective

Close the gap that lets Phase 0's `journeys.md` companion scaffold create
`documentation/reference/journeys.md` without ever upserting a `documentation/INDEX.md` row for
it — the gap that made `bun run verify` fail `V-DOCHEALTH-02` at the v0.21.0 campaign bootstrap
(2026-09-02) and blocked the next launch until the file was removed by hand. Two independent
paths must close it: the bootstrap-time scaffold itself (so a fresh bootstrap is clean the first
time) and `companion-file-sync.ts`'s implement-time repair (so a `journeys.md` created by an
older campaign build, before this fix landed, self-heals on the next PR). Also correct
`templates/companion-files/README.md`'s stale claim that `journeys.md` targets the repo root —
that claim is the actual root cause: `journeys.md.template`'s own frontmatter
(`type`/`status`/`review_trigger`/`created`/`last_updated`) is the `documentation/`-tree
lifecycle shape no other root companion file (`ARCHITECTURE.md`/`AGENTS.md`/`DESIGN.md`) carries,
and `doc-health.check.ts` only ever walks `documentation/` — a repo-root file could never have
tripped `V-DOCHEALTH-02` in the first place.

## Touch-Paths

- `src/SKILL.md` (plus all generated dist trees per `scripts/lib/build/targets.ts`)
- `src/references/companion-file-sync.md` (plus all generated dist trees per `scripts/lib/build/targets.ts`)
- `src/references/doc-governance.md` (plus all generated dist trees per `scripts/lib/build/targets.ts`)
- `templates/companion-files/README.md`
- `scripts/lib/companion-file-sync.ts`
- `scripts/companion-file-sync.test.ts`
- `scripts/lib/check-common.ts`
- `scripts/checks/doc-health.check.ts`
- `scripts/lib/worker-json/constants.ts`
- `scripts/validate-worker-json.test.ts`

### Touch-Paths beyond the issue's stated 5-file scope — evidence, not scope creep

The issue body's own "Scope: In" list and the router's touch-path hint both named 6 files. Two
corrections and four additions were required after live verification against this repo:

- **Path correction**: the router's hint named `scripts/lib/companion-file-sync.test.ts`. That
  file does not exist — the real test file is `scripts/companion-file-sync.test.ts` (confirmed
  via `find`/`wc -l`; it already imports from `./lib/companion-file-sync.ts`).
- **`scripts/lib/check-common.ts` + `scripts/checks/doc-health.check.ts`**: required by the
  Codebase Conventions decision below (V-INT-02) — see Decision Record 3.
- **`scripts/lib/worker-json/constants.ts` + `scripts/validate-worker-json.test.ts`**: required
  by the Dependency Blast-Radius scan below — `COMPANION_REPAIR_VCODES` in `constants.ts` is a
  **second, independently-maintained** enum of valid `companion_repairs[].vcode` values
  (`scripts/lib/worker-json/shared-validators.ts:156`, `pushEnumError`). Without adding
  `'V-ADA-09'` there, the implementer's own JSON output would be rejected by
  `scripts/validate-worker-json.ts` at `V-BRIEF-01`'s mandatory gate — a self-inflicted BLOCK,
  found only by actually grepping for consumers rather than trusting the router's hint list.

## Documentation Impact

- `documentation/INDEX.md` gains a row for `reference/journeys.md` — appended **at runtime** by
  the fix this issue ships (`repairJourneysIndexRow`, bootstrap-time via the new CLI flag,
  implement-time via `runCompanionFileSync`), never hand-edited in this PR.
- `templates/companion-files/README.md` — corrects the `journeys.md.template` target-path/scope
  claim; this is the actual doc-governance bug this issue traces to (see Objective).
- `src/references/doc-governance.md` — documents `status: template` as an accepted companion-file
  frontmatter value.
- `src/references/companion-file-sync.md` — documents the new `V-ADA-09` implement-time trigger.
- Search-before-write: grepped `documentation/INDEX.md` and `documentation/reference/` for
  "journeys" — zero hits before this issue. No existing doc covers this concern.

## Critical Files

None — no pre-existing sensitive touchpoint (auth config, DB client, secrets) is read or
modified by this fix.

## Codebase Conventions

| Touchpoint | Convention | Source | Required by |
|------------|------------|--------|--------------|
| INDEX.md pipe-table parsing | `parseIndexTableRows` — single shared 5-column parser | `scripts/lib/check-common.ts:97` | V-INT-02 |
| INDEX.md idempotent row append | `appendIndexRowIfAbsent`/`RootIndexRow` (issue #490, ADR-021 D2) — currently defined **inside** `scripts/checks/doc-health.check.ts:92-100`, a `*.check.ts` module | `scripts/checks/doc-health.check.ts:92-100` | V-INT-02 (see Decision Record 3 — must relocate, not duplicate) |
| `lib/` never imports `checks/` | `check-common.ts`'s own header comment: "Imports only check-utils (root), lib/fs, lib/build/facts.ts — never any `*.check.ts` module, to avoid import cycles" | `scripts/lib/check-common.ts:1-13` | V-INT-01 |
| Companion-file repair function naming | `needs{X}Repair(repoRoot, …)` / `{repairAction}(repoRoot, …) → CompanionRepair \| null` pairs, e.g. `needsArchitectureRepair`/`createArchitectureFromTemplate`, `needsAgentsSymlinkRepair`/`repairAgentsSymlink` | `scripts/lib/companion-file-sync.ts:104-183` | V-INT-01, V-INT-03 |
| `documentation/reference/` companion-doc INDEX row shape | `reference/product-principles.md \| Owner-rulings ledger of durable product preferences binding on future diffs \| reference \| current \| on new ruling \|` — the one existing companion file that already lives under `documentation/reference/` with lifecycle frontmatter | `documentation/INDEX.md:33` | V-INT-01 (structural precedent for the new `reference/journeys.md` row) |
| Companion-repair vcode enum | Two independent lists must stay in sync: the TS union `CompanionRepair.vcode` and the JS array `COMPANION_REPAIR_VCODES` | `scripts/lib/companion-file-sync.ts` (type), `scripts/lib/worker-json/constants.ts:39` | V-INT-02 (not DRY between the two — pre-existing; flagged, not refactored, see Decision Record 2) |
| CLI arg parsing | `parseCliArgs(argv)` → `{ repoRoot, diffFile }`, extended additively with a new optional flag rather than a second entrypoint | `scripts/lib/companion-file-sync.ts:238-250` | V-INT-01, V-DRY-01 |

## Database/API Schema Changes

N/A — no database or REST/GraphQL schema changes. The only "schema" touched is the internal
worker-JSON `companion_repairs[].vcode` enum (`scripts/lib/worker-json/constants.ts`), which is
additively widened (existing values unaffected) — see Dependency Blast-Radius.

## Dependency Blast-Radius

Grep-based scan (not estimated) of every consumer of the `companion_repairs[].vcode` value set
and of `appendIndexRowIfAbsent`/`RootIndexRow`, the two interfaces this plan changes:

| Consumer | Classification | Note |
|----------|----------------|------|
| `scripts/lib/worker-json/shared-validators.ts:156` (`pushEnumError(..., COMPANION_REPAIR_VCODES)`) | TRANSPARENT | Widening the array to include `'V-ADA-09'` only adds an accepted value — no currently-valid entry becomes invalid |
| `scripts/lib/worker-json/validators/implementer.ts:107-108` (`validateCompanionRepairsArray`) | TRANSPARENT | Calls through to the widened array above unchanged |
| `scripts/validate-worker-json.test.ts:498-531` | TRANSPARENT (one addition) | Existing `V-ADA-01`/`V-ADA-03`(rejected)/backward-compat cases keep passing unmodified; one new test case added for `V-ADA-09` (T3) |
| `scripts/verify.doc-health.test.ts:5,148-208` (`appendIndexRowIfAbsent` import) | TRANSPARENT | Import path (`./checks/doc-health.check.ts`) unchanged — the re-export shim (T4) makes the relocation invisible to this test |
| `src/references/companion-file-sync.md` § Ledger contract | TRANSPARENT (prose update) | "V-ADA-01/V-ADA-05 dedup rule" wording extended to include V-ADA-09; no behavior implied by the old wording is removed |

5 real consumers found (≥3 threshold) — table included per the conditional-inclusion rule.
`scripts/lib/check-common.ts` itself has ~20 unrelated importers (`parseIndexTableRows`,
`walkMdFilesAbs`, etc.) but none of them are affected by this plan — only the two new exports
(`RootIndexRow`, `appendIndexRowIfAbsent`) are added; no existing export's signature changes.

## Execution Strategy & Stop Conditions

- If `bun test scripts/verify.doc-health.test.ts` fails immediately after the T4 relocation
  (before any other change lands), STOP and revert the relocation — do not proceed to T5/T6 on
  top of a broken re-export.
- If `bun run build` leaves a non-clean `git status --porcelain` on any generated dist tree
  (`.cursor/`, `.claude/`, `skills/`, `codex-*`, `.agents/build/`, `plugins/`) after the
  `src/SKILL.md`/`src/references/companion-file-sync.md`/`src/references/doc-governance.md`
  edits, STOP and re-run `bun run build` to regenerate + commit the derived diff — never hand-edit
  a generated copy directly (`V-BUILD-01`).
- If `bun run verify`'s total check count differs from the T1 baseline count, STOP before
  claiming complete — a changed count with no new `scripts/checks/*.check.ts` module added
  signals `EXPECTED_CHECK_COUNT` drift (`V-GROUND-01`), not a passing gate.
- If the new `V-ADA-09` test (T3) still fails after T6, STOP and re-check
  `scripts/lib/worker-json/constants.ts:39` for a typo in the added literal before touching
  anything else — this is the single line the whole AC1 chain depends on downstream of it.

## Task Breakdown

- [ ] **TDD Baseline Verification**: `bun test scripts/companion-file-sync.test.ts scripts/validate-worker-json.test.ts scripts/verify.doc-health.test.ts scripts/lib/check-common.test.ts` — **AC**: baseline suite run, pass/fail counts quoted in the completion evidence (expect all passing pre-change).
- [ ] **Write Failing Tests — journeys index repair** (`scripts/companion-file-sync.test.ts`): add fixture-based tests for `needsJourneysIndexRepair`/`repairJourneysIndexRow`: (a) creates the `reference/journeys.md` row when `documentation/reference/journeys.md` and `documentation/INDEX.md` both exist and the row is absent; (b) a second call is idempotent (no duplicate row, returns `null`); (c) no-op when `documentation/reference/journeys.md` is absent; (d) no-op when `documentation/INDEX.md` is absent (nothing to append to). Maps to AC1 + AC3. — **AC**: new tests exist and fail for the expected reason (functions not yet exported) before implementation.
- [ ] **Write Failing Test — worker-JSON schema** (`scripts/validate-worker-json.test.ts`): add `test('accepts V-ADA-09 in companion_repairs[] (issue #728)')` inside the existing `describe('validateWorker implementer companion_repairs[] (issue #453)')` block. Maps to AC1. — **AC**: new test exists and fails (`'V-ADA-09'` not yet in `COMPANION_REPAIR_VCODES`) before implementation.
- [ ] **Implement — relocate the shared row-append primitive** (`scripts/lib/check-common.ts`, `scripts/checks/doc-health.check.ts`): move `RootIndexRow`/`appendIndexRowIfAbsent`'s definitions from `doc-health.check.ts` into `check-common.ts` (verbatim body, referencing `parseIndexTableRows` directly instead of the local `parseRootIndexRows` alias); `doc-health.check.ts` re-exports both names (`export { appendIndexRowIfAbsent } from '../lib/check-common.ts'; export type { RootIndexRow } from '../lib/check-common.ts';`) and keeps its own `parseRootIndexRows = parseIndexTableRows` alias untouched. Maps to AC1 (Codebase Convention). — **AC**: `bun test scripts/verify.doc-health.test.ts scripts/lib/check-common.test.ts` still pass with zero edits to either test file.
- [ ] **Implement — journeys index repair + CLI flag** (`scripts/lib/companion-file-sync.ts`): add `JOURNEYS_DOC_REL_PATH = 'documentation/reference/journeys.md'` and a `JOURNEYS_INDEX_ROW: RootIndexRow` constant (`path: 'reference/journeys.md'`, `type: 'reference'`, `status: 'template'`, `reviewTrigger: 'on ADR acceptance'`); add `needsJourneysIndexRepair(repoRoot)` and `repairJourneysIndexRow(repoRoot): CompanionRepair | null`; wire the pair into `runCompanionFileSync` **unconditionally** (no diff-path predicate — the repair only ever fires when `journeys.md` already exists on disk, so it is purely additive and self-limiting, unlike the ARCHITECTURE.md/AGENTS.md creation triggers which do need a diff-gate to avoid drive-by file creation); widen `CompanionRepair.vcode` to `'V-ADA-01' | 'V-ADA-05' | 'V-ADA-09'`; extend `parseCliArgs`/`import.meta.main` with a `--upsert-journeys-index` boolean flag that calls `repairJourneysIndexRow` directly (repo-root only, no `--diff-file` required) and prints `{ repairs: [...] }` in the same shape as the diff-triggered path. Maps to AC1. — **AC**: the tests from step 2 pass; all 12 pre-existing tests in the file still pass unmodified.
- [ ] **Implement — widen the worker-JSON vcode enum** (`scripts/lib/worker-json/constants.ts`): change `COMPANION_REPAIR_VCODES` from `['V-ADA-01', 'V-ADA-05']` to `['V-ADA-01', 'V-ADA-05', 'V-ADA-09']`. Maps to AC1. — **AC**: the test from step 3 passes; the existing `test('rejects invalid vcode in companion_repairs[]')` case (`V-ADA-03`) still fails validation as expected, unchanged.
- [ ] **Fix stale scope claim** (`templates/companion-files/README.md`): correct the `journeys.md.template` table row — "Root file it seeds" from `journeys.md` to `documentation/reference/journeys.md`; "Scope" from "Repo root — hunt-kind-gated…" to state the `documentation/reference/` placement, matching `product-principles.md.template`'s own row. Add one sentence to `## journeys.md hunt-kind gate` noting the `documentation/INDEX.md` row is upserted automatically (bootstrap via `--upsert-journeys-index`; implement-time via `runCompanionFileSync`'s unconditional check). Maps to AC1 (this is the actual root-cause doc bug, per Objective). — **AC**: `grep -n "documentation/reference/journeys.md" templates/companion-files/README.md` matches; no remaining "Repo root" claim on the `journeys.md.template` row.
- [ ] **Amend the bootstrap scaffold prose** (`src/SKILL.md` Phase 0 step 2): state the journeys.md target path explicitly as `documentation/reference/journeys.md`; immediately after the existing "Additionally create journeys.md…" clause, add: when created (not skipped), run `bun run scripts/lib/companion-file-sync.ts --repo-root <path> --upsert-journeys-index` to upsert its `documentation/INDEX.md` row (idempotent; no-op when `documentation/INDEX.md` does not yet exist in the target repo). Maps to AC1 + AC4. — **AC**: `grep -n "upsert-journeys-index" src/SKILL.md` matches; `bun test scripts/kaizen-ux-coherence-kind.test.ts` (unmodified) still passes — its existing `journeys.md`/`kaizen.enabled`/`kaizen.kinds`/`ux-coherence` string assertions on `src/SKILL.md` are all substring checks, unaffected by this addition.
- [ ] **Document the new trigger** (`src/references/companion-file-sync.md`): add a `### V-ADA-09 — root documentation/INDEX.md missing a row for journeys.md` subsection under `## Triggers`, mirroring the V-ADA-01/V-ADA-05 File-state/Diff-scope table format (`Diff scope: none — unconditional, purely additive, see Codebase Conventions`); add one line to `## Out of scope` clarifying `journeys.md`'s own *creation* stays bootstrap-only, never implement-time; update `## Ledger contract`'s "V-ADA-01/V-ADA-05 dedup rule" wording to "V-ADA-01/V-ADA-05/V-ADA-09". Maps to AC1. — **AC**: `grep -n "V-ADA-09" src/references/companion-file-sync.md` matches at least 2 lines.
- [ ] **Document the accepted `status: template` value** (`src/references/doc-governance.md`): add a short paragraph after the `## Lifecycle Frontmatter` table noting that an instantiated companion-file template (currently only `journeys.md`) may carry `status: template`; this is already accepted because `doc-health.check.ts`'s `V-DOC-GOV-02` check (`findMissingFrontmatter`/`lifecycleFrontmatterComplete`) checks the `status` key's **presence**, never its value against an enum — no code change is needed, only the documentation gap. Maps to AC2. — **AC**: `grep -n "status: template" src/references/doc-governance.md` matches.
- [ ] **Verify Integrity**: `bun test scripts/companion-file-sync.test.ts scripts/validate-worker-json.test.ts scripts/verify.doc-health.test.ts scripts/lib/check-common.test.ts scripts/kaizen-ux-coherence-kind.test.ts`, then `bun run build` (confirm exit 0 and a clean `git status --porcelain` on every generated dist tree), then `bun run verify` (confirm exit 0, no new failures, check count matches the T1 baseline). Maps to AC4. — **AC**: full suite green, build clean, verify green, all three quoted in the completion evidence.

## Sprint Contract

### Machine-verifiable
- [ ] `bun test scripts/companion-file-sync.test.ts` → all tests pass, including the 4 new journeys-index-repair cases
- [ ] `bun test scripts/validate-worker-json.test.ts` → all tests pass, including the new V-ADA-09 acceptance case; the pre-existing V-ADA-03 rejection case still fails validation as before
- [ ] `bun test scripts/verify.doc-health.test.ts scripts/lib/check-common.test.ts` → all tests pass, unmodified by the relocation
- [ ] `bun test scripts/kaizen-ux-coherence-kind.test.ts` → all tests pass, unmodified by the SKILL.md/README.md prose edits
- [ ] `bun run build` → exits 0, clean `git status --porcelain` (`V-BUILD-01`)
- [ ] `bun run verify` → exits 0, check count unchanged from the T1 baseline (`V-GROUND-01`)

### Human-verifiable
- [ ] Read the corrected `templates/companion-files/README.md` row and confirm the placement claim now matches `product-principles.md.template`'s own row (same `documentation/reference/` pattern) rather than restating the old "Repo root" claim
- [ ] Read the new `## Lifecycle Frontmatter` paragraph in `doc-governance.md` and confirm it reads as a scoped, one-off exception (companion-file templates only) rather than a general loosening of the `status` enum

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

## Decision Records

**1. Where does journeys.md actually live?**
- Context: `templates/companion-files/README.md` claims `journeys.md` targets the repo root, like `ARCHITECTURE.md`/`AGENTS.md`/`DESIGN.md`. `doc-health.check.ts` only ever walks `documentation/` — a repo-root file could never trip `V-DOCHEALTH-02`, yet the issue reports exactly that check failing at a real bootstrap.
- Alternatives: (a) easy — leave the README's "Repo root" claim alone, patch the code to index a root-level file too (never actually reproduces the reported failure); (b) hard — treat "Repo root" as the stale claim, correct it to `documentation/reference/journeys.md`, matching `journeys.md.template`'s own lifecycle frontmatter shape (which no other root companion file carries) and `product-principles.md.template`'s established placement.
- Choice: (b).
- Rationale: only (b) is consistent with the observed incident and with the template's own frontmatter. Fixing the stale doc is the root-cause fix, not a workaround (`V-FIX-01`).
- Confidence: High.

**2. Minting `V-ADA-09` without touching the central vcode registry**
- Context: the new repair needs a `vcode` label. The natural next slot in the `V-ADA` family is `V-ADA-09`, but registering it formally means editing `src/references/blackhole-vcodes.md` — a file `.blackhole/config.json`'s `wave_scheduling.hot_files_max_one_per_wave` explicitly locks to one worker per wave (collision-prone), and outside this issue's declared scope.
- Alternatives: (a) easy — reuse an existing, semantically-wrong vcode, or loosen `CompanionRepair.vcode`/`COMPANION_REPAIR_VCODES` to a bare `string` (drops the `pushEnumError` validation guard entirely); (b) hard — mint `V-ADA-09` consistently everywhere it must exist for the code to actually function (`companion-file-sync.ts`'s type, `worker-json/constants.ts`'s enum, `companion-file-sync.md`'s docs), deliberately not touching `blackhole-vcodes.md`/`reviewer.md`, and flag central registration as a fast-follow (mirrors the precedent `blackhole-vcodes.md`'s own V-ADA-08 note sets for "tracked as a fast-follow, not yet closed by any agent's numbered steps").
- Choice: (b).
- Rationale: (a)'s type-loosening path removes working validation for zero benefit; reusing a wrong code misleads a future ledger reader. Central registration is a genuinely separate, one-line follow-up that shouldn't block this bugfix or touch a contended hot file mid-fix.
- Confidence: Medium — the fast-follow registration is a soft dependency this plan cannot force to happen; recommend filing it as a follow-up issue at merge time.

**3. Relocating `appendIndexRowIfAbsent` instead of duplicating or cross-importing it**
- Context: `companion-file-sync.ts` (in `scripts/lib/`) needs the same idempotent-append primitive `doc-health.check.ts` (in `scripts/checks/`) already has.
- Alternatives: (a) easy — copy the function body into `companion-file-sync.ts` (V-DRY-01/V-INT-02: two copies to drift); (b) `lib/` imports directly from `checks/doc-health.check.ts` (inverts `check-common.ts`'s own documented layering — "never any `*.check.ts` module, to avoid import cycles"); (c) hard — hoist the function into `check-common.ts` (already the shared home for its direct dependency, `parseIndexTableRows`), re-export from `doc-health.check.ts` for backward compatibility.
- Choice: (c).
- Rationale: (c) is the only option that adds zero new duplication and respects the existing, explicitly-documented import direction.
- Confidence: High.

## References

- Issue #728
- `templates/companion-files/README.md` § `journeys.md` hunt-kind gate
- `src/references/doc-governance.md` § Lifecycle Frontmatter
- `src/references/companion-file-sync.md` § Triggers, § Ledger contract
- `documentation/reference/product-principles.md` — Ruling R-001 (documentation-integration-floor): this fix reinforces the ruling, no conflict
