# Launch Gate — Executive Summary Before the First Spawn

The launch gate shows the owner, on one screen, what a `run` or `catchup` will do, what it will cost and where
to watch it, then asks one question per section. `catchup` mode uses the same gate with one more row (§ Catchup form). It replaces the raw config print the routine
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
2. The 6-step form when a `coordinator.md` trigger condition holds.
3. The summary and the status-page probe (§ Probe procedure).
4. The questions (§ Questions), unless print-only (§ Print-only mode).
5. The rest is `coordinator.md`'s, in its order: publish or refresh the status page, then
   `bun run doctor` before the spawn (a non-zero exit stops it), then spawn or resume the
   orchestrator.

## The summary

Run `bun run status --summary` and print its output; never hand-format the table. Its flags,
rows and `--json` shape are documented once, in `coordinator-dashboard.md` § Command (Launch summary). The
gate adds two steps of its own:

- Before the summary, refresh the Budget row's usage source on hosts that have one. On a Claude
  cloud or Remote session, pipe the newest `rate_limit_event` from `list_events` to
  `bun run scripts/usage-probe.ts --from-events -` (`run-context.md`, Claude usage sources). On
  Cursor there is no source, so the row reads `not probed: cursor: no readable usage source,
  usage-aware pacing not applied` and, with `usage_budget` on, its consequence is `Usage not
  probed: workers are sized from parallel_max (<n>).`
- The summary carries the same plugin-version warning as a `> ` line under its heading, in every
  mode including print-only; it never becomes a question.
- Also run `bun run status config-summary` once: the coordinator's docs-governance drift guard
  copies its `Docs governance` lines verbatim into the spawn text.

## Catchup form

`/blackhole catchup` (`phase-catchup.md`) runs this gate with the full config, and the pacing preset
(`catchup` block, `config-template.md`) pre-fills what the run gate leaves to `usage_budget`:

- Run `bun run status --summary --mode catchup [--usage-file <path>] --json` instead of the plain
  summary. The rows are the run rows plus **Pacing**: the usage reading, the floor, the shortfall,
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

One Accept / Adjust question per adjustable row, at most 4 per card. Scope, Merge, Budget and
Kaizen and staging (and Pacing in a catchup) are always adjustable, and so is Status page unless the host publishes no
page: a full gate is 2 cards, or 1 card when the Status page row reads `none on this host`.
Send the cards the `--json` output returns; every option carries its own description. Accept keeps the
row as shown. Adjust opens only that row's form steps, never the whole form:

| Row | Adjust opens |
|-----|--------------|
| Scope | Step 1 (scope and the targeted-issues preview) |
| Order | Display only: bugs first, then Pareto order; stacking is always on |
| Merge | Step 2, then step 3 when the answer is gated batch |
| Pacing | Catchup only: the floor, the 5h caps or the lane, for this invocation only; `config.json` is untouched |
| Budget | Step 4 (`parallel_max`); the `usage_budget` thresholds are edited in `config.json`; a stale or missing reading is refreshed with `usage-probe.ts`, then the summary re-runs |
| Status page | Reuse the stored page, reuse another, publish new, or refresh template |
| Kaizen and staging | Step 5 |
| Peers | Display only: the configured `usage_budget.coordination.role` |
| Sleep mode | Display only: sleep mode on or off; while on the whole gate is print-only |

With `merge_mode` unset the Merge card has no Accept option (R-002): the owner must pick one.
After the adjusted steps, write the answers as step 6 does (atomic write, one decision record per
answer), re-print the summary, and continue the bootstrap order.

## Print-only mode

Print-only mode applies when sleep mode is on (`sleep_mode.enabled`), or the run context has no
question channel (its route reports questions `none`, e.g. a headless run). This is how a scheduled
catchup runs: sleep mode on, summary printed, every row accepted, then the `--floor` gate decides.
The gate then prints
the summary, asks nothing and never waits. It is not sleep mode's parking either: the
`coordinator.md` 6-step form does not run, and nothing is parked through `askOrPark()`
(`sleep-mode.md` § The choke point), so the gate leaves no pending decision behind:

- every row counts as accepted;
- `merge_mode` unset: refuse to start, with one line, `merge_mode is unset; print-only mode cannot
  ask for it (R-002)` — never pick a merge mode for the owner;
- a failed probe or an unreachable page: say so in one line and continue without the page; the
  next interactive start offers the reuse / publish choice.
<!-- GENERATED by scripts/build.ts from src/references/launch-gate.md — do not hand-edit -->
