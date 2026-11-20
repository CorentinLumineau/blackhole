---
type: plan
summary: "Harden expectLinearTime: injectable clock seam, tests pinning the default limit, floor and retry path, a decisive quadratic reject, and factor-3 headroom for the PATH_MAX-bounded call (issue #1369)"
status: current
review_trigger: "on file change"
created: 2026-11-20
last_updated: 2026-11-20
related: [documentation/plans/plan-ratio-based-linearity-tests.md]
---

# Plan: harden expectLinearTime (issue #1369)

## Objective

Make the `expectLinearTime` tests able to fail and the factor-2 call robust: (a) re-size the one factor-2 call in `scripts/hooks-bash-write-options.test.ts` so its limit has real headroom over linear and stays below quadratic; (b) pin the default `maxRatio = 12`, the 1 ms floor and the retry branch with tests driven by an injected clock, adding the smallest clock seam to the helper; (c) make the quadratic reject test decisive (ratio far above 12). No wall-clock-budget assertion is reintroduced: every new assertion is on a ratio, computed from a fake clock or from a real-clock ratio with a >= 2x margin.

## Touch-Paths

- `scripts/lib/test-fixtures.ts` (helper edit: optional clock seam, default = real clock, existing callers unchanged)
- `scripts/lib/test-fixtures.test.ts`
- `scripts/hooks-bash-write-options.test.ts` (the single `expectLinearTime` call near line 291 and its comment)
- `documentation/plans/plan-expect-linear-time-hardening.md` (this plan, carried by the implementer)

Out: `templates/hooks/**`, every other `hooks-*.test.ts`, `.blackhole/**`.

## Documentation Impact

None - test-only change plus an optional parameter on a test helper; the helper's JSDoc is updated in place.

## Decisions

1. Headroom for the factor-2 call (item a). The issue suggests `maxRatio: 4`. Rejected: at factor 2 a linear function measures about 2 and a quadratic one about 4, so a limit of 4 equals the quadratic ideal and the test could no longer reliably fail on the regression it exists for (V-TEST-11). Chosen: factor 3, `maxRatio: 6`. Linear ideal 3 (100% headroom, versus 200% on the default 4 -> 12), quadratic ideal 9 (50% above the limit, versus 33% on the default). Depth is bounded by PATH_MAX, so the small size becomes `Math.floor(depth / 3)` and the large size is at most `depth`. Assumption: factor 3 keeps `build(3n)` within the 3,800 character cap the test already uses. Alternative if the implementer measures flake: raise factor is impossible (PATH_MAX), so stop and report rather than raising `maxRatio` toward 9.
2. Clock seam (item b). `expectLinearTime` has no clock seam, so this edits the helper, not only tests. Smallest change: `minMs(run, runs = 3, now = () => performance.now())` and a new optional `now?: () => number` option on `expectLinearTime` forwarded to both `minMs` calls. Default is the real clock; no existing caller passes it, so behaviour is unchanged for them (verified by the untouched real-clock tests still passing).
3. The two real-clock accept tests run under the 1 ms floor and cannot fail. Replace them with injected-clock accept tests (below); keep one real-clock test, the quadratic reject, as the wiring check that the default clock is actually used.

## Task Steps

1. Add the `now` seam in `scripts/lib/test-fixtures.ts` as described in Decision 2; update the `expectLinearTime` JSDoc by one sentence about the injectable clock (no issue numbers). **AC**: `bun test scripts/lib/test-fixtures.test.ts` exits 0 with 0 failures (the existing real-clock reject test still passes unchanged, proving the default clock path); `grep -n "now" scripts/lib/test-fixtures.ts` shows the default `() => performance.now()`.
2. In `scripts/lib/test-fixtures.test.ts` add a fake-clock helper local to the describe block: `let t = 0; const now = () => t;` and runs that advance `t` by a chosen virtual cost (`run: (size) => { t += cost(size); }`). Replace the two real-clock accept tests with these injected-clock tests; each states its mutation:
   - `default limit is 12: ratio 11.9 passes, 12.1 throws`: small cost 10 virtual ms, large 119 passes; large 121 throws matching `/limit 12/`. **Red when**: the default `maxRatio = 12` becomes 8 (the 11.9 case throws) or 16 (the 12.1 case passes).
   - `ratio exactly at the limit fails`: small 10, large 120 throws. **Red when**: `ratio < maxRatio` becomes `<=`.
   - `retry passes after a spiked first pair`: large input costs 500 on the first `runs + 1` calls (warm-up plus runs of the first measurement) and 40 afterwards, small costs 10. Expect no throw, and assert the large input was measured exactly `2 * (runs + 1)` times. **Red when**: the retry branch is removed (helper throws after the first pair) or the second pair is never re-measured.
   - `fails when both pairs spike`: large costs 500 on every call; throws matching `/retry .*limit 12/`. **Red when**: the second check returns unconditionally (retry always forgives).
   - `a sub-millisecond small run divides by the 1 ms floor`: small 0.1, large 11 passes (11 / 1 = 11 < 12). **Red when**: the `Math.max(tSmall, 1)` floor is removed (ratio 110).
   - `a linear function passes with the injected clock`: cost proportional to size at factor 4 (ratio 4) passes. **Red when**: any mutation making the measured ratio exceed 12, e.g. timing the large input `factor^2` times; kept as the positive control for the cases above.
   **AC**: `bun test scripts/lib/test-fixtures.test.ts` exits 0; every new test name above is present in the output; no new test uses `performance.now`, `Date.now` or a millisecond `toBeLessThan`.
3. Make the quadratic reject decisive: keep one real-clock test, now with `factor: 8` and the spin constant calibrated so the large run is at least 50 ms (starting point `spin(size * size * 8_000)` at `n: 10`; implementer calibrates once). Its expectation is `toThrow(/not linear: size 10 -> 80 .*ratio (\d+)/)` plus a parsed reported ratio of at least 24 (twice the limit, versus 16 against 12 today). Keep the explicit-factor test (`factor: 2, maxRatio: 3`) but drive it with the injected clock so it is deterministic. **AC**: `bun test scripts/lib/test-fixtures.test.ts` exits 0 and the reject test completes in under 3 s as measured by the runner's reported duration for the file (a runtime guard on the helper's own self-test, not a budget on production code). **Red when**: the helper ignores the default clock (reports ratio 0 or NaN) or `factor` is ignored (message size would read `-> 40`).
4. Re-size the factor-2 call in `scripts/hooks-bash-write-options.test.ts`: `n: Math.floor(depth / 3)`, `factor: 3`, `maxRatio: 6`; replace the comment above it with one line pointing at `expectLinearTime` for the rationale (the one canonical copy lives on the helper's JSDoc; add a sentence there noting a PATH_MAX-bounded call uses factor 3 / limit 6). **AC**: `bun test scripts/hooks-bash-write-options.test.ts` exits 0 with 0 failures; the call contains `factor: 3` and `maxRatio: 6` (grep); no `minMs(` or millisecond `toBeLessThan` appears in the file. **Red when** (implementer verifies once, not committed): wrapping `resolveExistingAncestor` in a quadratic burn costing about 50 ms at depth 3n makes the test fail with a ratio of at least 6 in its message.
5. Verification evidence per CI-first: run only the two spec files above, scoped, through `with-test-lock`, after the pre-flight gate; push and read the CI job on the pushed head as the evidence for the full suite. **AC**: both single-spec commands exit 0; CI on the head is green.

## Execution Strategy & Stop Conditions

- If any injected-clock test passes when its stated mutation is applied locally, stop and fix the test before proceeding (that test cannot fail).
- If the real-clock reject test reports a ratio below 24 on the implementer's machine after calibration, stop and enlarge the spin constant rather than lowering the 24 bar.
- If `build(3n)` exceeds the PATH_MAX-safe depth for the factor-3 call, abort that change and report; do not raise `maxRatio` above 6.
- If a change to `minMs`'s signature breaks any existing caller (other `hooks-*.test.ts` pass `runs` positionally), revert the seam to the `expectLinearTime`-only option and halt.

## Quality Gate

- touch_paths_declared: PASS (four paths, generated trees not involved)
- ac_mapping: PASS (each step names a spec command and expected result)
- schema_baseline: PASS (no schema or public API change; helper gains an optional parameter)
- ADVISORY: `minMs` is shared by every hook suite; its new third parameter is optional and defaulted, so no consumer edit is needed.
