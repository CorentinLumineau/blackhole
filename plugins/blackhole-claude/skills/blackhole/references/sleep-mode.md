# Sleep Mode — never ask, park every owner decision, batch them on wake-up

While the owner is away (overnight, AFK) the campaign keeps working, but it never asks and never
answers its own owner questions. Each question it would have put to the owner is **parked** as a
pending decision, the item waits, and the next ready item that needs no decision runs. When the
owner returns, every parked question is asked in one batched round.

## Switch

`config.json` → `sleep_mode.enabled` (`config-template.md`). Absent or `false` ⇒ awake: every gate
asks as it always has. Never hand-edit it; the toggle is a script:

| Owner says | Run |
|------------|-----|
| `/blackhole sleep`, or that they are leaving | `bun "${BLACKHOLE_PLUGIN_ROOT:-.}"/scripts/campaign-record.ts sleep --on` — sets `enabled: true` and records `since` and a `baseline` (issues already done, weekly usage %) for the wake-up report, then takes the keep-awake hold (§ Keeps itself alive). Already on ⇒ the config is unchanged and a live hold is kept |
| `/blackhole wake`, or their first message back | `bun "${BLACKHOLE_PLUGIN_ROOT:-.}"/scripts/campaign-record.ts wake` — the wake-up round below; its first step turns sleep mode off and releases the hold |
| Cancel sleep with no round | `bun "${BLACKHOLE_PLUGIN_ROOT:-.}"/scripts/campaign-record.ts sleep --off` — releases the hold and prints how many parked decisions still wait for `wake` |

## Launch gate and run context

`bun run "${BLACKHOLE_PLUGIN_ROOT:-.}"/scripts/run-context.ts` writes `sleep_mode: {enabled, since, keep_awake}` into
`run-context.json` and prints `sleep mode on: owner questions are parked` with the hold's state
when it is on, so every resume sees it. `keep_awake` is `{held: true, tool, pid, since}` or
`{held: false, reason}` (§ Keeps itself alive). The
launch summary (`bun run status --summary`) carries a display-only **Sleep mode** row. What the
launch gate does while sleep mode is on is `launch-gate.md` § Print-only mode's.

## The choke point: `askOrPark()`

Every owner question — clarify gate, plan or design approval, split sign-off, mockup gate, owner
ruling — goes through one contract before any question channel is used (`clarify-gates.md` § C3
adapter). `askOrPark(config)` (`scripts/lib/campaign-status/pending-decisions.ts`) returns:

- `ask` — sleep mode is off: use the C3 adapter row for this session, unchanged.
- `park` — sleep mode is on: do not call any question tool. Park the question instead:

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

No playbook may skip the choke point: `scripts/checks/sleep-choke-point.check.ts` (`V-SLEEP-01`)
fails any `src/agents/*.md` or `src/references/*.md` section that names `AskQuestion` or
`AskUserQuestion` without citing `askOrPark()`, `clarify-gates.md` or this file. Descriptive
mentions (harness capability tables, this contract) are allowlisted in that check, each with its
reason; an entry that stops matching fails too.

**Allowed without asking:** only what config or an earlier owner ruling already authorizes —
`merge_mode`, the release permission, `usage_budget`. Anything else that is destructive,
outward-facing or irreversible is parked, never decided by the agent.

## Pending-decision record

`.blackhole/pending-decisions.json` — `{"next_id": <n>, "decisions": [...]}`, written only by
`campaign-record.ts park` and `resolve`, through the state write guard (`blackhole-state.md` §
Write protocol, entity key `decisions`). `next_id` only grows, so an answered id is never reused.
Each decision: `id` (`PD-<n>`), `question`, `options`
(2 to 4, each `{label, consequence?}`, labels distinct), `recommended` (index into `options`), optional `evidence`,
`blocks` (issue or PR numbers waiting on it — the cost of waiting), optional `gate`, `created_at`.
Schema and fixture: `pending-decisions.ts`, `fixtures/sleep-mode/pending-decisions.example.json`.

## Wake-up round

1. `bun "${BLACKHOLE_PLUGIN_ROOT:-.}"/scripts/campaign-record.ts wake` sets `sleep_mode.enabled` to `false` **first** — while it
   is `true`, the round's own questions would be parked again — then prints the batch as JSON:
   every parked decision, the most-blocking first, in `cards` of at most four questions.
2. Show the `report` field of that JSON first, verbatim: the executive summary of what ran while
   the owner was away — issues finished since `since` (against the sleep baseline), open PRs in
   merge order with each one's blocker (`mergeNextOrder`, `scripts/lib/merge-next.ts`), weekly usage
   now and the points used while away, and the number of decisions waiting. A value that could not
   be read is named as such, never guessed (`buildWakeReport`, `scripts/lib/campaign-status/sleep-session.ts`).
3. Ask each card as **one**
   AskUserQuestion call (or one set of decision cards, `project-thread-mode.md`), the recommended
   option first; more than four decisions means more cards, never a dropped question.
4. For each answer: `bun "${BLACKHOLE_PLUGIN_ROOT:-.}"/scripts/campaign-record.ts resolve --id PD-<n> --answer "<label or text>"`.
   It removes the decision, records it in `owner-decisions.json` with its blocked items as `refs`,
   and prints the items to unblock — promote them `blocked → ready` in the same turn.

## Keeps itself alive

A sleeping campaign must not depend on the owner's hardware staying on. What each host can do:

| Host | Can | Cannot |
|------|-----|--------|
| Claude Code cloud session (or Project thread) | Run while a turn is active; wake on a scheduled routine or trigger (`route.schedule: routine`), a PR event (`ci_wait: pr-events`) or a peer's message; keep state on the `blackhole/state` branch | Stay alive between turns on its own: an idle session ends and its container is reclaimed. There is no OS idle inhibitor to hold, and none is needed — no owner machine is involved |
| Local Claude Code / Cursor | Everything above that its run context reports, and hold the machine awake with an OS idle inhibitor (below) | Run once the app quits, or once the machine sleeps where no inhibitor exists. An app-level hold (keeping Claude Code or Cursor itself open) is out of reach of a script |

### Keep-awake hold (local hosts)

`sleep --on` takes an OS idle inhibitor; `sleep --off` and `wake` release it
(`scripts/lib/campaign-status/sleep-hold.ts`):

| Host | Inhibitor |
|------|-----------|
| macOS with `caffeinate` | `caffeinate -i` |
| Linux with `systemd-inhibit` | `systemd-inhibit --what=idle:sleep --mode=block sleep infinity` |
| `route.state_store: branch` (cloud, Project thread, CI) | none: a no-op, and the output says `not held — ephemeral host` |
| Any other host | none, and the output says so; sleep mode still goes on |

The inhibitor runs detached in its own process group. `sleep --on` gives it a moment to fail
(no D-Bus session, no permission) and confirms it is still running; one that exited is reported
as `not held — <tool> exited: <its first stderr line>` and nothing is recorded. A confirmed hold
is recorded in `.blackhole/.tmp/sleep-hold.json` as `{pid, tool, started_at, identity}`, where
`identity` is the process start time (read in UTC, C locale, so a
change of shell time zone between `sleep --on` and `wake` never makes a live hold look stale) and
command line. `.tmp/` is ignored wherever `.blackhole/`
is tracked and never travels on the state branch. If the record cannot be written, the new
inhibitor is stopped at once, so no hold is ever left untracked.

A recorded pid counts as the hold only while its start time and command line still match
`identity`, so a pid the system has since reused is never signalled:

- `sleep --on` again keeps a live hold, and clears and replaces a stale one (after a reboot, say).
- Release stops the whole process group (`systemd-inhibit`'s `sleep` child included) and drops
  the record only after the stop succeeds; a stale record is only cleared.
- When the process table cannot be read (`ps` fails), the hold's state is unknown: the record is
  kept, nothing is killed, and no second inhibitor starts.

With no `run-context.json`, the host is judged from the environment the same way
`run-context.ts` judges it.

### Wake-ups

So on every host the campaign keeps itself alive by re-arming its own wake-ups. At every turn end
in sleep mode (`checkpoint-protocol.md` § Write order, step 3), run:

```bash
bun "${BLACKHOLE_PLUGIN_ROOT:-.}"/scripts/campaign-record.ts rearm
```

It prints `{schedule, wake_ups}`: one entry per minute, soonest first, each with `at`, `reasons`
(`ci-check-in` for the PRs in flight, `CI_CHECK_IN_MINUTES` out; `five-hour-reset` and
`weekly-reset` for each future usage-window reset), `refs` and `wake_peers`. A usage stop's own
`wake_at` is not listed; `phase-stop.md` § Usage stop arms exactly that one.

- `schedule: routine`: keep one one-off routine per entry (`project-thread-mode.md` § Scheduling:
  routines). `checkpoint-protocol.md` § Write order, step 3 runs `rearm` at every turn end and lists
  each armed wake-up on a `## Notes` line, so a resume does not arm a second.
- `schedule: turn`: no timer exists; name the entries in the turn report, and the next turn started
  at or after one runs it.
- `wake_peers: true` (this session is the `usage_budget.coordination` manager): after the reset,
  message each peer holding a lease (`multitask-mode.md`), since the reset frees the slots they wait for.
<!-- GENERATED by scripts/build.ts from src/references/sleep-mode.md — do not hand-edit -->
