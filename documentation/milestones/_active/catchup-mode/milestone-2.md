---
type: plan
summary: "Catchup-mode M2 plan: break the usage-source and pace-gate layering cycle (#1272) by moving the rate-limit cache reader into rate-limit-cache.ts, add the usage provider chain and a normalized `bun run usage` reading (ADR-053 C6), and add the pure pace-floor.ts (ADR-053 C1)"
status: current
review_trigger: "on milestone completion"
created: 2026-11-17
last_updated: 2026-11-17
plan_base_commit: 4658feed
related:
  - documentation/milestones/_active/catchup-mode/README.md
  - documentation/milestones/_active/catchup-mode/discovery.md
  - documentation/milestones/_active/catchup-mode/outcomes.md
  - documentation/decisions/ADR-053-catchup-mode-quota-pacing.md
---

# M2: Usage reading everywhere

Track: standard. Branch: `design/catchup-mode` (shared, already checked out). Estimate: about 5 hours
(T1 about 1 h, T2 about 1.5 h, T3 about 45 min, T4 about 1 h, T5 and T6 about 45 min), two commits,
two `bun run build` runs.

## Objective

After this milestone, on any host:

1. The rate-limit cache reader lives in one module, `scripts/lib/rate-limit-cache.ts`, that both
   `usage-source.ts` and `pace-gate.ts` import. Neither imports the other, and the module imports
   nothing local (#1272).
2. `usage-source.ts` runs an ordered provider chain: (1) an explicit `--usage` file, (2) the
   statusline rate-limit cache, (3) the `rate_limit_event` probe cache. First usable wins. No
   provider gives source `none` with a reason.
3. `bun run usage` prints one single-line JSON reading: `plan` (`pro`, `max`, `none` or `unknown`),
   `windows[]` (only the windows the reading has: `five_hour`, `seven_day`, per-model weekly such as
   `seven_day_opus`, each with `used_pct` and `resets_at`), `extra_usage`, `source`, `provider`,
   `read_at`, `reason`.
4. `scripts/lib/pace-floor.ts` is a pure function: from now, the weekly `resets_at`, the used
   percent, `pct_per_weekday` (17.5) and the day-end hour it returns `{floor_pct, credits,
   shortfall_pct}`, with credits derived from the reset timestamp.

Out of scope (M3 and later): `usage-budget.ts --floor`, the `catchup` config block, the mode and its
playbook, claims. Existing gating behaviour is unchanged: `usage-budget.ts` and `pace-gate.ts` read the
same cache with the same verdicts.

## Assumptions and deferred items (recorded, no interactive channel)

| # | Assumption | Consequence if wrong |
|---|-----------|----------------------|
| A1 | At HEAD (`4658feed`) the import graph has no runtime loop: `lib/usage-source.ts` imports `lib/pace-gate.ts` one way, and `lib/pace-gate.ts` imports no local file. #1272 is the layering inversion: the reader that `usage-source.ts` abstracts sits in the gate module that sits beside it, and the chain would add a second dependency on it. The fix is the extraction in T1 plus a guard test | If #1272 names a real loop through another file, T1's first step (`git grep` of the import graph) finds it and the fix extends to that file |
| A2 | `usage-probe.ts` writes the same cache path the statusline writes (`{rate_limits, source: 'rate_limit_event', observed_at}`), so providers 2 and 3 read one file. The provider label comes from the payload's `source` field: `rate_limit_event` is `probe`, anything else `statusline` | A host with two distinct cache files would need a second path option; none exists today |
| A3 | `source` keeps the existing vocabulary (`rate-limit-cache`, `none`) plus `usage-file`. The finer label goes in a new `provider` key (`usage-file`, `statusline`, `probe`, `none`). `run-context.json` records `usage.source`, and the docs, the status page and `campaign-status/budget.ts` already use these names, so renaming them would ripple for no gain | None |
| A4 | A cache reading cannot say which plan it came from, so its `plan` is `unknown` and its `extra_usage` is `null`. Only an explicit file can state `plan` and `extra_usage`. `plan: none` (API-key, Bedrock or Vertex billing) comes only from a file that says so, with `windows: []`, and is the no-plan-limits case that M3 turns into a SKIP | A host could infer the plan later; additive |
| A5 | The explicit file is read once per call and must be fresh: its `read_at` (else its mtime) older than `resource_policy.pace.max_age_seconds` (600 s default) makes the provider fail and the chain moves on, as the cache reader does | A scheduled task that writes the file early would be ignored; the task prompt template (M3) writes it just before the call |
| A6 | An explicit file that is missing, unreadable or malformed is a usage error (exit 2), like a malformed `usage-budget.ts --usage`. A valid but stale or all-expired file is not an error: the chain moves on and the reason says why | A silent fall-through would hide an agent's broken hand-off |
| A7 | `pace-floor.ts` takes the used percent as an input because `shortfall_pct` needs it (the brief's tuple omits it), and a `utcOffsetMinutes` input (default 0) because a pure function cannot read the local zone. The caller (M3) passes the offset in force at `now` | A DST change inside the week shifts later day-end instants by an hour; accepted (LOW) |
| A8 | Day-end hour defaults to 18 (the scheduled 18:00 run, ADR-053). It is an argument now and becomes the `catchup` config key in M3 | None |
| A9 | Credit instants are clamped into the week `[resets_at - 7d, resets_at]`: the reset weekday's half credit lands at its day end, or at the week start when the reset hour is already past that hour; the closing half credit lands at `resets_at`. A reset on a weekend gives no half credits | Edge only; tested |
| D1 | **Deferred: provider 4 (the live account usage endpoint) is not built.** ADR-053 marks it "include only if verified, otherwise dropped, not stubbed", and nothing here can verify an undocumented endpoint. No stub, no flag, no empty branch. Revisit as its own milestone if the desktop hand-off (D2) proves insufficient | A host with neither a file nor a cache gets `source: none` with a reason, which M3's gate turns into a SKIP: fail-closed, safe |
| D2 | **Deferred to rollout: whether a desktop scheduled-task session can call the app's usage tool** (ADR-053 Key Assumption, open) cannot be tested from the repo. M2 ships the file hand-off contract and fixtures; the first scheduled run validates it | If it cannot, the task skips (provider 4 is the only other route, see D1) |

## Task Breakdown

Every task is test-first: write the failing test, see it fail, then write the code. Run test files
through `with-test-lock` and name the files (one `bun test a b c` per task, never the full suite). A
removed or moved export imported only as a type is erased by bun, so tests cannot catch a missed type
import: each task's acceptance uses `git grep` for that.

### T1. Break the #1272 cycle: `scripts/lib/rate-limit-cache.ts` (RED then GREEN)

First step, evidence: `git grep -nE "from '(\./|\.\./)+(lib/)?(pace-gate|usage-source)\.ts'" scripts`
quoted in the commit body (A1). Then:

Create `scripts/lib/rate-limit-cache.ts` (imports `fs`, `os`, `path` only) holding, moved verbatim from
`scripts/lib/pace-gate.ts` unless noted:

- `RateWindow`, `RateLimits` types, and the loose `isWindow` guard.
- `RATE_WINDOW_NAMES = ['five_hour', 'seven_day'] as const` (new): the one list of window names the cache carries. `readRateLimits` iterates it instead of `Object.keys(WINDOW_SECONDS)`; `USAGE_WINDOWS` in `lib/usage-budget.ts` becomes `RATE_WINDOW_NAMES` (one source, V-INT-02). `WINDOW_SECONDS` stays in `pace-gate.ts` (it is pace arithmetic, not cache reading).
- `resolveRateLimitCachePath(config)`.
- `readRateLimits(cachePath, now, maxAgeSeconds)`, return widened additively to `{limits, reason, observedAt: number | null, origin: 'statusline' | 'probe' | null}`: `observedAt` is the file mtime in epoch seconds (the probe sets it to the event time), `origin` is `probe` when the payload's `source` is `rate_limit_event`, else `statusline`; both `null` on any failure. Existing callers read only `limits` and `reason`.

`pace-gate.ts` imports its types from `rate-limit-cache.ts` and no longer defines or re-exports them
(no shim). Update every importer (one line each): `scripts/usage-budget.ts`, `scripts/usage-probe.ts`,
`scripts/campaign-status.ts`, `scripts/lib/usage-source.ts`, `scripts/lib/usage-budget.ts`,
`scripts/lib/usage-budget.test.ts`, `scripts/lib/campaign-status/budget.ts`,
`scripts/lib/campaign-status/launch-summary.test.ts`, `scripts/lib/pace-gate.test.ts`.

Tests (new `scripts/lib/rate-limit-cache.test.ts`; the `readRateLimits` describe block moves out of
`pace-gate.test.ts`, which keeps its pace-arithmetic tests and its own helpers):

| Case | Expected |
|------|----------|
| the four moved `readRateLimits` cases (fresh payload, stale, missing/not JSON/no windows, expired window dropped) | unchanged results |
| payload with `source: 'rate_limit_event'` and a file mtime of `NOW - 30` | `origin: 'probe'`, `observedAt: NOW - 30` |
| statusline payload (no `source`) | `origin: 'statusline'` |
| any failure | `observedAt: null`, `origin: null` |
| `resolveRateLimitCachePath({})` and with `resource_policy.pace.cache_path` | default under `os.homedir()`, then the override |
| layering guard: read `rate-limit-cache.ts` and `pace-gate.ts` source text | neither contains an import of `usage-source`; `rate-limit-cache.ts` has no relative import at all |

Acceptance:
- `with-test-lock bun test scripts/lib/rate-limit-cache.test.ts scripts/lib/pace-gate.test.ts scripts/lib/usage-source.test.ts scripts/lib/usage-budget.test.ts scripts/usage-budget.test.ts scripts/usage-probe.test.ts scripts/lib/campaign-status/launch-summary.test.ts` exits 0 with the new cases present and no existing assertion edited except import paths and the moved block.
- `git grep -nE "(readRateLimits|resolveRateLimitCachePath|RateLimits|RateWindow)[^;]*from '[^']*pace-gate\.ts'" scripts` returns nothing.
- `git grep -n "usage-source" scripts/lib/pace-gate.ts scripts/lib/rate-limit-cache.ts` returns nothing.
- `with-test-lock bun run build` exits 0 (the plugin bundle follows the import closure automatically).
- Commit 1: `refactor(usage): move the rate-limit cache reader out of pace-gate (#1272)`.

### T2. Provider chain and report in `usage-source.ts`, shape adapters in `usage-normalize.ts`

Depends on T1.

New pure module `scripts/lib/usage-normalize.ts`: `normalizeUsagePayload(payload: unknown, now: number)` returns
`{plan, windows, extra_usage, read_at: number | null}` or throws `UsageFileError` (message names the
problem, no path; the caller prefixes the path). It accepts the two shapes a `--usage` file may carry:

| Shape | Recognised by | Rules |
|-------|---------------|-------|
| Normalized | a `windows` array | each entry `{name, used_pct 0-100, resets_at epoch seconds > 0}`; optional `plan`, `extra_usage`, `read_at` |
| Desktop `get_usage` (and the RateLimits shape agents already build) | top-level keys named like windows | each value `{used_pct \| used_percentage 0-100 \| utilization 0-1, resets_at \| resetsAt epoch seconds or ISO-8601}`; optional `plan` (string), `extra_usage {enabled \| is_enabled, currency}` |

Shared rules: window names match `^(five_hour|seven_day(_[a-z0-9]+)*)$` (five-hour, weekly, per-model
weekly); a duplicate name, an out-of-range percent or a non-finite reset throws; unknown keys are
ignored; `plan` maps by case-insensitive substring (`max` to `max`, `pro` to `pro`, `none` to `none`,
anything else `unknown`); a payload with no window is an error unless `plan` is `none`;
`utilization` is a 0-1 fraction and becomes `used_pct` rounded to 2 decimals, the same conversion
`usage-probe.ts` applies. [NEEDS CLARIFICATION: the exact desktop `get_usage` payload is not captured anywhere in the repo, so the second shape is a tolerant superset of the documented keys; capture one real payload as a fixture at the first desktop run and tighten or extend the adapter then.]

`scripts/lib/usage-source.ts`:

- `UsageSourceName` becomes `'usage-file' | 'rate-limit-cache' | 'none'`; new `UsageProvider = 'usage-file' | 'statusline' | 'probe' | 'none'`, `PlanName`, `ReportWindow {name, used_pct, resets_at}`, `UsageReport {plan, windows, extra_usage, source, provider, read_at, reason}`.
- `UsageSource` gains `report(now): UsageReport`. `read(now)` keeps its `UsageReading` shape and is derived from the same chain call: `limits` is built from the report's `five_hour` and `seven_day` windows, then `restrictWindows` applies `usage_budget.windows` exactly as today. Per-model windows appear in the report only.
- `usageSourceFor(host, config, options)` gains `options.usageFile?: string`. Chain order: the explicit file (when given, before the host check, so a file works on Cursor), then, for non-Cursor hosts, the cache provider built on `readRateLimits` (provider label from `origin`). Cursor without a file keeps the current `none` reading and reason.
- A provider that fails with a reason lets the chain continue; the final reason joins the reasons in chain order with `; `. With exactly one provider the reason is unchanged (existing tests pass verbatim), and the unknown-host prefix `host unknown: ` stays.
- Explicit file: parsed with `normalizeUsagePayload`; windows whose `resets_at <= now` are dropped; `read_at` is the payload's, else the file mtime, clamped to `now`; stale beyond `resolvePaceGateThresholds(config).maxAgeSeconds` fails the provider (A5); missing, unreadable or malformed throws `UsageFileError` (A6).
- `plan: none` with no windows from a file is a valid reading: `source: usage-file`, `windows: []`, `read()` gives `limits: null` and reason `no plan limits`.

Tests (extend `scripts/lib/usage-source.test.ts`; new `scripts/lib/usage-normalize.test.ts`; the existing usage-source cases pass untouched):

| Case | Expected |
|------|----------|
| normalized file with `five_hour`, `seven_day`, `seven_day_opus`, plan `max`, `extra_usage {enabled: true, currency: 'USD'}` | report lists all three windows, `plan: 'max'`, `provider: 'usage-file'`; `read().limits` has the first two only |
| desktop-shaped file with `utilization: 0.09` and an ISO `resetsAt` | `used_pct: 9`, `resets_at` in epoch seconds |
| RateLimits-shaped file (`used_percentage`) | accepted, same result as the normalized equivalent |
| weekly-only plan file | one window, no five-hour leg |
| `plan: 'none'`, `windows: []` | valid; `read()` reason `no plan limits` |
| duplicate name, `used_pct` 101, `utilization` 1.5, non-finite reset, no window and plan not none | each throws `UsageFileError` |
| file stale (mtime `NOW - 700`) and a fresh cache | report comes from the cache, reason empty; with no cache the reason lists both failures |
| file windows all past their reset | provider fails, chain falls through |
| missing path, not JSON | throws `UsageFileError` naming the path |
| statusline cache payload | `provider: 'statusline'`, `plan: 'unknown'`, `extra_usage: null`, `read_at` equals the file mtime |
| probe-written payload (`source: 'rate_limit_event'`) | `provider: 'probe'`, `source: 'rate-limit-cache'` |
| Cursor with a file | file used; Cursor without: `source: 'none'`, `provider: 'none'`, cursor reason |
| `usage_budget.windows: ['seven_day']` with a two-window file | `read().windows` is `['seven_day']`; the report still lists both |
| no provider at all | `source: 'none'`, `plan: 'unknown'`, `windows: []`, non-empty reason |

Acceptance: `with-test-lock bun test scripts/lib/usage-normalize.test.ts scripts/lib/usage-source.test.ts scripts/lib/usage-budget.test.ts scripts/usage-budget.test.ts scripts/lib/campaign-status/budget.test.ts` exits 0 (add the last file only if it exists; `Glob scripts/lib/campaign-status/budget*.test.ts` first); `git grep -n "provider 4\|live endpoint" scripts/lib/usage-source.ts` returns nothing (D1: no stub).

### T3. `scripts/usage.ts` CLI, alias and V-ARGV-01 entry

Depends on T2.

`scripts/usage.ts`, built like `usage-budget.ts` and `usage-probe.ts`: `parseFlags` and `unknownFlagKeys` from `scripts/lib/argv-flags.ts`, known flags `usage`, `cache`, `host`, `config`, `now`; `import.meta.main` guard around `main`; header comment gives the usage line and the exit codes.

- `--usage <file>` is a file path here (`usage-budget.ts --usage` takes inline JSON; the header says so).
- Host: `--host claude|cursor`, else `resolveHost(path.dirname(configPath), process.env)`.
- Output: one `console.log(JSON.stringify(report))` line, the `UsageReport` exactly. When `source` is `none`, one stderr line `usage: <reason>`. Exit 0 on every reading including `none`; exit 2 on an unknown flag, a bad `--now` or `--host`, an unreadable or malformed `--usage` file, or an invalid config.
- `package.json`: add `"usage": "bun run scripts/usage.ts"` beside `status`, `forge-sync`, `record`.
- `scripts/checks/argv-flags-adoption.check.ts`: add `'scripts/usage.ts'` to `TARGET_SCRIPTS` (kept sorted) and fix the header count (16 to 17).

Tests (new `scripts/usage.test.ts`, `spawnSync('bun', ['run', cli, ...])` with `env: { PATH }` and a temp dir, as `usage-budget.test.ts` does):

| Case | Expected |
|------|----------|
| `--usage` normalized file with `--now` | exit 0, stdout one line, `JSON.parse` has `source: 'usage-file'`, windows, plan, `read_at` |
| statusline cache via `--cache` (mtime set with `utimes`) | `provider: 'statusline'` |
| no file, no cache | exit 0, `source: 'none'`, reason non-empty, stderr starts `usage: ` |
| `--host cursor` with no file | `source: 'none'`, cursor reason |
| malformed `--usage` file, missing file, `--now abc`, `--host x`, unknown flag | exit 2 |
| stdout is exactly one line | `stdout.trim().split('\n').length === 1` |

Acceptance: `with-test-lock bun test scripts/usage.test.ts scripts/verify.argv-flags-adoption.test.ts` exits 0; `git grep -n "scripts/usage.ts" scripts/checks/argv-flags-adoption.check.ts package.json` shows both entries.

### T4. `scripts/lib/pace-floor.ts` (pure, RED then GREEN)

Independent of T2 and T3; scheduled after T3 (one test process at a time).

```ts
export const DEFAULT_PCT_PER_WEEKDAY = 17.5;
export const DEFAULT_DAY_END_HOUR = 18;
export type PaceFloorInput = { now: number; resetsAt: number; usedPct: number; pctPerWeekday?: number; dayEndHour?: number; utcOffsetMinutes?: number };
export type PaceFloor = { floor_pct: number; credits: number; shortfall_pct: number };
export const computePaceFloor = (input: PaceFloorInput): PaceFloor;
```

Rules (epoch seconds in and out; local calendar via the offset; no `Date.now()`, no I/O):

- The week is `[resetsAt - 7 days, resetsAt]`. A weekday is Monday to Friday in the offset's zone.
- Credit schedule: the reset weekday at the week start weighs 0.5 and lands at its day end (clamped into the week, A9); each other Monday-Friday day inside the week weighs 1 and lands at its day end; the closing half of the reset weekday weighs 0.5 and lands at `resetsAt`; weekend days weigh 0. A Monday-Friday reset therefore totals 5 credits, and a weekend reset totals 5 from the five full weekdays.
- `credits` = sum of the weights whose instant is `<= now`; before the week 0, after it the full total.
- `floor_pct = min(100, round2(credits * pctPerWeekday))`; `shortfall_pct = max(0, round2(floor_pct - usedPct))`.
- Throws `Error` on a non-finite `now` or `resetsAt`, `usedPct` outside 0-100, `pctPerWeekday` not in (0, 100], a non-integer `dayEndHour` outside 1-24, a non-finite offset.

Tests (new `scripts/lib/pace-floor.test.ts`; instants built with `Date.UTC`, week reset Tue 2026-11-24 10:00Z, day end 18, offset 0, 17.5):

| Instant (UTC) | credits | floor_pct |
|---------------|---------|-----------|
| Tue 17 Nov 17:59:59 | 0 | 0 |
| Tue 17 Nov 18:00 | 0.5 | 8.75 |
| Wed 18 Nov 18:00 | 1.5 | 26.25 |
| Thu 19 Nov 18:00 | 2.5 | 43.75 |
| Fri 20 Nov 18:00, Sat 21 Nov, Sun 22 Nov 18:00 | 3.5 | 61.25 |
| Mon 23 Nov 18:00 | 4.5 | 78.75 |
| Tue 24 Nov 09:59:59 | 4.5 | 78.75 |
| Tue 24 Nov 10:00 (`resetsAt`) and any later instant | 5 | 87.5 |

More cases: shortfall 11.25 at Fri 18:00 with `usedPct` 50, and 0 with 70; offset +120 moves the first credit from 18:00Z to 16:00Z; reset on Saturday gives 0 until Monday 18:00, then 1 per day, 5 after Friday 18:00; reset on Friday totals 5 with the Friday half before and the closing half at the reset; reset hour after day end (Tue 20:00Z reset, day end 18) credits the first half at the week start (A9); `pctPerWeekday` 20 scales linearly; each invalid input throws.

Acceptance: `with-test-lock bun test scripts/lib/pace-floor.test.ts` exits 0 with the table above present; `git grep -nE "Date\.now|new Date\(\)|from '\./(fs|usage|pace)" scripts/lib/pace-floor.ts` returns nothing (pure, no local imports).

### T5. Docs and build

Depends on T2 and T3.

Edit `src/` only. In `src/references/run-context.md`, after the "Claude usage sources" list, add one short
paragraph: any host can read usage with `bun run scripts/usage.ts [--usage <file>]`; the provider
order (file, statusline cache, probe cache); the printed keys; `--usage` is a file path here, unlike
`usage-budget.ts`; exit codes. The `bun run scripts/usage.ts` invocation in a `src/` doc is what makes the
build bundle the script into the plugin (`listRuntimeScriptEntrypoints`). Do not restate the ADR
rationale and do not mention provider 4. Then `with-test-lock bun run build`.

Acceptance:
- `rg -c "scripts/usage.ts" src/references/run-context.md` returns at least 1.
- `with-test-lock bun run build` exits 0 and `ls plugins/blackhole-claude/scripts/usage.ts plugins/blackhole-claude/scripts/lib/rate-limit-cache.ts plugins/blackhole-claude/scripts/lib/usage-normalize.ts` lists all three.
- `git status --short` shows only the planned `src/` and `scripts/` edits, `package.json` and the rebuilt outputs.
- The focused doc gates still pass: `with-test-lock bun test scripts/verify.config-gate.test.ts` exits 0 (the run-context edit must not remove a gate marker).

### T6. Index row, commit, scout

Splice the `milestones/_active/catchup-mode/milestone-2.md` row into `documentation/INDEX.md`
(`bun run scripts/generate-doc-index.ts`, copy the one new row, never overwrite the file), then
`bun run scripts/generate-doc-index.ts --check` must exit 0. Commit 2 with explicit paths (never
`git add -A`): `feat(usage): bun run usage prints one normalized reading on any host, add pace-floor`
with a body naming ADR-053 C1 and C6 and deferral D1. No AI attribution lines. Run the Scout Check on
the diff and record one Improvement Record; the planned candidate is the stale "15-path" wording in the
`V-ARGV-01` row of `src/references/blackhole-vcodes.md` (document it, do not fix it here: the row is a
generated-from-`src/` gate text outside this diff).

Acceptance: `--check` exits 0; two commits on `design/catchup-mode` (T1, then T2-T6); `git show --stat`
lists only planned paths.

## Critical Files

| File | Change | Why |
|------|--------|-----|
| `scripts/lib/rate-limit-cache.ts` | new: types, `RATE_WINDOW_NAMES`, path resolver, `readRateLimits` | The one cache reader (#1272) |
| `scripts/lib/pace-gate.ts` | remove the moved symbols, import types | Cycle break only; pace arithmetic untouched |
| `scripts/lib/usage-source.ts` | provider chain, `report`, `usageFile` option | ADR-053 C6 |
| `scripts/lib/usage-normalize.ts` | new: payload shape adapters | Keeps shape parsing out of the chain |
| `scripts/usage.ts` | new CLI | ADR-053 C6 entry point |
| `scripts/lib/pace-floor.ts` | new pure function | ADR-053 C1 |
| `scripts/lib/usage-budget.ts` | `USAGE_WINDOWS` from `RATE_WINDOW_NAMES`, type import path | One window list (V-INT-02) |
| `scripts/usage-budget.ts`, `scripts/usage-probe.ts`, `scripts/campaign-status.ts`, `scripts/lib/campaign-status/budget.ts` | type import path only | Follow the move |
| `scripts/checks/argv-flags-adoption.check.ts`, `package.json` | allowlist entry, `usage` alias | V-ARGV-01, convention |
| `src/references/run-context.md` | one paragraph | Documents the CLI and bundles it |
| Tests: `rate-limit-cache.test.ts`, `usage-normalize.test.ts`, `usage-source.test.ts`, `usage.test.ts`, `pace-floor.test.ts`, `pace-gate.test.ts`, `usage-budget.test.ts` (lib), `launch-summary.test.ts` | new and moved cases, import paths | Test-first evidence |
| `documentation/INDEX.md` | one row | Doc governance |

Not touched: `scripts/lib/run-context.ts`, `scripts/run-context.ts` (its `usage` record keeps
`source` `rate-limit-cache` or `none`), `scripts/pace-gate.ts` (the CLI keeps reading through
`usageSourceFor`), `src/references/config-template.md` (no new config key until M3), the forge
adapters, the launch gate.

## Codebase Conventions

| Touchpoint | Convention | Source | Required by |
|------------|------------|--------|-------------|
| CLI argv | `parseFlags` and `unknownFlagKeys` from `argv-flags.ts`; add the script to the V-ARGV-01 allowlist | `scripts/lib/argv-flags.ts:15-50`, `scripts/checks/argv-flags-adoption.check.ts:12-29` | V-ARGV-01, V-INT-02 |
| CLI output | One `console.log(JSON.stringify(...))` line on stdout, a one-line reason on stderr, exit 0 on any verdict, 2 on bad usage | `scripts/usage-budget.ts:105-110`, `scripts/pace-gate.ts:73-74` | V-INT-01 |
| CLI shape | `main()` behind `import.meta.main`, a `fail()` that prints usage and exits 2 | `scripts/usage-budget.ts:24-27, 113`, `scripts/usage-probe.ts:117` | V-INT-01 |
| Usage reading | `usageSourceFor(host, config, options).read(now)`, `resolveHost`, `restrictWindows`; one cache path via `resolveRateLimitCachePath` | `scripts/lib/usage-source.ts:34-80` | V-INT-02 |
| Cache payload | `{rate_limits, source?, observed_at?}`; windows past `resets_at` are dropped; mtime carries the reading's age | `scripts/lib/pace-gate.ts:69-101`, `scripts/usage-probe.ts:107-109` | V-INT-02 |
| Percent conversion | `utilization` 0-1 to 0-100 rounded to 2 decimals | `scripts/usage-probe.ts:64` | V-INT-02 |
| Pure lib style | Pure functions, no I/O or clock reads in the pure ones, `throw new Error('<key path> must be ...')` for invalid input | `scripts/lib/usage-budget.ts:1-8, 67-79` | V-INT-01 |
| Script aliases | `package.json` aliases exist for the operator-facing CLIs (`status`, `forge-sync`, `record`, `doctor`) | `package.json:5-17` | V-INT-01 |
| Runtime bundling | A `bun run scripts/x.ts` invocation in a `src/` doc is what bundles the script and its import closure into the plugin | `scripts/lib/build/claude-plugin-runtime.ts:32-45, 57-74` | V-INT-02 |
| Tests | Pure-lib tests import the module with `withTempDir`; CLI tests `spawnSync('bun', ['run', cli])` with `env: { PATH }` and `--now` pinned | `scripts/lib/usage-source.test.ts:13-22`, `scripts/usage-budget.test.ts:18-26` | V-INT-01 |
| Build | Edit `src/` and `scripts/`, then `bun run build`; never hand-edit built output | `.claude/CLAUDE.md`, discovery block | V-INT-02 |
| Doc governance | Lifecycle frontmatter with `summary` on every new doc; INDEX row spliced, `--check` verified | `documentation/INDEX.md`, `scripts/generate-doc-index.ts` | V-DOC-GOV-02 |

## Dependency Blast-Radius

| Changed file | Downstream consumers | Blast radius |
|--------------|----------------------|--------------|
| `scripts/lib/pace-gate.ts` (symbols removed) | `scripts/pace-gate.ts`, `scripts/lib/pace-log.ts`, `scripts/pace-log.ts` (type `PaceGateVerdict`, unchanged), nine importers of the moved symbols | MEDIUM (a missed type import is erased by bun and shows only in review) |
| `scripts/lib/usage-source.ts` | `usage-budget.ts`, `pace-gate.ts`, `run-context.ts`, `campaign-status.ts`, `campaign-record.ts`, `campaign-status/budget.ts` | MEDIUM (every gate read goes through it; `read()` keeps its shape and the existing tests pass verbatim) |
| `scripts/lib/usage-budget.ts` | gate math, `usage-source.ts`, tests | LOW (one constant re-pointed) |
| New `usage.ts`, `usage-normalize.ts`, `pace-floor.ts`, `rate-limit-cache.ts` | none yet (`pace-floor.ts` is consumed by M3) | LOW |
| `package.json`, `argv-flags-adoption.check.ts` | `bun run usage`, `verify` V-ARGV-01 | LOW |

Overall: LOW to MEDIUM. The two MEDIUM entries are guarded by the unchanged existing suites listed in
T1 and T2.

## Blast Radius

| Surface | Outside the diff | Why it matters |
|---------|------------------|----------------|
| Callers | `usageSourceFor` callers (`usage-budget.ts`, `pace-gate.ts`, `run-context.ts`, `campaign-status/budget.ts`) call `.read()` only; `resolveHost` callers (`campaign-record.ts`, `campaign-status.ts`) are unaffected | `read()` shape and reasons are unchanged for the single-provider case |
| Consumers | Agents run `usage-budget.ts` and `pace-gate.ts` from `orchestrator-runtime.md`; `status-page.md` names `resolveRateLimitCachePath` in prose | Behaviour identical; the prose names the function, not its file |
| Config | none: no `config.json` key (`pct_per_weekday`, `lane`, caps arrive in M3) | No `config-template.md` row needed (V-CONFIG-02) |
| Data | `rate-limits.json` is read, never written, by the new code; `usage-probe.ts` still writes it | No format change; `source` and `observed_at` were already written |
| CI | `verify`: V-ARGV-01, doc INDEX check, plugin bundle coherence; the full suite runs in CI after the push | Not run locally |
| Built trees | `plugins/*`, `skills/`, `.claude/`, `.cursor/`, `.agents/build/`, `codex-*` regenerate from `bun run build` | Committed output must match (CI sync check) |

**Safety fact**: the extraction is behaviour-preserving for every current reader. Before the move, `git
grep -nE "readRateLimits|resolveRateLimitCachePath" scripts` lists the full consumer set (this plan's
read found `lib/usage-source.ts`, `usage-probe.ts` and the pace-gate tests, plus the doc mentions);
after the move the same command lists only `rate-limit-cache.ts` definitions and the same consumers
with the new path, and the seven named test files pass. T1 quotes both outputs in the commit body.

## Risk Assessment

| Risk | Severity | Mitigation |
|------|----------|------------|
| The desktop `get_usage` payload differs from the tolerant adapter, so the desktop hand-off silently reads nothing | MEDIUM | A malformed or window-less file is exit 2 with the reason (A6), never a silent GO; the one clarification marker and D2 make the first real payload a fixture |
| A moved type is missed in an importer and bun erases the import | MEDIUM | The T1 `git grep` acceptance, plus the nine importers listed by name |
| `read()` regresses for existing gate callers when the chain is introduced | MEDIUM | The existing usage-source and usage-budget suites pass unedited; new cases only add |
| `plan` inferred wrongly from a free-text field | LOW | Only substring `max`, `pro`, `none` map; everything else is `unknown`, and nothing gates on `plan` in M2 |
| DST shifts a day-end instant inside a week | LOW | A7: the caller passes the offset in force; effect is one hour on later days |
| Bundle misses a new file | LOW | The bundler follows relative imports from the `src/` invocation; T5 lists the three files in the built plugin |

No HIGH-risk item, so no `## Stop Conditions` section.

## Execution Strategy

**Pattern**: Sequential on the shared branch. One test process at a time (workstation rules); CI runs
the full suite after the push, nothing local goes beyond the named files.

| Agent | Task(s) | Model | Delegation Contract |
|-------|---------|-------|---------------------|
| x-implementer (or the main session) | T1 | sonnet | **Objective**: extract the cache reader with tests first. **Output format**: new `rate-limit-cache.ts` and test, edited importers, test and `git grep` output quoted. **Scope**: the files in Critical Files tagged T1; nothing under `src/`. **Tool guidance**: `with-test-lock bun test` on the seven named files; `with-test-lock bun run build`. **Stop condition**: acceptance greps empty, tests green, commit 1 made. |
| x-implementer | T2 | sonnet | **Objective**: chain, report and shape adapters with tests first. **Output format**: `usage-source.ts`, `usage-normalize.ts`, two test files. **Scope**: those four files only. **Tool guidance**: named test files through `with-test-lock`. **Stop condition**: existing usage-source cases unedited and green, new table cases green. |
| x-implementer | T3 | sonnet | **Objective**: the `usage.ts` CLI, alias, allowlist entry. **Output format**: `usage.ts`, `usage.test.ts`, `package.json`, the check file. **Scope**: those four files. **Tool guidance**: `with-test-lock bun test scripts/usage.test.ts scripts/verify.argv-flags-adoption.test.ts`. **Stop condition**: CLI table green, V-ARGV-01 test green. |
| x-implementer | T4 | sonnet | **Objective**: `pace-floor.ts` with the instant table as tests first. **Output format**: `pace-floor.ts`, `pace-floor.test.ts`. **Scope**: those two files; no imports from other local files. **Tool guidance**: `with-test-lock bun test scripts/lib/pace-floor.test.ts`. **Stop condition**: every table row and invalid-input case green. |
| x-implementer | T5 | sonnet | **Objective**: the run-context paragraph, then build. **Output format**: one `src/references/run-context.md` edit, build output quoted. **Scope**: that file plus rebuilt outputs. **Tool guidance**: `with-test-lock bun run build`, focused `verify.config-gate` test. **Stop condition**: build exits 0, three bundled files listed. |
| main session | T6 | sonnet | **Objective**: INDEX row, commit 2, scout record. **Output format**: one commit and one Improvement Record. **Scope**: `documentation/INDEX.md` plus the planned paths, explicit `git add`. **Tool guidance**: `generate-doc-index.ts --check`. **Stop condition**: check exits 0, `git show --stat` lists only planned paths. |

**Parallelization**: none (T1, T2, T3, T4, T5, T6 in order; T4 could run beside T2 in principle and is
serialized by the one-test-process rule).

## Sprint Contract

### Machine-verifiable

- [ ] `git grep -nE "(readRateLimits|resolveRateLimitCachePath|RateLimits|RateWindow)[^;]*from '[^']*pace-gate\.ts'" scripts` returns nothing, and `git grep -n "usage-source" scripts/lib/pace-gate.ts scripts/lib/rate-limit-cache.ts` returns nothing (#1272).
- [ ] `with-test-lock bun test scripts/lib/rate-limit-cache.test.ts scripts/lib/pace-gate.test.ts scripts/lib/usage-source.test.ts scripts/lib/usage-normalize.test.ts scripts/lib/usage-budget.test.ts scripts/usage-budget.test.ts scripts/usage-probe.test.ts` exits 0.
- [ ] `with-test-lock bun test scripts/usage.test.ts scripts/lib/pace-floor.test.ts scripts/verify.argv-flags-adoption.test.ts scripts/verify.config-gate.test.ts` exits 0.
- [ ] `bun run usage --usage <normalized fixture file> --now <epoch>` prints exactly one JSON line with `plan`, `windows`, `extra_usage`, `source: "usage-file"`, `read_at`; with no file and no cache it prints `source: "none"` and a reason, exit 0.
- [ ] `with-test-lock bun run build` exits 0; `plugins/blackhole-claude/scripts/usage.ts` exists.
- [ ] `bun run scripts/generate-doc-index.ts --check` exits 0.

### Human-verifiable

- [ ] Reading one `bun run usage` line, an owner sees the plan, each window with its percent and reset, and where the reading came from.
- [ ] `pace-floor.ts` reads as one pure function whose credit rules match ADR-053 C1 (half day at the reset weekday, one per weekday at day end, weekends zero, the closing half at the reset).
- [ ] Both commits reference ADR-053 (and #1272 for commit 1) and carry no AI attribution line.

## Plan Quality Gate

| Check | Result |
|-------|--------|
| 1 Task acceptance criteria (blocking) | Pass: every task states a measurable acceptance line |
| 2 Critical file existence | Pass: every modified file was read or listed by Grep; new files are named as new |
| 3 Dependency completeness | Pass: T1, T2, T3, then T4, T5, T6; no cycle |
| 4 Risk mitigation | Pass: each risk names a concrete mitigation |
| 5 Success criteria measurability | Pass: commands with expected results |
| 6 Boundary conditions (advisory) | Covered: stale, expired, malformed, duplicate windows, weekend and Friday resets, DST, invalid inputs |
| 7 Stop conditions (advisory) | N/A: no HIGH risk |
| 8 Codebase conventions (blocking) | Pass: section populated at the touchpoints |

Marker count: 1 `[NEEDS CLARIFICATION]` (T2, desktop `get_usage` payload shape).
