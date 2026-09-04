---
type: plan
summary: "Implementation plan for ADR-007's drift-proof toolchain re-seating blueprint"
status: current
task_type: feature
track: standard
plan_base_commit: 0f30d2a
review_trigger: "on ADR acceptance"
created: 2026-07-11
last_updated: 2026-07-11
related:
  - documentation/decisions/ADR-007-drift-proof-toolchain-reseating.md
  - documentation/architecture/retrospective-blackhole.md
---

# ADR-007 Drift-Proof Toolchain Re-Seating — Implementation Plan

## Objective

Implement ADR-007 blueprint v2 in its binding Implementation Order — **R6 → R5′ → R1′ → R7 →
R2′ → R3′** — as six sequential, independently reviewable PRs (T1–T6), each filed and executed
as a blackhole campaign issue. The campaign kills the two accidental-complexity patterns the
2026-07-11 retrospective traced ~80% of defect effort to (facts restated at consumption sites;
accretion surfaces without extension seams) while explicitly preserving the two-sided drift
detection the adversarial critic panel found load-bearing (independent filesystem scan vs
declaration — never collapsed to one derivation). Net shape: one shared tree-walker
(`scripts/lib/fs.ts`), one build policy (tracked ⇒ default), one facts declaration
(`scripts/build.ts`), one verify taxonomy (6 domains matching the existing test files), one new
link-integrity guard, and pure governance (no split) on `orchestrator.md`. Zero feature-parity
loss; 7 consumers touched (2 breaking/internal, 3 deprecation, 2 transparent) per the ADR's
Refactoring Impact table — below its own phased-migration threshold, so single-campaign delivery
is safe.

**Threat Model**: Not required. This is an internal developer-toolchain change (build scripts,
verify checks, markdown source files) with no network-facing surface, no auth boundary, and no
user data path — STRIDE categories do not apply to a CI-time drift detector operating on a
repository the campaign already has full read/write access to.

## Touch-Paths

### T1 (R6) — `scripts/lib/fs.ts` shared walker + fixture kit

- `scripts/lib/fs.ts` (new)
- `scripts/lib/fs.test.ts` (new)
- `scripts/verify.ts` (remove `walkMdFilesAbs`/`walkMdFiles` bodies at lines 449–461; replace
  with a thin wrapper over `scripts/lib/fs.ts`'s shared walker, keeping the `walkMdFilesAbs`
  export name so existing importers are unaffected)
- `scripts/verify.test.ts` (the `#216` EISDIR regression test moves to `scripts/lib/fs.test.ts`
  against the new primitive; this file keeps only the thin-wrapper import)
- `scripts/tree-shape.test.ts` (replace the local `makeTempDir` at line 15 and the two inline
  cleanup loops at lines 83 and 107 — the `#226` regression site — with `scripts/lib/fs.ts`'s
  shared `makeTempDir`/`cleanupDirEntries`)
- `scripts/verify.build.test.ts` (replace the local `makeTempDir` at line 8 with the shared import)
- `scripts/build.ts` (`compileFolder`'s recursive directory branch at lines 201–220 delegates its
  directory-vs-file traversal to the shared primitive in `scripts/lib/fs.ts`; `processFile`
  callback logic is unchanged — build output must stay byte-identical)
- `scripts/build.test.ts` (add one regression assertion: `compileFolder` handles a nested
  `src/references/` subdirectory without throwing — the `#228` fixture-mkdir sibling of `#226`,
  exercised at the build layer instead of the test-fixture layer)

### T2 (R5′) — tracked ⇒ built-by-default

- `scripts/build.ts` (args parsing at lines 22–25: step 0 verifies current git tracking state of
  every build target directory before changing defaults; `buildGemini`/`buildCodex` default to
  `true` unconditionally; `--gemini`/`--all`/`--no-codex` become no-op aliases for one release —
  parsed but ignored, with a one-line deprecation notice to stderr)
- `scripts/build.test.ts` (tests: default `bun run build` invocation produces every currently
  git-tracked target; `--gemini`/`--all`/`--no-codex` are behaviorally no-ops; step-0
  tracking-verification test using a fixture with one deliberately-untracked target)
- `scripts/release.ts` (line 49 `execSync('bun run build --all', ...)` → `execSync('bun run
  build', ...)`; line 163 console log wording no longer claims `--all` regenerates a special set)
- `scripts/release.test.ts` (regression: `build()` invokes the plain command, not `--all`)
- `src/references/blackhole-protocol.md` (flag-prose update per the ADR's Refactoring Impact
  table row — document `--gemini`/`--all`/`--no-codex` as no-op deprecation aliases, removal
  scheduled for the release after this one)
- `README.md` (line 128's "8 agent prompts" / `--gemini` opt-in framing updates to reflect
  tracked-by-default policy — this was the literal DX inconsistency the retrospective's P5 traced
  three dirty-tree confusions to)

### T3 (R1′) — facts declared once, verified two-sidedly

- `scripts/build.ts` (formalize the existing `AGENT_NAMES`/`RULES_LIST` SSOT under an explicit
  `§ facts` banner; promote `checkPhaseNames`'s inline `phases` array and `checkGroundTruth`'s
  inline `requiredRefs` array — currently magic values restated at their one consumption site in
  `verify.ts` — into named exports alongside `AGENT_NAMES`/`RULES_LIST`)
- `scripts/verify.ts` (rewrite `checkGroundTruth` (lines 754–780) into a two-sided
  facts-conformance check: independent filesystem scan of `src/agents/`, `src/references/
  phase-*.md`, and `blackhole-vcodes.md`'s table-row count, compared against `build.ts`'s `§
  facts` declaration — never collapsed onto one derivation path per the critics' binding
  rejection of R1; new `checkDocTables` check diffs `AGENTS.md`'s roster table row-set against
  `AGENT_NAMES` with a tolerant row-set parser, and checks `README.md`'s agent-count mention
  against `AGENT_NAMES.length`, both failing CI with the exact expected value)
- `scripts/verify.test.ts` (retire/rewrite `checkGroundTruth`'s old counter-comparison tests;
  add tests for the two-sided facts-conformance check and the new doc-table check, including a
  deliberately-stale `AGENTS.md` fixture row)
- `src/references/ground-truth.md` (slim to a prose pointer — remove the `agent_count`,
  `phase_playbook_count`, `vcode_table_rows`, `verify_check_count` counters and the duplicated
  Verify-checks description table; retain a one-paragraph pointer to `build.ts` § facts and
  `verify.ts`'s facts-conformance check as the source of truth)
- `src/SKILL.md` (F-DRIFT-01 wording at line 125 updates from "ground-truth counts match actual
  files" to "declaration vs independent-scan conformance — see `build.ts` § facts")

### T4 (R7) — link-integrity check

- `scripts/verify.ts` (new `checkLinkIntegrity` function: walks `src/**/*.md` via
  `scripts/lib/fs.ts`'s shared walker, extracts markdown link targets `[text](path)`, resolves
  each relative path against its source file's directory, and fails with file:line for any
  target that does not exist on disk; separately validates `documentation/decisions/*.md`
  cross-links referenced from ADR "related" frontmatter and inline `ADR-NNN` mentions)
- `scripts/verify.test.ts` (tests: a valid same-directory link passes; a valid
  `../hunt/quickwins.md`-style relative link passes; a dead link fails naming the exact file and
  line; an ADR frontmatter `related:` entry pointing at a non-existent path fails)

### T5 (R2′) — verify decomposition along the existing test taxonomy

- `scripts/verify.ts` (shrink to a ~50-LOC runner: glob-discovers `scripts/checks/*.check.ts`,
  imports each module's exported check function(s), concatenates `CheckResult[]`, prints the
  report, and preserves the `import.meta.main` entrypoint)
- `scripts/checks/core.check.ts` (new — moves `checkAgentToolPolicy`, `checkAgentFrontmatter`,
  `checkDelegationContracts`, `checkPhaseNames`, `checkVcodeReferences`, `checkFixtures`,
  `checkPlanArtifacts`, `checkSkillModes`, `checkClaudeCodeNativeNeutrality`, the T3
  facts-conformance + doc-table checks, the T4 link-integrity check, `checkGateContentAssertions`
  (its test import of `findMissingGateMarkers` already lives in `verify.test.ts`, confirming this
  domain), and the T6 content-gate check — matches `verify.test.ts`'s catch-all taxonomy slot)
- `scripts/checks/build.check.ts` (new — moves `checkBuild`, `checkGeminiBuild`,
  `checkGeminiDistributionBundle`, `checkCodexBuild` + its 3 sub-checks, `evaluateBuildCheck`,
  `detectBuildOutputDrift`, `BUILD_OUTPUT_PATTERNS` — matches `verify.build.test.ts`)
- `scripts/checks/checkpoint.check.ts` (new — moves `checkCheckpointAlignment`,
  `extractCheckpointTemplateKeys` — matches `verify.checkpoint.test.ts`)
- `scripts/checks/design-track.check.ts` (new — moves `checkDesignTrackTemplate`,
  `findMissingDesignTrackHeadings`, `DESIGN_TRACK_REQUIRED_HEADINGS` — matches
  `verify.design-track.test.ts`)
- `scripts/checks/companion-docs.check.ts` (new — moves `checkCompanionFileDocs`,
  `findMissingCompanionVcodes`, `COMPANION_FILE_REQUIRED_VCODES` — matches
  `verify.companion-docs.test.ts`)
- `scripts/checks/single-writer.check.ts` (new — moves `checkSingleWriterInvariant`,
  `ROUTER_NO_DIRECT_WRITE_REQUIRED_MARKERS`, `ORCHESTRATOR_SERIAL_TRIAGE_REQUIRED_MARKERS` —
  matches `verify.single-writer.test.ts`)
- `scripts/verify.build.test.ts`, `scripts/verify.checkpoint.test.ts`,
  `scripts/verify.design-track.test.ts`, `scripts/verify.companion-docs.test.ts`,
  `scripts/verify.single-writer.test.ts`, `scripts/verify.test.ts` (import paths follow their
  moved functions into `scripts/checks/`; taxonomy is already 1:1 per the ADR's Key Assumptions)
- `scripts/checks/epic-runbook.check.ts` **or** folded into `core.check.ts`
  (`checkEpicRunbook` — no dedicated test file exists today; see Task Breakdown marker)

### T6 (R3′) — orchestrator.md section-budget content-gate

- `scripts/checks/core.check.ts` (new `checkContentGate` function — content unchanged in
  `orchestrator.md`; the check enforces a max-LOC budget only on section headers added after a
  recorded baseline, see Task Breakdown marker for the exact threshold/grandfather mechanism)
- `scripts/verify.test.ts` (tests: a baseline-grandfathered large section — e.g. "Route-derived
  dispatch", ~110 lines — passes; a new section exceeding the budget fails naming the section
  header and line count)
- `src/agents/orchestrator.md` (no content change — governance-only task)

## Codebase Conventions (integration touchpoints)

| Touchpoint | Convention | Source |
|------------|------------|--------|
| Check contract | Every `scripts/checks/*.check.ts` file exports one or more pure functions returning `CheckResult[]` (no side effects beyond `fs.readFileSync`), plus the file itself performs no `console.log` — reporting stays in the runner | `scripts/verify.ts` `CheckResult` type (existing) |
| Test-to-check taxonomy | Each `scripts/checks/{domain}.check.ts` has exactly one paired `scripts/verify.{domain}.test.ts` (or `verify.test.ts` for the `core` domain) — 1:1, no new taxonomy invented | `scripts/verify.*.test.ts` (6 existing files) |
| Fixture convention | `bun:test` inline fixtures use `fs.mkdtempSync(path.join(os.tmpdir(), '<prefix>-'))` + `try/finally { fs.rmSync(dir, { recursive: true, force: true }) }` — T1 centralizes this in `scripts/lib/fs.ts`, callers keep the `try/finally` shape | `scripts/tree-shape.test.ts`, `scripts/verify.build.test.ts` |
| Edit surface | `src/` is the only hand-edited protocol source; every platform tree (`agents/`, `.cursor/`, `.claude/`, `.agents/build/`, `plugins/`, `codex-*`) is a `bun run build` output — never hand-edit a generated mirror | `ARCHITECTURE.md`, `V-BUILD-01` |
| Build regeneration discipline | Every PR touching `src/` or `scripts/build.ts` must run `bun run build` and commit the resulting mirror diff — `V-BUILD-01` fails CI on any leftover dirty diff in `BUILD_OUTPUT_PATTERNS` | `scripts/verify.ts::checkBuild`, `.github/workflows/verify.yml` |
| Facts declaration | Machine-checkable facts (agent roster, phase names, required references, V-code row count) are declared exactly once in `scripts/build.ts`, never restated as a literal at a consumption site | ADR-007 R1′ (this plan formalizes it) |
| Docs governance | `documentation/plans/*.md` frontmatter carries `type`/`status`/`review_trigger`; `ground-truth.md`'s slimming (T3) is a substantive replacement of its counter role — mark `status` unchanged (it stays `current`, only its content narrows) since the file is not superseded, just narrowed in scope | `.claude/rules/doc-governance.md` |

## Task Breakdown

### T1 — R6: shared FS walker + fixture kit (lands first, alone)

**Dependencies**: none — this is the sequencing root; blocks T3, T4, T5 (all of which touch
`scripts/verify.ts` and would conflict with an in-flight walker migration).

1. **[TDD]** Write `scripts/lib/fs.test.ts` first: a recursive walker test suite covering nested
   directories, a symlinked file, a hidden dotfile, and an empty directory (per the ADR Risk
   Assessment mitigation "own suite incl. nested/symlink/hidden cases") — all failing against a
   not-yet-created `scripts/lib/fs.ts`.
2. Implement `scripts/lib/fs.ts`: `walkFilesAbs(absDir): string[]` (directory-safe recursive
   walk, generalizing `verify.ts`'s `walkMdFilesAbs`), `makeTempDir(prefix): string`, and
   `cleanupDirEntries(dir): void` (directory-safe empty-out, generalizing `tree-shape.test.ts`'s
   inline cleanup loop).
3. Migrate the three walker/fixture sites: `verify.ts` (`checkVcodeReferences`'s
   `walkMdFilesAbs`/`walkMdFiles`, `#216`), `tree-shape.test.ts` (cleanup loop, `#226`, and the
   fixture-mkdir pattern, `#228`), `verify.build.test.ts` (`makeTempDir` duplication). Migrate
   `build.ts`'s `compileFolder` directory-recursion branch onto the same shared primitive.
4. Run `bun test` — full suite green, zero behavior change (build output byte-identical; verify
   check count unchanged at 22).

**Acceptance criteria**:
- [ ] `scripts/lib/fs.test.ts` passes with ≥4 cases: nested dir, symlink, hidden file, empty dir
- [ ] Zero other `.ts` file under `scripts/` defines its own recursive directory walker or
  `makeTempDir` — verified by `grep -rn "readdirSync" scripts/*.ts scripts/*.test.ts` showing
  only single-level, non-recursive uses (e.g. `install-verify.ts`'s existence checks) outside
  `scripts/lib/fs.ts`
- [ ] `bun run build && git status --porcelain` shows no diff beyond expected source changes
  (build output byte-identical to pre-T1)
- [ ] `bun test` — 100% pass, no test count regression

**Stop condition**: if migrating `build.ts`'s `compileFolder` changes any generated mirror byte,
halt and re-diff against `main` before proceeding — this is the one file where a walker bug would
propagate to all 6 platform targets at once (ADR Risk Assessment row 1).

### T2 — R5′: tracked ⇒ built-by-default (independent — no dependency on T1)

**Dependencies**: none (may land before, after, or parallel to T1 — touches `build.ts`'s CLI-arg
parsing, not its file-walking internals).

1. **[TDD]** Write failing tests in `build.test.ts`: default invocation regenerates every
   currently-tracked target (assert via `git ls-files` intersected with `BUILD_OUTPUT_PATTERNS`);
   `--gemini`/`--all`/`--no-codex` produce byte-identical output to the no-flag invocation.
2. Implement step 0: before changing any default, run `git ls-files --error-unmatch <target-dir>`
   (or equivalent) for every build-target directory; if any target is genuinely untracked, its
   opt-in flag survives for exactly that target (ADR Risk Assessment row 4) — this is the one
   place a residual flag may legitimately remain.
3. Flip `buildGemini`/`buildCodex` defaults to `true`; keep `--gemini`/`--all`/`--no-codex` as
   parsed-but-ignored no-op aliases with a one-line deprecation notice.
4. Update `release.ts`'s `build()` to call plain `bun run build`; update
   `blackhole-protocol.md` and `README.md` flag prose.

**Acceptance criteria**:
- [ ] `bun run build` (no flags) produces identical output to `bun run build --all` on the
  current tracked-file set (diff is empty)
- [ ] `build.test.ts` step-0 test: a fixture with one deliberately-untracked target directory
  causes that target's flag to remain opt-in (not silently defaulted on)
- [ ] `release.test.ts` asserts `build()` no longer passes `--all`
- [ ] `bun run build --gemini` and `bun run build --all` emit the deprecation notice to stderr
  and produce identical output to the flagless invocation
- [ ] `blackhole-protocol.md` and `README.md` no longer describe `--gemini` as required opt-in

**Stop condition**: if step 0 finds more than zero currently-untracked build targets, halt and
surface the exact target list before flipping any default — flipping tracked⇒default on an
untracked target would silently commit build noise no one asked for.

### T3 — R1′: facts declared once, verified two-sidedly

**Dependencies**: T1 (this task's facts-conformance check reuses `scripts/lib/fs.ts`'s walker for
its independent filesystem scan side).

1. **[TDD]** Write failing tests in `verify.test.ts` for the new two-sided facts-conformance
   check (independent scan vs `build.ts` declaration mismatch → fail with exact expected/actual)
   and the new doc-table check (stale `AGENTS.md` row fixture → fail naming the missing/wrong
   row).
2. Promote `build.ts`'s inline `phases`/`requiredRefs` literals (currently restated only inside
   `verify.ts`) into named `§ facts` exports alongside `AGENT_NAMES`/`RULES_LIST`.
3. Rewrite `checkGroundTruth` into the two-sided check: independent scan of `src/agents/`,
   `src/references/phase-*.md`, `blackhole-vcodes.md` row count — compared against the `§ facts`
   declaration, never collapsed onto one derivation (the critics' binding correction to R1).
4. Add `checkDocTables`: tolerant row-set parser diffs `AGENTS.md`'s roster table against
   `AGENT_NAMES`; a lighter count-consistency check compares `README.md`'s agent-count mention
   against `AGENT_NAMES.length`. Both print the expected value on failure (ADR Risk Assessment
   row 2 mitigation).
5. Slim `ground-truth.md` to a prose pointer; update `SKILL.md`'s F-DRIFT-01 wording.

**Acceptance criteria**:
- [ ] Facts-conformance check fails with an exact expected-vs-actual message when a fixture
  agent file is added/removed without a matching `AGENT_NAMES` edit
- [ ] Doc-table check fails naming the exact missing/mismatched `AGENTS.md` row when a fixture
  roster table is desynced from `AGENT_NAMES`
- [ ] `ground-truth.md` contains zero numeric counters; contains a pointer sentence to
  `build.ts` § facts and `verify.ts`'s facts-conformance check
- [ ] `SKILL.md` F-DRIFT-01 row no longer says "ground-truth counts"
- [ ] `bun run verify` still passes on the unmodified current repo state (no false positive)

**Stop condition**: if the two-sided check ever passes when the independent scan and the
declaration both encode the *same* bug (i.e., a change to `build.ts`'s scan-matching logic
itself, not the declaration), halt — that would silently recreate the one-sided-derivation
failure mode the critics rejected.

### T4 — R7: link-integrity check

**Dependencies**: T1 (reuses the shared walker for `src/**/*.md` traversal).

1. **[TDD]** Write failing tests: a same-directory relative link resolves; a `../hunt/`-style
   relative link resolves; a dead link fails naming file:line; a stale ADR `related:` frontmatter
   entry fails.
2. Implement `checkLinkIntegrity`: extract `[text](path)` targets from every `src/**/*.md` file
   via the shared walker, resolve each relative to its source file's directory, fail on any
   non-existent target; separately validate `documentation/decisions/*.md` `related:` frontmatter
   entries and inline `ADR-NNN` mentions resolve to an existing file.

**Acceptance criteria**:
- [ ] A deliberately-broken relative link in a fixture `.md` file fails with the exact file and
  line number
- [ ] All current `src/**/*.md` cross-references pass (zero false positives against the live repo
  — the architecture-coherence audit's F7 finding of pre-existing dead links is expected to
  surface here; document any pre-existing dead link found as a follow-up issue, not a plan blocker)
- [ ] All current `documentation/decisions/*.md` `related:` entries resolve

**Stop condition**: if the live-repo run surfaces more than 3 pre-existing dead links, halt and
file them as a separate tracked issue before merging this check as CI-blocking — a check that
immediately reds CI on landing needs a triage pass, not a silent large exception list.

### T5 — R2′: verify decomposition along the existing test taxonomy

**Dependencies**: T1 (shared walker must exist before checks move), T3 (facts-conformance +
doc-table checks must be finalized before their new home is chosen), T4 (link-integrity check
must exist before it's placed in `core.check.ts`).

1. **[TDD]** Before any move: record `results.length` from a clean `bun run verify` run (current
   baseline, live-repo-verified at grounding time: 22 checks plus T3's doc-table addition, T4's
   link-integrity addition, and T6's content-gate addition once those land — the exact number is
   asserted per-move, not hardcoded here).
2. Move one domain per commit within this PR (or split into sub-PRs if reviewability demands,
   per the ADR's own migration-churn mitigation): `core.check.ts` first (largest, catch-all),
   then `build.check.ts`, `checkpoint.check.ts`, `design-track.check.ts`,
   `companion-docs.check.ts`, `single-writer.check.ts`.
3. After each domain's move, assert `results.length` unchanged from the pre-move baseline for
   that commit (no check silently dropped or duplicated).
4. Shrink `verify.ts` to a ~50-LOC runner using glob auto-discovery — no central registry file
   (the critics' binding rejection of a check-registry hub).
5. Update the 6 `verify.*.test.ts` import paths to follow their functions into `scripts/checks/`.

**Acceptance criteria**:
- [ ] `scripts/verify.ts` is ≤60 LOC after decomposition (down from 979)
- [ ] Each of the 6 `scripts/checks/*.check.ts` files has a 1:1 paired
  `verify.{domain}.test.ts` (or `verify.test.ts` for `core`) with zero cross-file test imports
- [ ] Total `results.length` from `bun run verify` is identical before and after the full move
  (asserted per-commit, not just at the end)
- [ ] `bun test` — 100% pass, test count unchanged (only import paths moved)
- [ ] `[NEEDS CLARIFICATION: checkEpicRunbook has no dedicated test file among the 6 existing verify.*.test.ts files — confirm at migration time whether it belongs in core.check.ts (current default placement in this plan) or warrants its own companion-docs.check.ts co-location, by checking which test file (if any) currently exercises epic-orchestration.md linkage assertions.]`

**Stop condition**: if any single domain move changes `results.length`, halt that commit and
re-diff before proceeding to the next domain — per-domain isolation is the entire point of this
task; a silent count change defeats it.

### T6 — R3′: orchestrator.md section-budget content-gate

**Dependencies**: T5 (the content-gate check's natural home is `scripts/checks/core.check.ts`,
which must exist as a file before this check is added to it — landing T6 before T5 would mean
adding one more heterogeneous check to the monolithic `verify.ts`, working against R2′'s own
domain-isolation goal).

1. **[TDD]** Write failing tests: a section at or under the budget passes; a new section over
   budget fails naming the section header and line count; an existing baseline-grandfathered
   large section (e.g. "Route-derived dispatch", ~110 lines — core loop logic, not a "modal
   concern," and pre-dates this governance rule) continues to pass.
2. Implement `checkContentGate` in `core.check.ts`: parse `orchestrator.md`'s `##` section
   boundaries, compare each against a baseline snapshot (section-header → line-count) captured at
   this task's landing commit; sections not in the baseline (i.e., added after this task) must
   stay under the budget; baseline sections are grandfathered and never re-flagged for
   pre-existing size.
3. No content change to `orchestrator.md` itself — this is a governance-only check addition.

**Acceptance criteria**:
- [ ] `checkContentGate` passes on `orchestrator.md`'s current state (all existing sections
  grandfathered)
- [ ] A fixture-added new section exceeding the budget fails, naming the section header and its
  line count
- [ ] `[NEEDS CLARIFICATION: the ADR specifies "a content-gate check enforces a max section size" without a concrete LOC threshold or grandfather mechanism. This plan proposes a baseline-snapshot grandfather (only sections added after T6's landing commit are budget-checked) with a working default of 50 LOC per new section, chosen to sit between the newest "thin pointer" precedent sections (Kaizen hunt dispatch ~38 lines, Incident Mode ~34 lines) and comfortably below the un-grandfathered core-loop sections (~55-110 lines) — confirm this threshold and the grandfather mechanism with the ADR author at implementation time.]`

**Stop condition**: if the chosen threshold would immediately flag any of `orchestrator.md`'s
existing sections as over-budget without the grandfather mechanism, halt and widen the threshold
or fix the grandfather logic before merging — this check exists to prevent future accretion, not
to retroactively fail the file the ADR explicitly says needs no content change.

## Execution Strategy

Per blackhole protocol (`AGENTS.md`, `src/references/blackhole-protocol.md`): this plan is
executed by the blackhole campaign itself (dogfooding, same pattern as the ADR-004/ADR-006
campaigns) — each task below is filed as its own forge issue and run through the five-phase
pipeline (Handle → Plan → Implement → Review → Loop), one PR per issue, `bun run build && bun
run verify` green as an acceptance criterion on every issue.

| Task | Planner | Implementer | Reviewer | Notes |
|------|---------|-------------|----------|-------|
| T1 (R6) | `blackhole:planner` (sonnet) | `blackhole:implementer` (sonnet), isolated `wt-T1` worktree, branch `blackhole/issue-T1` | `blackhole:reviewer` (sonnet) | Lands first, alone — blocks T3/T4/T5 |
| T2 (R5′) | `blackhole:planner` (sonnet) | `blackhole:implementer` (sonnet), isolated `wt-T2` worktree, branch `blackhole/issue-T2` | `blackhole:reviewer` (sonnet) | Independent — parallelizable with T1 |
| T3 (R1′) | `blackhole:planner` (sonnet) | `blackhole:implementer` (sonnet), isolated `wt-T3` worktree, branch `blackhole/issue-T3` | `blackhole:reviewer` (sonnet) | After T1 |
| T4 (R7) | `blackhole:planner` (sonnet) | `blackhole:implementer` (sonnet), isolated `wt-T4` worktree, branch `blackhole/issue-T4` | `blackhole:reviewer` (sonnet) | After T1; parallelizable with T3 |
| T5 (R2′) | `blackhole:planner` (sonnet) | `blackhole:implementer` (sonnet), isolated `wt-T5` worktree, branch `blackhole/issue-T5` | `blackhole:reviewer` (sonnet) | After T1, T3, T4 |
| T6 (R3′) | `blackhole:planner` (sonnet) | `blackhole:implementer` (sonnet), isolated `wt-T6` worktree, branch `blackhole/issue-T6` | `blackhole:reviewer` (sonnet) | After T5 |

Parallelizable waves (respecting `parallel_max`): **W1** T1, T2 → **W2** T3, T4 → **W3** T5 →
**W4** T6.

The blackhole orchestrator coordinates (spawns planner/implementer/reviewer per issue, merges on
LGTM) — it does not itself appear as an agent row per mercure convention (the orchestrating
process, not a delegated worker).

## Risk Assessment

Carried from ADR-007's own Risk Assessment (binding), plus per-task rollback:

| Risk | Mitigation | Rollback |
|------|------------|----------|
| `lib/fs.ts` hub bug affects build+verify+tests at once | Lands first, alone (T1), with its own suite incl. nested/symlink/hidden cases; every subsequent migration PR keeps the suite green | Revert T1's single PR — nothing else has landed on top of it yet by construction (sequencing rule) |
| Doc-table check too strict (prose flexibility) | Check (T3) parses the table row-set only; tolerant of surrounding prose; failure message prints the expected rows | Revert T3's single PR; `ground-truth.md`'s prior counter form is restored from git history |
| Check migration churn masks regressions | Checks move one domain per commit (T5) along the existing test taxonomy; check count asserted before/after each move | Revert the single offending domain-move commit within T5's PR, or the whole T5 PR if the split wasn't granular enough |
| Residual untracked gemini output contradicts tracked⇒default | T2 step 0 verifies current tracking state of every target; if any output is untracked, the flag survives for exactly that target | Revert T2's single PR; `--gemini`/`--all` regain their prior opt-in-only semantics |
| (new, T4/T6-specific) Link-integrity or content-gate check reds CI immediately on landing due to pre-existing dead links / already-oversized sections | T4 caps first-run triage at 3 pre-existing dead links before merging as CI-blocking; T6's grandfather mechanism exempts all pre-existing `orchestrator.md` sections | Revert T4's or T6's single PR; each is independently revertible without affecting T1/T2/T3/T5 |

Every task is scoped to exactly one PR — reverting any single task's PR does not require
reverting any other task's PR, per the sequencing dependencies declared in Task Breakdown (a
revert of an earlier task, e.g. T1, would require re-evaluating whichever later tasks already
landed on top of it — flag this at revert time, do not silently proceed).

## Documentation Impact

- `src/references/ground-truth.md` — slimmed to a prose pointer (T3); counters removed
- `src/SKILL.md` — F-DRIFT-01 wording updated (T3)
- `src/references/blackhole-protocol.md` — `--gemini`/`--all`/`--no-codex` flag prose updated to
  deprecation-alias framing (T2)
- `README.md` — build-target/opt-in framing updated to tracked-by-default (T2)
- `documentation/decisions/ADR-007-drift-proof-toolchain-reseating.md` — flips `status: Proposed`
  → `Accepted` once all 6 tasks merge (per this repo's ADR lifecycle convention, stated in the
  ADR's own header); update `documentation/decisions/INDEX.md` accordingly at that point
  (V-ADA-02)
- No `DESIGN.md`/`ARCHITECTURE.md` impact — this is a toolchain/scripts change, not a UI or
  structural-architecture change; `ARCHITECTURE.md`'s Active Constraints already document the
  `src/`-only editing convention this plan preserves unmodified

## Success Criteria

- [ ] `bun test` green at every task's merge (100% pass, no regression in test count except
  intentional import-path moves in T5)
- [ ] `bun run verify` green at every task's merge, with `results.length` matching the expected
  per-task count (22 baseline; +1 doc-table check and +1 facts-conformance-rewrite net-neutral in
  T3; +1 link-integrity in T4; unchanged total across T5's moves; +1 content-gate in T6)
- [ ] `bun run build` produces a clean `git status --porcelain` diff at every task's merge
  (V-BUILD-01 holds throughout)
- [ ] Zero unguarded fact surfaces at completion — measured by T3's own facts-conformance check
  passing with no `VERIFY_SKIP_BUILD` escape hatch invoked, i.e., the check that used to be one
  hand-maintained mirror (`ground-truth.md`, Ce=22/Ca=1) is now a live two-sided comparison that
  runs green against the real repo state
- [ ] `scripts/verify.ts` is ≤60 LOC post-T5 (down from 979 pre-plan)
- [ ] All 6 tasks merged, each via its own reviewed PR with `Closes #N` linkage (`V-GIT-01`)
- [ ] `documentation/decisions/ADR-007-drift-proof-toolchain-reseating.md` status flipped to
  `Accepted` after the final task (T6) merges

## Sprint Contract

| Task | Definition of Done | Owner (agent) |
|------|--------------------|----------------|
| T1 (R6) | `scripts/lib/fs.ts` + fixture kit live; 3 walker sites migrated; `bun test`/`bun run verify`/`bun run build` all green; zero other recursive walker remains under `scripts/` | `blackhole:implementer` (sonnet) |
| T2 (R5′) | `bun run build` (no flags) == `bun run build --all` output; step-0 tracking check implemented; `release.ts` updated; docs updated | `blackhole:implementer` (sonnet) |
| T3 (R1′) | Two-sided facts-conformance check + doc-table check live; `ground-truth.md` slimmed; `SKILL.md` F-DRIFT-01 updated; `bun run verify` green on unmodified repo | `blackhole:implementer` (sonnet) |
| T4 (R7) | Link-integrity check live; ≤3 pre-existing dead links triaged as follow-up issues, not silently exempted | `blackhole:implementer` (sonnet) |
| T5 (R2′) | `verify.ts` ≤60 LOC; 6 domain check files match the 6 existing test files 1:1; check count identical pre/post per-domain move | `blackhole:implementer` (sonnet) |
| T6 (R3′) | Content-gate check live in `core.check.ts`; `orchestrator.md` content unchanged; existing sections grandfathered, no false-positive fails | `blackhole:implementer` (sonnet) |

Each row's reviewer is `blackhole:reviewer` (sonnet); each row's planner is `blackhole:planner`
(sonnet). No task is "done" until its own PR's `bun run build && bun run verify` reports green in
CI (`.github/workflows/verify.yml`) and the reviewer's aggregate LGTM lands.
