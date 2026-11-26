---
type: plan
summary: "Slice 2 of #1644: retire hook-event ingestion, V-HOOK-01..03, the deny-counts dashboard section, the plugin-drift signal and the guard workaround prose after ADR-065"
status: current
review_trigger: "on release"
created: 2026-11-26
last_updated: 2026-11-26
---

# Plan - Issue #1645

## Objective
Slice 2 of #1644 (owner decision 2026-11-26: no blocking PreToolUse guard anywhere; slice 1 merged as PR #1647, ADR-065). Remove everything that only existed to feed or work around those guards, so no reference to hook-event ingestion, `V-HOOK-01..03`, the deny-counts panel, the plugin-drift signal or the worker write-root workaround prose remains outside superseded/historical ADRs. Keep `V-PLUGIN-01` and `pluginVersionWarning`; keep `hook-events` in the state-branch `EXCLUDED_DIRS` (old installs still write it); keep legacy `V-HOOK` ledger rows valid. Pareto: Gain 5, Effort 4, Priority 5 x (11-4) = 35 (>= 30). PR closes #1645 and #1644.

## Touch-Paths
Edit `src/` and `scripts/` sources; regenerate built trees with ONE `bun run build` through `with-test-lock` (plus all generated dist trees per `scripts/lib/build/targets.ts`).

Delete:
- `scripts/lib/hook-event-triage.ts`, `scripts/lib/hook-event-triage.test.ts`
- `scripts/plugin-drift-signal.ts`, `scripts/plugin-drift-signal.test.ts`, `scripts/hook-sources.test.ts`
- `scripts/lib/hook-sources.ts`, `scripts/lib/hook-source-ordering.ts`
- `scripts/lib/campaign-status/deny-counts.ts`, `scripts/lib/campaign-status/deny-counts.test.ts`

Edit:
- `scripts/lib/plugin-drift.ts` (keep `pluginVersionWarning`, `checkPluginVersion`, `readPluginVersion*`, `compareVersions`, `parseVersion`, `listCachedVersions`, `readInstalledPluginRows`/`PLUGIN_MARKETPLACE` only if still consumed; drop `hashDirectory`, `computePluginDrift`, `writePluginDriftSignalAtomic`, `PluginDriftResult/Signal`), `scripts/plugin-drift.test.ts` (drop the removed-export suites)
- `scripts/campaign-status.ts` (drop `renderPluginDriftWarning`, drift JSON read, `collectDenyCounts`, `PluginDriftSignal` imports), `scripts/campaign-status.test.ts` (drop `renderPluginDriftWarning` suite)
- `scripts/lib/campaign-status/report.ts`, `data.ts`, `data-fixture.ts`, `html.ts`, `dashboard.ts`, `dashboard.test.ts`, `types.ts` (drop `DenyCount`, `deny_counts`, `denials`, `renderDenyCountsSection`, Hook denials section)
- `templates/status-dashboard/index.html` (drop the `cd-den-h` Hook denials panel and its script/CSS hooks)
- `scripts/lib/test-fixtures.ts` (drop `PRETOOLUSE_HOOKS_DIR`, `runPreToolUseHook`, `HookRunResult`, `NO_CLAUDE_HOME_SENTINEL`, `REBINDING_ROWS`, and `writeInstalledPlugins`/`readHookEvents` when grep shows no remaining consumer)
- `scripts/lib/build/facts.ts` (`VCODE_TABLE_ROW_COUNT`, re-derived), `scripts/lib/state-branch.test.ts` (drop the `plugin-drift.json` fixture line only; `state-branch.ts` `EXCLUDED_DIRS` keeps `hook-events`; drop `plugin-drift.json` from `MACHINE_FILES` only if the test and `state-branch.md` agree, else keep as inert)
- `scripts/checks/cwd-pin-guard.check.ts` (drop the `plugin-drift-signal.ts` target), `scripts/verify.cwd-pin-guard.test.ts` (swap the bare-invocation fixture to another listed target)
- `scripts/checks/v-test09-hooks-claim.check.ts`, `scripts/compute-body-hash.ts` (comment references only)
- `src/references/orchestrator-runtime.md` (Triage step 1b; turn-start steps 5 and 6; renumber), `src/references/phase-loop.md` (drift-scan sentence), `src/references/orchestrator-dispatch.md` (delete `## Implementer write-root containment` section)
- `src/references/blackhole-vcodes.md` (drop V-HOOK-01/02/03 rows and the sibling-plugin-defer note), `src/references/findings-ledger.md` (keep legacy-row validity note, drop writer reference), `src/references/hook-schemas.md` (replace the `hook-events` paragraph with a one-line historical note), `src/references/blackhole-state.md` (Plugin-Drift Signal section, guard-trust paragraphs, `plugin-drift.json`/`archive/hook-events-*` table rows), `src/references/state-branch.md`, `src/references/coordinator-dashboard.md`, `src/references/status-page.md`, `src/references/config-template.md` (remove `### Environment Variable Overrides`), `src/references/blackhole-protocol.md` (drop the link to the deleted hooks README), `src/references/gates/07-sensitive-filename-staging-gate.md` (drop `blockedSystemPaths`/`pathTraversal` clause), `src/references/audit-modules/29-plugin-cache-version-bump-audit.md`, `src/references/audit-modules/30-v-test09-hooks-claim-audit.md`, `src/agents/implementer.md`, `src/agents/orchestrator.md` (only if it cites the workaround)
- `ARCHITECTURE.md` (Active Constraints bullets for ADR-029/040/043/044/045 guards: worker write-containment, working-tree git guard, splitter quote policy, hook-source enumeration, `BLACKHOLE_ASSIGNED_WORKTREE`; keep the ADR-065 bullet and the `templates/hooks/**` version-bump bullet), `AGENTS.md`/`README.md` only where they cite a removed item
- `documentation/decisions/ADR-065-no-blocking-pretooluse-guards.md` (add `## Post-acceptance amendments`), ADR-041/042/044 (mark `superseded`, cite ADR-065) and `documentation/decisions/INDEX.md` rows to match

## Documentation Impact
`ARCHITECTURE.md` Active Constraints, ADR-065 amendment, ADR-041/042/044 superseded plus `documentation/decisions/INDEX.md`; `src/references/*` listed above; `documentation/INDEX.md` regenerates via `scripts/generate-doc-index.ts --write` (never hand-appended). No new `documentation/` file beyond the carried plan; search-before-write considered: the plan reuses the existing ADR-065 note instead of a new ADR.

## Critical Files
- `scripts/lib/build/facts.ts`
- `scripts/lib/campaign-status/types.ts`
- `scripts/lib/state-branch.ts`
- `src/references/blackhole-vcodes.md`
- `src/references/orchestrator-runtime.md`

## Codebase Conventions
- `src/` is the only editable source; built trees come from one `bun run build`, never hand-edited.
- V-code severity comes only from the `blackhole-vcodes.md` row; `VCODE_TABLE_ROW_COUNT` is read live (`parseVcodeTableRows`) and set to the live count after removal (currently 140 rows, 3 removed), never copied from this plan.
- CI verifies; locally run only the touched test files through `with-test-lock` after `MemAvailable >= 2500 MB`.
- Superseding an ADR: `status: superseded`, supersession citation in body, INDEX row status agrees (`V-ADR-01..04`); amendments go in `## Post-acceptance amendments` (V-ADR-06).
- Playbook prose cites scripts by source path, never package aliases (`V-INVOKE-01`); no issue numbers in source comments (`V-DOC-06`).
- ADR-065 removed the writers; `hook-schemas.md` already says the reader and V-HOOK codes are inert "until the follow-up slice of issue #1644" - this plan is that slice.

## Database/API Schema Changes
- Status report JSON (`--data`, `StatusReport`): `deny_counts` removed, and its `denials` projection in `data.ts`. Consumer: `templates/status-dashboard/index.html` only (same PR). Documented in `coordinator-dashboard.md` and `status-page.md`.
- `.blackhole/plugin-drift.json` is no longer written or read; a leftover file is inert.
- `findings-ledger.json` schema unchanged: existing `V-HOOK-01..03` rows and `occurrences` stay valid (`V-LEDGER-01` shape only); `scripts/validate`/`state-write-guard` do not enumerate V-codes, verified by grep at implement time.
- No queue schema change.

## Threat Model
| Category | Threat | Severity | Mitigation status |
|---|---|---|---|
| Spoofing | Forged `hook-events` file ingested as a finding | Low | Mitigated (the ingestion path is deleted) |
| Tampering | Worker writes outside its worktree or into campaign state with no hook deny | High | Accepted Risk (already accepted by ADR-065 residual-risk section; state-write-guard + review V-SCOPE-02) |
| Repudiation | Loss of the guard audit trail (hook-events, deny counts) | Low | Accepted Risk (nothing writes them after slice 1) |
| Information Disclosure | Sensitive file staging check weakened by editing gate 07 | Medium | Mitigated (only the `blockedSystemPaths`/`pathTraversal` words are removed; the `sensitiveFiles[]` read, V-SEC-11 and `V-HOOKPAT-01` are untouched) |
| Denial of Service | Orchestrator turn-start step removed incorrectly leaves a dangling reference | Low | Mitigated (AC greps for dangling step numbers) |
| Elevation of Privilege | Old installs keep blocking hooks; or removal of containment prose invites a worker to widen scope | Medium | Accepted Risk (ADR-065; README/release note, worktree-per-worker and V-SCOPE-02 remain) |

## UI Interpretation Gate

```
Status page, before                         Status page, after
+------------------------------+            +------------------------------+
| ... Pace / Run / Decisions   |            | ... Pace / Run / Decisions   |
| Hook denials (top 5 rules)   |   ---->    | (panel and section removed)  |
|   rm-rf  3 deny . 1 warn     |            | Plugin-drift line removed    |
| Plugin cache drift line      |            |                              |
+------------------------------+            +------------------------------+
Text dashboard: "### Hook denials" section removed; same for the HTML page and --data JSON.
```

### Owner said
"remove the blocking PreToolUse guards everywhere" (owner decision 2026-11-26 on #1644); issue #1645 work: "Retire hook-event ingestion ... and V-HOOK-01..03", "Remove the hook-source scan in plugin-drift if only the guards used it", "Remove the workaround prose".

### I interpreted
The status-page "Hook denials" panel and the plugin-drift warning line existed solely to surface guard output, so they go with the guards. No other panel, ordering or style changes. The version-mismatch warning (`pluginVersionWarning`, V-PLUGIN-01 companion) stays.

### Open ambiguities
None blocking. Router flagged `ui: true`; no size label is set, so the gate defaults to gated. Approval needed only to confirm the panel and drift line are removed, not hidden or kept as an empty "no denials" panel.

## Dependency Blast-Radius
| Consumer | Classification | Note | verification |
|---|---|---|---|
| `scripts/campaign-status.ts:16,41,138,212` | BREAKING | imports `collectDenyCounts`, drift types, reads `plugin-drift.json` | reasoned: grep-enumerated at plan time; implementer runs the campaign-status tests and typecheck after change |
| `scripts/lib/campaign-status/{report,data,html,dashboard}.ts` | BREAKING | consume `deny_counts` / `topDenyCounts` | reasoned: grep-enumerated; implementer runs dashboard/html tests |
| `scripts/lib/build/facts.ts:31`, `verify.ground-truth.test.ts:212` | BREAKING | row count must equal live table | reasoned: recomputed from live table at implement time |
| `scripts/checks/cwd-pin-guard.check.ts:21`, `verify.cwd-pin-guard.test.ts:62` | BREAKING | targets a deleted script | reasoned: grep; implementer runs both |
| `scripts/run-context.ts:10` | TRANSPARENT | uses kept `pluginVersionWarning` | reasoned: kept exports unchanged |

## Execution Strategy & Stop Conditions
- If `bun run scripts/checks/ground-truth.check.ts` reports a row-count mismatch after the V-HOOK rows are removed, then set `VCODE_TABLE_ROW_COUNT` to the live parsed count and re-run; if it still mismatches, stop and revert the vcodes edit.
- If any retained file still imports a deleted module (`bunx tsc --noEmit` or `git grep` finds `hook-event-triage`, `hook-sources`, `deny-counts` outside deleted files and superseded ADRs), then abort the deletion of that module and fix the importer first.
- If `bun run build` leaves a diff in a tree that `targets.ts` does not list, then halt and report instead of staging it.
- If removing a V-HOOK row makes `V-CITE-01` or `vcode-severity-sync` fail on a remaining citation, then rewrite that citation to the legacy-row wording rather than re-adding the row.
- If the full `bun run build` is needed more than once, stop after the second run and report; CI is the verifier.

## Task Breakdown
- [ ] **Baseline**: run the touched test files only (`scripts/campaign-status.test.ts`, `scripts/lib/campaign-status/dashboard.test.ts`, `scripts/plugin-drift.test.ts`, `scripts/lib/state-branch.test.ts`, `scripts/verify.cwd-pin-guard.test.ts`) via `with-test-lock`. — **AC**: pass counts quoted before any edit.
- [ ] **T1 Delete ingestion**: remove `hook-event-triage.ts` (+test), Triage step 1b and turn-start step 6 in `orchestrator-runtime.md`, renumber steps and fix cross-references. — **AC**: `git grep -nE "hook-event-triage|ingestHookEvents|hook ingestion" -- src scripts` returns nothing (scope: `src`, `scripts`; no exemptions).
- [ ] **T2 Retire V-HOOK-01..03**: remove the three rows and the sibling-plugin-defer note from `blackhole-vcodes.md`, set `VCODE_TABLE_ROW_COUNT` to the live parsed row count, keep `findings-ledger.md` legacy-row validity sentence. — **AC**: `bun run scripts/checks/ground-truth.check.ts` passes and `git grep -n "V-HOOK-0" -- src scripts` returns only the legacy-row note in `findings-ledger.md` and fixtures that prove legacy rows still validate.
- [ ] **T3 Delete deny-counts and the Hook denials section**: update `report/data/data-fixture/html/dashboard/types/campaign-status.ts`, the status template, `coordinator-dashboard.md`, `status-page.md`. — **AC**: `git grep -nE "deny_counts|DenyCount|denyCounts|Hook denials|cd-den-h" -- src scripts templates` returns nothing; `dashboard.test.ts` and `campaign-status.test.ts` pass.
- [ ] **T4 Delete plugin-drift signal**: remove `plugin-drift-signal.ts`, `hook-sources.ts`, `hook-source-ordering.ts` and tests; trim `lib/plugin-drift.ts` to the version-warning exports; drop `renderPluginDriftWarning`, turn-start step 5, `phase-loop.md` sentence, `blackhole-state.md` § Plugin-Drift Signal, `cwd-pin-guard` target; keep V-PLUGIN-01 and audit module 29 (reworded without the drift signal). — **AC**: `git grep -nE "plugin-drift-signal|hook-sources|hook-source-ordering|plugin-drift\.json|renderPluginDriftWarning" -- src scripts` returns nothing, `scripts/plugin-drift.test.ts` and `scripts/run-context` tests pass, `pluginVersionWarning` still exported and covered.
- [ ] **T5 Workaround prose**: delete `## Implementer write-root containment` in `orchestrator-dispatch.md`, the guard-trust paragraphs in `blackhole-state.md`, `BLACKHOLE_ASSIGNED_WORKTREE` everywhere, any cd-first state-write instruction, and `config-template.md` `### Environment Variable Overrides`. — **AC**: `git grep -nE "BLACKHOLE_ASSIGNED_WORKTREE|BLACKHOLE_HOOK_EVENT|write-root containment|trustedWriteRoots|cd-first" -- src scripts ARCHITECTURE.md AGENTS.md README.md` returns nothing.
- [ ] **T6 Slice-1 leftovers**: `test-fixtures.ts` cleanup, gate 07 clause, `blackhole-protocol.md` link, `implementer.md`/audit 30/`v-test09-hooks-claim.check.ts` wording, ARCHITECTURE.md guard Active Constraints. — **AC**: `git grep -nE "PRETOOLUSE_HOOKS_DIR|runPreToolUseHook|REBINDING_ROWS|blockedSystemPaths|pathTraversal|pretooluse/README" -- src scripts ARCHITECTURE.md` returns nothing and `ARCHITECTURE.md` keeps the ADR-065 bullet.
- [ ] **T7 ADR bookkeeping**: ADR-065 `## Post-acceptance amendments` entry (cites #1645, lists what slice 2 retired and what stays: V-PLUGIN-01, `hook-events` exclusion, legacy ledger rows); ADR-041/042/044 `status: superseded` with citation, INDEX rows agree. — **AC**: `bun run scripts/checks/adr-status.check.ts` and the adr-supersession check pass; `bun run scripts/generate-doc-index.ts --check` passes after `--write`.
- [ ] **T8 Build and verify**: one `bun run build` through `with-test-lock`, then the targeted tests listed above plus `bun run scripts/generate-doc-index.ts --check`; push and let CI run `bun run verify`. — **AC**: only generated trees listed in `targets.ts` changed; targeted tests green; CI `verify` job green on the pushed head (job status quoted).

## Sprint Contract
All task ACs above hold; the issue's own ACs are met: no hook-event-ingestion or V-HOOK reference remains outside superseded ADRs and the legacy-ledger note, and CI `bun run verify` is green. Out of scope: removing `hook-events` from `state-branch.ts` `EXCLUDED_DIRS`, removing `V-PLUGIN-01`, and any change to the SessionStart `BLACKHOLE_PLUGIN_ROOT` hook.

## Implementation Notes
Deviations from the plan as written, all inside the stated scope: ADR-029, ADR-040, ADR-043, ADR-045 and ADR-047 are superseded together with ADR-041/042/044 (each describes a retired guard, and their Active Constraints bullets were removed); `plugin-drift.json` also leaves `MACHINE_FILES` (the AC bars any `plugin-drift.json` reference), while `hook-events` stays in `EXCLUDED_DIRS`; `### Environment Variable Overrides` keeps its `BLACKHOLE_ARCHIVE_SNAPSHOT_RETENTION` row because `state-write-guard.ts` still reads it; the status template's `bh-template-version` moves 9 to 10; `VCODE_TABLE_ROW_COUNT` is 137; `check-utils.ts`'s declared consumer count is 96; the resume step in `orchestrator-runtime.md` is now step 5 (`stop-mode.check.ts` and `phase-stop.md` follow); `throw-in-trusted-roots.preload.ts` is deleted as a `trustedWriteRoots` leftover. `host.notes` stays in the report shape as an empty list so no consumer changes.

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
