---
type: plan
summary: "Catchup-mode M3 plan: usage-budget.ts --floor (fail-closed, per-invocation, ADR-053 C3), the registered catchup config block, the `catchup` mode and its playbook (C2), and the launch gate widened from run to run and catchup with the pacing preset and a Pacing row"
status: current
review_trigger: "on milestone completion"
created: 2026-11-17
last_updated: 2026-11-17
plan_base_commit: f1d2afc3
related:
  - documentation/milestones/_active/catchup-mode/README.md
  - documentation/milestones/_active/catchup-mode/discovery.md
  - documentation/milestones/_active/catchup-mode/outcomes.md
  - documentation/milestones/_active/catchup-mode/milestone-2.md
  - documentation/decisions/ADR-053-catchup-mode-quota-pacing.md
---

# M3: Catchup mode with the full-config launch gate

Track: standard. Branch: `design/catchup-mode` (shared, already checked out). Estimate: about 7 hours
(T1 about 1.5 h, T2 about 45 min, T3 about 1 h, T4 about 30 min, T5 about 2 h, T6 about 1 h, T7 about
45 min), two commits, two `bun run build` runs. Depends on M2 (shipped: `usage.ts`, the provider chain,
`pace-floor.ts`).

## Objective

After this milestone:

1. `scripts/usage-budget.ts --floor <pct>` is the one catchup gate (ADR-053 C3). Unreadable usage, a
   reading with no weekly window, or a plan with no limits gives verdict `SKIP` (fail-closed). The floor
   replaces `stop_campaign_at` for that invocation only, the 5h lines come from the `catchup` config
   block, and `config.json` is never written. Without `--floor` the CLI behaves exactly as today.
2. A `catchup` config block exists and is registered in `src/references/config-template.md`
   (`pct_per_weekday` 17.5, `five_hour.no_spawn_at` 75, `five_hour.stop_workers_at` 80, `lane`,
   `claim_lease_hours` 24, `day_end_hour` 18), with V-CONFIG-02 rows and a V-CONFIG-03 status row.
3. `/blackhole catchup` exists as a mode: a `SKILL.md` Modes row and `src/references/phase-catchup.md`
   (compute the floor with `pace-floor` and `usage`, gate, then run the normal campaign, plus the
   scheduled-task prompt template that writes the host usage reading to a `--usage` file).
4. The launch gate serves `run` and `catchup` with the same full-config summary and Accept / Adjust per
   section. For `catchup` the pacing preset pre-fills the floor, the 5h caps and the lane, every value is
   adjustable for that invocation only, and a **Pacing** row shows the usage reading and the shortfall.
   Print-only mode covers scheduled runs. `stop` drains a catchup exactly like a run.

Out of scope: lane claims and `OWN_LANES` (M4, ADR-053 C4), mercure `git-issue` (C5), usage provider 4
(M2 D1). Until M4 the `lane` key is recorded and shown but nothing consumes it, so `catchup` is
single-account only (ADR-053 Consequences, migration order).

## Assumptions and deferred items (recorded, no interactive channel)

| # | Assumption | Consequence if wrong |
|---|-----------|----------------------|
| A1 | `--floor` forces the gate on whatever `usage_budget.enabled` says: the mode is itself the gate, so a disabled budget must not make it ungated. The base `usage_budget` still supplies `max_workers`, `rates`, `coordination` and `windows`; `weekly.target_at_reset` is ignored under `--floor` | An owner who wants a disabled budget to skip the gate would get a gate anyway; that is the safe direction |
| A2 | Under `--floor` both weekly lines (`no_new_starts_at`, `stop_campaign_at`) are set to the floor, on the already-resolved `UsageBudgetConfig`. Setting only `stop_campaign_at` would let the default 78% `no_new_starts_at` end the run below an 87.5% floor. `resolveUsageBudget` rejects equal lines without a target, so the override is built after resolution (`floorBudget`), never through the config | A future rule change to the resolver does not touch the floor path |
| A3 | `SKIP` is a new verdict name, exit 0 like every verdict. It fires when: usage cannot be read, no current window exists, the reading has no weekly window (a five-hour-only reading, or `usage_budget.windows` leaving none), or the plan has no limits (`no plan limits`). At or over the floor the existing `STOP-CAMPAIGN` is returned (`wake_at` null) and the mode logs and exits | A weekly-only plan still works: the five-hour leg is simply absent |
| A4 | A missing `catchup` block means the defaults. An invalid block is exit 2 for the CLIs and shows as `invalid` on the Pacing row, never a throw in the summary | Same contract as `usage_budget` |
| A5 | `lane` defaults to `null` (unset). M3 records and displays it; M4 consumes it. The Pacing row says `lane unset` and the playbook warns that a second account's run is unsafe until claims land | None until M4 |
| A6 | ADR "every row stays adjustable, exactly as in `run`" is read as: the same adjustable set as `run` (Scope, Merge, Budget, Status page, Kaizen and staging; Order, Peers, Sleep stay display-only) plus Pacing, whose Adjust opens the floor, the 5h caps and the lane. Adjustments are invocation-only and re-print through flags, never through `config.json` | If every row must become editable, the display-only rows gain Adjust steps later; additive |
| A7 | The floor is recomputed at every start and wake (it grows with the clock). An owner-adjusted floor is pinned in the orchestrator spawn text for that invocation and re-passed to each spawn round | A resume without the pinned value recomputes; safe, never lower than the computed pace |
| A8 | A manual `/blackhole catchup` leaves sleep mode as the owner set it. The scheduled-task template turns sleep mode on (idempotent) and never turns it off: `wake` stays the owner's | None |
| A9 | The local UTC offset in force at `now` is the one `pace-floor.ts` receives (M2 A7), read at the two CLI edges through `localUtcOffsetMinutes` | A DST change inside the week shifts later day ends by one hour (LOW) |
| A10 | `usage.ts` and the new `pace-floor.ts` take `--usage <file>` (a path); `status --summary` already owns `--usage '<json>'` (inline), so its catchup file hand-off is `--usage-file <path>`. `status --summary --mode catchup` rejects the inline `--usage` (exit 2): one hand-off route for catchup | Naming asymmetry is documented in `coordinator-dashboard.md` |
| A11 | No Bash tool in the planning session: the plan file was written directly, not through `.tmp` and rename | None |
| D1 | `orchestrator-runtime.md` is not edited: its usage-verdict table sits inside the V-STOP-03 forbidden-word scan, and the playbook's spawn text overrides step 1's usage call (`--floor`). `phase-catchup.md` states that a `SKIP` in a later round is a `STOP-CAMPAIGN` (drain, no wake) | If the orchestrator ignores the override, the V-STOP-03 extension below fails verify |
| D2 | Status page: no new dataset or panel. `catchup` is declared `none` with a reason; the Pacing row lives in the launch summary, and the existing budget panel keeps showing the verdict | A page row can be added later with a `bh-template-version` bump |

## Task Breakdown

Every task is test-first: write the failing test, see it fail, then write the code. Run named test files
through `with-test-lock` (one `bun test a b c` per task, never the full suite; CI runs it after the
push). A removed or retyped export imported only as a type is erased by bun, so each task that moves a
name states a `git grep` acceptance.

### T1. Pure catchup lib: `scripts/lib/catchup.ts`, `SKIP` verdict, `pace-log` acceptance (RED then GREEN)

Exports added to `scripts/lib/usage-budget.ts`: `section`, `pick`, `isPct`, `isPositive` (V-INT-02: one
validation vocabulary), and `'SKIP'` in `UsageVerdictName`. `scripts/lib/pace-log.ts`: `'SKIP'` joins
`USAGE_PAUSES` (a pause that spawns nothing), so `pace-log.ts --usage` accepts the verdict line.

New `scripts/lib/catchup.ts` (imports `usage-budget.ts`, `pace-floor.ts` and types only; no I/O except
the one named helper):

- `CatchupConfig`, `DEFAULT_CATCHUP` (`pct_per_weekday` and `day_end_hour` from `DEFAULT_PCT_PER_WEEKDAY`
  and `DEFAULT_DAY_END_HOUR` in `pace-floor.ts`, never restated), `resolveCatchup(config)`: throws
  `catchup.<key> must be ...` for a wrong type; `five_hour.no_spawn_at` must be below `stop_workers_at`;
  `lane` is `null` or a string matching `^[a-z0-9][a-z0-9._-]*$`; `claim_lease_hours` is a number > 0.
- `CatchupOverrides {floor_pct?, no_spawn_at?, stop_workers_at?, lane?}` and `applyOverrides(preset,
  overrides)`: invocation-only merge, revalidated (same errors, key path `--no-spawn-at` and so on).
- `floorBudget(budget, preset, floor)`: `{...budget, enabled: true, five_hour: preset caps, weekly:
  {no_new_starts_at: floor, stop_campaign_at: floor, target_at_reset: null}}` (A1, A2).
- `workersAtFloor(limits, now, budget, parallelMax, floor, preset)`: `SKIP` per A3, else
  `workersAllowed(limits, now, floorBudget(...), parallelMax)`.
- `readPacing(report, preset, now, utcOffsetMinutes)`: from a `UsageReport` (M2) returns `{status:
  'ok' | 'unreadable' | 'no-weekly', plan, used_pct, resets_at, five_hour_pct, floor_pct, credits,
  shortfall_pct, reason}` using `computePaceFloor`. `localUtcOffsetMinutes(now)` is the one impure helper.

Tests (new `scripts/lib/catchup.test.ts`; one case added to `scripts/lib/pace-log.test.ts`):

| Case | Expected |
|------|----------|
| `resolveCatchup({})` | the defaults: 17.5, 75/80, `lane` null, 24, 18 |
| partial block, then each wrong type, `no_spawn_at >= stop_workers_at`, bad lane, `claim_lease_hours` 0 | merged values, then a throw naming the key path |
| `applyOverrides` with `stop_workers_at` 70 and `no_spawn_at` 75 | throws; a valid override leaves the input preset unchanged |
| `floorBudget` | `enabled` true, both weekly lines equal the floor, `target_at_reset` null, 5h caps from the preset, `max_workers` and `rates` kept |
| week 70%, floor 87.5, five-hour 40% | `GO`, workers sized by the 5h headroom |
| week 87.5% and 90% with floor 87.5 | `STOP-CAMPAIGN`, `wake_at` null |
| week 80%, floor 87.5, 5h 76% and 81% | `NO-SPAWN` and `STOP-WORKERS` (caps 75/80, not 85/90) |
| `usage_budget.enabled: false` base | still `GO` under the floor (A1) |
| `limits` null, no current window, five-hour-only reading | `SKIP`, reason names why; weekly-only reading is `GO` |
| `readPacing` Fri 13 Nov 09:30Z, reset Mon 16 Nov 09:30Z, used 50, offset 0 | floor 61.25, credits 3.5, shortfall 11.25, `ok` |
| `readPacing` with `source: 'none'`; with `plan: 'none'` and no windows; five-hour-only | `unreadable`, `no-weekly` (reason `no plan limits`), `no-weekly` |
| pace-log line with verdict `SKIP` | accepted, `rate_limit_stop` true |

Acceptance:
- `with-test-lock bun test scripts/lib/catchup.test.ts scripts/lib/usage-budget.test.ts scripts/lib/pace-log.test.ts scripts/lib/pace-floor.test.ts` exits 0 with the new cases present and no existing assertion edited.
- `git grep -nE "Date\.now|new Date\(\)" scripts/lib/catchup.ts` matches only inside `localUtcOffsetMinutes`.
- `git grep -n "DEFAULT_PCT_PER_WEEKDAY\|DEFAULT_DAY_END_HOUR" scripts/lib/catchup.ts` shows both imported, and `17.5` and `18` appear in `catchup.ts` nowhere as literals.

### T2. `usage-budget.ts --floor` (RED then GREEN)

Depends on T1. `scripts/usage-budget.ts`: new flag `floor` in the `unknownFlagKeys` list and the `USAGE`
line and header (the header says the floor is for one invocation, fail-closed, and never writes config).
`--floor` must be a number in (0, 100] (else exit 2). With it: `resolveCatchup(config)` (invalid block exit
2), `floorBudget`, then the reading path is unchanged and the verdict comes from `workersAtFloor`. Output
keeps the one JSON line, adding `floor_pct`; `SKIP` also prints one stderr line `usage-budget: SKIP:
<reason>`. Without `--floor` nothing changes (the existing suite is the guard).

Tests (extend `scripts/usage-budget.test.ts`, `spawnSync('bun', ['run', cli, ...])`, `--now` pinned):

| Case | Expected |
|------|----------|
| `--floor 87.5 --usage` weekly 70, five-hour 40 | exit 0, `GO`, `floor_pct` 87.5 |
| `--floor 61.25 --usage` weekly 62 | `STOP-CAMPAIGN`, `wake_at` null |
| no `--usage`, no cache | `SKIP`, stderr starts `usage-budget: SKIP:` (without `--floor` the same input is `unavailable`) |
| `--usage` five-hour only | `SKIP` |
| config with `catchup.five_hour` 60/70 and five-hour 65 | `NO-SPAWN` (config block honoured) |
| config file bytes before and after a `--floor` run | identical (`config.json` never mutated) |
| `--floor 0`, `--floor 101`, `--floor abc`, bare `--floor`, invalid `catchup` block | exit 2 |
| every existing case with no `--floor` | unchanged |

Acceptance: `with-test-lock bun test scripts/usage-budget.test.ts scripts/lib/catchup.test.ts` exits 0;
`git grep -n "writeFile\|renameSync" scripts/usage-budget.ts` returns nothing.

### T3. `scripts/pace-floor.ts` CLI and the V-ARGV-01 entry

Depends on T1. The playbook needs the floor as a number before the gate runs, and `pace-floor.ts` has no
CLI yet. `scripts/pace-floor.ts`, built like `usage.ts`: `parseFlags` and `unknownFlagKeys`, flags `usage`
(a file path), `cache`, `host`, `config`, `now`; `import.meta.main` guard; reads the report through
`usageSourceFor(...).report(now)`, then `readPacing` with `resolveCatchup(config)` and
`localUtcOffsetMinutes`. Prints one JSON line `{status, floor_pct, credits, shortfall_pct, used_pct,
resets_at, plan, source, reason}`; exit 0 on every status (`floor_pct` null unless `ok`), 2 on bad usage,
a broken `--usage` file or an invalid config. `package.json`: `"pace-floor": "bun run scripts/pace-floor.ts"`.
`scripts/checks/argv-flags-adoption.check.ts`: add `'scripts/pace-floor.ts'` (sorted) and fix the
header counts (17 to 18); `scripts/verify.argv-flags-adoption.test.ts` test title 17 to 18.

Tests (new `scripts/pace-floor.test.ts`, spawn style of `usage.test.ts`): normalized `--usage` file with
`--now` gives `ok`, floor 61.25 and shortfall 11.25 for a catchup `day_end_hour` of 18 under `TZ=UTC`;
a `catchup.pct_per_weekday` 20 config scales the floor; no source gives `unreadable` with `floor_pct`
null and exit 0; a plan-none file gives `no-weekly`; malformed file, `--now abc`, unknown flag exit 2;
stdout is exactly one line.

Acceptance: `with-test-lock bun test scripts/pace-floor.test.ts scripts/verify.argv-flags-adoption.test.ts` exits 0; `git grep -n "scripts/pace-floor.ts" scripts/checks/argv-flags-adoption.check.ts package.json` shows both.

### T4. Register the `catchup` block (V-CONFIG-02, V-CONFIG-03)

Depends on T1 (key names). `src/references/config-template.md`: field rows `catchup` (with a
`(sub-keys: ...)`-free per-leaf form, like `usage_budget`), `catchup.pct_per_weekday`,
`catchup.five_hour.no_spawn_at`, `catchup.five_hour.stop_workers_at`, `catchup.lane`,
`catchup.claim_lease_hours`, `catchup.day_end_hour`, each with Required `no`, default and range, and a
Resolution sentence (absent block or key means the default; wrong type throws with the key path).
One contract note after the table: the block is read only by `catchup` mode, `usage-budget.ts --floor`,
`pace-floor.ts` and the launch gate; it never changes `run`; the invocation overrides never write it; `lane`
is recorded but consumed from M4. One `## Status page coverage` row: `catchup | none | — | The pacing
preset is shown on the launch summary's Pacing row; the budget panel keeps the verdict`.

Test: `scripts/verify.config-registration.test.ts` and `scripts/verify.status-coverage.test.ts` (find the
real names with `Glob scripts/verify.*config*test.ts scripts/verify.*coverage*test.ts`) gain one case each
that the seven keys parse out of the real template and the coverage row has a reason.

Acceptance: `with-test-lock bun test <those two files> scripts/verify.config-gate.test.ts` exits 0; `rg -c "catchup\." src/references/config-template.md` is at least 6.
Commit 1 follows T4 (`feat(usage): catchup floor gate, pace-floor CLI and the catchup config block`).

### T5. Launch summary for `run` and `catchup`

Depends on T1, T3. Edit `src/`-free TypeScript first; docs are T6.

- `scripts/lib/campaign-status/types.ts`: `CATCHUP_ROW_KEYS = ['scope','order','merge','pacing','budget',
  'status_page','kaizen_staging','peers','sleep']`; `LaunchRowKey` becomes the union of both lists;
  `LAUNCH_ROW_KEYS` stays the eight run keys.
- `scripts/lib/campaign-status/budget.ts`: `buildBudgetPanel`, `readBudgetPanel` and `givenBudgetPanel`
  take an optional resolved `budget?: UsageBudgetConfig` that `verdictFor` uses instead of resolving the
  config (a catchup passes `floorBudget(...)`); no behaviour change without it.
- `scripts/lib/campaign-status/launch-summary.ts`: `LaunchSummaryInput` gains optional `catchup?:
  {preset: CatchupConfig; floorPct: number | null; pacing: Pacing; budget: UsageBudgetConfig}`. Absent:
  the eight run rows, byte-identical output. Present: nine rows in `CATCHUP_ROW_KEYS` order; `budgetRow`
  reads the thresholds from `catchup.budget` (so it shows `stops 5h 75/80, weekly <floor>`), and when
  usage is unreadable its consequence is `Usage unreadable: the catchup skips and spawns nothing
  (fail-closed).` New `pacingRow`: `value` = `plan <plan> · weekly <used>% (resets <when>) · floor <f>%
  (<credits> credits x <pct>) · shortfall <s>% · 5h caps <a>/<b> · lane <lane|unset>`; consequence by
  status, each at most `MAX_CONSEQUENCE_CHARS`: shortfall above 0 `Spends about <s> points of weekly quota
  on backlog work and stops at <f>%; 5h spawns stop at <a>%, workers at <b>%.`; shortfall 0 `Usage is at or
  above the floor: the catchup exits without spawning.`; unreadable or no weekly window `...: the catchup
  skips (fail-closed).`; invalid block `catchup config is invalid, so the catchup cannot start.`.
  `pacingRow` is adjustable; `ADJUST.pacing` = `Change the floor, the 5h caps or the lane for this
  invocation only; config.json is untouched.`. `gateCards` and `renderLaunchSummary` are unchanged
  (print-only still returns no cards).
- `scripts/lib/campaign-status/cli.ts` and `scripts/campaign-status.ts`: `--summary` accepts `--mode
  run|catchup` (default `run`) and, only with `--mode catchup`, `--usage-file <path>`, `--floor <pct>`,
  `--no-spawn-at <pct>`, `--stop-workers-at <pct>`, `--lane <name>`; inline `--usage` with catchup is an
  error (A10). The catchup path reads `report(now)` and `read(now)` from `usageSourceFor(host, config,
  {usageFile})`, builds the panel with the floor budget, and `--json` adds `pacing` (the `Pacing` object
  plus the effective preset and floor) beside `rows`, `cards`, `warnings`. `USAGE` lines list the flags.

Tests (extend `scripts/lib/campaign-status/launch-summary.test.ts`; new fixtures
`scripts/fixtures/campaign-status/full/usage.catchup.json` and `launch-summary.catchup.expected.md`; a CLI
case in the existing `--summary` test file, found with `Grep "summary" scripts/*.test.ts`):

| Case | Expected |
|------|----------|
| the run summary of the full fixture | the committed `launch-summary.expected.md`, unedited, still equal |
| catchup summary of the full fixture (NOW Fri 13 Nov 09:30Z, week 50%, reset Mon 16 Nov 09:30Z, five-hour 40%, offset 0) | nine rows in `CATCHUP_ROW_KEYS` order; Pacing value contains `floor 61.25%` and `shortfall 11.25%`; Budget row shows `5h 75/80`; equals `launch-summary.catchup.expected.md` |
| `[...CATCHUP_ROW_KEYS]` minus `pacing` | equals `[...LAUNCH_ROW_KEYS]` |
| every catchup consequence | non-empty and at most 140 chars (shortfall, none, unreadable, no-weekly, invalid) |
| `gateCards` for catchup, not print-only | Pacing, Scope, Merge, Budget, Status page, Kaizen questions, 4 per card; Order, Peers, Sleep absent |
| `gateCards` print-only for catchup | `[]` |
| override `floor_pct` 80 and `no_spawn_at` 70 | Pacing value shows floor 80 and caps 70/80; the preset input is not mutated |
| unreadable usage in catchup | Pacing consequence says fail-closed; Budget consequence says the catchup skips |
| CLI: `--summary --mode catchup --usage-file <fixture> --now <epoch> --json` | exit 0, `pacing.floor_pct` 61.25; `--mode catchup --usage '<json>'` exit 2; `--floor` without `--mode catchup` exit 2 |

Acceptance: `with-test-lock bun test scripts/lib/campaign-status/launch-summary.test.ts scripts/lib/campaign-status/budget.test.ts` (second file only if `Glob scripts/lib/campaign-status/budget*.test.ts` finds it) and the CLI test file exit 0; `git grep -nE "from '\.\./(\.\./)?pace-gate" scripts/lib/campaign-status/launch-summary.ts` returns nothing.

### T6. Docs, mode wiring and checks

Depends on T5. Edit `src/` only (never `skills/`).

- `src/references/phase-catchup.md` (new, no date in the name): the playbook. Sections: (1) when to use
  and the single-account warning (A5); (2) steps: resolve the run context; read usage (`bun run usage`,
  or `--usage <file>` on a host with only an app tool); `bun run pace-floor` for the floor; the gate
  `bun run scripts/usage-budget.ts --parallel-max <n> --floor <pct> [--usage '<json>']` with its verdict
  table (`GO` continue; `STOP-CAMPAIGN` is "at or above the floor", log and exit; `SKIP`,
  `PACE-WAIT`, `NO-SPAWN`, `STOP-WORKERS` log the reason and exit, `no ready work` is its own skip
  reason); then the launch gate (`launch-gate.md`, catchup form) and the normal campaign with the pinned
  floor in the spawn text so every spawn round runs `usage-budget.ts --floor <pct>` instead of step 1's
  plain call (D1); a later-round `SKIP` is a `STOP-CAMPAIGN` (drain, no wake, `phase-stop.md` § Usage
  stop); (3) `stop` drains a catchup like a run; (4) the scheduled-task prompt template: one line
  (`/blackhole catchup`) plus the hand-off, with the schedule from ADR-053 (weekdays about 18:00, 23:00,
  04:00; weekends every 5 h), writing the app's usage tool output to a file and passing `--usage <file>`,
  turning sleep mode on (A8), and the copy-per-account note (set `catchup.lane`). Cites the ADR; never
  restates it. Every block that names `pace-gate.ts` also names `usage-budget.ts` (V-STOP-03).
- `src/SKILL.md`: a `catchup` Modes row (`catchup`, `/blackhole catchup`, "burn the weekly quota down
  to the pace floor"; Coordinator spawns orchestrator, playbook link); Phase 0 step 1 wording: "The gate
  applies in `run` and `catchup` modes only"; the `stop` row notes it drains a catchup.
- `src/references/launch-gate.md`: `## When it runs` becomes `run` and `catchup`; a `## Catchup form`
  section (preset defaults, Pacing row, invocation-only adjustments through the summary flags, the
  Adjust target for Pacing, `--usage-file`); the Questions table gains the Pacing row; Print-only mode
  states it is how a scheduled catchup runs (sleep mode on, or no question channel: summary printed,
  every row accepted, then the `--floor` gate decides); `merge_mode` unset still refuses to start.
- `src/agents/coordinator.md`: the Routine resume confirmation gate bullet and the closing sentence say
  "`run` and `catchup` modes only" and add `catchup` to the mode resolution against `SKILL.md` § Modes.
- `src/references/claude-code-native.md` § Bootstrap gate ownership: "every `run`- or `catchup`-mode
  campaign start".
- `src/references/coordinator-dashboard.md` § Command: the nine-row catchup form and the new flags,
  documented once there (A10).
- `src/references/phase-stop.md`: one sentence outside every Usage stop section: a `catchup` is a `run`
  for all three tiers.
- `scripts/lib/build/facts.ts`: `PHASE_PLAYBOOK_FILES` gains `'phase-catchup.md'` (V-GROUND-01 scan;
  the playbook mentions at least one phase name for V-PHASE-01).
- `scripts/checks/config-gate.check.ts`: `COORDINATOR_ROUTINE_RESUME_REQUIRED_MARKERS` replaces
  `'run` mode only'` with `'run` and `catchup` modes only'`; SKILL marker `'mode only'` becomes `'modes
  only'`; `LAUNCH_GATE_REQUIRED_MARKERS` gains `'catchup'`, `'Pacing'`; the Pattern C markers gain
  `'catchup'`. `scripts/verify.config-gate.test.ts` fixtures follow.
- `scripts/checks/stop-mode.check.ts`: V-STOP-02 requires `phase-stop.md` to mention `catchup`; V-STOP-03
  adds `src/references/phase-catchup.md` to `PATTERN_SPAWN_SITES` and requires it to cite `--floor`.
  `scripts/verify.stop-mode.test.ts` gains the matching red and green fixture cases.

Tests: the marker and stop-mode fixture tests above, written first (stale text fails, new text passes),
plus `scripts/verify.playbook.test.ts` unchanged and green (its fixtures follow `PHASE_PLAYBOOK_FILES`).

Acceptance:
- `with-test-lock bun test scripts/verify.config-gate.test.ts scripts/verify.stop-mode.test.ts scripts/verify.playbook.test.ts scripts/verify.ground-truth.test.ts` exits 0 (use `Glob scripts/verify.*ground*` for the real name).
- `with-test-lock bun run scripts/verify.ts` is not run; instead the targeted checks run: `with-test-lock bun run scripts/checks/config-gate.check.ts` and the same for `stop-mode`, `playbook`, `ground-truth` each report ok (CI runs the full verify).
- `rg -n "run\` mode only" src` returns nothing; `rg -c "catchup" src/SKILL.md src/references/launch-gate.md src/agents/coordinator.md src/references/claude-code-native.md src/references/phase-stop.md src/references/phase-catchup.md` is at least 1 for each.

### T7. Build, index row, commit 2, scout

Depends on T6. `with-test-lock bun run build`. Splice the `milestones/_active/catchup-mode/milestone-3.md`
row into `documentation/INDEX.md` (`bun run scripts/generate-doc-index.ts`, copy the one new row, never
overwrite the file; the new `phase-catchup.md` is under `src/`, not `documentation/`, so it needs no
row); `bun run scripts/generate-doc-index.ts --check` exits 0. Commit 2 with explicit paths, never `git
add -A`: `feat(catchup): catchup mode with the full-config launch gate` with a body naming ADR-053 C2 and
C3 and deferrals D1 and D2. No AI attribution lines. Run the Scout Check on the diff and record one
Improvement Record (planned candidate: the header counts in `argv-flags-adoption.check.ts` that the diff
touches anyway).

Acceptance: `git status --short` shows only planned `src/`, `scripts/`, `documentation/`, `package.json`
and rebuilt outputs; two commits on `design/catchup-mode` (T1-T4, then T5-T7); `ls
plugins/blackhole-claude/scripts/pace-floor.ts plugins/blackhole-claude/scripts/lib/catchup.ts` lists both.

## Critical Files

| File | Change | Why |
|------|--------|-----|
| `scripts/lib/catchup.ts` | new: resolver, overrides, `floorBudget`, `workersAtFloor`, `readPacing` | One home for the catchup math; CLIs and the summary share it |
| `scripts/lib/usage-budget.ts` | export 4 helpers, `SKIP` in `UsageVerdictName` | Reuse validation (V-INT-02), new verdict |
| `scripts/usage-budget.ts` | `--floor` | ADR-053 C3 |
| `scripts/pace-floor.ts`, `package.json`, `scripts/checks/argv-flags-adoption.check.ts` | new CLI, alias, allowlist | The playbook needs the floor as a number |
| `scripts/lib/pace-log.ts` | `SKIP` is a pause | The verdict line must stay accepted |
| `src/references/config-template.md` | seven field rows, contract note, coverage row | V-CONFIG-02, V-CONFIG-03 |
| `scripts/lib/campaign-status/types.ts`, `launch-summary.ts`, `budget.ts`, `cli.ts`, `scripts/campaign-status.ts` | catchup rows, Pacing row, panel override, flags | ADR-053 C2 gate |
| `src/references/phase-catchup.md` (new), `src/SKILL.md` | playbook, Modes row, Phase 0 wording | ADR-053 C2 |
| `src/references/launch-gate.md`, `src/agents/coordinator.md`, `src/references/claude-code-native.md`, `src/references/coordinator-dashboard.md`, `src/references/phase-stop.md` | widen run-only to run and catchup | One gate, both modes |
| `scripts/lib/build/facts.ts` | `PHASE_PLAYBOOK_FILES` | V-GROUND-01 roster |
| `scripts/checks/config-gate.check.ts`, `scripts/checks/stop-mode.check.ts` and their tests | markers, wiring | Conformance |
| Tests: `catchup.test.ts`, `usage-budget.test.ts` (CLI), `pace-floor.test.ts` (CLI), `pace-log.test.ts`, `launch-summary.test.ts`, two config verify tests, the fixtures | new cases | Test-first evidence |
| `documentation/INDEX.md` | one row | Doc governance |

Not touched: `src/references/orchestrator-runtime.md` (D1), `scripts/lib/usage-source.ts` and
`usage-normalize.ts` (M2), the forge adapters, `blocked-classes.ts`, `forge-sync` (M4), the status page
template.

## Codebase Conventions

| Touchpoint | Convention | Source | Required by |
|------------|------------|--------|-------------|
| Config block | One `Field \| Required \| Description` row per leaf, a `## Status page coverage` row per top-level block | `src/references/config-template.md:33,284-316`, `scripts/checks/config-registration.check.ts:22-63` | V-CONFIG-02, V-CONFIG-03 |
| Config validation | `section`, `pick`, `isPct`, `isPositive` with `throw new Error('<key path> must be ...')`; exported, never copied | `scripts/lib/usage-budget.ts:67-82` | V-INT-02 |
| CLI argv | `parseFlags` and `unknownFlagKeys`; add the script to the V-ARGV-01 allowlist | `scripts/lib/argv-flags.ts:15-50`, `scripts/checks/argv-flags-adoption.check.ts:12-30` | V-ARGV-01 |
| CLI output | One `console.log(JSON.stringify(...))` line, reason on stderr, exit 0 on any verdict, 2 on bad usage; `main()` behind `import.meta.main` | `scripts/usage.ts:17-49`, `scripts/usage-budget.ts:22-27,113` | V-INT-01 |
| Usage reading | `usageSourceFor(host, config, {usageFile, cachePath}).report(now)` and `.read(now)`; `resolveHost` | `scripts/lib/usage-source.ts` | V-INT-02 |
| Pace math | `computePaceFloor` and its two default constants; never restate 17.5 or 18 | `scripts/lib/pace-floor.ts:11-12,27` | V-INT-02 |
| Narrow config types | A local narrow type per consumer, not one shared `CampaignConfig` | `scripts/lib/campaign-status/types.ts:90-119` | V-KISS-01 |
| Launch rows | `LaunchRow` per key, consequences at most 140 chars, `gateCards` builds Accept / Adjust from adjustable rows and none in print-only | `scripts/lib/campaign-status/launch-summary.ts:20,208-245` | V-INT-01 |
| Budget panel | One `BudgetPanel` for the gate and the status page; the override is optional so the page is unchanged | `scripts/lib/campaign-status/budget.ts:52-132` | V-INT-02 |
| Mode registration | A `Mode \| Trigger \| Who runs it` row plus a `references/phase-*.md` playbook declared in `PHASE_PLAYBOOK_FILES` | `src/SKILL.md:35-49`, `scripts/lib/build/facts.ts:25` | V-GROUND-01, V-SKILL-01 |
| Gate content assertion | Reuse `findMissingGateMarkers`; markers as exported constants with fixture tests | `scripts/checks/config-gate.check.ts:20-64` | V-INT-02 |
| Usage-stop prose | Forbidden words only inside the one `Never on a usage stop:` list; a block citing `pace-gate.ts` must cite `usage-budget.ts` | `scripts/checks/stop-mode.check.ts:49-143` | V-STOP-03 |
| Tests | Pure-lib tests import the module; CLI tests `spawnSync('bun', ['run', cli])` with `env: { PATH }` and `--now` pinned | `scripts/usage-budget.test.ts`, `scripts/usage.test.ts` | V-INT-01 |
| Build and docs | Edit `src/` and `scripts/`, then `bun run build`; new docs carry lifecycle frontmatter with `summary` and an INDEX row | `.claude/CLAUDE.md`, `scripts/generate-doc-index.ts` | V-DOC-GOV-02 |

## Dependency Blast-Radius

| Changed file | Downstream consumers | Blast radius |
|--------------|----------------------|--------------|
| `scripts/lib/usage-budget.ts` (4 exports, 1 union member) | `usage-budget.ts`, `usage-source.ts`, `campaign-status/budget.ts`, `launch-summary.ts`, `pace-log.ts`, tests | LOW (additive); a new union member can break an exhaustive `switch`, so T1 greps for `UsageVerdictName` switches |
| `scripts/usage-budget.ts` | orchestrator spawn rounds, `pace-log.ts --usage` | MEDIUM: every gate call goes through it; no `--floor` means no change, guarded by the unedited existing suite |
| `scripts/lib/campaign-status/budget.ts`, `launch-summary.ts`, `types.ts` | `campaign-status.ts`, the status page dataset writer, `status-coverage.check.ts` (`budgetRows`) | MEDIUM: the run summary and the page must stay byte-identical; the committed expected markdown is the guard |
| `config-gate.check.ts` markers | verify on every PR | MEDIUM: a wording slip in four docs fails verify; the real-tree marker tests pin it |
| `facts.ts` `PHASE_PLAYBOOK_FILES` | `ground-truth.check.ts`, `playbook.check.ts` | LOW |
| `src/` docs | built plugin trees (`plugins/*`, `skills/`, `.claude/`, `.cursor/`, `.agents/build/`, `codex-*`) | LOW: regenerated by `bun run build` |

Overall: MEDIUM. Each MEDIUM entry has an unchanged existing suite or fixture as its guard.

## Blast Radius

| Surface | Outside the diff | Why it matters |
|---------|------------------|----------------|
| Callers | Agents run `usage-budget.ts` from `orchestrator-runtime.md` step 1 and `pace-log.ts --usage`; `status --summary` from `launch-gate.md` | Without `--floor` and `--mode` their output is byte-identical |
| Consumers | `status-page.md` and `coordinator-dashboard.md` describe the summary; `sleep-mode.md` names the Sleep row | The summary text for `run` does not change |
| Config | `catchup` is new and optional; the committed `.blackhole/config.json` gets no key | V-CONFIG-02 needs rows only for keys present in it |
| Data | No new persisted state; `config.json` is never written by `--floor`; no checkpoint field | A crash cannot leave overrides behind (ADR-053 rejected alternative) |
| CI | `verify` (V-CONFGATE-01, V-STOP-02/03, V-GROUND-01, V-PHASE-01, V-ARGV-01, V-CONFIG-02/03, doc INDEX) and the full suite run in CI after the push | Not run locally |
| Built trees | Regenerated by `bun run build`; the committed output must match (CI sync check) | Stale output fails CI |

**Safety fact**: the run path is behaviour-preserving. Before any edit, `with-test-lock bun test
scripts/usage-budget.test.ts scripts/lib/campaign-status/launch-summary.test.ts` passes with the committed
`launch-summary.expected.md`; after T5 the same two files pass with that fixture unedited, and the
fixture's run rows still equal `LAUNCH_ROW_KEYS`. T5 quotes both runs in the commit body.

## Risk Assessment

| Risk | Severity | Mitigation |
|------|----------|------------|
| A fail-open slip burns quota unattended (usage unreadable yields GO) | MEDIUM | T1 and T2 tables pin `SKIP` for unreadable, five-hour-only and no-plan readings; A1 forces the gate on whatever `usage_budget.enabled` says |
| The floor ends the run early because `no_new_starts_at` (78) sits below it | MEDIUM | A2 and the T1 case (week 80%, floor 87.5, `GO` or the 5h verdicts, never `NO-NEW-STARTS`) |
| The run launch gate changes by accident while widening it | MEDIUM | The committed run fixture is unedited and still equal; the catchup code is behind the optional `catchup` input |
| Four docs and two markers drift apart (V-CONFGATE-01 fails in CI) | MEDIUM | T6 writes the marker tests first; the targeted check runs locally |
| The orchestrator ignores the spawn-text `--floor` override (D1) | MEDIUM | The V-STOP-03 extension requires `phase-catchup.md` to cite `--floor`; the first scheduled run validates it |
| Two accounts collide before lane claims exist | MEDIUM | A5: playbook and Pacing row say `lane unset`; single-account only until M4 |
| DST shifts a day end inside the week | LOW | A9 |
| A new union member breaks an exhaustive switch | LOW | T1 greps `UsageVerdictName` consumers; `budgetConsequence` already has a `default` case |

No HIGH-risk item, so no `## Stop Conditions` section.

## Execution Strategy

**Pattern**: Sequential on the shared branch. One test process at a time through `with-test-lock`;
focused files only; CI runs the full suite after the push.

| Agent | Task(s) | Model | Delegation Contract |
|-------|---------|-------|---------------------|
| x-implementer (or the main session) | T1 | sonnet | **Objective**: the pure catchup lib, `SKIP`, `pace-log` acceptance, tests first. **Output**: `catchup.ts`, its test, small edits to `usage-budget.ts`, `pace-log.ts`. **Scope**: those files; nothing under `src/`. **Tool guidance**: `with-test-lock bun test` on the four named files. **Stop**: table cases green, existing assertions unedited. |
| x-implementer | T2 | sonnet | **Objective**: `--floor` in `usage-budget.ts`. **Output**: the CLI edit and its test cases. **Scope**: `scripts/usage-budget.ts` and its test. **Tool guidance**: named test files. **Stop**: CLI table green, no-`--floor` cases unchanged. |
| x-implementer | T3 | sonnet | **Objective**: the `pace-floor.ts` CLI, alias, allowlist. **Output**: CLI, test, `package.json`, check and test title. **Scope**: those files. **Stop**: CLI table and V-ARGV-01 test green. |
| x-implementer | T4 | sonnet | **Objective**: register the block. **Output**: `config-template.md` rows and note, two test cases. **Scope**: that file and two verify tests. **Stop**: three config verify tests green; then commit 1 with explicit paths. |
| x-implementer | T5 | sonnet | **Objective**: widen the summary and status CLI, tests and fixtures first. **Output**: `types.ts`, `launch-summary.ts`, `budget.ts`, `cli.ts`, `campaign-status.ts`, tests, two fixtures. **Scope**: those files. **Tool guidance**: named test files. **Stop**: the run fixture unedited and green, catchup fixture green. |
| x-implementer | T6 | sonnet | **Objective**: playbook, mode row, gate docs, markers, stop-mode wiring, marker tests first. **Output**: the `src/` docs, `facts.ts`, two checks and tests. **Scope**: files in Critical Files tagged T6; no `skills/`. **Stop**: the four verify tests and four targeted checks green. |
| main session | T7 | sonnet | **Objective**: build, INDEX row, commit 2, scout record. **Output**: one commit, one Improvement Record. **Scope**: planned paths, explicit `git add`. **Stop**: `--check` exits 0, `git show --stat` lists planned paths only. |

**Parallelization**: none (T1, T2, T3, T4, T5, T6, T7 in order; T2 and T3 could overlap in principle and are
serialized by the one-test-process rule).

## Sprint Contract

### Machine-verifiable

- [ ] `with-test-lock bun test scripts/lib/catchup.test.ts scripts/lib/usage-budget.test.ts scripts/lib/pace-log.test.ts scripts/lib/pace-floor.test.ts scripts/usage-budget.test.ts scripts/pace-floor.test.ts` exits 0.
- [ ] `with-test-lock bun test scripts/lib/campaign-status/launch-summary.test.ts scripts/verify.config-gate.test.ts scripts/verify.stop-mode.test.ts scripts/verify.playbook.test.ts scripts/verify.argv-flags-adoption.test.ts` exits 0, with `launch-summary.expected.md` unedited.
- [ ] `bun run usage-budget` equivalent: `bun run scripts/usage-budget.ts --parallel-max 4 --floor 87.5 --usage '<five_hour 40, seven_day 70 JSON>' --now <epoch>` prints one JSON line with `verdict: "GO"` and `floor_pct: 87.5`; with no usage source it prints `SKIP`; `.blackhole/config.json` is byte-identical afterwards.
- [ ] `bun run pace-floor --usage <fixture> --now <epoch>` prints `floor_pct` 61.25 and `shortfall_pct` 11.25 for the full-fixture reading.
- [ ] `bun run status --summary --mode catchup --usage-file <fixture> --now <epoch> --json` returns nine rows whose keys equal `CATCHUP_ROW_KEYS`; the same command without `--mode` returns the eight run rows.
- [ ] `rg -n "run\` mode only" src` returns nothing; `rg -c "phase-catchup" src/SKILL.md scripts/lib/build/facts.ts` is at least 1 each.
- [ ] `with-test-lock bun run build` exits 0; `plugins/blackhole-claude/scripts/pace-floor.ts` exists.
- [ ] `bun run scripts/generate-doc-index.ts --check` exits 0.

### Human-verifiable

- [ ] Reading the catchup launch summary, an owner sees the usage reading, the floor, the shortfall, the 5h caps and the lane, and each value says what it costs.
- [ ] `phase-catchup.md` reads as a short playbook that cites ADR-053 and the gate docs without restating them, and its scheduled-task template fits one prompt.
- [ ] `launch-gate.md` states one gate for both modes, with the catchup differences in one section.
- [ ] Both commits reference ADR-053 and carry no AI attribution line.

## Plan Quality Gate

| Check | Result |
|-------|--------|
| 1 Task acceptance criteria (blocking) | Pass: every task states a measurable acceptance line |
| 2 Critical file existence | Pass: modified files were read or listed by Grep; new files are named as new; two test file names are resolved by a `Glob` step in the task |
| 3 Dependency completeness | Pass: T1 to T7 in order, no cycle; T3 and T5 depend on T1 |
| 4 Risk mitigation | Pass: each risk names a concrete mitigation |
| 5 Success criteria measurability | Pass: commands with expected results |
| 6 Boundary conditions (advisory) | Covered: unreadable, five-hour-only, weekly-only, plan none, at or over the floor, invalid block, bad flags, print-only, DST |
| 7 Stop conditions (advisory) | N/A: no HIGH risk |
| 8 Codebase conventions (blocking) | Pass: section populated at the touchpoints |

Marker count: 0 `[NEEDS CLARIFICATION]` (the one reading call, A6, is recorded as an assumption).
