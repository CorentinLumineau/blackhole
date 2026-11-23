---
type: plan
summary: "Pin expectLinearTime's 1 ms floor from both sides with an injected-clock test (issue 1376)"
status: current
review_trigger: "on file change"
created: 2026-11-23
last_updated: 2026-11-23
---

# Plan - Issue #1376

## Objective
Pin the 1 ms denominator floor of `expectLinearTime` (`scripts/lib/test-fixtures.ts:138`, `Math.max(tSmall, 1)`) from both sides. Today only the lower side is pinned (`test-fixtures.test.ts:207`: small 0.1, large 11 -> 11 < 12 passes; removing the floor gives 110 and goes red). Raising the floor to 2 leaves every injected-clock test green. Add one sibling test: small 0.1, large 13 must throw (13 / 1 = 13 >= 12), which fails if the floor is raised (13 / 2 = 6.5 passes).

Verified on main: floor expression at `test-fixtures.ts:138`; `fakeClock`/`measure` helpers and the existing floor test at `test-fixtures.test.ts:163-209`; `SMALL = 10`, factor 4. The new case reuses `measure(...)`, so no helper change. Constant cost per run makes `minMs` return the cost exactly, so the ratios are exact.

Priority = 3 x (11 - 1) = 30 (>= 30, passes V-PARETO-03). Test-only; F-00739/F-00740 stay in the ledger (out of scope).

## Touch-Paths
- `scripts/lib/test-fixtures.test.ts`

## Documentation Impact
None — test-only addition, no public API, companion or documentation change.

## Task Steps
1. Immediately after `'a sub-millisecond small run divides by the 1 ms floor'` (line 207) add:
   `test('a sub-millisecond small run still throws once the floor-divided ratio reaches the limit', () => { expect(measure((size) => (size === SMALL ? 0.1 : 13)).attempt).toThrow(/limit 12/); });`
   (title may be adjusted; assertion shape is fixed.)
2. Mutation check (read-only reasoning plus one scoped run): temporarily change `Math.max(tSmall, 1)` to `Math.max(tSmall, 2)` locally, confirm the new test goes red, revert. Do not commit the mutation.
3. Run only `bun test scripts/lib/test-fixtures.test.ts` through `with-test-lock` (CI runs the full suite).

## Task Breakdown
- [ ] **TDD Baseline**: run `bun test scripts/lib/test-fixtures.test.ts` through `with-test-lock`. — **AC**: all existing tests in the file pass, counts quoted.
- [ ] **Add floor-upper-side test**: add the case above, no source change to `test-fixtures.ts`. — **AC**: the new test passes on main's unmodified `Math.max(tSmall, 1)`; `git diff --name-only` lists only `scripts/lib/test-fixtures.test.ts`.
- [ ] **Mutation proof**: with the floor temporarily set to 2, the new test fails (red) and the existing floor test still passes; revert. — **AC**: quoted red output for the new test under the mutation, and `git diff` shows `scripts/lib/test-fixtures.ts` unchanged at commit time.
- [ ] **Verify**: file-scoped run green, changed file lint/typecheck clean; CI on the pushed head is the full-suite evidence. — **AC**: scoped run green and CI green on the PR head.

## Sprint Contract
Per-task ACs above are the contract; definition of done = new test green on unmodified source, red under floor = 2, only the one test file changed.

## Quality Gate Results
Quick track: `## Critical Files` and `## Execution Strategy & Stop Conditions` are not emitted, so `critical_files_exist` and `mitigation_concrete` are inert; the CLI is not required on Quick. Evaluated: `touch_paths_declared` PASS; `ac_mapping` verified by hand — every task carries `**AC**:` PASS. `touch_paths_ssot_gap`: PASS (single test file, no SSOT pair).
