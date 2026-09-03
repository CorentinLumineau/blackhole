---
type: plan
status: current
review_trigger: "on file change"
created: 2026-09-02
last_updated: 2026-09-02
related:
  - documentation/plans/plan-retrospective-v0.21.0-remediation.md
  - documentation/decisions/ADR-025-agent-plugins-skills-only-shell.md
---

# Plan — Issue #724: named-flags build plumbing + V-TREE-01 tree registry check

Part of #703, item R-17 of `documentation/plans/plan-retrospective-v0.21.0-remediation.md`.
Was blocked on #706 (fixed the stale `documentation/architecture.md` § Committed target trees
table this issue's new check reads); #706 is merged, dependency cleared. Blocks #725 (R-18, the
design-track ADR resolving the 3 "Unknown" trees — that issue updates `V-TREE-01`'s registry
again once it lands, per R-18's own AC).

## Objective

`scripts/lib/build/clean.ts:81` `cleanBuildDirectories(buildGemini, buildCodex,
buildAgentPlugins)` takes three positional booleans — ADR-025 already recorded this shape as a
3-row BREAKING signature change touching 14 files for one target addition (agent-plugins); a
4th target would repeat that churn. Convert to named-flags plumbing: `determineBuildTargets()`
returns `{ gemini, codex, agentPlugins }` and `cleanBuildDirectories(targets)` takes that single
object. Alongside this, add `V-TREE-01` (WARN, advisory-only — never fails `bun run verify`,
same established shape as `V-DOCHEALTH-01..03`): a new check comparing the committed
build-target tree list — a new `COMMITTED_TARGET_TREES` SSOT registry in `paths.ts` — against
`documentation/architecture.md` § Committed target trees and README § Installation Paths,
naming any tree missing from either doc. This is the check that would have caught the R-03 bug
(stale `architecture.md` table, unmentioned `plugins/blackhole-claude/` row) before it shipped.

## Touch-Paths

- `scripts/lib/build/clean.ts` — named-flags refactor of `determineBuildTargets`/
  `cleanBuildDirectories`.
- `scripts/build.ts` — call-site update for the new object shape.
- `scripts/build.test.ts` — shape assertion update (`{gemini,codex,agentPlugins}` field names).
- `scripts/lib/build/paths.ts` — **widened beyond the router's touch-path set.** New
  `COMMITTED_TARGET_TREES` registry belongs here (the file's own established role as the SSOT
  for build-target path constants — every other target-dir literal already lives here, e.g.
  `GEMINI_TARGET_DIRS`, `CODEX_TARGET_DIRS`, `paths.ts:44-46`) rather than duplicated as fresh
  literals inside the new check file (`V-DRY-01`/`V-INT-02`).
- `scripts/checks/tree-registry.check.ts` (new) — `V-TREE-01` check module. Covered by the
  router's `scripts/checks/*.check.ts` wildcard.
- `scripts/verify.tree-registry.test.ts` (new) — TDD test file for the above. Covered by the
  router's `scripts/verify.*.test.ts` wildcard.
- `src/references/blackhole-vcodes.md` — **HOT FILE, wave-locked to one worker at a time.**
  Adds the `V-TREE-01` table row. Coordinate with the orchestrator before editing; re-fetch the
  latest version immediately before applying this edit if another worker has landed a change to
  this file since this plan was written.
- `scripts/lib/build/facts.ts` — **HOT FILE, wave-locked to one worker at a time; widened beyond
  the router's touch-path set.** `VCODE_TABLE_ROW_COUNT` (currently `89`, `facts.ts:31`) MUST
  bump to `90` in the same PR as the `blackhole-vcodes.md` row-add — `V-GROUND-01`
  (`scripts/checks/ground-truth.check.ts:85-88`) counts `^| V-` rows and fails the count
  mismatch otherwise, and `TOUCH_PATH_SSOT_PAIRS[0]`
  (`scripts/lib/plan-touch-path-ssot-pairs.ts:19-25`) pairs exactly this trigger→companion
  edit, so omitting `facts.ts` from Touch-Paths would itself surface as a `touch_paths_ssot_gap`
  advisory. Coordinate with the orchestrator on wave sequencing the same as `blackhole-vcodes.md`
  above; this is a 1-character value edit (`89` → `90`), not a structural change.

No other file changes. `compileGeminiTargets`/`compileCodexTarget`/`compileAgentPluginsTarget`
(in `scripts/lib/build/targets.ts`) keep their existing single-boolean signatures — only their
call sites in `build.ts` change (from a destructured local var to a field access), the functions
themselves are untouched and out of scope.

## Documentation Impact

`docs_governance.enabled: true`. `src/references/blackhole-vcodes.md` gains one new WARN row
(`V-TREE-01`) — this is itself the affected companion doc and is already listed under
Touch-Paths above. No other companion doc (`ARCHITECTURE.md`, `DESIGN.md`,
`documentation/decisions/INDEX.md`) is affected: the named-flags signature refactor is internal
to `scripts/`, not a documented public contract, and the new check reads
`documentation/architecture.md` / `README.md` but does not write to them (both are explicitly
excluded from this plan's Touch-Paths — the check is a read-only drift detector, not a doc-sync
mechanism; see § Execution Strategy).

## Codebase Conventions

| Concern | Convention | Citation |
|---|---|---|
| Check-module shape | Every `scripts/checks/*.check.ts` file exports pure `CheckResult`-returning functions plus a `runChecks(): CheckResult[]` aggregator; `CheckResult = { id, ok, detail? }` and the `read()`/`root` helpers come from `check-utils.ts` | `scripts/checks/check-utils.ts:6-10`; `scripts/checks/config-registration.check.ts:1-3,69-85` |
| Advisory (never-block) check pattern | A WARN-severity check that should never fail `bun run verify` on its own returns `ok: true` unconditionally, carrying the finding in `detail` — established for exactly this reason by the doc-health checks | `scripts/checks/doc-health.check.ts:66-67` (`V-DOC-GOV-02`) |
| Markdown doc-parsing check pattern | A check that extracts structured data from markdown prose (not JSON) exports its extraction function separately from the aggregate check, fence-aware, tested against synthetic fixtures | `scripts/checks/links.check.ts:17-39` (`extractMarkdownLinkTargets`) |
| `verify.<name>.test.ts` test-file convention | Imports the check module's individual exported functions (not just `runChecks`) from `./checks/<name>.check.ts`, plus `read`/`root` from `./checks/check-utils.ts`, using `bun:test`'s `describe`/`test`/`expect` | `scripts/verify.config-registration.test.ts:1-10` |
| V-code table row format | `| V-CODE | Rule description | BLOCK\|WARN | Primary enforcement site |`, one row per code, inserted near other check-module-enforced rows rather than at the end | `src/references/blackhole-vcodes.md:72-73` |
| Named target-dir constant style | `paths.ts` is the sole SSOT for build-target path literals — every existing target directory is a named export or a `TARGET_DIRS` array here, never restated as a fresh literal in a consumer file | `scripts/lib/build/paths.ts:39-47` |
| Named-flags object-shaped build signature precedent | ADR-025 recorded the identical 3-row BREAKING-change shape (`determineBuildTargets` return + `cleanBuildDirectories` params) for the prior `buildAgentPlugins` addition — this issue converts that positional-boolean pattern to a named-flags object once, closing the recurring-churn pattern ADR-025 flagged | `documentation/decisions/ADR-025-agent-plugins-skills-only-shell.md:177-179` |
| `VCODE_TABLE_ROW_COUNT` companion-edit pairing | A `blackhole-vcodes.md` row-add is a documented SSOT-pair trigger requiring the paired `facts.ts` constant bump in the same PR | `scripts/lib/plan-touch-path-ssot-pairs.ts:19-25` |

## Execution Strategy & Stop Conditions

- If `checkTreeRegistry()` (the new `V-TREE-01` check), run against the live
  `documentation/architecture.md` and `README.md`, finds a gap: name it in `detail` and leave
  `ok: true` (advisory design, see Codebase Conventions table) — do NOT edit
  `documentation/architecture.md` or `README.md` to force a clean result. Both files are outside
  this plan's Touch-Paths (`V-SCOPE-02`); a real, pre-existing doc gap (e.g. the Codex CLI
  stanza never lists `codex-agents/`/`codex-skills/`/`.codex-plugin/`) is expected and
  acceptable output on this check's first run — it is exactly the kind of finding the check
  exists to surface for a future PR, not this one.
- If `bun run scripts/verify.ts` (or the project's `bun run verify`) reports a
  `V-CONTENTGATE-01` violation on `scripts/checks/tree-registry.check.ts` (budget: 218 total /
  68 per section, `scripts/lib/build/*.ts` and `scripts/checks/*.check.ts` globs,
  `scripts/lib/build/facts.ts:116,118,125-126`) or on `scripts/lib/build/paths.ts`/`clean.ts`
  (budget: 287 total / 68 per section, same fact rows), STOP and split/trim the new code —
  never edit `CONTENT_GATE_BUDGETS` values to raise the ceiling.
- If `bun run build` after the `clean.ts`/`build.ts` refactor produces a `git status --porcelain`
  diff touching any file outside the 8 Touch-Paths above plus the generated dist-tree mirrors of
  `src/references/blackhole-vcodes.md` (per `scripts/lib/build/targets.ts`), STOP — the
  named-flags refactor must be behavior-preserving; a wider diff means the object-shape
  conversion introduced a functional change, not just a signature change, and must be
  re-diagnosed before continuing.
- If another in-flight worker has modified `src/references/blackhole-vcodes.md` or
  `scripts/lib/build/facts.ts` since this plan was written (both HOT FILES), re-fetch the latest
  version of each file before applying this plan's edits — never force-overwrite a concurrent
  change to either file.

## Task Breakdown

- [ ] **TDD Baseline Verification**: Run the project's test suite first to verify all existing
  tests pass before modifying any codebase files. — **AC**: baseline suite run, pass/fail counts
  quoted in the completion evidence.
- [ ] **Write failing test — named-flags shape** (test-first, `V-TEST-01/02`): edit
  `scripts/build.test.ts`'s `'determineBuildTargets uses tracking-only gating...'` test (currently
  asserting `{buildGemini, buildCodex, buildAgentPlugins}`) to assert the target shape
  `{gemini: isTargetTracked(root, GEMINI_TARGET_DIRS), codex: isTargetTracked(root,
  CODEX_TARGET_DIRS), agentPlugins: isTargetTracked(root, AGENT_PLUGINS_TARGET_DIRS)}` instead.
  — **AC**: `bun test scripts/build.test.ts -t "determineBuildTargets"` fails against the
  current (pre-refactor) `clean.ts`, with the failure output quoted, before any implementation
  edit lands.
- [ ] **Write failing tests — `V-TREE-01` check** (test-first, `V-TEST-01/02`): create
  `scripts/verify.tree-registry.test.ts` importing (not yet existing)
  `extractMarkdownSection`, `findMissingTrees`, `checkTreeRegistry`, `runChecks` from
  `./checks/tree-registry.check.ts`, and `COMMITTED_TARGET_TREES` from `./lib/build/paths.ts`.
  Assert: (a) `extractMarkdownSection(fixture, 'Committed target trees')` returns only the lines
  between that `## ` heading and the next `## ` heading; (b) `extractMarkdownSection(fixture,
  'Installation Paths')` matches a heading containing that substring even with a leading emoji
  (`## 📦 Installation Paths`); (c) `findMissingTrees(section, trees, {requireAll: true})`
  returns `[]` when every path of every entry is present, and returns `[entry.id]` when one path
  of one entry is absent from a synthetic fixture section; (d) `findMissingTrees(section, trees,
  {requireAll: false, exclude: ['claude-native']})` returns `[]` when at least one path per
  (non-excluded) entry is present, excludes `claude-native` from consideration regardless of
  content, and returns the entry id when none of its paths are present; (e)
  `checkTreeRegistry()` run against the real, live `documentation/architecture.md` and
  `README.md` on disk returns exactly `{ id: 'V-TREE-01', ok: true, detail: 'README.md missing:
  claude-marketplace, codex' }` (asserts the calibrated current-state baseline — proves the
  check is correctly wired against real content, not a synthetic-only test); (f) `runChecks()`
  returns an array of length 1 whose single element has `id === 'V-TREE-01'`.
  — **AC**: `bun test scripts/verify.tree-registry.test.ts` fails (module not found) before the
  check module exists, failure output quoted.
- [ ] **Add `COMMITTED_TARGET_TREES` registry to `paths.ts`**: export `type CommittedTargetTree
  = { id: string; paths: string[] }` and `export const COMMITTED_TARGET_TREES:
  CommittedTargetTree[]` with exactly these 8 entries (paths reuse the file's existing named
  constants where one exists; `.claude-plugin/`, `.cursor/`, and the four flat-registry dirs have
  no existing named export and are added as fresh literals here, this file being the
  established SSOT per the Codebase Conventions table):
  `{id:'skills-registry', paths:['skills/','agents/','references/','rules/']}`,
  `{id:'cursor', paths:['.cursor/']}`,
  `{id:'claude-native', paths:[\`${CLAUDE_NATIVE_ROOT}/\`]}`,
  `{id:'claude-marketplace', paths:['.claude-plugin/', \`${CLAUDE_DISTRIBUTION_ROOT}/\`]}`,
  `{id:'codex', paths:[...CODEX_TARGET_DIRS.map(d => \`${d}/\`), 'codex-marketplace.json']}`,
  `{id:'gemini-workspace', paths:[\`${AGENTS_BUILD_ROOT}/\`, '.gemini-plugin/']}`,
  `{id:'agent-plugins', paths:AGENT_PLUGINS_TARGET_DIRS.map(d => \`${d}/\`)}`,
  `{id:'gemini-distribution', paths:[\`${DISTRIBUTION_ROOT}/\`]}`.
  — **AC**: `bun -e 'import { COMMITTED_TARGET_TREES } from "./scripts/lib/build/paths.ts";
  console.log(COMMITTED_TARGET_TREES.length)'` prints `8`; `wc -l scripts/lib/build/paths.ts`
  reports ≤ 287.
- [ ] **Implement `scripts/checks/tree-registry.check.ts`** (`V-TREE-01`, WARN, advisory —
  always `ok: true`): implement `extractMarkdownSection(content, headingSubstring)` (find the
  first line matching `/^##\s/` whose text includes `headingSubstring`, slice to the next such
  line or EOF), `findMissingTrees(sectionText, trees, {requireAll, exclude?})` (per-entry: if
  `requireAll`, every path in `entry.paths` — trailing `/` stripped for the containment check —
  must appear as a substring of `sectionText`; else at least one must; entries whose `id` is in
  `exclude` are skipped), `checkTreeRegistry()` (reads
  `documentation/architecture.md`/`README.md` via `read()`, extracts the `'Committed target
  trees'` and `'Installation Paths'` sections, computes `missingArch =
  findMissingTrees(archSection, COMMITTED_TARGET_TREES, {requireAll: true})` and `missingReadme
  = findMissingTrees(readmeSection, COMMITTED_TARGET_TREES, {requireAll: false, exclude:
  ['claude-native']})`, returns `{id:'V-TREE-01', ok:true}` when both are empty, else
  `{id:'V-TREE-01', ok:true, detail: <joined "architecture.md missing: ..." / "README.md
  missing: ..." parts>}`), and `runChecks(): CheckResult[] => [checkTreeRegistry()]`.
  — **AC**: `bun test scripts/verify.tree-registry.test.ts` passes in full (all 6 assertions
  from the prior task green); `wc -l scripts/checks/tree-registry.check.ts` reports ≤ 218.
- [ ] **Refactor `clean.ts` to named flags**: `determineBuildTargets(cliArgs?): { gemini:
  boolean; codex: boolean; agentPlugins: boolean }` (rename the returned fields only —
  `geminiTracked`/`codexTracked`/`agentPluginsTracked` local derivation logic is unchanged);
  `cleanBuildDirectories(targets: { gemini: boolean; codex: boolean; agentPlugins: boolean })`
  replacing the three positional boolean params, with the body's `if (buildGemini)` / `if
  (buildAgentPlugins)` / `if (buildCodex)` guards updated to `if (targets.gemini)` / `if
  (targets.agentPlugins)` / `if (targets.codex)`.
  — **AC**: `bun test scripts/build.test.ts -t "determineBuildTargets"` (the task-2 test) now
  passes; `grep -n "cleanBuildDirectories = (buildGemini: boolean, buildCodex: boolean,
  buildAgentPlugins: boolean)" scripts/lib/build/clean.ts` returns no match (old positional
  signature gone); `wc -l scripts/lib/build/clean.ts` reports ≤ 287.
- [ ] **Update `build.ts` call site**: `const targets = determineBuildTargets();
  cleanBuildDirectories(targets); ... compileGeminiTargets(targets.gemini); ...
  compileCodexTarget(targets.codex); compileAgentPluginsTarget(targets.agentPlugins);` —
  `compileGeminiTargets`/`compileCodexTarget`/`compileAgentPluginsTarget` themselves are
  untouched (still take a single boolean).
  — **AC**: `bun run build` exits 0; the existing byte-identical-output snapshot tests in
  `scripts/build.test.ts` (the `'%s is a behaviorally no-op alias...'` `test.each` block, lines
  ~763-775) continue to pass unmodified, proving the refactor is behavior-preserving.
- [ ] **Add the `V-TREE-01` row to `blackhole-vcodes.md`** (HOT FILE — re-fetch immediately
  before editing if another worker has touched it since this plan was written): insert between
  the `V-CONFIG-02` row (line 73) and the `V-SCOPE-01` row (line 74):
  `| V-TREE-01 | Committed target tree drift — paths.ts's COMMITTED_TARGET_TREES diverges from
  documentation/architecture.md § Committed target trees or README § Installation Paths,
  named per-doc | WARN | scripts/checks/tree-registry.check.ts |`.
  — **AC**: `grep -c '^| V-' src/references/blackhole-vcodes.md` reports `90`.
- [ ] **Bump `VCODE_TABLE_ROW_COUNT`** (HOT FILE — same coordination note as above) in
  `scripts/lib/build/facts.ts:31` from `89` to `90`, in the same PR as the previous task (never
  split across two PRs — `V-GROUND-01` fails on any mismatch).
  — **AC**: `grep -n "VCODE_TABLE_ROW_COUNT = 90" scripts/lib/build/facts.ts` matches.
- [ ] **Rebuild dist trees**: run `bun run build` and commit the regenerated mirror(s) of
  `src/references/blackhole-vcodes.md` (per `scripts/lib/build/targets.ts`) alongside the source
  edit, in the same PR.
  — **AC**: `git status --porcelain` after `bun run build` shows only the 8 Touch-Paths above
  plus the expected mirrored dist-tree paths for `blackhole-vcodes.md` — no unrelated file
  changed.
- [ ] **Verify Integrity**: run `bun test` and `bun run verify` (project's full gates, subject to
  the workstation resource-frugal pre-flight gate the implementer's own environment enforces).
  — **AC**: full suite green, `bun run verify` reports all checks passed (or documents any
  pre-existing unrelated failure with a citation, per `mercure-verification-evidence.md`), both
  quoted in the completion evidence.

## Sprint Contract

Definition of done = every task above's own `— **AC**:` condition holds, plus: `bun test` and
`bun run verify` both green (last task); `git status --porcelain` after `bun run build` shows
only the declared Touch-Paths plus expected dist mirrors (task 8); `VCODE_TABLE_ROW_COUNT` and
the `blackhole-vcodes.md` row count agree at `90` (tasks 7-8). No task in this plan has a
narrower "all tests and linters pass" fallback — every task's AC above is task-specific and
machine-verifiable.

## References

- `documentation/plans/plan-retrospective-v0.21.0-remediation.md` § R-17 (evidence, AC, touch
  list) and § R-18 (the follow-up design-track ADR this issue blocks).
- `documentation/decisions/ADR-025-agent-plugins-skills-only-shell.md:154,177-179` — named-flags
  precedent and the 3-row BREAKING-change table this issue closes the recurrence pattern for.
- `documentation/architecture.md:59-74` § Committed target trees — the 8-row table
  `COMMITTED_TARGET_TREES` mirrors.
- `README.md:125-172` § 📦 Installation Paths — the section `V-TREE-01`'s README-side check
  scans.
- `scripts/lib/plan-touch-path-ssot-pairs.ts:19-25` — the `VCODE_TABLE_ROW_COUNT` companion-edit
  pairing this plan's Touch-Paths already satisfies.
