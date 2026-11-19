---
type: plan
summary: "Launch gate Budget card says 'No usage limit' and offers Set usage caps first when no cap is enforced; Adjust asks for the 5-hour stop line, weekly target_at_reset and enabled, deriving no_spawn_at"
status: current
review_trigger: "on file change"
created: 2026-11-18
last_updated: 2026-11-18
related:
  - documentation/plans/plan-linear-pace-floor.md
---

# Plan - Issue #1265

## Objective
The launch gate's Budget card asks only Accept / Adjust, Adjust opens step 4 (`parallel_max`), and the `usage_budget` thresholds are "edited in `config.json`". With `usage_budget.enabled` false (the default) or no usage reading, the owner accepts a card whose consequence ("Usage pacing is off: up to N workers run whatever the usage") is buried in the table and whose first option is a neutral Accept, so a run with no usage limit is the default path. Fix: (1) when the row has no usable limit, the card question opens with `No usage limit:` and the options put "Set usage caps" first and make "Run with no limit" an explicit, labelled choice; (2) Adjust on Budget asks for the 5-hour stop line, the weekly `target_at_reset` and `enabled`, derives `no_spawn_at`, and writes through step 6's atomic write.

Out of scope: #1277 (summary rows for every config block), `usage_budget.rates.*` / `coordination.*`, the catchup Pacing row, `usage_budget.weekly.no_new_starts_at`/`stop_campaign_at` (the resolver already defaults both to `target_at_reset`, `config-template.md` rows 131-132).

Verified state at `plan_base_commit` (780665a3): `budgetRow`/`budgetConsequence`/`ADJUST.budget`/`gateCards` are in `scripts/lib/campaign-status/launch-summary.ts`; #1293 only touched the catchup Pacing row and `floorBudget`, the run-mode Budget row is unchanged. All `usage_budget.enabled`, `five_hour.*`, `weekly.target_at_reset` keys are already registered in `config-template.md` (rows 126-132) and covered in its § Status page coverage (row 329), so V-CONFIG-02/03 need no new registration; AC 7 re-verifies this.

## Touch-Paths
- `scripts/lib/campaign-status/launch-summary.ts` (card text, options, `usageCapsPatch`)
- `scripts/lib/campaign-status/launch-summary.test.ts`
- `scripts/campaign-status.ts` (one new `usage-caps` subcommand, next to `config-summary`)
- `scripts/campaign-status.test.ts` (subcommand test)
- `src/references/launch-gate.md` (§ Questions Budget table row and its closing "After the adjusted steps" paragraph only; line 29 and the forge-sync text are #1335's)
- `src/agents/coordinator.md` (step 4, plus the step 6 "confirmed values" list)
- `src/references/coordinator-dashboard.md` (only the Budget-row consequence text, around line 53-56)
- plus all generated dist trees per `scripts/lib/build/targets.ts`

Not touched (open PRs): `templates/hooks/**`, `hook-schemas.md`, the guard files (#1327, #1334), `scripts/lib/forge-sync.ts`, `forge-sync.md`.

## Critical Files
- `scripts/lib/usage-budget.ts` (`resolveUsageBudget` is the validator the patch must pass; read-only here)
- `scripts/lib/campaign-status/budget.ts` (`resolveBudgetSettings`, `parallelMaxOf`; read-only)
- `src/references/config-template.md` (key registry; read-only, AC 7)

## Codebase Conventions
- Pure logic lives in `scripts/lib/campaign-status/*.ts`, CLI I/O in `scripts/campaign-status.ts` (`launch-summary.ts` header comment). A step whose output is a pure function of inputs is a `bun run scripts/<name>.ts` call, never prose (ADR-003, V-PROSE-01): so the `no_spawn_at` derivation is code, not a sentence in coordinator.md.
- A row carries its own choices through `LaunchRow.options` (`types.ts:486`; the Merge and Status page rows already do this); `gateCards` falls back to `[ACCEPT, Adjust]` only when absent. Reuse that, add no new field.
- Validation reuses `resolveBudgetSettings` (`budget.ts`) / `resolveUsageBudget` (`usage-budget.ts`); no second range check (V-INT-02).
- Consequence strings are length-capped (`MAX_CONSEQUENCE_CHARS`, asserted in `launch-summary.test.ts` Budget cases).
- Production consumers of the card: `gateCards` is consumed by `campaign-status.ts --summary --json`, and `launch-gate.md` § Questions tells the coordinator to "send the cards the `--json` output returns" (so card text changes need no coordinator prose beyond the Adjust target).

## Design choices (made under autonomy; the owner can revisit)
1. **"No usage limit" = the row cannot enforce a cap on the run**: `usage_budget` invalid, `enabled` false, or `enabled` true with no reading (`!b.probed`). Catchup is excluded: it already fails closed (skips) when usage is unreadable, so it never runs unlimited. Rejected alternative: only `enabled: false`. A missing reading with caps configured still spawns up to `parallel_max` workers unmetered, which is exactly the issue's "or the reading is missing".
2. **Question wording**: in those three states the consequence (hence the question, `Budget: <consequence>`) begins `No usage limit:` and keeps the existing reason (`pacing is off`, `usage not probed`, `usage_budget is invalid`) and the `up to N workers run whatever the usage` clause. The table's Consequence column shows the same text, so print-only mode (which asks nothing) still says it.
3. **Options when unlimited**: `[Set usage caps, Run with no limit]`, in that order. The platform's question card has no "default" flag; the first option is the recommended one, so Accept is no longer first and no longer named Accept. Labels avoid "Accept" so the owner cannot accept the no-limit state by habit. When a limit is enforced (enabled, probed, valid) the card stays `[Accept, Adjust]`. `Set usage caps` opens the same flow as Adjust.
4. **What Adjust asks (coordinator.md step 4, the one owner of these questions; launch-gate.md's Adjust target points at it)**: after `parallel_max`: (a) `enabled`, (b) the 5-hour stop line `five_hour.stop_workers_at` (percent, 1-100, only when the plan has a 5-hour window; skipped for weekly-only), (c) the weekly `target_at_reset` (percent in (0, 100], or none). No numbers are suggested or pre-filled beyond showing the current config value; the owner types them (issue: "the owner sets them via Adjust"). Free-form numeric answers use a text question; yes/no for `enabled`. Answering "Run with no limit" leaves `enabled` false and records a decision `usage limit: none (owner accepted)`.
5. **Derived `no_spawn_at`**: `no_spawn_at = stop_workers_at - 5`, the exact gap of the shipped defaults (85/90), so the derived pair is never invented relative to the template. A `stop_workers_at <= 5` is rejected (the resolver requires `no_spawn_at > 0`). `no_new_starts_at` and `stop_campaign_at` are not written: with `target_at_reset` set the resolver already defaults them to it. Answering the owner's own example ("50% on 5h windows, 80% at reset") gives `{enabled: true, five_hour: {no_spawn_at: 45, stop_workers_at: 50}, weekly: {target_at_reset: 80}}`.
6. **Where the derivation and validation live**: exported `usageCapsPatch({enabled, stopWorkersAt, targetAtReset}, currentUsageBudget)` in `launch-summary.ts` (pure), exposed as `bun run scripts/campaign-status.ts usage-caps --enabled <true|false> [--stop-workers-at N] [--target-at-reset N|none]` which prints the merged `usage_budget` block as JSON and exits 2 with the resolver's message when it fails `resolveBudgetSettings`. Step 6 writes that block into `config.json` through the existing atomic write, merging over (never replacing) the existing `usage_budget` keys such as `rates`/`coordination`.
7. **Print-only / sleep mode**: unchanged. Nothing is asked, and the summary row now says `No usage limit`; nothing is parked through `askOrPark()` for this (no new parked decision: choosing numbers is the owner's, but the gate simply does not change them while the owner is away).

Parked decisions: none. Nothing here is owner-only that must block the fix (no default values are chosen).

## Task Steps / Task Breakdown
1. **Red tests first** in `launch-summary.test.ts`: (a) pacing off, `usage_budget` invalid and enabled-but-not-probed rows: `row.consequence` starts `No usage limit:` and still contains `whatever the usage` / the reason; (b) `gateCards` Budget question for those three states has options `['Set usage caps', 'Run with no limit']` with non-empty descriptions; for GO / NO-SPAWN / STOP-WORKERS it stays `['Accept', 'Adjust']`; catchup Budget keeps `['Accept','Adjust']`; (c) `usageCapsPatch` cases. Run them, see them fail. — **AC**: `bun test scripts/lib/campaign-status/launch-summary.test.ts` fails on exactly the new cases before any source change, with the failures naming the new assertions.
2. **Card text and options** in `launch-summary.ts`: a `noLimit(state)` predicate used by `budgetConsequence` (prefix) and `budgetRow` (`options`); update `ADJUST.budget` text to `Open step 4: parallel_max, then the usage caps (enabled, 5-hour stop line, weekly target).`; update the existing Budget cases' consequence regexes that assert the old strings. — **AC**: all `launch-summary.test.ts` tests pass; every Budget consequence still has length <= `MAX_CONSEQUENCE_CHARS`; a row with `enabled: true` and a GO verdict has options `['Accept','Adjust']`.
3. **`usageCapsPatch`** (pure) + `usage-caps` subcommand in `campaign-status.ts`. — **AC**: `usageCapsPatch({enabled:true, stopWorkersAt:50, targetAtReset:80}, {})` returns `{enabled:true, five_hour:{no_spawn_at:45, stop_workers_at:50}, weekly:{target_at_reset:80}}`; it preserves existing `rates`/`coordination` keys; `stopWorkersAt: 5` and `targetAtReset: 0` and `101` throw with the key path; `targetAtReset: null` writes `target_at_reset: null`; the CLI prints that JSON and exits 0, and exits 2 on invalid input (tested in `campaign-status.test.ts`).
4. **Docs, `coordinator.md` step 4** (add the three questions, the derivation via `campaign-status.ts usage-caps`, and the decision record) and **step 6** (write the `usage_budget` block); **`launch-gate.md`** Budget row of the § Questions table now reads "Step 4 (`parallel_max`, then the usage caps); a stale or missing reading is refreshed with `usage-probe.ts`" and the "thresholds are edited in config.json" claim is removed; `coordinator-dashboard.md` Budget consequence text updated. — **AC**: `grep -n "edited in \`config.json\`" src/references/launch-gate.md` has no Budget-row match; `grep -n "usage-caps" src/agents/coordinator.md src/references/launch-gate.md` matches in coordinator.md step 4; `bun run scripts/checks/config-gate.check.ts` and the V-PROSE-01 check (`scripts/checks/prose-heredoc.check.ts`) pass; `launch-gate.md` diff touches only the Budget row and the closing paragraph.
5. **Build and verify**: `bun run build` regenerates dist trees; one focused spec run through `with-test-lock`; CI runs the suite. — **AC**: `bun run verify` reports no V-CONFIG-02/03, V-DOCHEALTH, generated-tree drift finding; the CI run on the pushed head is green.

## Test Strategy
Behaviour through the public seam: `budgetRow` / `gateCards` / `usageCapsPatch` / the CLI. Unit tests for the pure branches (red first), one CLI test for the wiring. No mocking of internals; fixtures reuse `panel()`, `usage()` and `SAMPLE_CONFIG` in `launch-summary.test.ts`. Local runs: the two touched spec files only (ci-first-verification, resource-frugal-testing); full suite is CI's.

## Documentation Impact
`src/references/launch-gate.md`, `src/agents/coordinator.md`, `src/references/coordinator-dashboard.md` (all in Touch-Paths). `config-template.md`: `None - the usage_budget keys it documents are unchanged; only how they are asked is.` Search-before-write considered: no new `documentation/` file is created; the durable plan itself is staged for carry.

## Execution Strategy & Stop Conditions
- If `bun run scripts/campaign-status.ts --summary --json` shows any Budget card whose first option is `Accept` while the row consequence starts `No usage limit:`, stop and fix the predicate before touching docs.
- If `resolveBudgetSettings` rejects the derived pair for a `stop_workers_at` in 6..100, abort the derivation change and revisit choice 5.
- If the implementer finds that `launch-gate.md`'s Budget row edit would need to touch line 29 or the forge-sync text, stop: that file region belongs to #1335.
- If a Touch-Path above shows a merge conflict with #1327, #1334 or #1335 at rebase, revert to the base version of that hunk and rebase again rather than resolving it by hand.
- If `bun run verify` reports a V-CONFIG-02 or V-CONFIG-03 finding, halt: a key was added that this plan did not intend to add.

## Sprint Contract
Every task above carries its own AC; the unqualified "tests and linters pass" applies to none of them.

## Quality Gate Results
- `touch_paths_declared`: PASS
- `schema_baseline`: PASS (no config key added; `usage-caps` prints existing keys only)
- `ac_mapping`: PASS
- `critical_files_exist`: PASS
- `mitigation_concrete`: PASS
