---
type: plan
summary: "Linear pace floor over all 168 h of the week with configurable catchup.weekly_target_pct (default 80); removes catchup.pct_per_weekday and day_end_hour with a clear error; amends ADR-054"
status: current
review_trigger: "on file change"
created: 2026-11-18
last_updated: 2026-11-18
related:
  - documentation/decisions/ADR-054-catchup-mode-quota-pacing.md
---

# Plan - Issue #1293

## Objective
`scripts/lib/pace-floor.ts` (ADR-054 C1) credits 17.5 points per finished Mon-Fri weekday, so the floor lags the clock by up to 17.5 points inside a weekday, is flat from Friday night to Monday night, and ignores the hours left before `resets_at`. Owner ruling 2026-11-18 (issue body): replace it with a linear floor over the whole week, weekends counting like weekdays.

```
week_start = resets_at - 7d
elapsed_h  = clamp((now - week_start) / 3600, 0, 168)
floor_pct  = weekly_target_pct x elapsed_h / 168        (rounded to 2 decimals)
```

New key `catchup.weekly_target_pct`, a number in (0, 100], default 80. Removed: `catchup.pct_per_weekday` and `catchup.day_end_hour` (the credit schedule, the reset-weekday half split and the local working-day bounds). The floor output replaces `credits` with `elapsed_h` and adds `target_pct`. Because `utcOffsetMinutes` is no longer an input, `localUtcOffsetMinutes` (the one impure helper in `catchup.ts`) goes too. The result of the issue's own example (reset Sat 21 Nov 20:00Z, now Wed 18 Nov 13:00Z): 89 h / 168 h x 80 = 42.38%.

## Touch-Paths
- `scripts/lib/pace-floor.ts` (rewrite: linear math, new input/output types)
- `scripts/lib/pace-floor.test.ts` (rewrite, red first)
- `scripts/lib/catchup.ts` (`CatchupConfig`: `weekly_target_pct` replaces `pct_per_weekday` and `day_end_hour`; removed-key rejection; `Pacing` fields; `readPacing` drops its `utcOffsetMinutes` parameter; delete `localUtcOffsetMinutes`)
- `scripts/lib/catchup.test.ts`
- `scripts/pace-floor.ts` (CLI: JSON fields, header comment, drop the offset call)
- `scripts/pace-floor.test.ts`
- `scripts/campaign-status.ts` (one call site, `readCatchup`: drop `localUtcOffsetMinutes` import and argument)
- `scripts/lib/campaign-status/launch-summary.ts` (`pacingRow` floor text)
- `scripts/lib/campaign-status/launch-summary.test.ts`
- `fixtures/campaign-status/full/launch-summary.catchup.expected.md`
- `scripts/verify.config-registration.test.ts` (catchup key list test)
- `src/references/config-template.md` (catchup table rows and `## catchup` paragraph)
- `src/references/phase-catchup.md` (step 3 and the floor-0 sentence)
- `src/references/launch-gate.md` (Catchup form Pacing bullet)
- `documentation/decisions/ADR-054-catchup-mode-quota-pacing.md` (C1 row, config row, diagram label, frontmatter `summary`/`last_updated`, new `## Post-acceptance amendments` section)
- `documentation/decisions/INDEX.md` (ADR-054 row summary only)
- plus all generated dist trees per `scripts/lib/build/targets.ts` (rebuilt by `bun run build`, never hand-edited)
- Not touched (open PRs or follow-ups): `templates/hooks/**`, `src/references/hook-schemas.md`, `scripts/lib/build/claude-plugin-runtime.ts` (PR #1330), the guard files (#1327, #1334), `scripts/lib/forge-sync.ts`, `src/references/forge-sync.md` (#1335). Not touched: `scripts/usage-budget.ts` and `scripts/lib/usage-budget.ts` (read only `resolveCatchup`, whose signature is unchanged), `package.json` (no version bump; owner waived V-PLUGIN-01).

## Documentation Impact
- `src/references/config-template.md`, `phase-catchup.md`, `launch-gate.md`: listed above (companion docs of the changed behavior; generated copies rebuilt).
- `documentation/decisions/ADR-054-catchup-mode-quota-pacing.md`: amended in place (same decision, changed parameterization, so no new ADR and no `status: deprecated`): the C1 and config rows are corrected, and a dated `## Post-acceptance amendments` entry cites #1293 (V-ADR-06 leg 1, since `supersedes_adr: [ADR-054]` is declared above).
- `documentation/decisions/INDEX.md`: ADR-054 summary text refreshed.
- Left alone: `documentation/brainstorms/weekly-quota-pacing.md` and `documentation/milestones/_active/catchup-mode/**` and `documentation/reviews/**` describe the original 17.5-per-weekday design as history; the ADR amendment is the pointer a reader follows. No search-before-write concern: no new `documentation/` file is created by the implementer (the staged plan body is carried by the carry-step).

## Critical Files
- `scripts/lib/catchup.ts`
- `scripts/lib/pace-floor.ts`
- `src/references/config-template.md`
- `documentation/decisions/ADR-054-catchup-mode-quota-pacing.md`

## Codebase Conventions
- Config resolution: `pick(block, key, path, fallback, ok, want)` and `isPct` from `scripts/lib/usage-budget.ts` (`catchup.ts` l.43 pattern): absent key => default, wrong type/range throws `<path> must be <want>`. `weekly_target_pct` reuses `isPct` (number in (0, 100]); do not add a second validator (V-INT-02).
- `scripts/lib/pace-floor.ts` stays pure: no I/O, no clock reads, no local imports, epoch seconds in, throws `Error` on invalid input, `round2` rounding (existing `round2` helper). Keep the existing validation style (`if (!(x ...)) throw new Error('<name> must ...')`).
- Every `catchup` throw is surfaced by its callers as-is: `scripts/pace-floor.ts` (`fail` => stderr `pace-floor: <msg>`, exit 2), `campaign-status.ts` `readCatchup` (an invalid block becomes `{ invalid: message }` shown on the Pacing row as `catchup config invalid: <msg>`), `usage-budget.ts --floor` (`resolveCatchup` throw). The removed-key error therefore needs no new plumbing.
- Config keys: registered as one `Field` row per leaf in `src/references/config-template.md` (V-CONFIG-02 parser `parseConfigTemplateKeys`); the `catchup` block already has dataset `none` in `## Status page coverage`, so V-CONFIG-03 needs no new row (no new dataset, no new panel).
- Comments: one canonical rationale per concept, no issue numbers in source comments (V-DOC-05/06). The removed-key message may cite `ADR-054 amendment` since it is user-facing text, not a source comment; keep the `#1293` reference in the test function name only.
- Edit `src/**` only; generated trees come from `bun run build` ("plus all generated dist trees per `scripts/lib/build/targets.ts`"). `ci-first-verification.md`: locally run only the touched specs through `with-test-lock`; CI runs the suite.
- Data-structure orientation (V-DRY): `Pacing.credits` is read only by `scripts/pace-floor.ts` (JSON output) and `launch-summary.ts` (`pacingRow` floor text, `input.pacing.credits`); `CatchupConfig.pct_per_weekday` is read only by `readPacing` and `pacingRow` (`launch-summary.ts` l.201); `day_end_hour` only by `readPacing`. Re-confirm with `git grep` at implement time.

## Database/API Schema Changes
Config schema (`.blackhole/config.json` `catchup` block):
| Key | Before | After |
|---|---|---|
| `catchup.pct_per_weekday` | number in (0, 100], default 17.5 | REMOVED: present => `resolveCatchup` throws (message below) |
| `catchup.day_end_hour` | integer 1-24, default 18 | REMOVED: present => throws |
| `catchup.weekly_target_pct` | n/a | number in (0, 100], default 80 |
| `five_hour.*`, `lane`, `claim_lease_hours` | unchanged | unchanged |

`computePaceFloor` (pure API, `scripts/lib/pace-floor.ts`):
- Input `{ now, resetsAt, usedPct, weeklyTargetPct? }` (was `+ pctPerWeekday?, dayEndHour?, utcOffsetMinutes?`). Exports: `DEFAULT_WEEKLY_TARGET_PCT = 80`, `WEEK_HOURS = 168`; `DEFAULT_PCT_PER_WEEKDAY` and `DEFAULT_DAY_END_HOUR` deleted.
- Output `{ floor_pct, elapsed_h, target_pct, shortfall_pct }` (was `{ floor_pct, credits, shortfall_pct }`). `elapsed_h` rounded to 2 decimals, `floor_pct = round2(target x elapsed_h_unrounded / 168)`, `shortfall_pct = max(0, round2(floor_pct - usedPct))`.

`Pacing` (`catchup.ts`): `credits: number | null` replaced by `elapsed_h: number | null` and `target_pct: number | null`. `readPacing(report, preset, now)` loses its 4th parameter.

`scripts/pace-floor.ts` JSON line: `credits` replaced by `elapsed_h` and `target_pct`; all other fields unchanged. `campaign-status.ts --summary --mode catchup --json` `pacing` object carries the same two replaced fields.

Pacing row text (`launch-summary.ts`): `floor 45.71% (96 h / 168 h x 80%)` replaces `floor 61.25% (3.5 credits x 17.5)`; the adjusted form `floor X% (adjusted)` is unchanged. `elapsed_h` prints as `Number(elapsed_h.toFixed(1))`, target as `pct(target_pct)`, with ASCII `x` as in the current row.

### Breaking change: exact error text
`resolveCatchup` checks the two removed keys before any `pick`, using one exported map `REMOVED_CATCHUP_KEYS` (key => message), and throws on the first present key (`pct_per_weekday` first):
- `catchup.pct_per_weekday was removed (ADR-054 amendment): the pace floor is now linear over all 168 h of the week. Delete it and set catchup.weekly_target_pct instead (a number in (0, 100], default 80; the old 17.5 x 5 weekdays equals 87.5).`
- `catchup.day_end_hour was removed (ADR-054 amendment): the pace floor no longer follows working days. Delete it from config.json.`
Presence is detected with `key in block` (a `null` value still rejects). `run` mode never reads `catchup`, so a stale key breaks only `catchup`, `usage-budget.ts --floor`, `pace-floor.ts` and the Pacing row, each with the message above (exit 2 / `catchup config invalid: ...`). No silent fallback and no auto-migration.

## Dependency Blast-Radius
| Consumer (file:line at base) | Classification | Note | verification |
|---|---|---|---|
| `scripts/lib/catchup.ts:130-148` `readPacing` | BREAKING | drops `utcOffsetMinutes`, reads `weekly_target_pct`, returns `elapsed_h`/`target_pct` | reasoned: it is the only caller of `computePaceFloor` outside tests; its own tests are rewritten red-first |
| `scripts/campaign-status.ts:9,316` | BREAKING | imports and passes `localUtcOffsetMinutes(nowS)` | reasoned: typecheck fails until the import and argument are removed; `bun run typecheck` at implement |
| `scripts/pace-floor.ts:4,40,46` | BREAKING | imports the offset helper; prints `credits` | reasoned: CLI test asserts the new JSON fields |
| `scripts/lib/campaign-status/launch-summary.ts:201` | BREAKING | reads `pacing.credits` and `preset.pct_per_weekday` | reasoned: typecheck on `CatchupConfig`/`Pacing`; fixture test |
| `fixtures/campaign-status/full/launch-summary.catchup.expected.md:8` | BREAKING | pinned Pacing row text | reasoned: `launch-summary.test.ts` compares to this file |
| `scripts/usage-budget.ts:97` | TRANSPARENT | calls `resolveCatchup` for `five_hour` only | reasoned: signature unchanged; a stale removed key now throws, which `usage-budget.ts --floor` already surfaces |
| `scripts/verify.config-registration.test.ts:122` | BREAKING | lists the old keys | reasoned: test updated |
The implementer records the post-change proof (V-INT-05, `executed: <command> -> <result>` for the touched specs plus typecheck) in the PR body's `## Blast-Radius Evidence`; the plan-time rows are `reasoned:` because the planner runs no builds.

## Execution Strategy & Stop Conditions
- RED first: if any rewritten spec in `pace-floor.test.ts` or `catchup.test.ts` passes before the implementation lands, halt and fix the test; a spec that cannot fail proves nothing (V-TEST-11).
- If `git grep -n "pct_per_weekday\|day_end_hour\|pctPerWeekday\|dayEndHour\|PCT_PER_WEEKDAY\|DAY_END_HOUR\|utcOffsetMinutes\|localUtcOffsetMinutes" -- scripts src` still matches outside the exemptions (the `REMOVED_CATCHUP_KEYS` map in `scripts/lib/catchup.ts`, its tests, and the one removal sentence in `src/references/config-template.md`), do not finish: remove the stale reader.
- If the ADR-054 edit leaves the C1 row or the `catchup` config row naming `pct_per_weekday` or credits, revert and redo it; the amendment section may name them as history.
- If `bun run build` or `bun run verify` reports drift in a tree owned by an open PR (`templates/hooks/**`, `claude-plugin-runtime.ts`, the guard files) or in `forge-sync*`, abort that rebuild step and report; do not hand-edit those paths.
- If the pinned fixture row cannot be regenerated byte-for-byte from the test inputs, stop and re-derive it from the test constants rather than editing the expected file by hand.
- If usage in the launch-summary test inputs (50% weekly) exceeds the new floor (45.71%) and the shortfall assertions turn vacuous, stop and lower the fixture usage so shortfall stays above zero; do not weaken the assertions.

## Task Breakdown
- [ ] **T0 Baseline**: record the base is `51b828d0` or newer and run only the specs listed under T1-T4 once through `with-test-lock`. — **AC**: pass counts for `scripts/lib/pace-floor.test.ts`, `scripts/lib/catchup.test.ts`, `scripts/pace-floor.test.ts`, `scripts/lib/campaign-status/launch-summary.test.ts`, `scripts/verify.config-registration.test.ts` quoted in the completion evidence.
- [ ] **T1 pace-floor tests (red)**: rewrite `scripts/lib/pace-floor.test.ts` for the linear model: week start -> 0; reset -> 80 and, with `weeklyTargetPct: 50`, -> 50; midpoint (84 h) -> 40; each of Saturday and Sunday hourly steps strictly increases the floor (e.g. Sat 06:00 < Sat 18:00 < Sun 12:00 < Mon 00:00 for a Tue reset); the issue's example (reset Sat 21 Nov 20:00Z, now Wed 18 Nov 13:00Z, used 54) -> `elapsed_h` 89, `floor_pct` 42.38, `shortfall_pct` 0; `now` before week start -> 0 and after reset -> target (`elapsed_h` 0 and 168); `target_pct` echoes the input; validation throws for non-finite `now`/`resetsAt`, `usedPct` outside 0-100, `weeklyTargetPct` 0, 101, NaN. — **AC**: `bun test scripts/lib/pace-floor.test.ts` run before T5 fails on every new case (module still exports `credits`), and passes after T5.
- [ ] **T2 catchup tests (red)**: in `scripts/lib/catchup.test.ts` replace the default-preset test with `{ weekly_target_pct: 80, five_hour: { no_spawn_at: 75, stop_workers_at: 80 }, lane: null, claim_lease_hours: 24 }`; override test for `weekly_target_pct: 60`; invalid values 0, 101, `'x'` throw naming `catchup.weekly_target_pct`; both removed keys throw with the exact text from the breaking-change section (assert full message equality, and that `null` values also reject); `readPacing(report, preset, NOW)` with NOW Fri 13 Nov 09:30Z and RESET Mon 16 Nov 09:30Z and used 30 returns `elapsed_h` 96, `target_pct` 80, `floor_pct` 45.71, `shortfall_pct` 15.71; the `none` branches return `elapsed_h: null` and `target_pct: null`; the `localUtcOffsetMinutes` describe block is deleted. — **AC**: failing before T6, green after; no test references `credits`, `pct_per_weekday` (outside the removal case) or the 4th `readPacing` argument.
- [ ] **T3 CLI tests (red)**: in `scripts/pace-floor.test.ts` the base case expects `{ floor_pct: 45.71, elapsed_h: 96, target_pct: 80 }`; `catchup.weekly_target_pct: 60` -> `floor_pct` 34.29; a config with `catchup.pct_per_weekday` exits 2 and stderr contains the exact removal message; same for `day_end_hour`; the old `day_end_hour: 99` case is replaced by the removal case. — **AC**: new cases fail before T7, pass after.
- [ ] **T4 summary and registration tests (red)**: update `scripts/lib/campaign-status/launch-summary.test.ts` (readPacing call without the 4th argument; floor assertions `floor 45.71%` and `96 h / 168 h`; lower the fixture weekly usage so shortfall stays above zero) and `scripts/verify.config-registration.test.ts` (title "the catchup keys", keys `weekly_target_pct`, `five_hour.no_spawn_at`, `five_hour.stop_workers_at`, `lane`, `claim_lease_hours`, `toHaveLength(5)`). — **AC**: both fail before T6/T8 and pass after; the fixture file `launch-summary.catchup.expected.md` is regenerated from the test, not hand-written, and its Pacing row reads `floor 45.71% (96 h / 168 h x 80%)` for the test's inputs.
- [ ] **T5 implement `pace-floor.ts`**: linear math per the Objective, new exports and types, header comment rewritten, nothing else imported. — **AC**: `bun test scripts/lib/pace-floor.test.ts` green; `grep -nE "Date|utcOffset|dayEndHour|pctPerWeekday|credits" scripts/lib/pace-floor.ts` returns no match; the file has no `import` lines.
- [ ] **T6 implement `catchup.ts`**: `weekly_target_pct` via `pick`/`isPct`; `REMOVED_CATCHUP_KEYS` rejection before `pick`; `Pacing` fields; `readPacing(report, preset, now)`; delete `localUtcOffsetMinutes` and the "impure" header sentence. — **AC**: `bun test scripts/lib/catchup.test.ts` green; `bun run typecheck` reports no error in `catchup.ts` and its callers once T7-T8 land.
- [ ] **T7 callers**: `scripts/pace-floor.ts` prints `elapsed_h` and `target_pct` (no `credits`), header comment updated; `scripts/campaign-status.ts` drops the helper import and argument. — **AC**: `bun test scripts/pace-floor.test.ts` green; `git grep -n "localUtcOffsetMinutes" -- scripts src` returns no match (exemption: none; the helper is deleted).
- [ ] **T8 launch summary and fixture**: `pacingRow` prints `floor <pct> (<elapsed_h> h / 168 h x <target>%)`; rerun the test's fixture writer or the project's fixture-regeneration route for `launch-summary.catchup.expected.md`. — **AC**: `bun test scripts/lib/campaign-status/launch-summary.test.ts` green; the expected file contains `h / 168 h` and no `credits`.
- [ ] **T9 docs**: `config-template.md` replaces the `pct_per_weekday` and `day_end_hour` rows with a `catchup.weekly_target_pct` row (default 80; number in (0, 100]; Resolution: absent block or key => 80; a wrong type or range throws with the key path) and adds one sentence to `## catchup` that `pct_per_weekday` and `day_end_hour` are removed and now rejected with a clear error; `phase-catchup.md` step 3 lists `elapsed_h`, `target_pct`, `shortfall_pct` and restates the floor-0 case as "the instant the week starts"; `launch-gate.md` Catchup form bullet shows the new Pacing text. — **AC**: `bun run verify` passes `V-CONFIG-02`/`V-CONFIG-03`; `git grep -n "credits\|pct_per_weekday\|day_end_hour" -- src/references` matches only the single removal sentence in `config-template.md` (scope `src/references`, exemption: that sentence).
- [ ] **T10 ADR-054**: edit the C1 row (linear model: `weekly_target_pct`, elapsed over 168 h, weekends count), the `catchup` config row (`weekly_target_pct` (80), no working-day end hour), the C1 diagram node label, frontmatter `summary` and `last_updated: 2026-11-18`; append `## Post-acceptance amendments` (dated 2026-11-18, cites #1293 and the owner ruling) stating the old staircase, the observed failure (Wed 13:00Z showed 35% when the linear value was 42.38%), the new formula, the two removed keys with the rejection message, and that the 87.5 floor in Context was the owner's earlier figure now configurable (default 80); refresh the ADR-054 `documentation/decisions/INDEX.md` summary. — **AC**: `bun run verify` green for `V-ADR-06` (amendment cites 1293), `V-ADR-01/02/03` and `V-DOCHEALTH-*`; `grep -n "pct_per_weekday" documentation/decisions/ADR-054-catchup-mode-quota-pacing.md` matches only inside the amendments section.
- [ ] **T11 rebuild and verify**: `bun run build` (regenerates the dist trees from `src/**` and `scripts/**`), then `bun run verify`. No version bump. — **AC**: `bun run verify` green on the PR head in CI (job name and status quoted); `git diff --name-only` lists only Touch-Paths plus generated trees from `scripts/lib/build/targets.ts`, none of `templates/hooks/**`, `hook-schemas.md`, `claude-plugin-runtime.ts`, `forge-sync*`, `package.json`.

## Test Strategy
Behavioral unit tests on the pure `computePaceFloor` and `readPacing` through their public exports; config resolution tested through `resolveCatchup`; the CLI contract through the existing `scripts/pace-floor.test.ts` runner (real process, config file, usage file); the row text through the committed fixture comparison in `launch-summary.test.ts`. Tests change first and go red (T1-T4 fail on current code: `credits` exists, `weekly_target_pct` is unknown, the removed keys still resolve). Local runs are the five named spec files through `with-test-lock` (frugal, one at a time); the full suite and `bun run verify` run in CI (`ci-first-verification.md`). Data-structure axes for the new assertions: `floor_pct` and `elapsed_h` are scalar outputs of `computePaceFloor`; no map or set is asserted.

## Sprint Contract
All task ACs above hold; the five named specs pass; CI `bun run verify` is green on the PR head; the removed-key messages match the text in this plan byte for byte; ADR-054 carries a dated amendment citing #1293; no open-PR file is touched.
