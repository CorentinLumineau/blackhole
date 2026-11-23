---
type: plan
summary: "Plan for ADR-059: decisions.mode park by default in askOrPark(), campaign-record.ts decide (round without config change), sleep reduced to absence, launch print-only kept on absence only, Decisions rows on the launch summary, Run panel, dashboard and status page; one PR"
status: current
review_trigger: "on file change"
created: 2026-11-23
last_updated: 2026-11-23
related:
  - documentation/decisions/ADR-059-park-owner-decisions-by-default.md
---

# Plan - Park owner decisions by default (ADR-059)

Track: Standard. One PR.

## Tasks

| # | Task | Files | Acceptance criteria |
|---|------|-------|---------------------|
| 1 | `decisions.mode` resolution and the new `askOrPark()` | `scripts/lib/campaign-status/pending-decisions.ts` (+ test) | `askOrPark({})` is `park`; `{decisions: {mode: 'ask'}}` is `ask`; with `sleep_mode.enabled: true` it is `park` whatever the mode; `sleep_mode.enabled: false` alone is `park`; an invalid mode is `park` |
| 2 | `decide` subcommand; `wake` = `sleep --off` + the same round | `scripts/campaign-record.ts`, `scripts/lib/campaign-status/sleep-session.ts` (+ tests) | `decide` prints `{report, total, blocked_items, cards}` and leaves `config.json` byte-identical; its report has no away lines when the owner is not away and names the away state when they are; `wake` still releases the hold and turns `sleep_mode.enabled` off, and never writes `decisions` |
| 3 | Launch summary Decisions row | `launch-summary.ts`, `launch-config-rows.ts`, `types.ts` (+ tests) | Row key `decisions`, label `Decisions`, claims `decisions` and `sleep_mode`; value names the mode, the waiting count and away state; print-only stays keyed on `sleep_mode.enabled` or `question_channel: none` |
| 4 | Run panel, dashboard, status page, next action | `run-state.ts`, `dashboard.ts`, `html.ts`, `report.ts`, `templates/status-dashboard/index.html` (+ tests) | Run row `Decisions` reads `park · 3 waiting — run /blackhole decide`; pending panels end with `run /blackhole decide`; a parked item's next action names `/blackhole decide` |
| 5 | Docs and the choke-point check | `src/references/decision-parking.md` (new), `sleep-mode.md`, `clarify-gates.md`, `launch-gate.md`, `config-template.md`, `src/SKILL.md`, citing playbooks, `scripts/checks/sleep-choke-point.check.ts` | `V-SLEEP-01` accepts `decision-parking.md`; `bun run verify` checks pass in CI; generated trees rebuilt |

## Codebase Conventions

- Config resolution lives next to its consumer and is cited by `**Resolution**` in `config-template.md` (V-GATE-02).
- Every new top-level config block gets a Status page coverage row (V-CONFIG-03) and a `LAUNCH_ROW_CLAIMS` claim.
- State writes go through `writeJsonAtomic` / `installStateFile`; `pending-decisions.json` keeps its schema.
- Playbooks invoke scripts by source path (V-INVOKE-01).

## Verification

CI is the authority. Locally, one scoped test file at a time through `with-test-lock`.
