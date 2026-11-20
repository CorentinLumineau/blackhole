---
type: plan
summary: "Reject a usage payload that mixes the desktop get_usage shape with top-level normalized windows, and pin the mixed-shape rule and the expired desktop window through usage.ts --usage with specs"
status: current
review_trigger: "on file change"
created: 2026-11-20
last_updated: 2026-11-20
related: []
---# Plan - Issue #1374 — usage-normalize mixed-shape rule and expired desktop window spec

## Objective
Close the two WARN findings left at merge of the desktop `get_usage` reader fix. (1) Decide and pin what `normalizeUsagePayload` does when one payload carries both the desktop shape (`plan.windows` array) and top-level normalized windows (`windows`, top-level `five_hour`/`seven_day*` keys, or `rate_limits`): today the desktop branch silently wins and the other rows are ignored (probe: top-level `five_hour` 5% plus `plan.windows` 5-hour 90% yields 90). (2) Pin, through `usage.ts --usage`, that an expired desktop window is dropped by the file provider and the chain falls through to the rate-limit cache with exit 0.

Decision (rule): **reject** a mixed payload with a `UsageFileError` rather than document a precedence. Rationale: no known host emits both shapes, so rejection costs nothing today, and silently picking one source of truth in a pacing gate is the kind of ambiguity V-API-01 flags; failing loud (exit 2, as for any malformed `--usage` file) is the conservative contract and matches how a repeated window name is already refused.

## Touch-Paths
- `scripts/lib/usage-normalize.ts` (mixed-shape guard in `normalizeUsagePayload`; update the header comment's shape list to state the rule once)
- `scripts/lib/usage-normalize.test.ts`
- `scripts/usage.test.ts`
- `src/references/run-context.md` (the `--usage` file sentence: one clause stating a payload mixing the desktop shape with top-level windows exits 2)
- plus all generated dist trees per `scripts/lib/build/targets.ts`

## Documentation Impact
`src/references/run-context.md` usage-file paragraph gains the reject clause; generated copies re-emitted by `bun run build`, never hand-edited. No ADR or companion-file change.

## Task Steps (tests first, V-TEST-01/02)
1. RED, `scripts/lib/usage-normalize.test.ts`: add specs in `describe('desktop get_usage payload')` feeding `ccdPayload()` merged with each top-level window form: `windows: [{name:'five_hour',used_pct:5,resets_at}]`, top-level `five_hour: {used_pct:5,resets_at}`, and `rate_limits: {five_hour:{...}}`. Each expects `toThrow(UsageFileError)` and message `/mixes the desktop get_usage shape/`. Run the file and confirm these fail against current code (current code returns 90-style desktop-only result, so each assertion fails, not passes trivially).
2. RED, `scripts/usage.test.ts`, new spec in `describe('usage CLI, desktop get_usage payload')`: a file with the desktop shape plus top-level `windows` exits 2 with stderr matching the same message. Plus the expired-window spec (step 4) written now.
3. GREEN, `scripts/lib/usage-normalize.ts`: when `ccd` is non-null and (`Array.isArray(payload.windows)` or `isRecord(payload.rate_limits)` or any top-level key matches `WINDOW_NAME`), throw `UsageFileError('usage payload mixes the desktop get_usage shape with top-level windows')`. Other top-level keys (e.g. `read_at`) stay allowed. No change to the non-desktop branches.
4. Expired-window spec in `scripts/usage.test.ts`: desktop payload whose rows have `resetsAt: NOW - HOUR`, `--usage` file mtime NOW-5, `--cache` pointing at a valid rate-limit cache (`seven_day` 30%, `resets_at: NOW + 90*HOUR`, mtime NOW-10, `--host claude`). Assert exit 0, `source: 'rate-limit-cache'`, `provider: 'statusline'`, and windows equal the cache's, proving the fall-through (not `source: none`). Add a sibling case with no cache: exit 0, `source: 'none'`, `reason` contains `no current window`.
5. Docs: one clause in `src/references/run-context.md`, then `bun run build` to regenerate dist trees.
6. Scout Check record per implementer.md (improvement within the diff boundary only).

## Acceptance Criteria (machine-verifiable)
- **AC1**: `bun test scripts/lib/usage-normalize.test.ts` passes and contains three mixed-shape specs (windows array, top-level key, `rate_limits`), each asserting `UsageFileError` with `/mixes the desktop get_usage shape/`; each spec was observed failing before step 3 (red-before-green).
- **AC2**: `bun test scripts/usage.test.ts` passes with a spec asserting `usage.ts --usage <mixed file>` exits 2 and stderr matches `/mixes the desktop get_usage shape/`.
- **AC3**: `bun test scripts/usage.test.ts` passes with a spec asserting an all-expired desktop file plus a valid cache exits 0 with `source: 'rate-limit-cache'` and the cache's windows, and a no-cache variant exits 0 with `source: 'none'` and reason containing `no current window`.
- **AC4**: A pure desktop payload and every existing normalized/top-level payload spec in `usage-normalize.test.ts`, `usage.test.ts`, `usage-probe.test.ts`, `pace-floor` and `usage-budget` specs still pass unchanged (no existing assertion edited or removed, V-TEST-10).
- **AC5**: `grep -n "mixes the desktop get_usage shape" scripts/lib/usage-normalize.ts src/references/run-context.md` is non-empty for the code and the docs clause states exit `2`; generated dist trees contain no hand edits (`bun run build` leaves a clean diff beyond the source change).

## V-TEST-11 requirement
Each new spec must be falsifiable by the bug it covers: mixed-shape specs must use a top-level window whose value differs from the desktop row (5% vs 90%) so a silent-precedence implementation cannot satisfy `toThrow`; the expired-window spec must use a cache with a distinct window so a wrong fall-through to `source: none` or to the expired file fails the assertion.

## Verification (ci-first, resource-frugal)
Locally only: the two focused spec files through `with-test-lock`, then a typecheck of the changed files. Full suites run in CI on the pushed head.

## Pareto
Gain 3, Effort 1: Priority 3 x (11 - 1) = 30 (meets V-PARETO-03 floor).

## Prior art read
PR #1373 (d60c2ab6, issue #1361) added `ccdRowsToWindows` and the desktop branch at `usage-normalize.ts:92`; `fileProvider` (`scripts/lib/usage-source.ts:97`) filters `resets_at > now` and returns `fail('usage file carries no current window')` for a non-`none` plan, so the chain continues to the cache provider.
