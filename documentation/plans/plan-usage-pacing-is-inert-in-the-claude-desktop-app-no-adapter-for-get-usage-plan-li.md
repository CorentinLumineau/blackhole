---
type: plan
summary: "Add usage-probe --from-ccd-usage mapping get_usage plan windows (5-hour, Weekly all models) into the rate-limit cache so usage pacing works in the Claude desktop app"
status: current
review_trigger: "on file change"
created: 2026-11-18
last_updated: 2026-11-18
---

# Plan: Add usage-probe --from-ccd-usage mapping get_usage plan windows (5-hour, Weekly all models) into the rate-limit cache so usage pacing works in the Claude desktop app (issue #1266)

## Objective
Add `--from-ccd-usage <file|->` to `scripts/usage-probe.ts` so the Claude desktop app (no statusline, no `rate_limit_event`) can feed `mcp__ccd_session_mgmt__get_usage` plan limits into the rate-limit cache, ending the inert `usage_budget` (`verdict: unavailable`) on that host.

## Design decisions (80/20)
- **Same pattern as `--from-events`** (issue says so): the orchestrator calls `get_usage`, pipes the JSON to the probe; the probe writes the one rate-limit cache `pace-gate.ts` and `usage-budget.ts` already read. No new reader, no new cache (V-INT-02).
- **Not `usage.ts --usage`**: `usage-normalize.ts` accepts top-level `five_hour`/`seven_day` keys or a `windows` array of normalized names, not the raw `plan.windows[] = {label, percentUsed, resetsAt}` shape, and `usage.ts` never writes the cache pace gating reads. A label adapter is the missing piece.
- **Mapping** (exact per issue): label `5-hour limit` to `five_hour`; label `Weekly · all models` to `seven_day`; every other row (per-model weekly such as `Weekly · Opus`) ignored. Match the label case-insensitively after normalizing the middle dot / whitespace, and `all models` only (a per-model row must never overwrite `seven_day`). `percentUsed` is 0-100 (validated, else exit 2), carried as `used_percentage`; `resetsAt` accepts epoch seconds or an ISO-8601 string, a window at or past `now` is dropped (the rule `eventsToRateLimits` uses). `[ASSUMPTION: percentUsed is 0-100 and resetsAt is epoch or ISO, per the issue example; the implementer confirms against one real get_usage payload and records the fixture shape.]`
- **Dating**: no event time exists, so `observed_at = now` (cache mtime set to now), per the issue ("dated now"); this is why the orchestrator must call `get_usage` at every spawn round.
- **Flag exclusivity**: exactly one of `--from-events` / `--from-ccd-usage`; both or neither exits 2. Exit codes unchanged (0 written, 1 no current window, 2 bad usage or malformed, 3 write failure). Cache `source` field is `ccd_get_usage`. Weekly reading still appended to `usage-history.jsonl`. Reuse `main`s write and history path (extract, do not copy).
- **Build output**: `scripts/usage-probe.ts` is copied to `plugins/*/scripts/`; the implementer runs `bun run build` and commits the regenerated output with the source before verify (build then commit then verify; no dependency on any other PR).
- **Not touched**: all files on the open-PR list (`templates/hooks/**`, `hook-schemas.md`, `doctor.ts`, `campaign-status/cli.ts`, `status-page-row.ts`, `forge-sync.ts`, `check-common.ts`, `blackhole-vcodes.md`, `facts.ts`, the 14 PR #1316 references). `run-context.md` is not on any list.

## Touch-Paths
- `scripts/usage-probe.ts`
- `scripts/usage-probe.test.ts`
- `src/references/run-context.md` (§ Claude usage sources only)
- plus all generated dist trees per `scripts/lib/build/targets.ts`

## Documentation Impact
`src/references/run-context.md` § Claude usage sources: add a third source row (desktop app), update "Both end in the one rate-limit cache" to "All", and mention the `usage-probe` tool row (line ~31) is satisfied by `get_usage` via this flag. No other doc restates the probe flags.

## Task Steps (red first)
1. Tests first in `scripts/usage-probe.test.ts` (all red on main): a pure `ccdUsageToRateLimits(raw, now)` export and CLI cases (below). Run the focused spec once and confirm red.
2. `usage-probe.ts`: add `ccdUsageToRateLimits`; accept `--from-ccd-usage <file|->`; enforce exactly-one-source; share the cache write, `utimes`, history append and summary line with the events path; update the header comment and `USAGE`.
3. `run-context.md`: add source 3 (desktop app: at every spawn round call `mcp__ccd_session_mgmt__get_usage`, pipe its JSON to `bun run scripts/usage-probe.ts --from-ccd-usage -`; mapping, ignored rows, dated now, exit codes), and the usage-source order sentence.
4. `bun run build`, commit source plus regenerated output together, push; CI runs `bun run verify`.

## Task Breakdown / Acceptance Criteria
- T1 mapping - **AC**: `bun test scripts/usage-probe.test.ts` fails before T2 and passes after; `ccdUsageToRateLimits` on `{plan:{windows:[{label:"5-hour limit",percentUsed:12,resetsAt:R5},{label:"Weekly · all models",percentUsed:42,resetsAt:R7},{label:"Weekly · Opus",percentUsed:90,resetsAt:R7}]}}` returns `five_hour.used_percentage 12` and `seven_day.used_percentage 42` (the 90 row ignored).
- T2 edge cases - **AC**: tests assert: an elapsed `resetsAt` drops that window; only per-model rows gives exit 1 and writes nothing; percentUsed 101 or non-number gives exit 2; an ISO `resetsAt` equals the same epoch; a missing `plan.windows` gives exit 2.
- T3 CLI - **AC**: spawn test with `--from-ccd-usage <file> --now N --cache <tmp>` exits 0, cache JSON has `rate_limits.five_hour` and `seven_day`, `source: "ccd_get_usage"`, `observed_at == N`, mtime == N, and `usage-history.jsonl` gains one weekly line; the same via stdin `-`.
- T4 exclusivity - **AC**: both flags, or neither, exits 2 with the usage line on stderr; `--from-events` behaviour tests unchanged and green.
- T5 end-to-end - **AC**: a test feeds the written cache to `usage-budget.ts --parallel-max 10 --cache <tmp>` and its verdict is not `unavailable` (reuses the existing probe-to-budget test pattern).
- T6 docs - **AC**: `grep -c "from-ccd-usage" src/references/run-context.md` >= 1 and the new row names `get_usage`, both mapped labels and "ignored"; `bun run build` exits 0 and no generated tree is stale (`bun run verify` green in CI).

## Test Strategy
TDD, red first. Pure mapper unit-tested with in-memory payloads; CLI tested through `spawnSync` in a temp dir with `--cache`/`--config` pointed there (existing harness, `env` stripped), so nothing touches `~/.claude` or the repo `.blackhole`. Local: the one focused spec through with-test-lock; full suite and verify in CI.

## Stop conditions
- If a real `get_usage` payload differs from the issue shape (labels, 0-1 percent, other key names), stop and amend the mapper plus fixtures to the real shape before coding further; do not guess.
- If the `windows` label match would also match a per-model row, abort and tighten the matcher before proceeding.

## Track / Classification
Quick; `task_type: feature`; size s. No security surface beyond reading local JSON (`route.security_review_required` not set); no UI.

## Pareto
Gain 6, Effort 3, Priority = 6 x 8 = 48 (>= 30).
