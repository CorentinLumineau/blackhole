# Status Page — One Live View of the Campaign

The owner checks campaign state on one page instead of asking the agent. The page is fed by
`bun run status --json` (the same counts as the text dashboard, `coordinator-dashboard.md`
§ Status page) and published to **one** place per harness. It never gets a second link. Claude
Code shows a live Data dashboard (`--data`); `--html` is the Cursor and local-file view.

Gated by `config.json` → `status_page.enabled` (`config-template.md`). When it is `false`, skip
everything below; the text dashboard is unaffected.

## When to refresh

| Event | Who |
|-------|-----|
| Campaign start, after bootstrap and before the first spawn | `coordinator` (Pattern B) or the main-chat orchestrator (Pattern C) |
| Every checkpoint write — `checkpoint-protocol.md` § Write order, step 5 | `orchestrator` |
| The main chat hands the turn back while workers are still in flight (Pattern C) | main-chat orchestrator |
| `status` mode / the owner asks for status | whoever runs `bun run status` |

A refresh is cheap and idempotent: regenerate, then update the existing view. Online it reads the
forge counts plus three REST reads per open PR the board shows (review label, check runs, commit
statuses; at most `PR_SIGNAL_CAP` = 15 PRs, `scripts/lib/campaign-status/pr-signals.ts`); `--no-gh`
reads nothing from the forge and every PR card says "CI not checked". A failed refresh is
reported in one line and never blocks the turn — the checkpoint is the SSOT, this page only
shows it.

## What the orchestrator records

Everything the page shows is derived from campaign state, so nothing on it is typed by hand. Four
facts come from the owner or the orchestrator; each has one home (ADR-052):

| Fact | Home | Written by | When |
|------|------|-----------|------|
| Headline (one sentence) | checkpoint `## Headline` | orchestrator | every checkpoint write |
| Blocking the run (one line each) | checkpoint `## Blocking the run` (`none` when nothing blocks) | orchestrator | every checkpoint write |
| Scope (in, parked, deferred, blocked upstream, out; date and optional reason) | `config.json` → `campaign_scope.entries` | `bun scripts/campaign-record.ts scope` | the launch configuration gate, and every owner scope change |
| Your decisions (date, one line) | `owner-decisions.json` | `bun scripts/campaign-record.ts decision` | every owner answer to a gate, and every scope or priority instruction |

Only the record script writes the last two (atomic, checked, a repeated call changes nothing):

```bash
bun scripts/campaign-record.ts scope --kind in --text "Open issues in milestone v2.0" --filter
bun scripts/campaign-record.ts scope --kind parked --text "Theme editor" --refs 111 --reason "another team owns it"
bun scripts/campaign-record.ts decision --text "Park the theme editor: another team owns it" --refs 111
```

`--filter` marks the line the launch gate writes for the issue filter, and replaces the previous
one when the gate runs again. An entry naming `--refs` takes those issues from older entries, so
re-including a parked issue moves it. A missing headline or blocker section is not an error: the
page then shows one generated from the counts (what waits on the owner, how many are in review,
what blocks most), and a campaign with no recorded scope shows "Scope not recorded".

Derived, never recorded: the stage of each card (queue state, the scope entry naming it, and the
PR's review label, CI and mergeability when the forge is read), the workstream of each issue
(`status_page.streams`, `config-template.md`; one stream when absent), the quick links (the
forge's PR, issue and CI pages, plus `status_page.links`) and the config rows (`config.json` and
the plugin version).

## Refresh procedure

1. Render the view for this harness. Claude Code publishes a live **Data dashboard** fed by
   `bun run status --data .blackhole/.tmp/status-data` (one `<id>.json` row file per dataset,
   derived from the same `StatusReport` as `--json`, so the counts never diverge); every other
   harness renders `bun run status --html`, which writes `.blackhole/.tmp/status.html` (override
   with `--out <path>`) and prints the path. `--html` escapes every value and loads nothing from
   the network.
2. Update the single view for this harness — the first matching row wins:


### Any other harness, or no artifact/canvas tool

Run `bun run status --html`, then print the path once per session (`📄 Status page: .blackhole/.tmp/status.html`).
Later refreshes rewrite the same file silently.

## Page layout

Top to bottom, the same facts in every renderer (`templates/status-dashboard/index.html` for the
Data dashboard, `scripts/lib/campaign-status/html.ts` for `--html`, `dashboard.ts` for the text
dashboard, all from one `StatusReport`), so the owner sees at a glance where the run stands and
what to do:

1. **Header** — `<campaign> · <state> · updated <age>` (state `running` / `waiting on you` /
   `idle` / `done`, or `stale` when the newest of the checkpoint and queue write times is older
   than `STALE_AFTER_HOURS`, `staleness.ts`; the Data dashboard decides this in the reader's
   browser, against the time it is opened), `· forge not checked` when the forge was not read,
   the headline, one progress bar, six counts (done, in review, on you, blocked, parked, not
   started) and the quick links
2. **Your move** (numbered, each a link: PRs delivered at LGTM or held for the owner first, then
   owner gates, then other PRs ready to merge; "Nothing is waiting on you.") beside **Blocking
   the run** ("Nothing blocks the run.")
3. **Stage board** — five columns: in review (`ready`, `review`, `active`: work in flight
   without a PR yet), blocked, not started (`you`: an owner gate, `todo`), parked, done. Four
   cards per column, the rest in a native `<details>` "N more". Each card is a link `#ref title`
   and a one-line status whose colour repeats its words: green done, blue in review, orange your
   move, red a conflict, failing CI or a bad queue entry, grey otherwise
4. **Workstreams** — done / in review / left / next per stream; a stream button above the board,
   or a row, shows only that stream (no buttons when there is one stream)
5. **Scope** (in, parked, deferred, blocked upstream, out; "Scope not recorded" when none is),
   **Config**, **Your decisions** (newest first, four shown, the rest folded)

`--html` keeps its detail sections after these: in progress, waiting on you, waiting on
something else by reason class (`elseClasses()`), up next, recently done, and a closed native
`<details>` with host, checkpoint notes and open findings. The text dashboard prints the headline,
the board counts, your move, the scope and the newest decisions above its queue sections.
Visual rules: R-006 (`documentation/reference/product-principles.md`).

## State file

`.blackhole/status-artifact.json` is the one state file meant to be committed in a consumer repo
(`blackhole-state.md` § Paths), so every session and machine reuses the same link. On
`state_store: branch` it also travels with the state branch.
<!-- GENERATED by scripts/build.ts from src/references/status-page.md — do not hand-edit -->
