# Sleep Mode — the owner is away: stay awake, re-arm wake-ups, report on return

Sleep mode now covers only the owner's **absence** (ADR-059). Parking owner questions is the
default whether the owner is here or not (`decision-parking.md`). While the owner is away, the
campaign also holds the machine awake, keeps its own wake-ups armed, keeps the launch gate
print-only, and reports what ran when they come back. An away owner is never asked, even under
`decisions.mode: "ask"`.

## Switch

`config.json` → `sleep_mode.enabled` (`config-template.md`). Absent or `false` ⇒ the owner is
present. Never hand-edit it; the toggle is a script:

| Owner says | Run |
|------------|-----|
| `/blackhole sleep`, or that they are leaving | `bun scripts/campaign-record.ts sleep --on` — sets `enabled: true` and records `since` and a `baseline` (issues already done, weekly usage %) for the wake-up report, then takes the keep-awake hold (§ Keeps itself alive). Already on ⇒ the config is unchanged and a live hold is kept |
| `/blackhole wake`, or their first message back | `bun scripts/campaign-record.ts wake` — § Wake-up below |
| Back, with no round | `bun scripts/campaign-record.ts sleep --off` — releases the hold and prints how many parked decisions wait for `/blackhole decide` |

None of them changes `decisions.mode`.

## Launch gate and run context

`bun run scripts/run-context.ts` writes `sleep_mode: {enabled, since, keep_awake}` into
`run-context.json` and prints `sleep mode on: …` with the hold's state when it is on, so every
resume sees it. `keep_awake` is `{held: true, tool, pid, since}` or `{held: false, reason}`
(§ Keeps itself alive). The launch summary (`bun run scripts/campaign-status.ts --summary`) shows
it on the display-only **Decisions** row. While the owner is away the launch gate is print-only
(`launch-gate.md` § Print-only mode); default parking alone never makes it print-only.

## Wake-up

`bun scripts/campaign-record.ts wake` turns sleep mode off and releases the hold, then prints the
decision round of `decision-parking.md` § Decide round with the away report as its `report`: issues
finished since `since` (against the sleep baseline), open PRs in merge order with each one's
blocker, weekly usage now and the points used while away, and the number of decisions waiting
(`buildWakeReport`, `scripts/lib/campaign-status/sleep-session.ts`). The JSON also carries
`keep_awake`, the release line. Ask the cards and resolve the answers exactly as that section says.
`/blackhole decide` while away prints the same report without ending the absence.

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
bun scripts/campaign-record.ts rearm
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
