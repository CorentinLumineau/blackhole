---
type: plan
summary: "Catchup-mode M1 plan: warn once when the running blackhole plugin is older than the newest installed or cached version (#1271), and add the missing Sleep row to launch-gate.md"
status: current
review_trigger: "on milestone completion"
created: 2026-11-17
last_updated: 2026-11-17
plan_base_commit: 13d217f5
related:
  - documentation/milestones/_active/catchup-mode/README.md
  - documentation/milestones/_active/catchup-mode/discovery.md
  - documentation/decisions/ADR-054-catchup-mode-quota-pacing.md
---

# M1: Bootstrap version check and launch-gate doc completeness

Track: standard. Branch: `design/catchup-mode` (shared, already checked out). Estimate: about 3 hours
including the doc edits and one `bun run build`.

## Objective

Fix GitHub #1271. A project-scope plugin pin can leave `/blackhole run` (and later `catchup`) on an
older blackhole than the one installed elsewhere on the machine, which hides new launch-gate
features without any signal. After this milestone:

1. The bootstrap prints one explicit `warn:` line when the running plugin version is older than the
   newest version found in the `installed_plugins.json` rows for `blackhole@blackhole-marketplace`
   or in the version-named directories of the marketplace cache.
2. The launch summary (`bun run status --summary`, text and `--json`) carries the same warning
   line, so the gate shows it even in print-only mode.
3. `src/references/launch-gate.md` lists all eight rows `buildLaunchSummary` builds, including the
   display-only Sleep row.

Out of scope: auto-updating the plugin, editing `~/.claude` files, blocking the launch on a stale
version (the warning is advisory; exit codes do not change), the doctor check
`checkPluginVersionDrift` (vendored copy vs installed, a different concern).

## Assumptions (recorded, no interactive channel)

| # | Assumption | Consequence if wrong |
|---|-----------|----------------------|
| A1 | "Running version" is the version of the plugin tree the script itself runs from (`.claude-plugin/plugin.json`, else `package.json`), the value `readPluginVersion()` already returns for the status page | The warning could miss a case where agent prompts load from a different copy than scripts; the doctor drift check already covers vendored copies |
| A2 | "Marketplace cache" means `~/.claude/plugins/cache/blackhole-marketplace/blackhole/<version>/` (the layout `plugin-drift.ts` documents); only directory names that parse as `N.N.N` count | A cache layout change makes the cache source silently empty; `installed_plugins.json` rows still work |
| A3 | `~/.claude` is resolved with `os.homedir()` like `plugin-drift-signal.ts`; no new env override | Tests override `HOME` |
| A4 | Any scope and any `projectPath` row counts as "available": the plugin is installed on this machine at that version, which is exactly the version a user expects to be running | A row for a deleted worktree could trigger a false warning; accepted ("prefer false positives", ADR-044 bias) |
| A5 | A running version that is unknown or newer than every candidate yields no warning | Dev checkouts ahead of the marketplace stay quiet |
| A6 | The warning is one line, advisory, never a `missing:` entry and never an exit-code change | Matches the usage-probe precedent in `run-context.md` |

## Task Breakdown

Every task is test-first: write the failing test, see it fail, then write the code. Run each test
file alone through `with-test-lock` (`bun test <file>`); never the full suite.

### T1. Version comparison core in `scripts/lib/plugin-drift.ts` (RED then GREEN)

Add to `scripts/lib/plugin-drift.ts` (fs-only imports, so `status` and `run-context` do not pull
`hook-sources.ts`'s CJS `require`):

- `PLUGIN_MARKETPLACE = 'blackhole-marketplace'` (exported; `plugin-drift-signal.ts` imports it in place of its private `MARKETPLACE_NAME`).
- `InstalledPluginRow` type and `readInstalledPluginRows(readFile, installedPluginsPath, pluginKey)`: returns every row under the key, `[]` when the file is absent, unreadable, malformed or the key is missing. `hook-sources.ts` `enumeratePluginCacheSources` calls it instead of its inline `readJson<InstalledPluginsFile>` (V-INT-02: one reader of that file's rows).
- `parseVersion(v): [number, number, number] | null` (leading `N.N.N`; anything else is `null`) and `compareVersions(a, b): number`.
- `checkPluginVersion(running, candidates): PluginVersionCheck` where `candidates` is `{version, source}[]` and the result is `{running, newest, newest_source, behind}`. Pure.
- `pluginVersionWarning(check): string | null`: one line, no newline, names both versions and the source, and the remedy (update the project-scope pin or run `/plugin update blackhole@blackhole-marketplace`, then restart). `null` when not behind.
- `listCachedVersions(cacheDir, listDir)`: directory names that parse as versions.
- `readPluginVersionCheck({ running, homeDir, pluginName })`: the thin real-fs shell composing the three readers.
- `readPluginVersion(pluginRoot)` moved here from `scripts/campaign-status.ts` (required `pluginRoot` argument; its only callers are `campaign-status.ts` and, after T3, `run-context.ts`).

Tests (extend `scripts/plugin-drift.test.ts`; extend `scripts/hook-sources.test.ts` for the reader):

| Case | Expected |
|------|----------|
| `0.9.0` vs `0.10.0` | `compareVersions` negative (numeric, not lexical) |
| running `0.28.0`, row `0.29.0` | `behind: true`, `newest: '0.29.0'`, `newest_source` names `installed_plugins.json` |
| running `0.28.0`, only a cache dir `0.29.0` | `behind: true`, source names the plugin cache |
| running equal to newest, or newer | `behind: false`, `pluginVersionWarning` is `null` |
| running `null` | `behind: false` |
| cache dir `fd30cee3ecd5`, row with non-string version | ignored, no throw |
| `installed_plugins.json` absent, malformed JSON, key missing | `[]`, no throw |
| project-scope row for another `projectPath` | counted as a candidate |
| `readPluginVersionCheck` against a temp `HOME` holding a row and a cache dir | `behind: true` end to end |
| existing `hook-sources.test.ts` suite | passes unchanged (behaviour-preserving extraction) |

Acceptance: `bun test scripts/plugin-drift.test.ts scripts/hook-sources.test.ts` exits 0 with the
new cases listed above present and passing; `git grep -n "installed_plugins.json" scripts/lib/hook-sources.ts`
no longer shows an inline `readJson<InstalledPluginsFile>` call for the plugin rows.

### T2. Launch summary warning line (`launch-summary.ts` and `campaign-status.ts`)

Depends on T1.

- `renderLaunchSummary(rows, warnings: string[] = [])` in `scripts/lib/campaign-status/launch-summary.ts` prints each warning as a `> ` blockquote line directly under `## Launch summary` and before the table. With no warnings the output is byte-identical to today.
- `printLaunchSummary` in `scripts/campaign-status.ts` builds the warnings with `readPluginVersionCheck` + `pluginVersionWarning` (running version from the moved `readPluginVersion`, plugin name from `projectIdentity.name`), passes them to `renderLaunchSummary`, and adds `warnings: string[]` to the `--json` output beside `rows` and `cards`.
- `gateCards` is untouched: a warning is never a question and never a row, so `LAUNCH_ROW_KEYS` stays at eight and the committed fixture `fixtures/campaign-status/full/launch-summary.expected.md` is unchanged.

Tests:

- `scripts/lib/campaign-status/launch-summary.test.ts`: the existing "renders the committed expected markdown" test still passes unchanged; a new test asserts `renderLaunchSummary(rows, ['W1'])` equals the heading, a blank line, `> W1`, a blank line, then the table; two warnings render two lines in order.
- `scripts/campaign-status.test.ts` (`status --summary` block): add an `env` option to the local `summary` helper; with `HOME` set to a temp dir whose `installed_plugins.json` carries a `blackhole@blackhole-marketplace` row at `999.0.0`, stdout contains `> ` followed by the warning and `--json` has `warnings.length === 1`; with a row at `0.0.1`, `warnings` is `[]` and stdout has no `> ` line. Rename the stale test title "prints the seven-row table" to "eight-row" and add `Sleep mode` to its label list (scout fix inside the touched block).

Acceptance: `bun test scripts/lib/campaign-status/launch-summary.test.ts scripts/campaign-status.test.ts`
exits 0; `LAUNCH_ROW_KEYS` length is still 8 (asserted by the existing test); the stale-version
case prints exactly one warning line.

### T3. Bootstrap `warn:` line in `scripts/run-context.ts`

Depends on T1. Independent of T2; run after it (one test process at a time).

- After the route warnings, when `behind` is true, print `  warn: <pluginVersionWarning text>` (same prefix style as the existing `warn:` lines).
- Add `plugin: {running, newest, behind}` to the record written to `run-context.json` (new key; no existing key changes).
- Exit codes unchanged: a stale plugin never adds a `missing:` entry (A6). `--no-write` still prints the line.

Tests (extend `scripts/run-context.test.ts` CLI block; temp `HOME` through the `env` argument of the
existing `run` helper):

- stale row (`999.0.0`): stdout contains `warn: ` plus both versions, exit code 0, `run-context.json` has `plugin.behind === true`.
- no newer row: no `plugin` warning line, `plugin.behind === false`, exit code unchanged from the pre-change baseline test.
- the existing three CLI tests and the `usage_budget wiring` block pass unchanged.

Acceptance: `bun test scripts/run-context.test.ts` exits 0; `bun test scripts/lib/run-context.test.ts`
exits 0 untouched (the routing module is not modified).

### T4. Docs: `launch-gate.md` Sleep row and the version warning

Depends on T2 and T3 (documents their behaviour).

Edit `src/` only:

- `src/references/launch-gate.md`:
  - Add `| Sleep mode | Display only: sleep mode on or off; while on the whole gate is print-only |` to the Adjust rows table (rows then match the eight `LAUNCH_ROW_KEYS`; the `Order` and `Peers` rows keep their wording).
  - Bootstrap order step 1: after "Resolve the run context", say a `warn:` line about an older plugin version is part of the run-context output and must be restated verbatim, never dropped.
  - § The summary: say the summary carries the same version warning as a `> ` line under the heading, in every mode including print-only, and that it does not become a question.
  - Keep every marker in `LAUNCH_GATE_REQUIRED_MARKERS` (`status --summary`, `Accept / Adjust`, `status-probe.ts record`, `last_probe`, `Print-only mode`, `never waits`).
- `src/references/run-context.md`: add the plugin-version `warn:` line and the `plugin` record key next to the existing usage-probe and sleep notes (one sentence each, no restated rationale).
- `src/references/coordinator-dashboard.md` § Launch summary: add the warning line and the `--json` `warnings` key to the flag list.
- Then `bun run build`.

Acceptance (all measurable):

- `rg -c "^\| (Scope|Order|Merge|Budget|Status page|Kaizen and staging|Peers|Sleep mode) \|" src/references/launch-gate.md` returns 8.
- The V-CONFGATE-01 check still passes, run through the narrow `scripts/verify.config-gate.test.ts` (not the full verify).
- `bun run build` exits 0 and `git status --short` shows only the `src/` edits, the rebuilt outputs and the files named in this plan.
- No new file under `documentation/` other than this plan; the INDEX row for it is added in T5.

### T5. Index row, commit

Splice the `milestones/_active/catchup-mode/milestone-1.md` row into `documentation/INDEX.md`
(regenerate with `bun run scripts/generate-doc-index.ts`, copy only the new row, never overwrite
the file), then confirm `bun run scripts/generate-doc-index.ts --check` exits 0. Commit with
explicit paths (never `git add -A`):

`fix(plugin-version): warn when the running plugin is older than an installed version`

with a body referencing `#1271`. No AI attribution lines. Run the Scout Check on the diff and record
one Improvement Record (the stale test title in T2 is the planned one).

Acceptance: `generate-doc-index.ts --check` exits 0; one commit on `design/catchup-mode`; `git show --stat`
lists only planned paths.

## Critical Files

| File | Change | Why |
|------|--------|-----|
| `scripts/lib/plugin-drift.ts` | add version comparison, row reader, warning text, moved `readPluginVersion` | Single home for plugin-version evidence, fs-only imports |
| `scripts/lib/hook-sources.ts` | call `readInstalledPluginRows` | V-INT-02: one reader of the installed rows |
| `scripts/plugin-drift-signal.ts` | import `PLUGIN_MARKETPLACE` | Remove the duplicate constant |
| `scripts/lib/campaign-status/launch-summary.ts` | `renderLaunchSummary` takes warnings | Summary warning line |
| `scripts/campaign-status.ts` | build warnings in `printLaunchSummary`, `--json` `warnings`, drop local `readPluginVersion` | I/O shell of the summary |
| `scripts/run-context.ts` | print `warn:` line, record `plugin` | Bootstrap warning before the gate |
| `src/references/launch-gate.md` | Sleep row, warning handling | Doc completeness (#1271) |
| `src/references/run-context.md`, `src/references/coordinator-dashboard.md` | one sentence each | Keep the documented CLI output true |
| `scripts/plugin-drift.test.ts`, `scripts/hook-sources.test.ts`, `scripts/lib/campaign-status/launch-summary.test.ts`, `scripts/campaign-status.test.ts`, `scripts/run-context.test.ts` | new cases | Test-first evidence |
| `documentation/INDEX.md` | one row | Doc governance |

Not touched: `scripts/lib/run-context.ts` (routing stays pure and fixture-tested),
`scripts/lib/campaign-status/types.ts` (`LAUNCH_ROW_KEYS` stays eight), `scripts/doctor.ts`
(its own `CLAUDE_PLUGIN_KEY` constant is a scout candidate for a later change, not this diff),
`templates/hooks/**`.

## Codebase Conventions

| Touchpoint | Convention | Source | Required by |
|------------|------------|--------|-------------|
| Installed plugin rows | One reader of `installed_plugins.json` rows; candidate filtering stays in `selectCandidateInstalledPluginRows` (shipped CJS). The version check reads all rows under the key, so it adds the reader, not a second filter | `scripts/lib/hook-sources.ts:112-147`, `templates/hooks/pretooluse/utils/installed-plugin-rows.js:27` | V-INT-02 |
| Injected-fs idiom | Pure functions take `readFile`/`listDir` callbacks; a thin shell binds real fs; tests use temp dirs or stubs | `scripts/lib/plugin-drift.ts` (path injection), `scripts/lib/hook-sources.ts:73-76` | V-INT-01 |
| Running plugin version | `.claude-plugin/plugin.json`, else `package.json` | `scripts/campaign-status.ts:130-140` (moved, not reimplemented) | V-INT-02 |
| Plugin identity | `projectIdentity.name` plus the marketplace name builds the `name@marketplace` key | `scripts/plugin-drift-signal.ts:171`, `scripts/project-identity.ts` | V-INT-01 |
| Bootstrap output | `  warn: <text>` lines after the route summary; warnings never change the exit code | `scripts/run-context.ts:123-126` | V-INT-01 |
| Summary rendering | `renderLaunchSummary` is the text the gate prints verbatim; rows come from `LAUNCH_ROW_KEYS` and a display-only row has `adjustable: false` | `scripts/lib/campaign-status/launch-summary.ts:207-227` | V-INT-01 |
| Machine output | `--json` stays a single JSON document; new key is additive | `scripts/campaign-status.ts:294-297` | V-INT-03 |
| Fixture stability | The committed expected markdown must stay byte-identical when there is no warning | `fixtures/campaign-status/full/launch-summary.expected.md` | V-INT-01 |
| CLI tests | `spawnSync('bun', ['run', cli])` with a bare env plus explicit `HOME`; pure-lib tests import the module | `scripts/run-context.test.ts:9-12`, `scripts/campaign-status.test.ts:885` | V-INT-01 |
| Build | Edit `src/`, then `bun run build`; never hand-edit built output | `.claude/CLAUDE.md`, discovery block | V-INT-02 |
| Doc gate markers | `LAUNCH_GATE_REQUIRED_MARKERS` must all stay present in `launch-gate.md` | `scripts/checks/config-gate.check.ts:27-34` | V-CONFGATE-01 |
| Doc governance | Frontmatter with `summary` on every new doc; INDEX row spliced, `--check` verified | `documentation/INDEX.md`, `scripts/generate-doc-index.ts` | V-DOC-GOV-02 |

## Dependency Blast-Radius

| Changed file | Downstream consumers | Blast radius |
|--------------|----------------------|--------------|
| `scripts/lib/plugin-drift.ts` | `scripts/plugin-drift-signal.ts`, `scripts/plugin-drift.test.ts`, new importers `campaign-status.ts`, `run-context.ts`, `hook-sources.ts` | MEDIUM |
| `scripts/lib/hook-sources.ts` | `scripts/plugin-drift-signal.ts`, `scripts/hook-sources.test.ts` | LOW |
| `scripts/lib/campaign-status/launch-summary.ts` | `scripts/campaign-status.ts`, `launch-summary.test.ts`, the committed fixture | LOW (default argument keeps output identical) |
| `scripts/campaign-status.ts` | `bun run status` in every mode, the launch gate | MEDIUM (it is the CLI every orchestrator turn runs) |
| `scripts/run-context.ts` | Every bootstrap and resume | LOW (additive line and key) |

Overall blast radius: LOW to MEDIUM. The two MEDIUM entries are guarded by tests that exercise the
unchanged paths (existing fixture test, existing CLI tests).

## Blast Radius

| Surface | Outside the diff | Why it matters |
|---------|------------------|----------------|
| Callers | `readPluginVersion` is called only at `scripts/campaign-status.ts:208`; `renderLaunchSummary` only at `scripts/campaign-status.ts:298` and its own test | The moved function and the new optional argument have no hidden caller |
| Consumers | Agents read `bun run status --summary` output and `--json` `{rows, cards}` through `launch-gate.md`; a new `warnings` key and a `> ` line are additive | A consumer that destructures strictly would ignore the extra key |
| Config | none: no `config.json` key, no env var | No `config-template.md` row (V-CONFIG-02) needed |
| Data | `run-context.json` gains `plugin`; `status` reads `route.question_channel` and `context.host` only | Additive key |
| CI | `verify` checks V-CONFGATE-01 (doc markers), the doc INDEX check, V-ARGV-01 (no new CLI, none added) | Run in CI after push, not locally |

**Safety fact**: no code outside the planned files depends on the moved or extended symbols, proven
by the Grep for `readPluginVersion` over `scripts/` and `src/`, which returned only
`scripts/campaign-status.ts:130` and `:208`, and the Grep for `renderLaunchSummary|enumerateHookSources`,
which returned only `campaign-status.ts`, `launch-summary.ts`, their tests and `hook-sources` consumers
already listed. T1 repeats the same two searches with `git grep -n` before the move and quotes the
output in the commit evidence.

## Risk Assessment

| Risk | Severity | Mitigation |
|------|----------|------------|
| `status` breaks in an installed plugin because of a new transitive import | MEDIUM | `plugin-drift.ts` keeps fs-only imports; `hook-sources.ts` (CJS `require`) is not imported by `campaign-status.ts` or `run-context.ts` |
| False positive from a stale row for a deleted worktree | LOW | Accepted (A4); the line is advisory and names its source |
| Version parsing rejects a suffix such as `0.30.0-rc1` | LOW | Only the leading `N.N.N` is compared; a non-parseable string is ignored, never thrown |
| Existing CLI tests read the real `~/.claude` and now see a warning | LOW | They parse JSON or check labels, so an extra line or key does not break them; new tests pin `HOME` |

No HIGH-risk item, so no `## Stop Conditions` section.

## Execution Strategy

**Pattern**: Sequential on the shared branch (one test process at a time; the workstation rules
forbid parallel test runs). T3 could run beside T2 in principle; it is serialized.

| Agent | Task(s) | Model | Delegation Contract |
|-------|---------|-------|---------------------|
| x-implementer (or the main session) | T1 | sonnet | **Objective**: the version core with its tests first. **Output format**: edited `plugin-drift.ts`, `hook-sources.ts`, `plugin-drift-signal.ts`, two test files, test output quoted. **Scope**: those five files only. **Tool guidance**: `with-test-lock bun test scripts/plugin-drift.test.ts scripts/hook-sources.test.ts`; no full suite. **Stop condition**: new and existing cases green. |
| x-implementer | T2 | sonnet | **Objective**: summary warning line and `--json` `warnings`. **Output format**: edited `launch-summary.ts`, `campaign-status.ts` and two test files. **Scope**: those four files. **Tool guidance**: `with-test-lock bun test` on the two named files. **Stop condition**: fixture test unchanged and green, stale and clean CLI cases green. |
| x-implementer | T3 | sonnet | **Objective**: bootstrap `warn:` line and `plugin` record key. **Output format**: edited `run-context.ts` and `run-context.test.ts`. **Scope**: those two files. **Tool guidance**: `with-test-lock bun test scripts/run-context.test.ts`. **Stop condition**: new cases green, existing cases untouched. |
| x-implementer | T4 | sonnet | **Objective**: the three `src/references` edits, then build. **Output format**: edited docs, `bun run build` output quoted. **Scope**: the three reference files plus built outputs. **Tool guidance**: edit `src/` only; `with-test-lock bun run build`; focused `verify.config-gate` test. **Stop condition**: eight table rows counted, build exits 0. |
| main session | T5 | sonnet | **Objective**: INDEX row and commit. **Output format**: one commit. **Scope**: `documentation/INDEX.md` plus the planned paths, explicit `git add`. **Tool guidance**: `generate-doc-index.ts --check`. **Stop condition**: check exits 0, `git show --stat` lists only planned paths. |

**Parallelization**: none (T1, then T2, T3, T4, T5 in order). CI runs the full suite after the push;
nothing local goes beyond the named focused files.

## Sprint Contract

### Machine-verifiable

- [ ] `with-test-lock bun test scripts/plugin-drift.test.ts scripts/hook-sources.test.ts` exits 0, new cases present.
- [ ] `with-test-lock bun test scripts/lib/campaign-status/launch-summary.test.ts scripts/campaign-status.test.ts` exits 0; the committed `launch-summary.expected.md` is unchanged.
- [ ] `with-test-lock bun test scripts/run-context.test.ts scripts/lib/run-context.test.ts` exits 0.
- [ ] `rg -c "^\| (Scope|Order|Merge|Budget|Status page|Kaizen and staging|Peers|Sleep mode) \|" src/references/launch-gate.md` returns 8.
- [ ] `with-test-lock bun run build` exits 0; the V-CONFGATE-01 focused test passes.
- [ ] `bun run scripts/generate-doc-index.ts --check` exits 0.
- [ ] With a stale row at `999.0.0` in a temp `HOME`, `bun run scripts/campaign-status.ts --summary --no-gh` prints exactly one `> ` warning line naming both versions.

### Human-verifiable

- [ ] Reading the warning, an owner knows which version runs, which is newer, where the newer one was found and the one command that fixes it.
- [ ] `launch-gate.md` reads as describing the same eight sections the printed table shows.
- [ ] The commit body references #1271 and carries no AI attribution line.

## Plan Quality Gate

| Check | Result |
|-------|--------|
| 1 Task acceptance criteria (blocking) | Pass: every task states a measurable acceptance line |
| 2 Critical file existence | Pass: every modified file was read or listed; new test cases go in existing test files |
| 3 Dependency completeness | Pass: T1 then T2, T3 then T4 then T5; no cycle |
| 4 Risk mitigation | Pass: each risk names a concrete mitigation |
| 5 Success criteria measurability | Pass: commands with expected results |
| 6 Boundary conditions (advisory) | Covered in T1 table: absent, malformed, missing key, non-version dirs, equal and newer |
| 7 Stop conditions (advisory) | N/A: no HIGH risk |
| 8 Codebase conventions (blocking) | Pass: section populated at the touchpoints |

Marker count: 0 `[NEEDS CLARIFICATION]`.
