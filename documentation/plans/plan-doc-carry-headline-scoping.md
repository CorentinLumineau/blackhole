---
type: plan
summary: "Scope the Doc carry headline and unrouted count to issues past handle, name unrouted issues, fix a stale Scope comment and scope two label tests to the Scope section"
status: current
review_trigger: "on file change"
created: 2026-11-18
last_updated: 2026-11-18
---
# Plan: Doc carry headline scoping (issue #1311)

## Objective
The Doc carry row counts handle-phase routes (staged 0 is expected there) and handle-phase unrouted issues, so it reads as missing work that is not missing (live: promised 27 / staged 9 / unrouted 10; past-handle truth 9/9, unrouted #1246 and #1252). Count promised, staged, carried and unrouted only for issues past `handle` (plan/implement/review; handle-phase routes are not shown), and name unrouted issues the way gaps are named. Plus two folded-in items from PR #1313's review: the stale `types.ts` comment and two weak label assertions.

## Touch-Paths
- `scripts/lib/campaign-status/run-state.ts` (`buildDocCarry` ~l.34-56: skip handle-phase live issues for promised/staged/carried/unrouted; `unrouted` becomes the issue list; `docCarryValue` ~l.123 prints `unrouted #A, #B`)
- `scripts/lib/campaign-status/types.ts` (`DocCarry.unrouted` ~l.528 `number` -> `number[]`; l.359 comment)
- `scripts/lib/campaign-status/run-state.test.ts` (pinned tests ~l.152 and ~l.174-177)
- `scripts/lib/campaign-status/doc-carry.test.ts` (~l.47-69 row expectation)
- `scripts/lib/campaign-status/html.test.ts` (~l.129 label assertions)
- `scripts/lib/campaign-status/campaign-dashboard.test.ts` (~l.166-168 label assertions)
- `scripts/campaign-status.ts` only if the unrouted push at ~l.255 needs no change (expected untouched: it already carries `phase` via `base`)
- Not touched: `doctor.ts`, `src/references/*`, `blackhole-vcodes.md`, `facts.ts` (#1268 in flight). No `src/**` edits, so no generated-tree rebuild.

## Documentation Impact
None - status-dashboard behavior only; no companion doc restates the Doc carry row format (implementer greps `documentation/` and `src/references/status-page.md` for "routes promised" and updates in place if found).

## Task Steps
1. RED first: update the tests (below) to the new behavior and run only `run-state.test.ts`, `doc-carry.test.ts`, `html.test.ts`, `campaign-dashboard.test.ts` through `with-test-lock`; confirm failures.
2. `run-state.ts`: in the live-issue loop, `if ((GAP_PHASE_RANK[i.phase ?? ''] ?? 0) === 0) continue;` after the `done` and `unreadable` handling and before the `unrouted` and promised accumulation (so handle issues add nothing to promised/staged/carried/unrouted); `out.unrouted.push(i.issue)`; init `unrouted: []`; the gap rank test at the end of the loop can then drop its own phase check.
3. `docCarryValue`: `if (d.unrouted.length) parts.push(\`unrouted ${d.unrouted.slice(0, DOC_CARRY_GAPS_SHOWN).map((n) => \`#${n}\`).join(', ')}${more}\`)` reusing the `+N more` idiom already used for gaps (no new helper beyond a shared local).
4. `types.ts`: `unrouted: number[]`; fix the l.359 comment to "`recorded: false` when `config.json` has none; surfaces then print the shared label from `scope-label.ts`".
5. Scope the label assertions: in `html.test.ts` and `campaign-dashboard.test.ts` slice the rendered output to the Scope section (from `<h2>Scope` to the next `<h2>` in HTML; the Scope heading block in text) before `toContain(label)`.
6. Greens: rerun the four test files plus `bun run lint`/typecheck on the touched files; CI runs the full suite (ci-first-verification).

## Task Breakdown / Acceptance Criteria
- T1 headline scope - **AC**: `run-state.test.ts` case "a handle-phase issue ..." asserts `buildDocCarry` over one handle issue with `['plan']` and no manifest yields `promised: 0, staged: 0` and the row `routes promised 0 · staged 0 · docs carried 0`; fails before the change (was `promised 1`), passes after.
- T2 live mix - **AC**: a test with one handle issue (2 routes, no manifest) and one implement issue (1 route staged) yields `promised: 1, staged: 1`; the `merged issues ... history` test and the implement-gap test (`#7 1/2`) still pass unchanged.
- T3 unrouted named - **AC**: `run-state.test.ts` ~l.174: given `live(1,..,'implement',{unrouted:true})` and `live(2,..,'handle',{unrouted:true})`, `dc.unrouted` equals `[1]` and the row is `routes promised 0 · staged 0 · docs carried 0 · unrouted #1`; a review-phase pair yields `unrouted #2, #1` order-stable by issue number (descending, same as gaps) or ascending as chosen, asserted exactly.
- T4 end-to-end row - **AC**: `doc-carry.test.ts` expectation becomes `routes promised 4 · staged 3 · docs carried 2 · unrouted #5 · unreadable 1 · gaps: #4 1/2 · history: 1/2 routes staged` (handle #3 dropped from promised; unrouted #5 named); passes.
- T5 stale comment - **AC**: `grep -n "Scope not recorded" scripts/lib/campaign-status/types.ts` returns no match.
- T6 scoped label tests (V-TEST-05) - **AC**: the label assertions in `html.test.ts` and `campaign-dashboard.test.ts` operate on the Scope-section slice only; mutation check: temporarily blanking the Scope section's label while leaving the Config "Issue filter" row makes both tests fail (run once, then revert).
- T7 no collateral - **AC**: `git diff --name-only` lists only the Touch-Paths above; no `doctor.ts`, `src/**`, `blackhole-vcodes.md`, `facts.ts`.

## Test Strategy
Behavioral unit tests on the pure `buildDocCarry` and `docCarryValue` through their existing `build`/`rowOf` helpers (public seam), plus the collectStatusReport integration case in `doc-carry.test.ts`. Tests change first and go red (T1, T3, T4 fail on current code). Local runs: only the four named files via `with-test-lock`; the full suite runs in CI.

## Data-structure orientation
`DocCarry.unrouted` is consumed only at `run-state.ts` (`docCarryValue`) and populated in `buildDocCarry`; no other production call site (grep of `\.unrouted` over non-test `scripts/` shows only those). `GAP_PHASE_RANK` (`run-state.ts:26`) keys are phase names (plan/implement/review) with rank values; a missing key means `handle`/other, which this change treats as "not past handle".

## Track / Classification
Quick; `task_type: bugfix`; size xs; `route.ui` false (text/HTML status dashboard rows, no UI gate); no auth/data/endpoint (no threat screen needed).

## Pareto
Gain 5, Effort 2, Priority = 5 x 9 = 45 (>= 30).
