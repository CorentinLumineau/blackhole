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
forge counts, then two adapter reads per open PR the board shows (`prView` for the review label and
mergeability, `prChecks` for CI; at most `PR_SIGNAL_CAP` = 15 PRs,
`scripts/lib/campaign-status/pr-signals.ts`), then the merged PRs (`prList`, newest 300). All of it
goes through the forge adapter of the configured forge (`github`, `gitea` or `gitlab`), so a Gitea
campaign gets the same page as a GitHub one. CI comes from each forge's own source: check runs and
commit statuses on GitHub, the pipeline jobs on GitLab, and on Gitea the combined commit status of
the PR's head commit (`tea` has no per-PR CI command, so it is read through the REST API). A
commit with no status at all reads as "no CI", never as green.

The reads are independent. `--no-gh` reads nothing from the forge and every PR card says "CI not
checked". A PR whose CI read fails keeps its review verdict and conflict check and says "CI not
checked"; one whose review read fails keeps its CI and says "review not checked"; only a PR whose
reads both fail has no signal. The review verdict is the PR's `ai-review:*` label, the one verdict
the merge gate also reads (`merge-gate.md`); the page does not read formal reviews, and no config
key names another review label.

Merged PRs make two things. A campaign PR merged since `queue.json` `campaign_started_at` that no
queue entry names is a done card in its workstream. A queue entry whose PR the forge merged renders
as done, says what the queue said and is listed as drift for the next sync (`drift` in `--json`, one
warning line in "Blocking the run"); so does an entry with no PR whose issue a merged PR closes
(`Closes #N` in its body), which is matched to that PR and not counted a second time. Known limits:

- Only the newest 300 PRs are read, so a campaign with more merged PRs than that since it started
  shows the newest.
- Without `campaign_started_at` no unnamed PR is counted, because nothing bounds it.
- When `config.json` sets `scope_labels`, an unnamed merged PR counts only if it carries every one
  of them (the same matcher the sync uses, `issueMatchesScope`); a PR whose forge channel reports
  no labels is kept. `scope_milestone` is not applied to PRs, because a pull request row carries no
  milestone, and there is no author filter.
- Closing references are read from the PR body only; the forges' own linked-issue fields are not.

A failed refresh is reported in one line and never blocks the turn: the checkpoint is the SSOT, this
page only shows it.

## What the orchestrator records

Everything the page shows is derived from campaign state, so nothing on it is typed by hand. Four
facts come from the owner or the orchestrator; each has one home (ADR-052):

| Fact | Home | Written by | When |
|------|------|-----------|------|
| Headline (one sentence) | checkpoint `## Headline` | orchestrator | every checkpoint write |
| Blocking the run (one line each) | checkpoint `## Blocking the run` (`none` when nothing blocks) | orchestrator | every checkpoint write |
| Scope (in, parked, deferred, blocked upstream, out; date and optional reason) | `config.json` → `campaign_scope.entries` | the coordinator (Pattern B) or the main-chat orchestrator (Pattern C), with `bun scripts/campaign-record.ts scope` | the launch configuration gate, and every owner scope change |
| Your decisions (date, one line) | `owner-decisions.json` | the coordinator (Pattern B) or the main-chat orchestrator (Pattern C), with `bun scripts/campaign-record.ts decision` | every owner answer to a gate, and every scope or priority instruction |

In Pattern B the orchestrator records only an answer given to it directly, never one the
coordinator relayed, so each answer is written once (`clarify-gates.md` § Chat feedback intake,
item 6). Only the record script writes these two files (atomic, checked, a repeated call changes
nothing, and re-recording an entry keeps its place and date):

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


### Cursor (Canvas present)

- Refresh the canvas named exactly **`Blackhole status`**, with `bun run status --json` as its
  data source. The JSON shape is the `StatusReport` type
  (`scripts/lib/campaign-status/types.ts`); render the same sections as the HTML page, in
  the same order (§ Page layout below).
- If no canvas with that name exists, create it once; afterwards rebuild that canvas, never a
  second one with a new name.
- Cursor CLI or a session without Canvas falls through to the local file below.

### Any other harness, or no artifact/canvas tool

Run `bun run status --html`, then print the path once per session (`📄 Status page: .blackhole/.tmp/status.html`).
Later refreshes rewrite the same file silently.

## Page layout

Top to bottom, the sections of the Data dashboard (`templates/status-dashboard/index.html`) and
of `--html` (`scripts/lib/campaign-status/html.ts`), both from one `StatusReport`, so the owner
sees at a glance where the run stands and what to do:

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
4. **Workstreams** — done / in review / left / next per stream. On the Data dashboard a stream
   button above the board, or a row, shows only that stream (no buttons when there is one
   stream); `--html` ships no script, so it has the table without the filter
5. **Scope** (in, parked, deferred, blocked upstream, out; "Scope not recorded" when none is),
   **Config**, **Your decisions** (newest first; the Data dashboard shows four and folds the rest)

`--html` keeps its detail sections after these: in progress, waiting on you, waiting on
something else by reason class (`elseClasses()`), up next, recently done, and a closed native
`<details>` with host, checkpoint notes and open findings. The text dashboard (`dashboard.ts`)
is shorter: it prints the headline, the board counts, your move, the scope and the newest
decisions above its queue sections, with no card list and no workstreams.
Visual rules: R-006 (`documentation/reference/product-principles.md`).

## State file

`.blackhole/status-artifact.json` is the one state file meant to be committed in a consumer repo
(`blackhole-state.md` § Paths), so every session and machine reuses the same link. On
`state_store: branch` it also travels with the state branch.
<!-- GENERATED by scripts/build.ts from src/references/status-page.md — do not hand-edit -->
