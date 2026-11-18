---
type: plan
summary: "Add a Doc carry row to the campaign status Run section showing artifacts promised vs staged vs carried, so a silent manifest stop shows as staged 0 against promised above 0"
status: current
review_trigger: "on file change"
created: 2026-11-18
last_updated: 2026-11-18
---

# Plan: doc_carry status line, artifacts promised vs staged vs carried (issue #1297)

## Objective
Add one `Doc carry` row to the campaign status Run section so a silent stop like #1278 (no manifest written for weeks) shows as `staged 0` against `promised > 0`. Reuse `collectDocCarry` (`scripts/lib/route-artifacts.ts`) and the V-AUTO-03 helpers `latestRoute`/`promisedRoutes`/`dispatchGaps`; no new manifest reader or validator (V-INT-02).

## Design decisions (80/20)
- **"Per wave" = campaign total plus the per-issue gaps.** Neither the manifest nor the queue records a wave per artifact, so a per-wave split would need new state. The row shows one campaign total and names up to 3 issues whose promised routes are not all staged, which is the actionable part.
- **Scope of counted issues**: every non-done queue issue with a route, plus done issues that have a manifest. Legacy merged issues with no manifest are excluded, so pre-#1278 history cannot pin the line at `staged 0` forever.
- **Units**: `promised` = routes the route promised (`promisedRoutes`, including `plan`); `staged` = promised routes with a valid manifest entry (`promised - dispatchGaps`, the same test the dispatch gate runs); `carried` = staged `new_file` targets that exist under the repo root (`collectDocCarry(manifest, isCarried).carried`). `carried` counts documents, so it can exceed `staged` on a design issue; the row labels it plainly and the plan does not hide that.
- **Placement**: a 4th key of the existing `run` dataset (`RUN_ROW_KEYS`), so the text dashboard, `--html` and the `run` JSON dataset all print it from one `runRows` call. The HTML template already draws `run` (`data-source="run"`, generic key/value list), so no template panel or `bh-template-version` change is needed. V-CONFIG-03 (`status-coverage.check.ts`) needs only: dataset in `STATUS_DATASET_IDS` (yes), drawn by a panel (yes), row key present in `PANEL_ROW_KEYS.run` (derived from `RUN_ROW_KEYS`, so adding the key satisfies it).
- **Coverage registration**: `docs_governance` already owns the `config` row `Docs governance`, and a block may appear once, so the new row is a sub-block row, as the section allows: `docs_governance.write_governance | run | Doc carry`. That key is a registered field (config-template.md line 52), so `isRegistered` passes.
- **Gate**: same as `scripts/route-artifacts.ts`: `docs_governance.enabled !== true` or `write_governance === false` renders `off (docs governance off)`; the gate is evaluated by the I/O reader, the pure builder takes `enabled`.

## UI Interpretation Gate
ui_gate: approved (approved_by: orchestrator (autonomy full; owner asleep)). The route flagged `ui: true` (confidence 60, size s); the surface is one text line in the existing Run section.

### Owner said
"The campaign status render shows a `doc_carry` line: per wave or campaign, the count of artifacts that routes promised, that were staged under `.blackhole/staged/<issue>/manifest.json`, and that were carried into `documentation/`. A silent stop like #1278's (no manifest written for weeks) then shows as staged=0 against promised>0."

### I interpreted
One row appended to `### Run`, campaign-level (the data has no wave), gaps named per issue:

```
### Run
- **Run route:** pattern C · host claude · state branch · questions ask-decision · forge rest
- **Sleep mode:** on · 2 parked decisions
- **Coordination:** solo
- **Doc carry:** promised 6 · staged 4 · carried 1 · gaps: #1297 0/2, #1303 1/3
```
Other states: `Doc carry: promised 0 · staged 0 · carried 0` (nothing routed), `Doc carry: off (docs governance off)`, `Doc carry: unreadable (<reason>)` when a manifest is malformed. Gaps list omitted when every promised route is staged; more than 3 gaps end with `+N more`.

### Open ambiguities
Wave breakdown deferred (no wave field on manifests); revisit only if the owner wants per-wave history.

## Touch-Paths
- `scripts/lib/campaign-status/run-state.ts` (`RUN_ROW_KEYS` 4th key; pure `buildDocCarry`; `runRows` value)
- `scripts/lib/campaign-status/types.ts` (`RunPanel.doc_carry`)
- `scripts/lib/campaign-status/report.ts` (pass `docCarry` input into `buildRunPanel`)
- `scripts/campaign-status.ts` (I/O: read manifests, call `collectDocCarry`, build input)
- `scripts/lib/campaign-status/run-state.test.ts`, `scripts/lib/campaign-status/dashboard.test.ts`, `scripts/lib/campaign-status/data.test.ts` (row count/keys), `scripts/checks/status-coverage.check.test.ts` if present
- `src/references/config-template.md` (§ Status page coverage: add the `docs_governance.write_governance` row)
- `src/references/coordinator-dashboard.md` (line ~117: list the 4th Run row)
- plus all generated dist trees per `scripts/lib/build/targets.ts`

## Documentation Impact
`src/references/config-template.md` (coverage row) and `src/references/coordinator-dashboard.md` (Run row list) are updated in the same PR; no other doc restates `RUN_ROW_KEYS`.

## Task Steps (red first)
1. Tests first (all fail on main): in `run-state.test.ts` add `buildDocCarry` cases and update the row-key tests to expect `[...RUN_ROW_KEYS]` with `'Doc carry'` last; in `dashboard.test.ts` assert `renderRunSection` prints a `- **Doc carry:**` line; in `data.test.ts` assert the `run` dataset has 4 rows. Run each focused spec once and confirm red.
2. `run-state.ts`: add `'Doc carry'` to `RUN_ROW_KEYS`; add pure `buildDocCarry({ enabled, issues: [{ issue, promised, manifest }], isCarried })` returning `{ promised, staged, carried, gaps: [{issue, staged, promised}] } | null` (null when disabled), using `dispatchGaps` and `collectDocCarry`; add the value to `runRows`.
3. `types.ts` + `report.ts`: `RunPanel.doc_carry` (`null` = off, plus `doc_carry_error: string | null`); `StatusReportInput.docCarry`.
4. `campaign-status.ts`: read the gate from `config.docs_governance`, iterate `queue.issues` per the scope rule above, `latestRoute`/`promisedRoutes`/`loadManifest` per issue, `isCarried = (t) => fs.existsSync(path.join(repoRoot, t))`, wrap in try/catch to the `unreadable` state.
5. Docs: coverage row in `config-template.md`; list the 4th row in `coordinator-dashboard.md`.
6. `bun run build` regenerates dist trees (implementer, via with-test-lock); push and let CI run `bun run verify`.

## Task Breakdown / Acceptance Criteria
- T1 tests - **AC**: `bun test scripts/lib/campaign-status/run-state.test.ts` fails before T2 and passes after; cases: disabled gives null/`off`; no routed issues gives `promised 0 · staged 0 · carried 0`; plan+design promised with only plan staged gives `promised 2 · staged 1` and gap `#N 1/2`; `isCarried` stub true for one target gives `carried 1`; done issue without manifest is excluded; done issue with manifest is included; 4 gaps print 3 plus `+1 more`.
- T2 run-state - **AC**: `RUN_ROW_KEYS` equals `['Run route','Sleep mode','Coordination','Doc carry']` and `runRows` emits exactly those keys for any input; `buildDocCarry` imports `collectDocCarry` and `dispatchGaps` from `route-artifacts.ts` (no reimplementation: `grep -n "validateEntries" scripts/lib/campaign-status/` returns nothing).
- T3 wiring - **AC**: `bun run scripts/campaign-status.ts` (text mode, against this repo's `.blackhole`) prints a `- **Doc carry:**` line under `### Run`; a campaign with `docs_governance.enabled` absent prints `off (docs governance off)`.
- T4 V-CONFIG-03 - **AC**: `findStatusCoverageGaps(config-template.md, templates/status-dashboard/index.html)` returns `[]` (focused: `bun test scripts/checks/status-coverage.check.test.ts`, or `bun run verify` in CI); the new row names `Doc carry`, which is in `PANEL_ROW_KEYS.run`.
- T5 docs - **AC**: `grep -c "Doc carry" src/references/config-template.md src/references/coordinator-dashboard.md` is >= 1 in each; `bun run build` exits 0 and no generated tree is stale (`bun run verify` green in CI).

## Test Strategy
TDD, red first (T1). Pure builder is unit-tested with in-memory manifests and an `isCarried` stub, no filesystem; one wiring test in `data.test.ts` covers the `run` dataset. Per ci-first-verification run only the focused specs locally through `with-test-lock`; the full suite and `bun run verify` run in CI.

## Track / Classification
Quick; feature; size s; `route.ui: true` gate approved above; no security surface (read-only reads of `.blackhole`), `route.security_review_required` not set.

## Pareto
Gain 6, Effort 3, Priority = 6 x 8 = 48 (>= 30).

## Hot files
`src/references/config-template.md`, status renderer (`scripts/lib/campaign-status/run-state.ts`, `dashboard.ts` untouched). Not touched: `blackhole-vcodes.md`, `facts.ts`, `phase-implement.md`.
