# Keep-Awake — hold the machine while the campaign has work in flight, re-arm its own wake-ups

`run` and `catchup` keep a local machine awake whenever a worker is in flight or a wake is armed,
and let it sleep again at drain, stop and `STOP-CAMPAIGN` (ADR-059 amendment). Whether the owner
is at the desk does not matter: an unattended campaign dies when the machine sleeps either way.
This replaces the hold that retired sleep mode took only while the owner said they were away.

## The rule

One idempotent command takes or releases the hold so it matches the campaign's state:

```bash
bun "${BLACKHOLE_PLUGIN_ROOT:-.}"/scripts/campaign-record.ts keep-awake --workers <n> [--wake-armed]
```

`<n>` is the number of workers in flight now (the `## In-flight workers` table of the checkpoint,
not queue status: a PR waiting on CI or on the owner is not a worker). `--wake-armed` says a wake
is armed (a usage stop's `wake_at`, or a wake-up from `rearm`). Held while `n > 0` or a wake is
armed; released otherwise. Run it:

| When | Call |
|------|------|
| Spawning a worker (`orchestrator-runtime.md` § Spawn) | `--workers <n after the spawn>` |
| Every turn end (`checkpoint-protocol.md` § Write order, step 3) | `--workers <n>`, plus `--wake-armed` when a wake is armed |
| Drain-and-wake usage stop (`STOP-WORKERS`, `PACE-WAIT`; `phase-stop.md` § Usage stop) | `--workers 0 --wake-armed` once the wake is armed |
| Drain complete, `stop` (any tier), `STOP-CAMPAIGN`, queue empty | `--workers 0` — releases it |

Each call prints one line (`Keep-awake: held by …`, `already held`, `released …`, or why not
held); put it in the turn report. An inhibitor problem never stops the campaign.

## What each host can do

| Host | Can | Cannot |
|------|-----|--------|
| Claude Code cloud session (or Project thread) | Run while a turn is active; wake on a scheduled routine or trigger (`route.schedule: routine`), a PR event (`ci_wait: pr-events`) or a peer's message; keep state on the `blackhole/state` branch | Stay alive between turns on its own: an idle session ends and its container is reclaimed. There is no OS idle inhibitor to hold, and none is needed — no owner machine is involved |
| Local Claude Code / Cursor | Everything above that its run context reports, and hold the machine awake with an OS idle inhibitor (below) | Run once the app quits, or once the machine sleeps where no inhibitor exists. An app-level hold (keeping Claude Code or Cursor itself open) is out of reach of a script |

## The hold (local hosts)

`scripts/lib/campaign-status/keep-awake.ts`:

| Host | Inhibitor |
|------|-----------|
| macOS with `caffeinate` | `caffeinate -i` |
| Linux with `systemd-inhibit` | `systemd-inhibit --what=idle:sleep --mode=block sleep infinity` |
| `route.state_store: branch` (cloud, Project thread, CI) | none: a no-op, and the output says `not held — ephemeral host` |
| Any other host | none, and the output says so; the campaign runs on |

The inhibitor runs detached in its own process group. Taking the hold gives it a moment to fail
(no D-Bus session, no permission) and confirms it is still running; one that exited is reported
as `not held — <tool> exited: <its first stderr line>` and nothing is recorded. A confirmed hold
is recorded in `.blackhole/.tmp/keep-awake-hold.json` as `{pid, tool, started_at, identity}`, where
`identity` is the process start time (read in UTC, C locale, so a change of shell time zone between
taking and releasing never makes a live hold look stale) and command line. `.tmp/` is ignored
wherever `.blackhole/` is tracked and never travels on the state branch. If the record cannot be
written, the new inhibitor is stopped at once, so no hold is ever left untracked. A record left at
`.tmp/sleep-hold.json` by retired sleep mode is moved to the new path on first read, so an upgrade
never orphans a live inhibitor.

A recorded pid counts as the hold only while its start time and command line still match
`identity`, so a pid the system has since reused is never signalled:

- Taking it again keeps a live hold, and clears and replaces a stale one (after a reboot, say).
- Release stops the whole process group (`systemd-inhibit`'s `sleep` child included) and drops
  the record only after the stop succeeds; a stale record is only cleared.
- When the process table cannot be read (`ps` fails), the hold's state is unknown: the record is
  kept, nothing is killed, and no second inhibitor starts.

With no `run-context.json`, the host is judged from the environment the same way
`run-context.ts` judges it. `run-context.ts` records the hold's state as `keep_awake`
(`run-context.md`).

## Wake-ups

An unattended invocation (`--unattended`, the scheduled catchup) keeps itself alive by re-arming
its own wake-ups. At every turn end of an unattended invocation (`checkpoint-protocol.md` § Write
order, step 3), run:

```bash
bun "${BLACKHOLE_PLUGIN_ROOT:-.}"/scripts/campaign-record.ts rearm
```

It prints `{schedule, wake_ups}`: one entry per minute, soonest first, each with `at`, `reasons`
(`ci-check-in` for the PRs in flight, `CI_CHECK_IN_MINUTES` out; `five-hour-reset` and
`weekly-reset` for each future usage-window reset), `refs` and `wake_peers`. A usage stop's own
`wake_at` is not listed; `phase-stop.md` § Usage stop arms exactly that one. An interactive
invocation arms none: the owner restarts it, as before.

- `schedule: routine`: keep one one-off routine per entry (`project-thread-mode.md` § Scheduling:
  routines). `checkpoint-protocol.md` § Write order, step 3 lists each armed wake-up on a
  `## Notes` line, so a resume does not arm a second.
- `schedule: turn`: no timer exists; name the entries in the turn report, and the next turn started
  at or after one runs it.
- `wake_peers: true` (this session is the `usage_budget.coordination` manager): after the reset,
  message each peer holding a lease (`multitask-mode.md`), since the reset frees the slots they wait for.

Any wake armed this way counts as `--wake-armed` for the keep-awake call of the same turn end.
<!-- GENERATED by scripts/build.ts from src/references/keep-awake.md — do not hand-edit -->
