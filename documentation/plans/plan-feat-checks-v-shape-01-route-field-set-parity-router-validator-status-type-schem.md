---
type: plan
status: current
review_trigger: "on ADR acceptance"
created: 2026-09-02
last_updated: 2026-09-02
related:
  - documentation/plans/plan-retrospective-v0.21.0-remediation.md
---

# Plan — V-SHAPE-01 Route Field-Set Parity

## Objective
Add `V-SHAPE-01`: a drift check that keeps the `route` object's field set consistent across
its four declaration sites — `router.ts`'s `requireField` calls (validator, the enforced
truth), `campaign-status/types.ts`'s `Route` type (a deliberately narrower consumer type),
`worker-schemas.md`'s Router example JSON (prose), and `queue-dag.md`'s `route` table (prose)
— closing the same defect class as ADR-012 F3b, where nothing today compares these four sides.

## Touch-Paths
- `scripts/checks/route-shape.check.ts` (new)
- `scripts/verify.route-shape.test.ts` (new)
- `scripts/lib/campaign-status/types.ts`
- `src/references/worker-schemas.md` — plus all generated dist trees per `scripts/lib/build/targets.ts`
- `src/references/queue-dag.md` — plus all generated dist trees per `scripts/lib/build/targets.ts`
- `src/references/blackhole-vcodes.md` — plus all generated dist trees per `scripts/lib/build/targets.ts`
- `scripts/lib/build/facts.ts`

## Documentation Impact
None — Touch-Paths are `src/references/*.md` build sources (compiled to dist trees on
`bun run build`, per Touch-Paths above) and `scripts/**`; no `documentation/` tree file is
created or edited by this change.

## Critical Files
- `scripts/lib/build/facts.ts` — hot file, wave-locked to one holder
  (`config.json` `wave_scheduling.hot_files_max_one_per_wave`); houses `VCODE_TABLE_ROW_COUNT`
  and `CONTENT_GATE_BUDGETS`, both touched by this issue.
- `src/references/blackhole-vcodes.md` — hot file, same wave lock; the V-code table this issue
  adds a row to.

## Codebase Conventions
Follow `scripts/checks/config-registration.check.ts` (67 LOC) as the closest existing pattern
for a "declared side vs. independent scan side" drift check with a parsed allowlist:
- A pure `parse*` function per input (here: `parseRequireFieldKeys(routerSrc)` for
  `router.ts`, `parseRouteTypeKeys(typesSrc)` for `types.ts`, `parseOmitsAllowlist(typesSrc)`
  for the header-comment allowlist) — same shape as `parseConfigTemplateKeys`.
- A pure `find*` diff function (`findRouteShapeDrift(routerKeys, typeKeys, omits)`) returning
  the undeclared symmetric difference — same shape as `findUnregisteredConfigKeys`.
- `runChecks(): CheckResult[]` exported at module bottom, using `CheckResult`/`read`/`root`
  from `./check-utils.ts` (never a duplicate wire type — `V-INT-02`).
- Test file mirrors `scripts/verify.config-registration.test.ts`'s four-`describe` shape: unit
  tests per pure function, a fixture-backed drift case under `scripts/fixtures/route-shape/`
  (mirrors `scripts/fixtures/config-registration/`), and a `runChecks()` live-tree assertion.
- V-code row and enforcement-site citation follow `scripts/checks/pareto-filing-gate.check.ts`'s
  row shape in `blackhole-vcodes.md` (bare `scripts/checks/<file>.check.ts` site, no `§` —
  `vcode-citation.check.ts`'s `sectionRef: null` path, no section-body check required).
- `VCODE_TABLE_ROW_COUNT` bump follows the existing single-line-comment-adjacent-value pattern
  in `facts.ts` (`export const VCODE_TABLE_ROW_COUNT = 89;` → `90`) — `EXPECTED_CHECK_COUNT` is
  retired (#704 merged as PR #733) and MUST NOT be bumped or referenced (orchestrator note R-05).

## Database/API Schema Changes
- `scripts/lib/campaign-status/types.ts` `Route` type: no field added or removed (all fields
  stay optional; consumer-facing shape is unchanged, so this is not a breaking API change).
  Only the header comment changes, from:
  `// Mirrors the `route` object SSOT ... this type must not rename or add fields.`
  to append a declared, check-parsed allowlist line, e.g.:
  `// omits: ui, needs_brainstorm, needs_analysis, docs_impact, confidence.brainstorm,
  confidence.ui — not read by campaign-status.ts's current consumers (V-SHAPE-01 declared
  narrowing).`
  The exact field list must match live drift at implement time (re-derive from `router.ts` vs
  `types.ts`, do not copy this plan's evidence numbers per Ground rule #7).
- `src/references/worker-schemas.md` § Router example JSON: add `"needs_brainstorm": false` and
  `"ui": false` to the `route` object, add `"brainstorm": 20, "ui": 85` to the nested
  `confidence` object (matching `queue-dag.md`'s existing example values), and add a
  `<!-- shape: exhaustive -->` marker comment immediately before the fenced JSON block.
- `src/references/queue-dag.md` § `route` object: the example JSON and field table are already
  exhaustive (verified at plan time — contains `needs_brainstorm`, `needs_analysis`,
  `docs_impact`, `ui`, and `confidence.{brainstorm,ui}`); only add the
  `<!-- shape: exhaustive -->` marker comment immediately before the fenced JSON block.
- `src/references/blackhole-vcodes.md`: new row —
  `| V-SHAPE-01 | route field-set parity — router.ts \`requireField\` keys vs.
  \`campaign-status/types.ts\` \`Route\` keys diverge without a declared \`omits:\` allowlist
  entry (undeclared drift); or a doc marked \`<!-- shape: exhaustive -->\` in
  \`worker-schemas.md\`/\`queue-dag.md\` omits a router-required field | WARN |
  scripts/checks/route-shape.check.ts |`
- `scripts/lib/build/facts.ts`: `VCODE_TABLE_ROW_COUNT` 89 → 90 (measured live at plan time:
  `grep -c '^| V-' src/references/blackhole-vcodes.md` returns 89 today across 89 data rows
  after the header separator; re-verify count at implement time before bumping — Ground rule
  #7). `CONTENT_GATE_BUDGETS` values are NOT raised (`worker-schemas.md` measured 940/950 LOC
  and its widest section 178/179 LOC at plan time — the Router section (56 LOC) is far from
  ceiling and the ~3-line JSON addition plus 1 marker line fits inside the file's 10-line
  headroom without raising the budget; re-measure at implement time before editing).

## Execution Strategy & Stop Conditions
- If re-measuring `src/references/blackhole-vcodes.md`'s `| V-` row count at implement time
  does not equal 89 (drifted since plan time), recompute the bumped `VCODE_TABLE_ROW_COUNT`
  from the fresh count + 1, not from this plan's stated 89 → 90.
- If re-measuring `worker-schemas.md`'s total LOC or its Router-section LOC at implement time
  shows less than 5 lines of headroom against `CONTENT_GATE_BUDGETS['src/references/worker-schemas.md']`,
  halt and file a Stage 2 follow-up issue for the `worker-schemas.md` edit instead of adding the
  fields — per the issue's own "Stage 2 same issue if cheap, else file a follow-up" scope
  clause; do not raise the budget to make it fit.
- If `#704` (retiring `EXPECTED_CHECK_COUNT`) has NOT merged by implement time (contrary to this
  plan's orchestrator-note assumption that PR #733 already merged it), then `EXPECTED_CHECK_COUNT`
  in `facts.ts` still exists and MUST also be bumped by 1 for the new check module — verify with
  `grep -n EXPECTED_CHECK_COUNT scripts/lib/build/facts.ts` before writing the check, and update
  this task's AC accordingly if the grep returns a match.
- If `bun test scripts/verify.route-shape.test.ts` fails after implementation, do not adjust the
  test to match broken behavior — fix `route-shape.check.ts` until the fixture-backed drift
  cases and the live-tree case both pass, per `V-TEST-10` (never loosen an assertion with no
  stated reason).

## Task Breakdown
- [ ] **TDD Baseline Verification**: Run `bun test scripts/verify.route-shape.test.ts` before
  the file exists (expect a module-not-found failure) to confirm no stale artifact is already
  present. — **AC**: command output shows the test file does not yet resolve, or does not
  exist, confirming a clean starting state.
- [ ] **Write Failing Tests First**: Author `scripts/verify.route-shape.test.ts` mirroring
  `scripts/verify.config-registration.test.ts`'s shape — unit tests for
  `parseRequireFieldKeys`, `parseRouteTypeKeys`, `parseOmitsAllowlist`,
  `findRouteShapeDrift`, plus fixture-backed drift cases under
  `scripts/fixtures/route-shape/` (one fixture pair per drift direction: a `types.ts` key
  present but absent from `router.ts`'s required fields with no allowlist entry; a
  `router.ts`-required field absent from `types.ts` with no allowlist entry), before
  `route-shape.check.ts` exists. — **AC**: `bun test scripts/verify.route-shape.test.ts` fails
  with import/module-resolution errors (the check module doesn't exist yet), not assertion
  failures.
- [ ] **Implement `route-shape.check.ts`**: Implement `parseRequireFieldKeys`,
  `parseRouteTypeKeys`, `parseOmitsAllowlist`, `findRouteShapeDrift`, and
  `runChecks(): CheckResult[]` returning a single `V-SHAPE-01` result, restricted to the
  Touch-Paths above. — **AC**: `bun test scripts/verify.route-shape.test.ts` passes (all unit
  tests, both fixture drift cases, and the live-tree `runChecks()` assertion green).
- [ ] **Add the declared `omits:` allowlist to `types.ts`**: append the allowlist line to the
  `Route` type's header comment per § Database/API Schema Changes, re-deriving the exact field
  list from a fresh `router.ts` vs `types.ts` diff at implement time. — **AC**: `bun test
  scripts/verify.route-shape.test.ts`'s `runChecks()` live-tree case reports `V-SHAPE-01: ok:
  true` (no undeclared drift against the live `router.ts`/`types.ts` pair).
- [ ] **Stage 2 — `worker-schemas.md` and `queue-dag.md` exhaustive markers**: add the four
  missing example fields to `worker-schemas.md`'s Router JSON and the `<!-- shape: exhaustive
  -->` marker to both files per § Database/API Schema Changes, subject to the headroom stop
  condition above. — **AC**: `grep -c 'shape: exhaustive' src/references/worker-schemas.md
  src/references/queue-dag.md` returns 1 for each file, and `grep -c '"needs_brainstorm"\|"ui"'
  src/references/worker-schemas.md` shows the Router example section now contains both fields
  (manual diff read, since grep alone can't disambiguate sections — verify by eye against the
  `## Router` heading span).
- [ ] **V-code row + counter bump**: add the `V-SHAPE-01` row to `blackhole-vcodes.md` per
  § Database/API Schema Changes and bump `VCODE_TABLE_ROW_COUNT` in `facts.ts` to match the
  fresh row count. — **AC**: `bun test scripts/verify.ground-truth.test.ts` (or the equivalent
  `V-GROUND-01` check invocation covering `VCODE_TABLE_ROW_COUNT`) passes, and `bun test
  scripts/verify.vcode-citation.test.ts` (or `vcode-citation.check.ts`'s `runChecks()`) resolves
  the new row's `Primary enforcement site` cell without a `V-CITE-01`/`V-CITE-02` failure.
- [ ] **Build + full verify**: run `bun run build` (regenerates dist trees for the three
  `src/references/*.md` edits, per V-BUILD-01), commit source + regenerated trees together,
  then run `bun run verify`. — **AC**: `bun run build` exits 0 with no diff-producing drift on
  a second run, and `bun run verify` reports all checks passing including the new
  `route-shape.check.ts` module (auto-discovered — no registration edit needed).

## Sprint Contract
Every task above carries its own `— **AC**:` marker; there is no task relying on the blanket
"all tests and linters pass" fallback. Definition of done for this issue: `bun test
scripts/verify.route-shape.test.ts` green, `bun run build` idempotent, `bun run verify` green,
and the six Touch-Paths files present in the diff with no file outside that list touched.

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
