---
type: plan
summary: "Implementation plan for ADR-033: give the `research` investigator sub-mode a durable home in `documentation/investigations/research-{concern-slug}.md`, plus backfilling the 4 pre-existing gitignored research notes"
status: current
issue: #807
review_trigger: "on ADR acceptance"
created: 2026-09-04
last_updated: 2026-09-04
supersedes_adr: null
---


# Plan - Issue #807

## Objective

ADR-033 (`documentation/decisions/ADR-033-durable-research-notes.md`, staged at
`.blackhole/staged/807/ADR-033-durable-research-notes.md`, along with its
`documentation/decisions/INDEX.md` row) decided **Option A**: give the `research` investigator
sub-mode a durable home in `documentation/investigations/research-{concern-slug}.md`, reusing
`investigate`'s existing folder and staging/carry machinery. The Design Track note
(`.blackhole/plans/issue-807-design.md`) produced the trade-off analysis, adversarial evaluation,
and Refactoring Impact Analysis; `scripts/design-aggregate.ts` returned `status: "blocked"`
(`dominance` + `breaking-consumer`), overridden by the orchestrator under `autonomy.mode: full`
since all 3 scorers unanimously picked Option A. This plan produces the implementation task
breakdown executing ADR-033's Decision section (6 numbered items) plus AC5's backfill obligation.

**AC5 backfill status (verified this session)**: all 4 pre-existing gitignored research notes
still exist on disk — `.blackhole/plans/issue-{452,469,593,800}-research.md` — none were cleaned
up. This plan (as the write-capable append-only staging step available to the planner role) has
already staged all 4 into the issue #807 manifest as `new_file` + `append_row` (INDEX) pairs
alongside the already-staged ADR/INDEX-row pair; see `## Staging note (ADR-021 D3 + backfill)`
below. The implementer's carry-step (`implementer.md` § Carry Staged Artifacts) materializes them
into `documentation/investigations/research-*.md` at merge-readiness once Task 8 below lands the
`research` case in `carry-staged-artifacts.ts`'s `SUB_MODE_TO_TYPE`/`decideCopyMode` — not before,
since carrying today would copy the raw investigator working-note frontmatter verbatim instead of
rewriting it to the `doc-governance.md` lifecycle schema.

**Two closure gaps beyond ADR-033's literal 6 items, both required for functional completeness
and flagged in the design note's Refactoring Impact Analysis as purely-additive/TRANSPARENT**:
ADR-033 items 1-4 add the schema/enum/check/carry-step plumbing, but nothing yet instructs the
`investigator` agent to actually *use* it going forward — its `research` sub-mode section has no
"Promotion target" / "Companion INDEX row" prose (unlike `investigate`/`analyze`, which both have
one). Task 4 below adds it, mirroring the existing two blocks exactly. Separately, Critic A's
design-note finding ("verify `concern-slug.ts`'s `plan-{slug}.md` precedent actually generalizes
... rather than hardcoding one-off string concatenation in `carry-staged-artifacts.ts`") is
verified moot by inspection (Task 10): `carry-staged-artifacts.ts` never computes a target/staged
path itself — it only reads `entry.target_path`/`entry.staged_path` verbatim from the manifest —
so no `researchTargetPath` helper is added (would have zero consumers today, `V-YAGNI-01`).

## Touch-Paths

- `src/references/artifact-contract.md` (plus all generated dist trees per `scripts/lib/build/targets.ts`) — add the `research` row to the Route → artifact table
- `src/references/blackhole-state.md` (plus all generated dist trees per `scripts/lib/build/targets.ts`) — extend `entries[].route`'s enum with `research`; correct the `entries[].sub_mode` Notes prose ("research never appears" is now false)
- `src/references/doc-governance.md` (plus all generated dist trees per `scripts/lib/build/targets.ts`) — one-line addition to § Canonical Naming naming the `research-` filename prefix as a second stated exemption
- `src/agents/investigator.md` (plus all generated dist trees per `scripts/lib/build/targets.ts`) — add "Promotion target" + "Companion INDEX row" prose to the `research` sub-mode section, mirroring `investigate`/`analyze`'s existing blocks
- `scripts/checks/staging-schema.check.ts` — remove `checkNoResearchStaging`/`findForbiddenSubModeLiterals` (`V-STAGE-04`) and its now-stale comments; `runChecks()` drops to 3 entries
- `scripts/verify.staging-schema.test.ts` — remove the `findForbiddenSubModeLiterals` import and its `describe('findForbiddenSubModeLiterals (V-STAGE-04)', ...)` block; update the `runChecks (real tree)` describe block's length/id-array assertions from 4 to 3
- `scripts/lib/carry-staged-artifacts.ts` — add `research: 'research'` to `SUB_MODE_TO_TYPE`; extend `decideCopyMode`'s rewrite condition to include `sub_mode === 'research'`
- `scripts/lib/carry-staged-artifacts.test.ts` — add a `decideCopyMode` case (`investigator` + `research` sub_mode → `'rewrite'`) and a `rewriteInvestigatorFrontmatter` case (`sub_mode: 'research'` → `type: research`)

## Documentation Impact

- Touch-Paths above **are** the documentation-governance surface itself (`artifact-contract.md`'s
  route table, `blackhole-state.md`'s manifest schema, `doc-governance.md`'s naming rules) — no
  separate downstream consumer doc needs updating for the schema change itself.
- No `documentation/runbooks/*.md` patch applies: Touch-Paths don't intersect ops surfaces
  (`.github/workflows/**`, `.devlocal/**`, `scripts/ci-*.sh`, e2e runner scripts per
  `ops-touch-paths.ts`), and search-before-write found no existing runbook covering staging or
  research-note promotion (`ls documentation/runbooks/` — no match on "stag"/"research"/"doc-gov").
- 4 new files land at `documentation/investigations/research-{concern-slug}.md` (the first files
  ever staged into that folder) plus 4 matching root `documentation/INDEX.md` rows — staged this
  session (see `## Staging note` below), carried by `implementer` at merge-readiness once Task 8
  lands.
- This plan's own durable copy is staged at
  `.blackhole/staged/807/plan-discovery-research-sub-mode-has-no-route-into-documentation-and-its-working-copy.md`
  plus a root `documentation/INDEX.md` row fragment, per Step 7 (ADR-021 D3) — see `## Staging
  note` below.

## Critical Files

- `scripts/checks/staging-schema.check.ts` — the enforcement gate for the entire ADR-021 D1
  staging contract (V-STAGE-01..04 today, V-STAGE-01..03 after this plan); a mis-edit here can
  silently stop validating the manifest schema for every future route, not just `research`.
- `scripts/lib/carry-staged-artifacts.ts` — the sole filesystem-write path for every staged
  artifact (`plan`, `design`, `review`, `analyze`, `investigate`, and now `research`); a mis-edit
  here risks mis-typing or corrupting frontmatter for routes this plan does not otherwise touch.

## Codebase Conventions

| Concern | Convention | Touchpoint |
|---|---|---|
| Staging mechanism (Bash heredoc + atomic `mv`, manifest append) | `route`/`sub_mode`/`produced_by`/`declared_at`/`staged_path`/`target_path`/`target_kind` fields, gated by `docs_governance.enabled`/`write_governance` | `blackhole-state.md` § Staging; `investigator.md`'s `investigate`/`analyze` "Promotion target" + "Companion INDEX row" blocks — mirrored verbatim for `research` in Task 4, not a new mechanism |
| Filename discriminator prefix for a route's durable artifact | `{route}-{concern-slug}.md` (`plan-`, `review-` already shipped via `scripts/lib/concern-slug.ts`'s `planTargetPath`/`reviewTargetPath`) | `research-{concern-slug}.md` reuses the identical naming idiom, computed by the investigator agent itself (prose instruction, no new TS helper — Task 10 confirms `carry-staged-artifacts.ts` never computes paths, so there is no consumer for a `researchTargetPath` function; adding one would be speculative, `V-YAGNI-01`) |
| Pure `CheckResult`/`runChecks()` module shape for mechanical checks | Each check is a pure function returning `{id, ok, detail?}`; `runChecks()` is the glob-discovered entrypoint for `scripts/verify.ts` | `scripts/checks/staging-schema.check.ts` — shape is unchanged by this plan, only the fourth check is removed |
| Investigator working-note → `doc-governance.md` lifecycle frontmatter rewrite (9-row mapping) | `SUB_MODE_TO_TYPE` maps `sub_mode` to a `doc-governance.md` `type` value; `decideCopyMode` decides `rewrite` vs `verbatim` per `produced_by`/`sub_mode` | `scripts/lib/carry-staged-artifacts.ts` — `research` joins `analyze`/`investigate` as a third `rewrite`-mode sub_mode, mapping to `type: research` (already a valid `doc-governance.md` lifecycle type, no schema change needed there) |
| Lifecycle frontmatter `type` enum already includes `research` | `brainstorm \| research \| adr \| analysis \| plan \| reference \| implementation \| review \| runbook` | `src/references/doc-governance.md` § Lifecycle Frontmatter — unchanged by this plan; confirmed pre-existing during design (Assumption Audit) |

No `## Database/API Schema Changes` section — this plan touches no database or public API
surface; the manifest JSON "schema" changed here is an internal campaign-state contract already
covered by the Touch-Paths and Dependency Blast-Radius sections.

## Dependency Blast-Radius

Reuses the Design Track's own grep-based consumer scan (`.blackhole/plans/issue-807-design.md` §
Refactoring Impact Analysis) verbatim — not re-run (`V-INT-02`/`V-DRY-01`). 4 consumers of the
`entries[].route` enum / `sub_mode: "research"` literal meet the ≥3 threshold:

| Consumer | Classification | Note |
|---|---|---|
| `scripts/checks/staging-schema.check.ts` — `checkNoResearchStaging`/`findForbiddenSubModeLiterals` (`V-STAGE-04`) | **BREAKING** | Forbids the exact literal this plan's Task 4 legitimately introduces; removed in Task 6, same PR (anticipated, not a surprise regression). |
| `scripts/verify.staging-schema.test.ts` — V-STAGE-04 fixture tests | **BREAKING** | Asserts the forbidding behavior directly; removed/updated in Task 7, same PR, or `bun run verify` fails on a dangling assertion of the reversed invariant. |
| `src/references/blackhole-state.md` `entries[].route`/`entries[].sub_mode` Notes prose | DEPRECATION | Corrected in Task 3. |
| `scripts/lib/carry-staged-artifacts.ts` — `decideCopyMode`, `SUB_MODE_TO_TYPE` | DEPRECATION | An unlisted `sub_mode` today soft-mis-types as `'analysis'` verbatim-copy instead of erroring; fixed in Task 8. |

## Execution Strategy & Stop Conditions

- If `bun run verify` fails on any check other than the ones this plan anticipates touching
  (`V-STAGE-01..04` → `V-STAGE-01..03`, `V-PLANGATE-*` grounding checks), **halt and investigate
  before proceeding** — a failure elsewhere signals an unplanned regression, not this plan's
  anticipated V-STAGE-04 reversal.
- If Task 9's live re-inspection finds `collectProducerLiterals` was touched, or its call sites
  changed beyond removing the single `checkNoResearchStaging()` invocation from `runChecks()`,
  **abort Task 6 and re-derive the removal diff from scratch** — the design note's Assumption
  Audit explicitly flagged this as an unverified blind spot, not a closed question.
- If any of the 4 backfilled research-note source files
  (`.blackhole/plans/issue-{452,469,593,800}-research.md`) is missing when the implementer's
  merge-readiness carry step runs (moved/deleted since this plan was written), **skip that one
  entry, note it as unrecoverable in the PR description, and do not fail the rest of the carry** —
  never block the schema/check/carry-step changes or the other 3 backfilled notes on one missing
  file.
- If `bun run scripts/plan-quality-gate.ts --plan-file .blackhole/plans/issue-807.md` reports any
  of `ac_mapping`/`critical_files_exist`/`mitigation_concrete` as `false`, **halt before requesting
  approval and revise the failing section** — never hand-wave a FAIL to PASS in the Quality Gate
  Results table below.
- Once Task 12's `bun run build` regenerates dist trees, if the diff touches any file outside the
  targets `scripts/lib/build/targets.ts` declares for the 4 edited `src/**` docs, **stop and
  investigate a build-config drift before committing** — an unexpected extra target signals a
  stale target list, not a harmless side effect.

## Task Breakdown

- [ ] **TDD Baseline Verification**: Run `bun test` and `bun run verify` to confirm the current
  suite and check set are green before any change. — **AC**: baseline run completes, pass/fail
  counts quoted in the completion evidence; `staging-schema.check.ts`'s `runChecks (real tree)`
  test currently asserts and passes 4 IDs (`V-STAGE-01..04`).

- [ ] **Task 1 — Failing tests: `carry-staged-artifacts.ts` `research` case.** In
  `scripts/lib/carry-staged-artifacts.test.ts`, add a `decideCopyMode` case
  (`{ produced_by: 'investigator', sub_mode: 'research' }` → expect `'rewrite'`) and a
  `rewriteInvestigatorFrontmatter` case (`sub_mode: 'research'` → expect `out` to contain
  `type: research`). — **AC**: both new assertions exist and fail against the current
  implementation (`decideCopyMode` returns `'verbatim'`; `rewriteInvestigatorFrontmatter` defaults
  to `type: analysis`) before Task 8 lands.

- [ ] **Task 1b — Failing test: `staging-schema.check.ts`'s check count.** In
  `scripts/verify.staging-schema.test.ts`, update the `runChecks (real tree)` describe block's two
  assertions from `['V-STAGE-01', 'V-STAGE-02', 'V-STAGE-03', 'V-STAGE-04']` (length 4) to
  `['V-STAGE-01', 'V-STAGE-02', 'V-STAGE-03']` (length 3), and remove the
  `findForbiddenSubModeLiterals` import and its `describe('findForbiddenSubModeLiterals
  (V-STAGE-04)', ...)` block. — **AC**: the updated length/id assertions fail against the current
  code (still returns 4 IDs) before Task 6 lands.

- [ ] **Task 2 — `artifact-contract.md`: add the `research` row.** Add a row to the Route →
  artifact table: `| research | `documentation/investigations/research-{concern-slug}.md` |`. —
  **AC**: `grep -c '| research |' src/references/artifact-contract.md` returns 1.

- [ ] **Task 3 — `blackhole-state.md`: extend the enum, correct the prose.** Add `research` to
  `entries[].route`'s enum cell (alongside `analyze | investigate | design | brainstorm | plan |
  review | runbook`) with a Notes addition citing this ADR/issue; rewrite `entries[].sub_mode`'s
  Notes cell to drop "research never appears — it has no `documentation/` target" and instead
  state its target (`documentation/investigations/research-{concern-slug}.md`, ADR-033). —
  **AC**: `grep -c 'entries\[\]\.route.*research' src/references/blackhole-state.md` returns ≥1;
  `grep -c 'research never appears' src/references/blackhole-state.md` returns 0.

- [ ] **Task 4 — `investigator.md`: `research` sub-mode gets Promotion target + Companion INDEX
  row prose.** Mirror the `investigate`/`analyze` sub-mode sections' existing blocks exactly
  (same Bash heredoc + atomic `mv` pattern, same staging directory convention, same
  `docs_governance` gate, same `V-AUTO-02` citation on a missed promotion), substituting the
  target `documentation/investigations/research-{concern-slug}.md` and staged filename
  `research-{concern-slug}.md`. The block must contain the literal manifest-field declarations
  `` `route: "research"` `` and `` `sub_mode: "research"` `` (feeding Task 6's now-permissive
  `V-STAGE-02` conformance check). — **AC**: `grep -c 'Promotion target' src/agents/investigator.md`
  returns 3 (investigate, analyze, research); `grep -c '`route: "research"`'
  src/agents/investigator.md` returns ≥1.

- [ ] **Task 5 — `doc-governance.md` § Canonical Naming: one-line addition.** State the
  `research-` filename prefix as a second stated exemption alongside ADR files. — **AC**:
  `grep -c 'research-' src/references/doc-governance.md` returns ≥1, inside the § Canonical Naming
  section (between its heading and the next `## `).

- [ ] **Task 6 — Remove `V-STAGE-04` from `staging-schema.check.ts`.** Delete
  `checkNoResearchStaging` and `findForbiddenSubModeLiterals`; remove the call to
  `checkNoResearchStaging()` from `runChecks()`'s return array; delete or rewrite the now-stale
  comments referencing "forbid the literal `sub_mode: "research"`" (the block above
  `findForbiddenSubModeLiterals`, and the "V-STAGE-04 forbids ..." line in the issue #782 comment
  block). Leave `collectProducerLiterals` untouched (it stays the sole source for `V-STAGE-02`'s
  `checkProducerConformance`). — **AC**: Task 1b's updated assertion now passes;
  `grep -c 'V-STAGE-04\|checkNoResearchStaging\|findForbiddenSubModeLiterals'
  scripts/checks/staging-schema.check.ts` returns 0.

- [ ] **Task 7 — Finish `verify.staging-schema.test.ts`'s update.** Confirm Task 1b's edits are
  complete and the file no longer imports or references `findForbiddenSubModeLiterals`/
  `V-STAGE-04` anywhere (including the "Issue #782" top-of-describe-block comment naming both
  V-STAGE-03 and V-STAGE-04 — narrow it to V-STAGE-03 only). — **AC**: `bun test
  scripts/verify.staging-schema.test.ts` is green; `grep -c 'V-STAGE-04\|findForbiddenSubModeLiterals'
  scripts/verify.staging-schema.test.ts` returns 0.

- [ ] **Task 8 — `carry-staged-artifacts.ts`: add the `research` case.** Add
  `research: 'research'` to `SUB_MODE_TO_TYPE`; extend `decideCopyMode`'s condition to
  `entry.produced_by === 'investigator' && (entry.sub_mode === 'analyze' || entry.sub_mode ===
  'investigate' || entry.sub_mode === 'research')`. — **AC**: Task 1's two new tests now pass.

- [ ] **Task 9 — Verify the Assumption Audit blind spot.** Confirm, by direct inspection of the
  post-Task-6 file, that `collectProducerLiterals` is unchanged and still the sole literal source
  for `checkProducerConformance` (`V-STAGE-02`) — the design note flagged this as an unverified
  blind spot, not a closed question. — **AC**: `grep -n 'collectProducerLiterals'
  scripts/checks/staging-schema.check.ts` shows exactly 2 occurrences post-Task-6 (the
  definition + the one call site inside `checkProducerConformance`), down from 3 pre-Task-6 (the
  definition + 2 call sites, one of which was inside the now-removed `checkNoResearchStaging`).

- [ ] **Task 10 — Verify Critic A's `carry-staged-artifacts.ts` concern is moot.** Confirm, by
  direct inspection, that `carry-staged-artifacts.ts` never constructs or concatenates a
  `research-`/`plan-`/`review-` filename prefix itself — `target_path`/`staged_path` are always
  read verbatim from the manifest entry. Document the finding in the PR description rather than
  adding a speculative `researchTargetPath` helper with zero current consumers. — **AC**:
  `grep -n 'entry\.target_path\|entry\.staged_path' scripts/lib/carry-staged-artifacts.ts` shows
  every occurrence is a read (never assigned to, never concatenated with a literal string prefix).

- [ ] **Task 11 — Confirm the AC5 backfill staging validates and will carry correctly.** The 8
  manifest entries for issues #452/#469/#593/#800 (4× `new_file` + 4× `append_row`, staged this
  planning session — see `## Staging note` below) must validate against
  `scripts/checks/staging-schema.check.ts`'s `V-STAGE-01`/`V-STAGE-02` (post-Task-3/Task-4 enum
  update) and must not regress `V-STAGE-03`'s mandatory-pairing check. At merge-readiness, the
  implementer's carry step (now that Task 8 lands the `research` case) must copy all 4 into
  `documentation/investigations/research-*.md` with rewritten `type: research` frontmatter, and
  append all 4 corresponding rows to `documentation/INDEX.md`. — **AC**: `bun run verify` (Task
  "Verify Integrity" below) reports `V-STAGE-01`/`V-STAGE-02`/`V-STAGE-03` all `ok: true` against
  the live manifest at `.blackhole/staged/807/manifest.json`; at merge-readiness,
  `scripts/carry-staged-artifacts.ts --manifest .blackhole/staged/807/manifest.json --repo-root
  <worktree>` reports 0 skipped entries for the 8 backfill rows, and all 4 target files exist
  post-carry with `type: research` frontmatter.

- [ ] **Task 12 — Rebuild generated dist trees.** Run `bun run build` to regenerate every platform
  target for the 4 edited `src/**` docs. — **AC**: `git status --porcelain` shows changes only
  under the dist trees `scripts/lib/build/targets.ts` declares for `artifact-contract.md`,
  `blackhole-state.md`, `doc-governance.md`, and `investigator.md`, plus the 8 hand-edited source
  files from Tasks 2-8 above — no unexpected extra target touched (Execution Strategy stop
  condition).

- [ ] **Verify Integrity**: Run `bun test` and `bun run verify` in full. — **AC**: full suite
  green, `bun run verify` green (0 failing checks, including the now-3-check `V-STAGE-01..03`
  trio), both quoted in the completion evidence; no file outside this plan's Touch-Paths modified.

## Sprint Contract

- Task 1/1b: new/updated tests exist and fail (red) before the corresponding implementation task
  lands — AC per Task 1/1b.
- Task 2/3/4/5: the 4 documentation/prompt edits each carry their own grep-verifiable AC above —
  AC per Task 2/3/4/5.
- Task 6/7: `V-STAGE-04` fully removed from both the check module and its test file, `V-STAGE-01..03`
  still pass — AC per Task 6/7.
- Task 8: `carry-staged-artifacts.ts` correctly types and rewrite-copies a `research` entry — AC
  per Task 8 (Task 1's tests now green).
- Task 9/10: both design-note-flagged verification concerns (Assumption Audit blind spot, Critic
  A's carry-step concern) are explicitly checked and their outcomes documented, not assumed — AC
  per Task 9/10.
- Task 11: the AC5 backfill (4 pre-existing research notes) validates against the staging schema
  checks and carries correctly at merge-readiness — AC per Task 11.
- Task 12: dist trees rebuilt with no unexpected target drift — AC per Task 12.
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

(Populated by `bun run scripts/plan-quality-gate.ts --plan-file .blackhole/plans/issue-807.md` —
see tool output; copied verbatim, not hand-derived. `ac_sweep_conflict`/`ac_sweep_scope`/
`touch_paths_ssot_gap`/`ac_facts_literal_bump` are advisory-only heuristics evaluated separately,
not part of the CLI's 3-key output.)

## Owner-Ruling Check (Step 3)

`rulings_checked_at`: 5 (ledger `rulings_revision` at read time, unchanged since the Design
Track's own read). `ruling_conflicts`: `[]` — this plan directly executes R-001
"documentation-integration-floor" (`documentation/reference/product-principles.md`) rather than
conflicting with it; no candidate task above requires violating any active-status ruling.

## References

- **ADR**: `documentation/decisions/ADR-033-durable-research-notes.md` (staged) — chosen approach:
  Option A (durable, reuse `investigate`'s `documentation/investigations/` folder under a
  `research-{concern-slug}.md` filename); rejected: Option B (new `documentation/research/`
  folder — unjustified taxonomy split per both blind critics), Option C (not durable — CRITICAL
  finding from both blind critics, R-001 conflict, issue #800 knowledge-loss precedent).
- Design Track note: `.blackhole/plans/issue-807-design.md`.

## Staging note (ADR-021 D3 + AC5 backfill)

Per `blackhole-state.md` § Staging and Step 7 (durable plan staging, mandatory on every track when
`docs_governance.enabled`/`write_governance` both resolve `true` — confirmed true in
`.blackhole/config.json`), the following were staged this session, **appended to** (never
overwriting) the 2 already-staged `design`-route entries in
`.blackhole/staged/807/manifest.json`:

1. **This plan's durable body** — `bun run scripts/detect-doc-schema.sh index
   documentation/INDEX.md` returned `schema=blackhole` (5-column: `path | summary | type | status
   | review_trigger`). Rendered at
   `.blackhole/staged/807/plan-discovery-research-sub-mode-has-no-route-into-documentation-and-its-working-copy.md`
   (campaign-only frontmatter keys — `plan_base_commit`, `track`, `task_type`,
   `threat_screen_passed`, `ui_gate` — stripped; lifecycle frontmatter added: `type: plan`,
   `status: current`, `review_trigger: "on ADR acceptance"`, `created`/`last_updated`: today).
   Target: `documentation/plans/plan-discovery-research-sub-mode-has-no-route-into-documentation-and-its-working-copy.md`
   (matches `scripts/lib/concern-slug.ts`'s `planTargetPath` for this issue's title).
2. **This plan's `documentation/INDEX.md` row** — staged at
   `.blackhole/staged/807/plan-index-row.md`, blackhole 5-column schema.
3. **4× AC5 backfill `new_file` entries** — the raw, unmodified content of
   `.blackhole/plans/issue-{452,469,593,800}-research.md` staged verbatim (to be rewritten by the
   carry-step's `rewriteInvestigatorFrontmatter`, per `decideCopyMode`'s `produced_by:
   "investigator"` + `sub_mode: "research"` rewrite condition once Task 8 lands) at
   `.blackhole/staged/807/research-issue-{452,469,593,800}.md`, target
   `documentation/investigations/research-{concern-slug}.md` where `{concern-slug}` is each
   issue's own title-derived slug (`no-hunt-kind-scans-the-backlog-duplicate-stale-referent-and-low-info-triage-are`,
   `reasoning-effort-is-an-unrouted-spawn-dimension-model-routing-md-pins-model-tier`,
   `investigate-cloudflare-free-tier-as-ci-cd-runner-workflows-sandbox-sdk-artifacts`,
   `discovery-the-enforcing-pretooluse-guard-is-the-installed-plugin-copy-which-lack` — each
   computed via the live `deriveConcernSlug` function against the issue's own `queue.json` title,
   not hand-typed).
4. **4× matching `append_row` `documentation/INDEX.md` entries**, one per backfilled note,
   `summary` authored with full context on each note's content (per `investigator.md`'s own
   Companion INDEX row convention: never a mechanical title copy).

   `produced_by: "investigator"` on all 8 backfill entries (not `"planner"`) — a deliberate choice
   (Decision Record below), matching the content's true origin so the carry-step's
   `decideCopyMode`/`rewriteInvestigatorFrontmatter` rewrite path actually fires; `"planner"` would
   route these through the `verbatim` copy path and leave them stuck in the investigator working-
   note schema forever (never gaining proper `doc-governance.md` lifecycle frontmatter).

**Decision Record — `produced_by` on backfill entries**:
- **Context**: the manifest's `produced_by` field normally identifies which agent staged an entry
  during its own turn; here the planner is staging content the investigator produced in a past
  turn, as a one-time catch-up.
- **Alternatives**: (a) `produced_by: "planner"` (literally who is running this Bash command right
  now) vs. (b) `produced_by: "investigator"` (who authored the content, whose schema the content
  is in).
- **Choice**: (b) — `produced_by: "investigator"`.
- **Rationale**: the field's semantic purpose downstream is to select the carry-step's copy mode
  (verbatim vs. rewrite) and frontmatter mapping, both of which are keyed on "what schema is this
  content in," not "who literally ran the `mv` command." `blackhole-state.md`'s Write protocol
  extension note ("each producer appends only its own entries") targets same-turn concurrency
  safety between two *live* producers, not a deliberate, explicitly-directed, one-time backfill
  where no concurrent investigator run for these issues exists.
- **Confidence**: High — verified against `carry-staged-artifacts.ts`'s actual `decideCopyMode`
  condition (Task 1/8), which reads `produced_by`/`sub_mode` together and has no other axis for
  detecting "this is investigator-schema content."

All entries above append to the existing `.blackhole/staged/807/manifest.json` (now 12 entries:
2 `design` + 2 `plan` + 8 backfill) — the 2 pre-existing `design`-route entries are untouched.
