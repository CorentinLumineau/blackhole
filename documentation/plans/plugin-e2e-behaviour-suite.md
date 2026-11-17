---
type: plan
summary: "Implementation plan for issue #1244's plugin behaviour e2e suite (ADR-053), the theme of the release after the upcoming one: fake-forge shim and scenario runner, units x tiers coverage matrix with V-E2E-01, hook replay and metamorphic fuzz, campaign scenarios, golden workflow, four-target load check, live claude plugin eval plus a bare mini-campaign, and release-gate wiring"
status: current
review_trigger: "on ADR-053 acceptance or amendment"
created: 2026-11-17
last_updated: 2026-11-17
related:
  - documentation/decisions/ADR-053-behaviour-e2e-suite.md
  - documentation/investigations/research-plugin-e2e-testing.md
  - documentation/decisions/ADR-027-forge-adapter-interface.md
---

# Plan — plugin behaviour e2e suite (issue #1244)

Design: ADR-053 (proposed, owner gate pending). Research: `research-plugin-e2e-testing.md`.
Plan base: `2c590fc6`. Pareto: Gain 9, Effort 7, Priority 36 (≥ 30).

## Objective

Build the T2–T5 tiers and the units × tiers coverage matrix, and make release N+2 (the release
after the upcoming one) the first release they gate. **Nothing here ships in the upcoming
release**; S8's gate wiring merges only after that release is tagged.

## Story Impact

Blackhole has no `documentation/user-stories/` catalog. S2 creates `e2e/behaviours.md`, the
catalog of user-visible campaign behaviours the coverage check reads; each slice that adds a
behaviour adds its row there. No existing behaviour changes.

## Evidence: where regressions landed

36 `fix` commits in local history (112 commits, shallow) and 49 closed `bug` issues:

| Area | Fix commits | Bug issues | Examples |
|---|---|---|---|
| PreToolUse hooks (false deny, escape, timeout, fail-open) | 16 | 19 | #729, #1226, #1116, #1027, #1070, #1078, #1184, #1195, #1197, #1199, #1143 |
| Stacking and merge order | 7 | 1 | #1166, #1113, #341 |
| Status page | 4 | 3 | #1141, #1147, #1154, #1139, #1127 |
| Worker-return validation | 0 | 4 | #380, #381, #950, #953 |
| Forge adapter | 1 | 1 | #1240 |
| CI diagnosis | 1 | 1 | #1207, #984 |

## Pareto: the 20% of scenarios to build first

| # | Scenario (tier) | Would have caught |
|---|---|---|
| 1 | Hook replay of real worker calls + metamorphic fuzz (T3) | #729, #1226, #1116, #1026, #1179 (false denies); #1027, #1070, #1077, #1078, #1184 (escapes); #1195, #1197, #1199 (timeouts on 120 KB inputs); #1143 (fail-open) |
| 2 | Stacked chain, parent squash-merged, child restacked (T2) | #1166, #1113, `c4942669`, `ba935fe3`, #341 |
| 3 | Status page from a fake gitea and github forge (T2) | #1141, #1147, #1154, #1139, #1127 |
| 4 | Worker-return validation per role via SubagentStop (T2) | #380, #381, #950, #953 |
| 5 | forge-sync with > 1 MiB of forge output (T2) | #1240 |
| 6 | Red CI routed through trunk-red (T2) | #1207, #984 |

About 45 of ~60 recorded regressions.

## Touch-Paths (union; each slice names its own)

`e2e/**` (new), `scripts/e2e.ts`, `scripts/e2e-inventory.ts`, `scripts/e2e-hook-replay.ts`,
`scripts/e2e-live.ts`, `scripts/lib/e2e/**` (new), `scripts/checks/e2e-coverage.check.ts`,
`scripts/checks/e2e-golden-hygiene.check.ts`, `scripts/lib/campaign-status/queue.ts`
(`QUEUE_TRANSITIONS` only), `scripts/verify.ts`, `scripts/release.ts`, `scripts/release.test.ts`,
`scripts/verify.cursor-harness.test.ts`, `src/references/blackhole-vcodes.md` plus all generated
dist trees per `scripts/lib/build/targets.ts`, `package.json` (scripts, `fast-check` dev
dependency), `bun.lock`, `.github/workflows/verify.yml`, `.github/workflows/release.yml`,
`documentation/runbooks/e2e-suite.md` (new), `ARCHITECTURE.md`.

## Documentation Impact

ADR-053 and its INDEX row (staged); the research note (staged by the investigator); new runbook
`documentation/runbooks/e2e-suite.md` (search-before-write: no doc under `documentation/runbooks/`
covers e2e); ARCHITECTURE.md § 8 gains the tiers.

## Critical Files

- `scripts/lib/forge-adapter/cli.ts`
- `scripts/lib/campaign-status/queue.ts`
- `scripts/release.ts`
- `templates/hooks/pretooluse/validate-bash-command.js`
- `templates/hooks/pretooluse/validate-file-changes.js`
- `.github/workflows/release.yml`

## Codebase Conventions

Bun + TypeScript with co-located `*.test.ts`; flags via `scripts/lib/argv-flags.ts`; JSON via
`readJsonFile`; checks as `scripts/checks/*.check.ts` registered in `verify.ts`; numeric facts in
`scripts/lib/build/facts.ts`; prose edited in `src/` then `bun run build`; worker-return fixtures
in `fixtures/worker-json/` reused as scripted returns.

## Database/API Schema Changes

New file schemas only, each defined in its slice: `scenario.json`, `forge.json`,
`forge-writes.jsonl`, `coverage-matrix.json`, `e2e/coverage-baseline.json`, the hook-corpus
record, `e2e/attestation.json`. New exported constant `QUEUE_TRANSITIONS` in
`scripts/lib/campaign-status/queue.ts`. New V-code row `V-E2E-01`. No change to `queue.json`,
ledger or config schemas.

## Dependency Blast-Radius

| Consumer | Classification | Verification |
|---|---|---|
| `scripts/lib/forge-adapter/{cli,tea-cli,glab-cli}.ts` | TRANSPARENT | reasoned: bare-name spawn, PATH-intercepted; S1 AC asserts no edit |
| `scripts/lib/campaign-status/queue.ts` importers (state-write-guard, campaign-status) | TRANSPARENT | reasoned: additive export only |
| `scripts/release.ts` callers (`release.yml`, `bun run release`) | BREAKING (intended) | reasoned: S8 adds refusals, each with a test |

## Task Breakdown

1. **S1 — Fake forge shim and scenario runner (T2 core).** Touch: `e2e/bin/{gh,tea,glab}`,
   `scripts/lib/e2e/{fake-forge,runner,normalize}.ts`, `scripts/e2e.ts`, `package.json`,
   `e2e/scenarios/ingest-new-issue/`, `e2e/forge-recordings/`. Test: unit tests per module; the
   shim answers the exact argv the adapter builds, from recorded fixtures; contract test compares
   shim output with recorded real CLI output for the same argv.
   — **AC**: `bun run e2e` passes `ingest-new-issue`; an unscripted argv exits 97 and fails the
   scenario naming the argv; the contract test fails when one recorded real response is edited;
   `git diff --name-only origin/main -- scripts/lib/forge-adapter/` is empty.
2. **S2 — Inventory, coverage matrix and V-E2E-01.** Touch: `scripts/e2e-inventory.ts`,
   `scripts/lib/e2e/coverage.ts`, `scripts/checks/e2e-coverage.check.ts`, `e2e/behaviours.md`,
   `e2e/coverage-baseline.json`, `scripts/lib/campaign-status/queue.ts` (`QUEUE_TRANSITIONS`),
   `scripts/verify.ts`, `src/references/blackhole-vcodes.md` + dist trees. Test: red fixtures.
   — **AC**: the report prints one line per unit × tier row with covered/total and no overall
   percentage; the check fails on each red fixture: an unmapped script, a dangling tag, a tag on a
   scenario rather than an assertion, a `#trigger` with no `#near-miss`, a hook id with only a
   deny case, an untaken legal queue edge, and a baseline that grew; it passes on the committed
   baseline. `--prove-falsifiable` flags a fixture assertion that cannot fail.
3. **S3 — Hook replay and fuzz (T3, Pareto #1).** Touch: `scripts/e2e-hook-replay.ts`,
   `scripts/lib/e2e/{corpus-mine,hook-fuzz}.ts`, `e2e/hook-corpus/**`, `package.json`
   (`fast-check`), `bun.lock`. Corpus mined from `.blackhole/hook-events/`, its archive, and
   session transcripts, scrubbed with the hook-event redactor. Replay at base and head; fuzz with
   fast-check over wrappers, subshells, brace groups, `eval`, quoting, redirects, `cd` chains.
   — **AC**: every hook pattern id has a deny and an allow case; replay fails when a fixture
   hook change flips one record's verdict and passes when the PR body lists it as
   `Hook-verdict:`; the fuzz, run against the pre-fix hook of #1077 or #1027, finds a deny→allow
   flip; `xargs -I{}`/`find -exec` fixtures are marked `allow-knowingly`; `grep -rE
   'ghp_|AKIA|/home/[a-z]' e2e/hook-corpus` returns nothing (scope `e2e/hook-corpus`, no exemptions).
4. **S4 — Campaign scenarios (T2, Pareto #2–#6).** Touch: `e2e/scenarios/*/`. Scenarios:
   stacked-chain-squash-parent, status-page-gitea, status-page-github, worker-return-per-role,
   forge-sync-large-repo, red-ci-trunk-red, review-changes-loop, sleep-park-resume,
   design-aggregate-verdict, carry-staged-artifacts, plus a fast-check model-based queue sequence.
   — **AC**: each named regression's input fails on its pre-fix commit and passes on HEAD,
   recorded in the PR body as `executed: … → FAIL/PASS`; every legal queue edge is taken.
5. **S5 — Golden workflow and hygiene.** Touch: `scripts/lib/e2e/golden.ts`,
   `scripts/checks/e2e-golden-hygiene.check.ts`, `documentation/runbooks/e2e-suite.md`.
   — **AC**: `bun run e2e --update <id>` rewrites only that scenario; the check fails on a golden
   containing an ISO timestamp, a 40-hex SHA or a `/home/`/`/tmp/` path, and on a golden diff
   with no `Golden: <id> — <reason>` line in the PR body.
6. **S6 — Four-target load check (T4).** Touch: `scripts/lib/e2e/harness-load.ts`,
   `scripts/verify.cursor-harness.test.ts`, `.github/workflows/verify.yml`.
   — **AC**: for each `COMMITTED_TARGET_TREES` tree, every declared agent, skill and hook
   resolves and parses; deleting one agent file from a built tree fails the check.
7. **S7 — Live tier (T5).** Touch: `scripts/e2e-live.ts`, `e2e/evals/<agent>/*` (`claude plugin
   eval` cases, including one trigger case per reviewer-judgment V-code), `e2e/live/sandbox/`
   (three seeded tiny issues), `e2e/attestation.json` schema. Spike first: prove `--bare
   --plugin-dir` keeps the plugin's hooks active. Calibration run sets `--max-cost-usd`.
   — **AC**: the attestation records model, Claude Code version, k, cost, safety-invariant
   results (pass^3), per-case eval scores and baseline Δ, and mini-campaign outcomes; a sandbox
   seeded with an unexpected hook deny fails the run; a cap hit (exit 2) records `fail`.
8. **S8 — Release gate wiring (lands after the upcoming release is tagged).** Touch:
   `scripts/release.ts`, `scripts/release.test.ts`, `.github/workflows/release.yml`,
   `ARCHITECTURE.md`, runbook. — **AC**: `release.ts validate` refuses, one test each, on: a T2
   golden mismatch, an unlisted hook verdict change, a fuzz flip, a T4 failure, a non-empty
   coverage baseline, a missing attestation, an attestation commit that is not an ancestor or
   with a non-manifest change since, a version mismatch, a safety invariant below 3/3, an eval
   case below threshold, more than 10% of cases on the flake budget.

Order: S1 → S2 → (S3, S4, S5, S6 in parallel) → S7 → S8.

## Execution Strategy & Stop Conditions

- If the `--bare --plugin-dir` spike shows the plugin's hooks do not run, then stop S7 and
  return to the owner before writing evals.
- If the `insteadOf` rewrite makes ADR-027 detection read a non-github host, then halt S7 and
  set an explicit `forge` value in the sandbox config instead.
- If an S1 change edits a file under `scripts/lib/forge-adapter/`, then abort the slice.
- If an eval case cannot reach its threshold in three calibration runs, then stop and report it
  to the owner rather than lowering the threshold.
- If the upcoming release is not yet tagged when S8 is ready, then hold S8 (do not merge).
- If mined corpus records still contain a secret after redaction, then abort S3's commit and
  fix the redactor first.

## Sprint Contract

Each task's AC above; otherwise `bun run verify` and the slice's own tests green on CI.

## Quality Gate Results

| Check | Result |
|---|---|
| touch_paths_declared | PASS |
| schema_baseline | PASS (new file schemas, one new constant, one V-code row) |
| ac_mapping | PASS |
| critical_files_exist | PASS |
| mitigation_concrete | PASS |
