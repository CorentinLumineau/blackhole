# Launch Gate — Executive Summary Before the First Spawn

The launch gate shows the owner, on one screen, what a `run` or `catchup` will do, what it will cost and where
to watch it, then asks one question per section. `catchup` mode uses the same gate with its own Pacing row (§ Catchup form). It replaces the raw config print the routine
resume confirmation gate used to show. The trigger conditions and the full 6-step form stay in
`coordinator.md` § Bootstrap preflight; this file owns the gate's body. On Pattern C the main chat
runs it (`claude-code-native.md` § Bootstrap gate ownership).

## When it runs

`run` and `catchup` modes only; every other mode loads config with no gate (`coordinator.md` § Bootstrap
preflight lists them).

| Bootstrap | What the gate does |
|-----------|--------------------|
| Routine resume (the 6-step form is skipped) | The full gate below: summary, probe, one Accept / Adjust per section |
| First bootstrap, post-campaign restart, explicit reconfigure, missing `merge_mode` | The form asks every section, so after its step 6 print the summary once and ask nothing more |

Bootstrap order, every `run` start:

1. Resolve the run context (`run-context.md`); on `state_store: branch`, pull the state branch. A
   `warn:` line saying the running plugin is older than an installed version is part of its output:
   restate it verbatim, never drop it.
2. Peer detection (ADR-057, `multitask-mode.md` § Peer campaign registry): run
   `bun run scripts/peer-campaigns.ts heartbeat --turn 0` (add `--host-session <id>` on a host
   with a cross-session transport), so a peer bootstrapping at the same moment sees this one.
   The summary's Peers row then reads `detect` itself. A non-zero exit means no record was
   written, so a peer could not see this session: restate its stderr line and stop the bootstrap
   before any spawn. Exit 1 is an unresolvable git common dir, a worktree path or host a peer
   could not read, or a record that could not be written (one line naming the errno code and the registry directory); exit 2 is a usage error.
3. The 6-step form when a `coordinator.md` trigger condition holds.
4. The summary and the status-page probe (§ Probe procedure).
5. The questions (§ Questions), unless print-only (§ Print-only mode).
6. The rest is `coordinator.md`'s, in its order: publish or refresh the status page, then
   `bun run scripts/doctor.ts` before the spawn (a non-zero exit stops it), then spawn or resume the
   orchestrator.

## The summary

Run `bun run scripts/campaign-status.ts --summary` and print its output; never hand-format the table. Its flags,
rows and `--json` shape are documented once, in `coordinator-dashboard.md` § Command (Launch summary). The
gate adds two steps of its own:

- Before the summary, refresh the Budget row's usage source on hosts that have one. On a Claude
  cloud or Remote session, pipe the newest `rate_limit_event` from `list_events` to
  `bun run scripts/usage-probe.ts --from-events -` (`run-context.md`, Claude usage sources). On
  Cursor there is no source, so the row reads `not probed: cursor: no readable usage source,
  usage-aware pacing not applied` and, with `usage_budget` on, its consequence is `Usage not
  probed: workers are sized from parallel_max (<n>).`
- The summary shows every top-level `config.json` block, or names it. Pacing, Autonomy, Resource policy and
  Wave scheduling are display-only rows, and **Other config** lists by name, never by value, every key no
  row shows, so no config reaches a run unseen. Which row claims which key is `LAUNCH_ROW_CLAIMS`
  (`scripts/lib/campaign-status/launch-config-rows.ts`).
- The summary carries the same plugin-version warning as a `> ` line under its heading, in every
  mode including print-only; it never becomes a question.
- Also run `bun run scripts/campaign-status.ts config-summary` once: the coordinator's docs-governance drift guard
  copies its `Docs governance` lines verbatim into the spawn text.

## Catchup form

`/blackhole catchup` (`phase-catchup.md`) runs this gate with the full config, and the pacing preset
(`catchup` block, `config-template.md`) pre-fills what the run gate leaves to `usage_budget`:

- Run `bun run scripts/campaign-status.ts --summary --mode catchup [--usage-file <path>] --json` instead of the plain
  summary. The rows are the run's 13, with the run's Pacing row swapped for the catchup's **Pacing**: the usage reading, the floor (`floor 45.71% (96 h / 168 h x 80%)`: hours elapsed of the week times the weekly target), the shortfall,
  the 5h caps and the lane. The Budget row judges by the floor budget.
- Every value stays adjustable for this invocation only, as in a run: re-print the summary with
  `--floor <pct>`, `--no-spawn-at <pct>`, `--stop-workers-at <pct>` or `--lane <name>`. Nothing
  writes `config.json`, and the adjusted floor is pinned in the spawn text.
- Unreadable usage, or a reading with no weekly window, reads as fail-closed on the Pacing row: the
  catchup skips rather than spends.
- A catchup is single-account until lane claims land: `lane unset` is shown, not enforced.

## Probe procedure

The Status page row says whether the stored page opens from this account. A stored URL that no
longer opens must surface before the first spawn, not on the first failed refresh.

1. Skip the probe when `status_page.enabled` is `false`, when the host publishes no artifact, or
   when `.blackhole/status-artifact.json` is absent (the row then reads `never published`).
2. When the summary's Status page row carries `probe_needed.url`, probe that URL: an
   `ArtifactData` `list` of `datasets` on it.
3. Record the result into `status-artifact.json`'s `last_probe` (`{at, ok, url, reason?}`) with
   the recorder (`scripts/status-probe.ts`):

   ```bash
   bun run scripts/status-probe.ts record --ok
   bun run scripts/status-probe.ts record --fail --reason "<why>"
   ```

   `--url` defaults to the stored `url`. It writes atomically, keeps every other key, and leaves
   an unchanged, still-fresh probe alone (`PROBE_FRESH_MINUTES`). Exit `2` (usage error, or a
   missing, malformed or url-less file) leaves the file untouched.
4. Re-run the summary so the Status page row shows the probed state.

A failed probe offers, before the first spawn: reuse another artifact (pick one from `Artifact`
`action: "list"`) or publish a new page. A page whose `template_version` is behind the template
also offers "Refresh template". Never delete the stored page to reset it (`status-page.md`).

## Questions

One Accept / Adjust question per adjustable row (Budget with no usage limit asks Set usage caps / Run with no limit instead), at most 4 per card. Scope, Merge, Budget and
Kaizen and staging (and Pacing in a catchup) are always adjustable, and so is Status page unless the host publishes no
page: a full gate is 2 cards, or 1 card when the Status page row reads `none on this host`.
Send the cards the `--json` output returns; every option carries its own description. Accept keeps the
row as shown. Adjust opens only that row's form steps, never the whole form:

| Row | Adjust opens |
|-----|--------------|
| Scope | Step 1 (scope and the targeted-issues preview) |
| Order | Display only: bugs first, then Pareto order; stacking is always on |
| Merge | Step 2, then step 3 when the answer is gated batch |
| Pacing (catchup) | The floor, the 5h caps or the lane, for this invocation only; `config.json` is untouched |
| Pacing (run) | Display only: `usage_budget` absent, disabled or on, its thresholds, the pace gate's max age and where the reading came from |
| Budget | Step 4 (`parallel_max`, then the usage caps: `enabled`, the 5-hour stop line, the weekly target); a stale or missing reading is refreshed with `usage-probe.ts`, then the summary re-runs |
| Status page | Reuse the stored page, reuse another, publish new, or refresh template |
| Kaizen and staging | Step 5 |
| Autonomy, Resource policy, Wave scheduling | Display only: edit the block in `config.json` to change it |
| Other config | Display only: the key names no row shows; never a value |
| Peers | Display only (the configured role, or `solo (no live peer in this clone)`), unless a live peer is not yet coordinated with this session, or `unknown (N unreadable: <files>)`: then the peer question below |
| Decisions | Display only: `decisions.mode` (park by default, or ask), the decisions waiting for `/blackhole decide`, and a retired `sleep_mode` block, named and ignored. Nothing on this row makes the gate print-only |

With `merge_mode` unset the Merge card has no Accept option (R-002): the owner must pick one.

The Peers question has no Accept option either: a live peer campaign in this clone is never
ignored, and this session never starts as `solo` beside it.

- **Stop**: run `bun run scripts/peer-campaigns.ts release`, then end the bootstrap.
- **Join as peer**: offered only when an uncoordinated live peer gives a manager to join (a host
  listed in `claude-code-native.md` § Cross-session budget transport records `host_session`). The
  option names it: a live `manager` record, else the manager a live peer follows, else a solo
  peer's `host_session`; coordinated peers are never a join target. Never offered while a live
  peer names this session as its manager (`names_me`): joining would leave that peer's slot
  requests unanswered. Write
  `usage_budget.coordination.role: peer` and `manager_session: <that id>` as step 6 does, then
  continue.
- **Take over after drain**: release, spawn nothing, and re-run the gate on the next resume. It
  starts once `detect` finds no live peer (the record is released or its 40-minute lease lapsed).

Unreadable records fail closed: a registry entry whose mtime is within one lease of now and that
is not a regular file, cannot be parsed, is another version, or is dated beyond one lease ahead
reads `unknown (N unreadable: <file names>)` and is asked about like a live peer, with Stop and
Take over only. The owner can remove a named file from `<git common dir>/blackhole/campaigns/`.

Release on every refusal too. A waiting session that kept its record would block the other side's
next bootstrap.
After the adjusted steps, write the answers as step 6 does (atomic write, one decision record per
answer), re-print the summary, and continue the bootstrap order.
With no usage limit (`usage_budget` invalid, `enabled` false, or enabled with no reading or no current usage window; a catchup
is excluded, it fails closed) the Budget question begins `No usage limit:` and offers `Set usage
caps` then `Run with no limit`, not Accept; `Set usage caps` opens the Budget Adjust form, and its
answers become the `usage_budget` block `campaign-status.ts usage-caps` prints.

## Print-only mode

Print-only mode applies when this invocation is `--unattended`
(`bun run scripts/campaign-status.ts --summary --unattended …`), or the run context has no
question channel (its route reports questions `none`, e.g. a headless run). `--unattended` is
per invocation and never stored: a forgotten flag cannot silently skip the next interactive gate,
and no config makes the gate print-only. Default parking (`decisions.mode`,
`decision-parking.md`) never does either: on an interactive start the gate is owner-initiated, so
its questions are asked directly (ADR-059 D5). This is how a scheduled catchup runs:
`--unattended`, summary printed, every row accepted, then the `--floor` gate decides.
The gate then prints
the summary, asks nothing and never waits. It does not park its rows either: the
`coordinator.md` 6-step form does not run, and nothing is parked through `askOrPark()`
(`decision-parking.md` § The choke point), so the gate leaves no pending decision behind, with one
exception, the peer question:

- every row counts as accepted;
- `merge_mode` unset: refuse to start, with one line, `merge_mode is unset; print-only mode cannot
  ask for it (R-002)` — never pick a merge mode for the owner;
- a live peer that is not yet coordinated, or unreadable peer records (the Peers row offers a
  question): refuse to start and release this session's record. When the invocation is `--unattended`, first
  park the peer question for the decide round. The question text and the option set are always the same,
  so a re-park on the next scheduled start merges into the pending decision instead of failing (`park`
  refuses the same question with a different option set). Join is always listed; the evidence
  says whether it applies, and the row's details (worktree, turn, heartbeat age, unreadable files)
  go in `--evidence` only:
  `bun run scripts/campaign-record.ts park --gate peers --question "Another campaign may be running
  in this clone: stop, join it, or take over after it drains?" --options "Stop|Join as peer: only
  when the evidence names a manager to join|Take over after drain" --recommended "Take over after
  drain" --evidence "<the Peers row value>; join: <id, or none>"` (`none` whenever the row offers no
  Join). A Join answer when the evidence
  says `join: none` is treated as Take over. With no question channel and no `--unattended` flag, refusing
  is enough;
- a failed probe or an unreachable page: say so in one line and continue without the page; the
  next interactive start offers the reuse / publish choice.
<!-- GENERATED by scripts/build.ts from src/references/launch-gate.md — do not hand-edit -->
