# Decision Parking — park every owner question, answer them all with `/blackhole decide`

Every question the campaign raises for the owner is **parked** by default as a pending decision
(ADR-059). The item it blocks waits, and the next ready item that needs no decision runs. The owner
answers every parked question in one round when they choose: `/blackhole decide`, or a phrase such
as "process the decisions" or "answer the decisions". Parking stays on after the round.

## Switch

`config.json` → `decisions.mode` (`config-template.md`): `park` (the default when absent or any
value other than `ask`) or `ask` (every gate asks as it comes). Nothing else changes it: a
`sleep_mode` block left from retired sleep mode is ignored with a warning (ADR-059 amendment).

## The choke point: `askOrPark()`

Every owner question the campaign raises on its own — clarify gate, plan or design approval,
split sign-off, mockup gate, owner ruling, review rethink — goes through one contract before any
question channel is used (`clarify-gates.md` § C3 adapter). `askOrPark(config)`
(`scripts/lib/campaign-status/pending-decisions.ts`) returns:

- `ask` — `decisions.mode` is `ask`: use the C3 adapter row for this session, unchanged.
- `park` — otherwise: do not call any question tool. Park the question instead:

```bash
bun "${BLACKHOLE_PLUGIN_ROOT:-.}"/scripts/campaign-record.ts park --question "<the question as it would have been asked>" \
  --options "<label>: <consequence>|<label>|…" --recommended "<label>" \
  --refs <blocked issues/PRs> --gate <clarify|plan-approval|design-approval|split-sign-off|mockup|ruling> \
  [--evidence "<one line>"]
```

Then set each blocked item `status: blocked`, `notes: "awaiting-owner-on-return"`
(`clarify-gates.md` § Queue status when waiting on user) and move on. Parking the same question
again with the same options adds its new blocked items to the existing record; it is never listed
twice. The same question with different options is refused — reword it or reuse the options.

`bun "${BLACKHOLE_PLUGIN_ROOT:-.}"/scripts/campaign-record.ts ask` prints which of the two applies, read from `config.json`.

**Owner-initiated rounds ask directly.** Rounds the owner starts are the answer channel itself,
so `askOrPark()` does not apply to them: the launch configuration gate on an interactive start
(`launch-gate.md` § Questions and the coordinator's bootstrap form; print-only mode is keyed on
the per-invocation `--unattended` flag or a run context with no question channel, never on
`decisions.mode`), the decide round's cards below, and a follow-up question about
a message the owner just sent (`coordinator.md` § Chat Feedback Intake Protocol).

No playbook may skip the choke point: `scripts/checks/sleep-choke-point.check.ts` (`V-SLEEP-01`)
fails any `src/agents/*.md` or `src/references/*.md` section that names `AskQuestion` or
`AskUserQuestion` without citing `askOrPark()`, `clarify-gates.md` or this file. Descriptive
mentions (harness capability tables, this contract) are allowlisted in that check, each with its
reason; an entry that stops matching fails too.

**Allowed without asking:** only what config or an earlier owner ruling already authorizes —
`merge_mode`, the release permission, `usage_budget`. Anything else that is destructive,
outward-facing or irreversible is parked, never decided by the agent.

**Nothing left but parked items.** When every remaining item waits on a parked decision, the turn
ends on `N decisions waiting — run /blackhole decide` (`phase-loop.md` checklist): it is not a
completion, and it arms no wake-up of its own.

## Pending-decision record

`.blackhole/pending-decisions.json` — `{"next_id": <n>, "decisions": [...]}`, written only by
`campaign-record.ts park` and `resolve`, through the state write guard (`blackhole-state.md` §
Write protocol, entity key `decisions`). `next_id` only grows, so an answered id is never reused.
Each decision: `id` (`PD-<n>`), `question`, `options`
(2 to 4, each `{label, consequence?}`, labels distinct), `recommended` (index into `options`), optional `evidence`,
`blocks` (issue or PR numbers waiting on it — the cost of waiting), optional `gate`, `created_at`.
Schema and fixture: `pending-decisions.ts`, `fixtures/decision-parking/pending-decisions.example.json`.

## Decide round

1. `bun "${BLACKHOLE_PLUGIN_ROOT:-.}"/scripts/campaign-record.ts decide` prints the round as JSON. Parking stays as it was, and
   the keep-awake hold is untouched (the owner may answer from a phone while the machine runs
   on). The only write is this round's baseline, `.blackhole/decide-baseline.json`
   (`{at, done, weekly_pct}`: when, the issues done then, the weekly usage % then), which the next
   round's report measures against. Every `decide` advances it, so a second `decide` straight
   after the first reports nothing finished since.
2. Show the `report` field first, verbatim: `## Since the last decide round` — when the last round
   was, the issues finished since, open PRs in merge order with each one's blocker
   (`mergeNextOrder`, `scripts/lib/merge-next.ts`), the weekly points used since, and the number of
   decisions waiting (`buildDecideReport`, `scripts/lib/campaign-status/decide-round.ts`). The first
   round has no baseline and says so (`not measured`); a campaign upgraded from retired sleep mode
   uses that sleep baseline once. A value that could not be read is named as such, never guessed.
   A `warning` field, when present, names a retired `sleep_mode` block to remove; show it too.
3. Ask each entry of `cards` (at most four questions, the most-blocking first) as **one**
   AskUserQuestion call (or one set of decision cards, `project-thread-mode.md`), the recommended
   option first; more than four decisions means more cards, never a dropped question.
4. For each answer: `bun "${BLACKHOLE_PLUGIN_ROOT:-.}"/scripts/campaign-record.ts resolve --id PD-<n> --answer "<label or text>"`.
   It removes the decision, records it in `owner-decisions.json` with its blocked items as `refs`,
   and prints the items to unblock — promote them `blocked → ready` in the same turn.

The dashboard's and the status page's "Decisions waiting for you" panels, the Run panel's
Decisions row and the launch summary's Decisions row all say `run /blackhole decide` while a
decision waits.
<!-- GENERATED by scripts/build.ts from src/references/decision-parking.md — do not hand-edit -->
