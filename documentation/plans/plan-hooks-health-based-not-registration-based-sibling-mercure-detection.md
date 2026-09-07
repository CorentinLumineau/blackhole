---
type: plan
summary: "Add a health-verification leg to blackhole's sibling-mercure defer guard so a registered-but-broken mercure install no longer silently stands down blackhole's own containment; Option A partial fix per issue #969's owner-ruled design"
status: current
issue: #969
review_trigger: "on file change"
created: 2026-09-07
last_updated: 2026-09-07
supersedes_adr: null
---

# Plan - Issue #969

## Objective

Add a **health-verification leg** to blackhole's sibling-mercure defer guard
(`shouldDeferToMercure`, `templates/hooks/pretooluse/utils/sibling-plugin-guard.js`) so that a
mercure plugin merely *registered* in `~/.claude/plugins/installed_plugins.json` — but whose
actual `hooks.json`-declared script is missing or empty — no longer causes blackhole to silently
stand down. This implements **Option A** from the owner-ruled design note
(`.blackhole/plans/issue-969-design.md` § "Gate — blind-critic verdict and owner ruling (turn
19)") as an honest **partial** fix, under five binding constraints from that gate. The design
decision itself is closed and not reopened here.

**What this change closes, precisely** (binding constraint 1 — the load-bearing one): the
narrower **manifest-declared-but-script-missing** layer — a `hooks.json` that still declares a
`PreToolUse` entry whose referenced script file no longer exists or is empty. **What it does
NOT close**: the ADR-030/issue #800 stale-cache class — a script file that exists, is non-empty,
and is referenced correctly by an untouched `hooks.json`, but whose *content* is stale or broken.
Neither this change nor any artifact it produces (code comment, docstring, README, PR body, issue
comment) may describe this as closing #800 or "the stale-cache problem" — that would be a control
that cannot fire (`V-UNFALSIFIABLE-01`, BLOCK). Every task below that touches prose carries this
scope constraint explicitly in its AC.

## Touch-Paths

- `templates/hooks/pretooluse/utils/installed-plugin-rows.js` (NEW) — shared row-filter +
  command-path-extraction helper, dual-consumed by the shipped hook tree and by
  `scripts/lib/hook-sources.ts` (see Codebase Conventions and Task 4/5/6 below for why this file
  has to exist and where its logic comes from).
- `templates/hooks/pretooluse/utils/sibling-plugin-health.js` (NEW) — `isPluginHealthy(installPath): boolean`.
- `templates/hooks/pretooluse/utils/sibling-plugin-guard.js` — wire the health leg into
  `shouldDeferToMercure`; update module docstring.
- `scripts/lib/hook-sources.ts` — delete the private `extractCommandPath` and the inline
  candidate-row filter predicate; import both from the new shared module instead.
- `scripts/lib/test-fixtures.ts` — extend `writeInstalledPlugins` with an opt-in healthy mode.
- `scripts/lib/test-fixtures.test.ts` — unit tests for the fixture extension.
- `scripts/hooks-validate-bash.test.ts` — fix the one #870 defer test that the health leg
  breaks; add new health-fail-closed + multi-row regression tests.
- `scripts/hooks-validate-file.test.ts` — same, mirrored.
- `scripts/hooks-sibling-plugin-health.test.ts` (NEW) — focused unit tests for
  `isPluginHealthy` and the shared helper module.
- `templates/hooks/pretooluse/README.md` — update § "Sibling mercure defer (issue #870)".
- `src/references/hook-schemas.md` — update the `defer`-tier paragraph.
- `package.json` — version bump (`V-PLUGIN-01`).
- plus all generated dist trees per `scripts/lib/build/targets.ts`.

## Documentation Impact

- `templates/hooks/pretooluse/README.md` § "Sibling mercure defer (issue #870)" — needs a 4th
  condition (health) plus the scope-of-claim caveat (constraint 1). Already in Touch-Paths
  (Task 11).
- `src/references/hook-schemas.md`'s `defer`-tier paragraph — same 4-condition + scope-caveat
  update. Already in Touch-Paths (Task 11).
- `documentation/plans/plan-hooks-health-based-not-registration-based-sibling-mercure-detection.md`
  — durable plan copy, staged this turn under ADR-021 D3 (see `staged_artifacts` in the return
  JSON); carried into the PR by the implementer's carry-step, not written directly here.
- No `ARCHITECTURE.md` update: this change lands inside an already-documented mechanism
  (issue #870's own contract) as a bugfix, not a new cross-cutting Active Constraint — nothing
  here changes the scope/enforcement/foreclosure profile #870's own design pass already assessed.

## Critical Files

- `templates/hooks/pretooluse/utils/sibling-plugin-guard.js`
- `templates/hooks/pretooluse/utils/hook-event-log.js`
- `scripts/lib/hook-sources.ts`
- `scripts/lib/test-fixtures.ts`
- `package.json`

## Codebase Conventions

| Convention | Where | Note |
|---|---|---|
| Fail-closed-on-ambiguity idiom | `sibling-plugin-guard.js:11-16` module docstring | Every existing ambiguity branch (unreadable/malformed manifest, no git context, anomalous stat error) returns "stay active". The new health leg's every failure path (unreadable/malformed `hooks.json`, no `PreToolUse` entries, unresolvable command path, missing/empty script) must return `false` the same way (binding constraint 5). |
| `require(path.join(PRETOOLUSE_HOOKS_DIR, 'utils', '<file>.js'))` from a `.ts` test/module | `scripts/hooks-validate-bash.test.ts:2789`, `scripts/hooks-validate-file.test.ts:1257` | The already-working CJS/ESM interop precedent this plan's Task 6 reuses so `scripts/lib/hook-sources.ts` (a Bun/ESM dev-time module) can `require()` the shared CommonJS helper shipped under `templates/hooks/pretooluse/utils/`. |
| `root` repo-root SSOT | `scripts/lib/build/paths.ts:3` (`export const root = ...`) | Any new absolute-path resolution in `scripts/lib/*.ts` reuses this constant rather than re-deriving `import.meta.dirname` math. |
| "No import path between the CommonJS hooks tree and the Bun/ESM `scripts/lib` tree" — but only in the shipped→dev direction | `scripts/lib/carry-staged-artifacts.ts:212-215` (`resolveExistingAncestor` doc comment) | That precedent re-implements rather than imports because it runs the OTHER direction (`scripts/lib` code needing a *shipped hook's* helper at a point where the shipped tree is not guaranteed present). This plan's direction is the reverse and does not hit that constraint: `scripts/lib/hook-sources.ts` is dev/orchestrator-only tooling (its sole consumer, `plugin-drift-signal.ts`, is only ever invoked via `bun run` from inside a full repo checkout — `blackhole-state.md` § Plugin-Drift Signal), so `templates/hooks/pretooluse/utils/*.js` is always present on disk relative to it at the moment it runs. The reverse direction — a *shipped* hook script (running inside an installed plugin cache, where `scripts/lib/` does not exist) reaching into `scripts/lib/`  — would hit exactly the failure this precedent documents, which is why the canonical implementation must live in the shipped tree (`templates/hooks/pretooluse/utils/installed-plugin-rows.js`), not in `scripts/lib/hook-sources.ts`. Task 4/5/6 below implement this direction. |
| `writeInstalledPlugins`/`writeCampaignConfig` fixture helpers | `scripts/lib/test-fixtures.ts:291-305` | One shared fixture-writer per concern, extended rather than duplicated. Task 1 extends this helper instead of writing a parallel one. |
| Generated-dist-tree citation | `scripts/lib/build/targets.ts` | Touch-Paths above cite it by the standard phrase rather than hand-enumerating `.claude/hooks/`, `.cursor/`, `plugins/*/hooks/`, etc. |

## Database/API Schema Changes

N/A — no schema or public API surface changes. `shouldDeferToMercure(cwd): boolean`'s external
contract is unchanged (both call sites, `validate-bash-command.js:49` and
`validate-file-changes.js:61`, need zero edits — TRANSPARENT per Dependency Blast-Radius below).
`enumerateHookSources`'s return shape (`HookSource[]`) in `scripts/lib/hook-sources.ts` is also
unchanged — Task 6 is an internal refactor of that file, not a contract change.

## Threat Model

Trigger: `route.security_review_required: true` (design note routing, confidence 75 — this issue
directly targets a residual Elevation-of-Privilege gap issue #870's own threat model named).

| Threat | STRIDE | Description | Severity | Mitigation status |
|---|---|---|---|---|
| A stale/broken mercure hook script still reads as healthy because the check only verifies manifest + existence + non-empty size, not script *content* | Elevation of Privilege | Binding constraint 1's exact scope gap: a truncated or syntactically-broken but non-empty script passes the health check, so blackhole defers to a hook that will not actually run correctly for that call | High | Accepted Risk — explicitly out of scope by owner ruling. The design note's Assumption Audit #3 documents `require()`/syntax-checking a foreign plugin's own code as a strictly *worse* trade (real code-execution risk vs. a detection gap). Mitigated only in the sense that no artifact this plan produces may claim otherwise (constraint 1) — enforced by Task 11's doc wording and this plan's own scope language above. |
| Health-check probe throws on an adversarial or malformed `hooks.json` / command string | Denial of Service | The probe reads a file under `~/.claude/plugins/`, a path reachable only by a local actor with pre-existing filesystem access — not a remote or network input channel | Low | Mitigated — every parse/read step wrapped in try/catch per constraint 5; any throw resolves to `false` (stay active), never an uncaught exception. Task 8's AC requires this for every failure branch; Task 7's tests assert it. |
| Row-selection ambiguity picks a stale project-scope leftover instead of the row that actually matches the calling repo, reading a defunct install as healthy | Spoofing | `installed_plugins.json` stores an array of scope-differentiated rows per key (constraint 4); picking the wrong one risks reading a stale, disconnected install's manifest as the live signal | Medium | Mitigated — Task 5/6 reuse `hook-sources.ts`'s existing candidate-row filter (`row.scope === 'user' \|\| (row.scope === 'project' && row.projectPath === repoRoot)`), the same predicate already governing `enumeratePluginCacheSources`. Task 10 adds a dedicated multi-row regression test. |
| A local actor with write access to `~/.claude/plugins/installed_plugins.json` or a plugin cache directory engineers a `hooks.json`/script pair that reads as healthy while doing nothing (or something else) | Tampering | Same local-write-access precondition the existing registration-only check already carries | Low | Accepted Risk — unchanged from status quo. The design note's Assumption Audit #4 already establishes that reading this tree crosses no new trust boundary versus today's registration-only read; this check's purpose is drift/staleness detection, not an adversarial-tampering defense. |
| The health check's own defer record discloses to a local reader that blackhole is deferring | Information Disclosure | No new disclosure surface — the `pattern_id: sibling-plugin-defer` event already exists from issue #870; this plan adds no new field to that record | Low | Mitigated — Task 9 does not modify the event schema, only the predicate deciding when it fires. |
| A test fixture (`writeInstalledPlugins`'s `/fake/path` stub) silently starts asserting the opposite of its written intent once the health leg lands, with nobody able to trust what the suite proves | Repudiation | Constraint 3's exact failure shape (`V-TEST-11`) | High | Mitigated — Task 1 (fixture fix) is sequenced before Task 9 (guard wiring); Task 10's AC mandates a red-before-green re-verification of every existing #870 defer assertion against the new fixture, with both outputs quoted in the completion evidence. |

Both HIGH-severity rows carry a non-`Open` mitigation status (`V-THREAT-02`).

## Dependency Blast-Radius

Reused from the design note's Refactoring Impact Analysis (7 non-transparent consumers, above
the 3-consumer Standard-track threshold), collapsed against this plan's actual implementation
shape:

| Consumer | Classification | Note |
|---|---|---|
| `templates/hooks/pretooluse/validate-bash-command.js:18,49` | TRANSPARENT | Calls `shouldDeferToMercure(cwd): boolean`; contract unchanged. |
| `templates/hooks/pretooluse/validate-file-changes.js:18,61` | TRANSPARENT | Same. |
| `scripts/lib/hook-sources.ts` (`enumerateHookSources`; consumed by `plugin-drift-signal.ts`, `hook-source-ordering.ts`) | TRANSPARENT | Internal refactor only (Task 6) — `extractCommandPath` and the candidate-row filter move to the new shared module and are imported, not reimplemented; `HookSource`/`enumerateHookSources`'s public contract is unchanged. AC: `scripts/hook-sources.test.ts` and `scripts/plugin-drift.test.ts` pass unmodified. |
| `scripts/lib/test-fixtures.ts:291-305` (`writeInstalledPlugins`) | BREAKING (fixture) | Must gain a healthy-mode option (Task 1) before the health leg lands, or every existing #870 defer test silently degrades (`V-TEST-11`). |
| `scripts/hooks-validate-bash.test.ts` (#870 describe block, `~3634`) | BREAKING (fixture-dependent) | The one "defer" assertion in this block needs the fixture's healthy mode (Task 10). |
| `scripts/hooks-validate-file.test.ts` (#870 describe block, `~1288`) | BREAKING (fixture-dependent) | Same, mirrored. |
| `templates/hooks/pretooluse/README.md` § "Sibling mercure defer (issue #870)" | DEPRECATION (doc) | 4th condition + scope caveat (Task 11). |
| `src/references/hook-schemas.md:122` (defer-tier paragraph) | DEPRECATION (doc) | Same (Task 11). |
| `sibling-plugin-guard.js`'s own module docstring | DEPRECATION (doc, same file/diff) | Kept in sync in the same diff as the logic it describes (Task 9). |
| Generated dist trees (`.claude/hooks/`, `.agents/build/hooks/`, `plugins/*/hooks/`, etc.) | TRANSPARENT | Regenerated wholesale by `bun run build` from `templates/hooks/pretooluse/` — never hand-edited. |
| `package.json` `version` | BLOCKING (release gate) | `V-PLUGIN-01` — Task 12. |

9 non-transparent rows.

## Execution Strategy & Stop Conditions

- Task 1 (fixture fix) MUST land and be verified before Task 9 (guard wiring) starts. If Task 9 is implemented against the unmodified `/fake/path` fixture, the #870 defer test silently flips from testing defer to testing stay-active (`V-TEST-11`); if that ordering is violated, halt implementation and restart from Task 1.
- If the extended `extractCommandPath` regex fails to resolve a script path for any of blackhole's own three shipped hook commands (the Bash matcher, the Write\|Edit matcher, and any future `.mjs`-suffixed addition) when self-tested against blackhole's own compiled `plugins/blackhole-claude/hooks/hooks.json`, abort Task 5 and revise the regex before continuing — a helper that cannot parse blackhole's own manifest cannot be trusted against mercure's.
- If `isPluginHealthy` throws an uncaught exception in any of its own unit tests instead of returning `false`, stop and wrap the missing branch in try/catch before proceeding — constraint 5's fail-closed discipline is unconditional, not best-effort.
- If `bun run scripts/plan-quality-gate.ts` (this plan, Step 8) reports any `false` value, halt and revise this plan document before requesting approval — never proceed to implement on a blocked plan-quality verdict.
- If the live `package.json` version at implement time is not strictly greater than what `git show origin/main:package.json` reports at that same moment, abort the version-bump task and re-read origin/main before retrying — never reuse a value computed at plan time (this session's own prior incident: a rebase silently voided an earlier same-value bump).
- Watch for intermittent failures in the two hook validator test files' subprocess harness (`runPreToolUseHook` spawns a real `bun run` subprocess per test); if a newly added test fails on 3 consecutive local runs with no code change in between, halt and treat it as a fixture race (e.g. a tempdir collision) rather than retrying indefinitely — fix the fixture's isolation before re-running.

## Task Breakdown

- [ ] **Task 1 — TDD Baseline Verification**: On `plan_base_commit` (`104fd5f6`), run
      `bun test scripts/hooks-validate-bash.test.ts scripts/hooks-validate-file.test.ts scripts/hook-sources.test.ts scripts/plugin-drift.test.ts scripts/lib/test-fixtures.test.ts`
      once, before touching any file. — **AC**: pass/fail counts for each file quoted verbatim
      in the completion evidence; all green (this is the pre-existing baseline the rest of this
      plan modifies).

- [ ] **Task 2 — Extend `writeInstalledPlugins` with a healthy-mode option (fixture fix, sequenced early per binding constraint 3)**:
      In `scripts/lib/test-fixtures.ts`, extend `writeInstalledPlugins(claudeHome, pluginKeys, opts?)`
      to accept an options bag whose `healthy` flag, when `true`, creates a real per-plugin
      `installPath` directory (a subdirectory under `claudeHome`, never the literal string
      `/fake/path`) containing `hooks/hooks.json` (a valid `{"hooks":{"PreToolUse":[...]}}`
      manifest with one `Bash`-matcher entry whose command references
      `${CLAUDE_PLUGIN_ROOT}/hooks/validate-bash-command.js`) plus that referenced script file,
      written non-empty. When `opts` is omitted or `healthy` is `false`/absent, the function's
      behavior must be byte-for-byte identical to today (`installPath: '/fake/path'`, no files
      written to disk) — every existing non-#870 call site must be unaffected. — **AC**: a new
      test in `scripts/lib/test-fixtures.test.ts` asserts both modes directly: (a) the default
      call still produces `installPath: '/fake/path'` with `fs.existsSync('/fake/path')` false
      and no `hooks.json` anywhere under the fixture's `claudeHome`; (b) `{ healthy: true }`
      produces an `installPath` whose `hooks/hooks.json` parses, whose referenced script resolves
      via `fs.statSync`, and whose script file size is `> 0`.

- [ ] **Task 3 — Write failing unit tests for the shared `installed-plugin-rows.js` helper (RED)**:
      Create `scripts/hooks-sibling-plugin-health.test.ts` and write failing tests (module does
      not exist yet) for two functions to be exported from
      `templates/hooks/pretooluse/utils/installed-plugin-rows.js`:
      `selectCandidateInstalledPluginRows(rows, repoRoot)` — returns every row where
      `row.scope === 'user'` or (`row.scope === 'project'` and `row.projectPath === repoRoot`),
      mirroring `scripts/lib/hook-sources.ts`'s existing inline filter (`enumeratePluginCacheSources`,
      currently lines ~99-101) verbatim; and `extractCommandPath(command)` — same two-pattern
      (quoted-path, bare-path) extraction as `hook-sources.ts`'s current private function, extended
      to accept `.mjs` in both patterns' extension alternation (currently `sh|js|ts`, must become
      `sh|js|ts|mjs`) alongside the existing three. — **AC**: `bun test scripts/hooks-sibling-plugin-health.test.ts`
      fails with "Cannot find module" (module absent), quoted in the completion evidence, before
      Task 4 creates the file.

- [ ] **Task 4 — Implement `installed-plugin-rows.js` (GREEN)**: Create
      `templates/hooks/pretooluse/utils/installed-plugin-rows.js` (CommonJS, no dependencies
      beyond string/array primitives) implementing both functions from Task 3, including at
      least one test case per extension (`.sh`, `.js`, `.ts`, `.mjs`) in both the quoted and bare
      command-string shapes, and at least one multi-row case (a `user`-scope row plus a
      `project`-scope row with a non-matching `projectPath`) proving only the matching rows are
      returned. — **AC**: `bun test scripts/hooks-sibling-plugin-health.test.ts` passes; the
      Execution Strategy's self-test against blackhole's own compiled
      `plugins/blackhole-claude/hooks/hooks.json` resolves both shipped script paths correctly
      (quoted in the completion evidence).

- [ ] **Task 5 — Refactor `scripts/lib/hook-sources.ts` to import the shared helper (binding constraints 2 and 4)**:
      Delete `hook-sources.ts`'s private `extractCommandPath` function (currently lines ~140-146)
      and its inline candidate-row filter (currently inside `enumeratePluginCacheSources`, lines
      ~99-101). Import both from
      `templates/hooks/pretooluse/utils/installed-plugin-rows.js` via
      `require(path.join(root, 'templates', 'hooks', 'pretooluse', 'utils', 'installed-plugin-rows.js'))`
      (using the existing `root` export from `./build/paths.ts`, mirroring the
      `require(path.join(PRETOOLUSE_HOOKS_DIR, 'utils', '<file>.js'))` interop precedent already
      used in `scripts/hooks-validate-bash.test.ts:2789`), and call the imported functions in
      place of the deleted local definitions. Do not change `enumeratePluginCacheSources`'s
      external behavior — it must still report every candidate row without adjudicating
      precedence between them (this file's own documented "Assumption A-1 ... this function
      never adjudicates it" contract is unchanged). — **AC**: `bun test scripts/hook-sources.test.ts scripts/plugin-drift.test.ts`
      passes with zero test-file edits (both quoted in the completion evidence) — a purely
      internal refactor, `HookSource`/`enumerateHookSources`'s public contract unchanged.

- [ ] **Task 6 — Write failing unit tests for `sibling-plugin-health.js` (RED)**: Add to
      `scripts/hooks-sibling-plugin-health.test.ts` failing tests (module does not exist yet)
      for `isPluginHealthy(installPath): boolean`, covering every fail-closed branch required by
      binding constraint 5: (a) `installPath` missing/non-string → `false`; (b)
      `<installPath>/hooks/hooks.json` absent → `false`; (c) `hooks.json` present but malformed
      JSON → `false`; (d) `hooks.json` parses but `hooks.PreToolUse` is absent or an empty array
      → `false`; (e) a `PreToolUse` entry's `command` does not yield an extractable script path →
      `false`; (f) the resolved script path does not exist on disk → `false`; (g) the resolved
      script exists but is zero bytes → `false`; (h) every resolved script exists and is
      non-empty → `true`. — **AC**: `bun test scripts/hooks-sibling-plugin-health.test.ts` fails
      on every one of (a)-(h) with "Cannot find module" or an assertion failure (module absent),
      quoted in the completion evidence, before Task 7 creates the file.

- [ ] **Task 7 — Implement `sibling-plugin-health.js` (GREEN)**: Create
      `templates/hooks/pretooluse/utils/sibling-plugin-health.js` exporting
      `isPluginHealthy(installPath): boolean` per the design note's Component Decomposition:
      read `<installPath>/hooks/hooks.json`, parse it, substitute `${CLAUDE_PLUGIN_ROOT}` →
      `installPath` in every `PreToolUse` entry's `command` string, extract each resulting
      script path via `installed-plugin-rows.js`'s `extractCommandPath`, and return `true` only
      when at least one script path was extracted and every extracted path
      `fs.statSync`s to a regular file with `size > 0`; every other path (per Task 6's list)
      returns `false`, wrapped in try/catch so no branch can throw uncaught. — **AC**: `bun test scripts/hooks-sibling-plugin-health.test.ts`
      passes all 8 cases from Task 6.

- [ ] **Task 8 — Wire the health leg into `sibling-plugin-guard.js`**: In `shouldDeferToMercure`,
      after the existing registration check (a matching `mercure*` key exists) and BEFORE the
      config-presence check, insert: (1) move the existing `mainCloneRoot(cwd)` call earlier
      (it is needed here to filter candidate rows by `projectPath`, not only later for the
      config-presence check — behaviorally equivalent reordering: every path in this function is
      an AND-composed short-circuit returning `false` on any failure, so moving a failure-capable
      step earlier changes no observable outcome, only which check reports first); (2) collect
      every `installed_plugins.json` row under every key whose `@`-split first segment is
      `mercure`; (3) filter via `selectCandidateInstalledPluginRows(rows, mainClone)`; (4) from
      the candidates, prefer a `scope === 'project'` row (already `projectPath`-matched by the
      filter) over a `scope === 'user'` row, else `false` if no candidate exists (binding
      constraint 4); (5) call `isPluginHealthy(installPath)` on the preferred row's `installPath`
      — a non-string `installPath` or `isPluginHealthy` returning `false` means `shouldDeferToMercure`
      returns `false` (binding constraint 5). Update the module docstring (lines 5-17, 24-26) to
      describe the four-condition contract, and add one sentence stating explicitly what this
      check does and does not detect (binding constraint 1's scope language, matching this
      plan's Objective). — **AC**: with Task 2's fixture in default (non-healthy) mode, the
      existing #870 "defer" test in `scripts/hooks-validate-bash.test.ts` (`~3634`) and
      `scripts/hooks-validate-file.test.ts` (`~1288`) now FAILS (tier flips from `defer` to
      `block`) — run and quote this RED result before Task 9 fixes the test itself.

- [ ] **Task 9 — Re-verify #870 defer tests red-before-green against the new fixture; add health-specific regression tests (GREEN, binding constraint 3's mandatory re-verification)**:
      Update the one breaking assertion in each of `scripts/hooks-validate-bash.test.ts` (`~3634`)
      and `scripts/hooks-validate-file.test.ts` (`~1288`) to call `writeInstalledPlugins(claudeHome, ['mercure@some-marketplace'], { healthy: true })`
      instead of the current call, so the test again exercises a genuinely healthy install.
      Add two new `describe` blocks (one per file, "sibling mercure health check (#969)"),
      covering: (i) mercure registered, healthy install, no `.blackhole/config.json` → defer
      (tier `defer`) — new positive case distinct from the updated #870 test; (ii) mercure
      registered, `installPath`'s `hooks.json` absent, no config → stay-active (`rm -rf /`
      still blocks); (iii) `hooks.json` present but malformed JSON → stay-active; (iv)
      `hooks.json` present, referenced script missing on disk → stay-active; (v) `hooks.json`
      present, referenced script exists but zero-length → stay-active; (vi) two candidate rows
      (a `user`-scope row pointing at an unhealthy install and a `project`-scope row — matching
      the test repo's own root — pointing at a healthy install) → defer, proving the
      project-scope row is preferred and the stale user-scope row is not read (binding
      constraint 4 regression guard). — **AC**: re-run the exact #870 defer test from Task 8 —
      now GREEN (quote this result alongside Task 8's RED result, both in the completion
      evidence); all 6 new cases (i)-(vi) pass; `bun test scripts/hooks-validate-bash.test.ts scripts/hooks-validate-file.test.ts`
      fully green.

- [ ] **Task 10 — Update docs (`README.md`, `hook-schemas.md`) with the 4-condition contract and the scope-of-claim caveat**:
      In `templates/hooks/pretooluse/README.md` § "Sibling mercure defer (issue #870)", add the
      health condition as a 4th numbered condition in the existing "when (1)...(2)...(3)..."
      list, remove the "Health-based ... — issue #969" line from the "Two follow-ups are logged"
      list (issue #969 is now resolved, not outstanding), and add one explicit sentence stating
      this check does not detect the ADR-030/#800 stale-script-content class (binding constraint
      1). Apply the mirrored update to `src/references/hook-schemas.md`'s `defer`-tier paragraph
      (currently line ~122). — **AC**: `grep -c "issue #969" templates/hooks/pretooluse/README.md`
      returns `0` in the "follow-ups" context (the health-based bullet is gone; a reference to
      #969 elsewhere, e.g. crediting the change, is fine); both files' updated prose is
      grep-verified to contain a sentence with "#800" or "stale" adjacent to "does not" or "not
      detect" (the scope caveat is present, not merely implied).

- [ ] **Task 11 — Bump `package.json` version (`V-PLUGIN-01`)**: This diff touches
      `templates/hooks/pretooluse/**`. At implement time, read `git show origin/main:package.json`
      live and set `package.json`'s `version` to a value strictly greater (semver) than whatever
      that live read returns — never the value recorded in this plan document (0.21.12 as read
      at plan time; do not hard-code this number into the implementation). — **AC**: at the
      moment of the implementation commit, `node -e "console.log(require('./package.json').version)"`
      on the working tree is strictly greater, per semver comparison, than
      `git show origin/main:package.json | node -e "..."` run in the same moment — verify both
      immediately before committing, not earlier in the session.

- [ ] **Task 12 — Rebuild dist trees and run full verification**: Run `bun run build` (regenerates
      `.claude/hooks/`, `.agents/build/hooks/`, `plugins/*/hooks/`, etc. from
      `templates/hooks/pretooluse/`), then `bun run verify`, then the full scoped test set
      (`bun test scripts/hooks-validate-bash.test.ts scripts/hooks-validate-file.test.ts scripts/hook-sources.test.ts scripts/plugin-drift.test.ts scripts/lib/test-fixtures.test.ts scripts/hooks-sibling-plugin-health.test.ts`),
      each wrapped per the resource policy (`free -m` check before starting;
      `flock /tmp/blackhole-verify.lock -c '<command>'`). — **AC**: `bun run build` produces a
      clean `git status --porcelain` diff scoped to Touch-Paths only (no unexpected drift in
      generated trees beyond the hooks tree); `bun run verify` exits `0`; the full scoped test
      set is green; all four outputs quoted in the completion evidence.

## Sprint Contract

Each task above carries its own measurable AC; this restates the acceptance bar in one place
rather than substituting for it. Definition of done for this plan: Tasks 1-9 establish and prove
the health-check behavior end-to-end (TDD red/green at each layer, red-before-green
re-verification of every pre-existing #870 assertion per binding constraint 3); Task 10 keeps
every prose surface honest about what the change closes (binding constraint 1); Task 11 satisfies
the release gate (`V-PLUGIN-01`); Task 12 is the final "all tests and linters pass" bar for the
diff as a whole. No task in this plan has an AC narrower than what is stated above — none falls
back to the blanket phrasing.

## Quality Gate Results

| Check | Result |
|---|---|
| `touch_paths_declared` | PASS |
| `schema_baseline` | PASS — N/A, no schema/API change (see Database/API Schema Changes) |
| `ac_mapping` | PASS |
| `critical_files_exist` | PASS |
| `mitigation_concrete` | PASS |
| `ac_sweep_conflict` | PASS — no sweep-to-zero AC in this plan |
| `ac_sweep_scope` | PASS — no sweep-to-zero AC in this plan |
| `touch_paths_ssot_gap` | PASS |
