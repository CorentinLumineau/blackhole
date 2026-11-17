# Launch Gate — Executive Summary Before the First Spawn

The launch gate shows the owner, on one screen, what a `run` will do, what it will cost and where
to watch it, then asks one question per section. It replaces the raw config print the routine
resume confirmation gate used to show. The trigger conditions and the full 6-step form stay in
`coordinator.md` § Bootstrap preflight; this file owns the gate's body. On Pattern C the main chat
runs it (`claude-code-native.md` § Bootstrap gate ownership).

## When it runs

`run` mode only. `status`, `handle #N`, `plan #N`, `implement #N`, `review #N`, `hunt [kind]` and
`campaign-audit` load config with no gate.

| Bootstrap | What the gate does |
|-----------|--------------------|
| Routine resume (the 6-step form is skipped) | The full gate below: summary, probe, one Accept / Adjust per section |
| First bootstrap, post-campaign restart, explicit reconfigure, missing `merge_mode` | The form asks every section, so after its step 6 print the summary once and ask nothing more |

Bootstrap order, every `run` start:

1. Resolve the run context (`run-context.md`); on `state_store: branch`, pull the state branch.
2. The 6-step form when a `coordinator.md` trigger condition holds.
3. The summary and the status-page probe (§ Probe procedure).
4. The questions (§ Questions), unless print-only (§ Print-only mode).
5. `bun run doctor`; a non-zero exit stops the start.
6. Publish or refresh the status page (`status-page.md` § Refresh procedure).
7. Spawn or resume the orchestrator.

## The summary

```bash
bun run status --summary [--usage <json>] [--json]
```

One table, seven rows in this fixed order: Scope, Order, Merge, Budget, Status page, Kaizen and
staging, Peers. Each row ends with a one-line consequence, so the table reads on its own. Run the
command and print its output; never hand-format the table. The status page reads the same
builder, so the two never disagree.

- Budget row source: with no `--usage`, the row reads the host's usage source
  (`scripts/lib/usage-source.ts`, host from `run-context.json`, else the environment), the same
  `BudgetPanel` the status page shows (`status-page.md` § Page layout, **Usage budget**). On a Claude cloud or
  Remote session, refresh that source first: pipe the newest `rate_limit_event` from
  `list_events` to `bun run scripts/usage-probe.ts --from-events -` (`run-context.md`, Claude
  usage sources). Cursor has no usage source, so the row says `usage not probed — <reason>` and
  sizes workers from `parallel_max`.
- `--usage '<json>'` overrides that source with the usage the harness reported directly (its
  `get_usage` tool, `usage-probe` in `run-context.md`); `--now <epoch s>` pins the clock.
- `--json` returns `{rows, cards}`; `cards` are the question cards (built by `gateCards`), which
  § Questions sends as is.
- Also run `bun run status config-summary` once: the coordinator's docs-governance drift guard
  copies its `Docs governance` lines verbatim into the spawn text.

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

One Accept / Adjust question per adjustable row, at most 4 per card, so a full gate is 2 cards.
Send the cards `gateCards` returns; every option carries its own description. Accept keeps the
row as shown. Adjust opens only that row's form steps, never the whole form:

| Row | Adjust opens |
|-----|--------------|
| Scope | Step 1 (scope and the targeted-issues preview) |
| Order | Display only: bugs first, then Pareto order; stacking is always on |
| Merge | Step 2, then step 3 when the answer is gated batch |
| Budget | Step 4 (`parallel_max`); the `usage_budget` thresholds are edited in `config.json`; a stale or missing reading is refreshed with `usage-probe.ts`, then the summary re-runs |
| Status page | Reuse the stored page, reuse another, publish new, or refresh template |
| Kaizen and staging | Step 5 |
| Peers | Display only: the configured `usage_budget.coordination.role` |

With `merge_mode` unset the Merge card has no Accept option (R-002): the owner must pick one.
After the adjusted steps, write the answers as step 6 does (atomic write, one decision record per
answer), re-print the summary, and continue the bootstrap order.

## Print-only mode

Print-only mode applies when sleep mode is on (`sleep_mode.enabled`), or the run context has no
question channel (its route reports questions `none`, e.g. a headless run). The gate then prints
the summary, asks nothing and never waits:

- every row counts as accepted;
- `merge_mode` unset: refuse to start, with one line, `merge_mode is unset; print-only mode cannot
  ask for it (R-002)` — never pick a merge mode for the owner;
- a failed probe or an unreachable page: say so in one line and continue without the page; the
  next interactive start offers the reuse / publish choice.
<!-- GENERATED by scripts/build.ts from src/references/launch-gate.md — do not hand-edit -->
