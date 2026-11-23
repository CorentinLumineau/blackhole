---
type: adr
summary: "Every owner question the campaign raises is parked by default (decisions.mode park, ask opts out); /blackhole decide asks them all in cards of four, most-blocking first, reports what ran since the last round, and leaves parking on; sleep mode is retired (amendment): run and catchup hold keep-awake while work is in flight, an unattended start passes --unattended, a leftover sleep_mode key warns and is ignored; the interactive launch gate and the decide round are owner-initiated and ask directly"
status: accepted
review_trigger: "on a change to askOrPark(), the decisions config block, the decide round or its baseline, the keep-awake rule, or the launch gate's print-only mode"
created: 2026-11-23
last_updated: 2026-11-23
related:
  - src/references/decision-parking.md
  - src/references/keep-awake.md
  - src/references/clarify-gates.md
  - src/references/launch-gate.md
  - documentation/plans/plan-park-owner-decisions-by-default.md
---

# ADR-059: Park owner decisions by default; answer them on request

## Status

Accepted — 2026-11-23, owner request in the invest-monorepo catchup campaign. Amended 2026-11-23: sleep mode retired (§ Amendment).

## Context

Sleep mode (`sleep_mode.enabled`) made one choke point, `askOrPark()`, park every owner question
in `.blackhole/pending-decisions.json` while the owner was away, and `campaign-record.ts wake`
asked them all in one batched round. It was opt-in and tied to absence: `wake` turned parking off
so its own round could reach the owner, and every later gate interrupted the owner again.

On 2026-11-23 the owner, interrupted by approval questions during a catchup campaign, turned sleep
mode on as a stopgap and asked for that to be the default: "by default you parked all decision (as
sleep mode is doing) and i just have to run a mode or say something to process all decision
answering … the sleep mode is no longer needed and it become default + user is asking to start the
decision session".

Two things the old design bundled have to come apart:

1. **Parking**: whether a gate the campaign raises interrupts the owner now or waits for a round.
2. **Absence**: the owner is gone, so hold the machine awake, re-arm wake-ups, keep the launch gate
   print-only, and report what ran while they were away.

## Decision

**D1 — Parking is the default.** A new config block `decisions.mode: "park" | "ask"`. Absent, or
any value other than `"ask"`, resolves to `park`. `askOrPark(config)` returns `park` unless
`decisions.mode` is `"ask"` and the owner is not away (`sleep_mode.enabled !== true`). An away
owner is never asked, whatever the mode.

`sleep_mode.enabled` stays as the absence flag. Its `true` value still parks (it always did), but
`false` is **not** read as "ask": every campaign that ever ran `wake` carries
`sleep_mode: {enabled: false}`, written by the script and not by the owner, so honouring it would
keep exactly the campaigns that tried sleep mode in ask mode. The only opt-out is
`decisions.mode: "ask"`.

**D2 — `/blackhole decide`.** `campaign-record.ts decide` prints the round as JSON: a short
report (open PRs in merge order, usage now, the away summary when the owner is away, the decisions
waiting), then every parked decision in `cards` of at most four, most-blocking first. The owner
reaches it with `/blackhole decide` or a phrase such as "process the decisions" or "answer the
decisions". Each answer goes through `campaign-record.ts resolve` as before, which records it and
names the items to promote `blocked → ready`. `decide` writes nothing to `config.json`: parking
stays on, and absence is left as it was, since the owner may be answering from a phone while the
machine they left running still needs its hold.

**D3 — Owner-initiated rounds ask directly.** `askOrPark()` governs questions the campaign raises
on its own: clarify, plan and design approval, split sign-off, mockup, ruling, review rethink. Two
rounds are started by the owner and are the answer channel itself, so they ask directly: the launch
gate's questions on an interactive start (`launch-gate.md` § Questions), and the decide round's
cards. Without this rule a default-park campaign would park its own launch questions and the
decide round's cards, and nothing could ever be answered. The C3 adapter states it at the choke
point (`clarify-gates.md` § C3 adapter).

**D4 — `sleep` keeps only absence.** `sleep --on` records `since` and the baseline, takes the
keep-awake hold, and makes the launch gate print-only; `rearm` keeps the wake-ups armed.
`sleep --off` releases the hold. `wake` is `sleep --off` followed by the decide round. None of them
changes `decisions.mode`.

**D5 — The launch gate stays interactive by default.** Print-only mode stays keyed on absence
(`sleep_mode.enabled`) or a run context with no question channel, never on `decisions.mode`, so an
interactive start under default parking still asks the launch summary questions. In print-only
mode the true blockers are unchanged: an unset `merge_mode` refuses to start, and so does an
uncoordinated live peer (parked first when the owner is away).

**D6 — Status surfaces point at the round.** The Run panel's `Sleep mode` row becomes `Decisions`
(`park · 3 waiting — run /blackhole decide`, then `owner away since …` when away); the launch
summary's `Sleep mode` row becomes `Decisions` and claims both blocks; the dashboard's and the
status page's "Decisions waiting for you" panels end with `run /blackhole decide`; a blocked item
parked on a decision reads `Owner: answer the parked decision — run /blackhole decide`. When every
remaining item waits on a parked decision, the turn ends on that line: it is neither a completion
nor a reason to re-arm.

The pending-decisions schema (`pending-decisions.json`), the queue note `awaiting-owner-on-return`
and the `V-SLEEP-01` choke-point check are kept unchanged in shape; the check also accepts the new
contract file, `decision-parking.md`, as a route.

## Amendment — 2026-11-23: retire sleep mode

**Owner approval.** Approved by the owner in chat on 2026-11-23 ("let's fix plugin to remove the
sleep mode"), after the analysis in issue 1433. Decisions D1 to D6 above are left unedited for
history; where they mention sleep mode, `sleep_mode`, `wake` or the owner's absence, this section
supersedes them.

**Why.** Once D1 made parking the default, sleep mode only bundled four unrelated behaviours: the
keep-awake hold, "never ask while away", the print-only launch gate and the away report. Each one
belongs somewhere else, and the mode was a sticky switch the owner had to remember to turn off.

**A1 — Keep-awake follows the run, not the owner.** `run` and `catchup` hold the OS idle inhibitor
whenever a worker is in flight or a wake is armed, and release it at drain, stop and
`STOP-CAMPAIGN`. One idempotent command reconciles it:
`campaign-record.ts keep-awake --workers <n> [--wake-armed]`, called at each spawn, each turn end,
a drain-and-wake usage stop (`--wake-armed`) and every stop (`--workers 0`). Worker count comes
from the checkpoint's in-flight workers, not queue status, so a PR waiting on CI or the owner does
not hold the machine for days. The hold module is `keep-awake.ts` (formerly `sleep-hold.ts`), and
its record moves to `.tmp/keep-awake-hold.json`; a record at the old `.tmp/sleep-hold.json` is
adopted on first read, so an upgrade never orphans a live inhibitor. Presence does not matter: an
unattended campaign dies when the machine sleeps either way.

**A2 — "Never ask while away" is dropped.** `askOrPark()` follows `decisions.mode` alone. Parking
is the default, so the owner is not interrupted unless they chose `ask`. The optional ask-timeout
from the proposal (an `ask`-mode question with no answer parks after N minutes) is **not built**:
it stays a possible follow-up if `ask` mode turns out to strand questions.

**A3 — Print-only becomes a per-invocation `--unattended` flag.** D5's print-only mode is keyed on
`campaign-status.ts --summary --unattended` or a run context with no question channel, never on
config. The scheduled catchup prompt (`phase-catchup.md` § Scheduled task) passes it. No sticky
state: a forgotten `wake` used to silently skip the next interactive gate, and a flag cannot. An
unattended invocation also keeps re-arming its own wake-ups at each turn end (`rearm`), which
sleep mode did; an interactive one arms none, as before, so campaigns that never slept see no
change.

**A4 — The away report becomes the decide report.** `/blackhole decide` reports what ran since
the last decide round: issues finished, open PRs with their blockers, and weekly points used. Each
`decide` records `{at, done, weekly_pct}` in `.blackhole/decide-baseline.json` (`buildDecideReport`,
`decide-round.ts`, formerly `sleep-session.ts`); this amends D2's "writes nothing" to "writes only
its own baseline". The first round says "not measured". A campaign away at the upgrade has its
`sleep_mode.since`/`baseline` used once as that first baseline.

**A5 — Removal and migration.** `campaign-record.ts sleep` and `wake` fail with a line naming
their replacement. The `sleep_mode` config key is retired: any `sleep_mode` block is ignored with
a warning (run context, the launch summary and Run panel Decisions rows, the decide JSON), never a
crash. `sleep-mode.md` is deleted; the hold and wake-up content moves to `keep-awake.md`. The Run
panel field `sleep_mode` becomes `retired_sleep_mode`, and `run-context.json` records
`keep_awake` instead of `sleep_mode`.

**Strongest case against, and why it does not hold.** Sleep mode was the only explicit "owner is
gone" signal in an interactive session. That matters only under `decisions.mode: ask`, which is no
longer the default; the ask-timeout (A2) covers it if it is ever needed.

## Alternatives Considered

**Flip `sleep_mode.enabled` to default `true`.** The smallest diff: no new block, every call site
already reads it. Rejected because the flag would then mean two things at once. Default-on sleep
would also make every launch print-only (D5's failure) and take a keep-awake hold on every start,
and `false` written by past `wake` runs would silently keep those campaigns asking.

**Read `sleep_mode.enabled: false` as the deprecated spelling of `decisions.mode: "ask"`.** The
literal reading of "keep `sleep_mode.enabled` as a deprecated alias". Rejected for the reason in
D1: the value was written by the script on every `wake`, so it records "the owner came back",
not "the owner wants to be asked". The alias survives in the direction that is safe: `true` parks.

**`decide` also ends absence.** Simpler for the case where the owner is back at the desk. Rejected
because answering is not the same as returning; the owner may answer remotely while the local
machine must stay held. `wake` remains the "I am back" command, and the decide report names the
away state and that `wake` ends it.

**Treat an invalid `decisions.mode` as a config error.** Rejected: an invalid value should not stop
a campaign, and parking is the reading that never decides for the owner and never interrupts them.
The launch summary's Decisions row names the invalid value.

## Consequences

- A campaign with no `decisions` block parks from the next resume on. Existing parked decisions
  stay valid (same file, same schema) and are answered with `/blackhole decide`.
- A campaign that is currently away (`sleep_mode.enabled: true`, a live hold) stays away until
  `wake` or `sleep --off`; `decide` answers its decisions without ending it.
- An owner who wants every gate asked as it comes sets `decisions.mode: "ask"`; the launch
  summary shows it.
- Owner questions arrive in rounds the owner starts. A gate that blocks many items still waits for
  that round: the dashboard's next action and the status page name the round so the wait is
  visible, not silent.
- `sleep-mode.md` shrinks to absence; the choke point, the record and the round move to
  `decision-parking.md`.
