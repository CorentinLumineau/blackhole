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
| Scope (in, parked, deferred, blocked upstream, out; date and optional reason) | `config.json` → `campaign_scope.entries` | the coordinator (Pattern B) or the main-chat orchestrator (Pattern C), with `bun "${BLACKHOLE_PLUGIN_ROOT:-.}"/scripts/campaign-record.ts scope` | the launch configuration gate, and every owner scope change |
| Your decisions (date, one line) | `owner-decisions.json` | the coordinator (Pattern B) or the main-chat orchestrator (Pattern C), with `bun "${BLACKHOLE_PLUGIN_ROOT:-.}"/scripts/campaign-record.ts decision` | every owner answer to a gate, and every scope or priority instruction |

In Pattern B the orchestrator records only an answer given to it directly, never one the
coordinator relayed, so each answer is written once (`clarify-gates.md` § Chat feedback intake,
item 6). Only the record script writes these two files (atomic, checked, a repeated call changes
nothing, and re-recording an entry keeps its place and date):

```bash
bun "${BLACKHOLE_PLUGIN_ROOT:-.}"/scripts/campaign-record.ts scope --kind in --text "Open issues in milestone v2.0" --filter
bun "${BLACKHOLE_PLUGIN_ROOT:-.}"/scripts/campaign-record.ts scope --kind parked --text "Theme editor" --refs 111 --reason "another team owns it"
bun "${BLACKHOLE_PLUGIN_ROOT:-.}"/scripts/campaign-record.ts decision --text "Park the theme editor: another team owns it" --refs 111
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


### Claude Code (Artifact tool present)

One Data dashboard per campaign, laid out by `templates/status-dashboard/index.html` (resolve it
from `${BLACKHOLE_PLUGIN_ROOT:-.}`). Its datasets are `overview`, `moves`, `blockers`, `board`,
`streams`, `scope`, `config`, `decisions` and `links` (`STATUS_DATASET_IDS`; the ids and fields:
`scripts/lib/campaign-status/data.ts`). The page works STALE out in the reader's browser from
`overview.last_activity_at` and `overview.stale_after_hours` (the one `STALE_AFTER_HOURS`), so a
dashboard nobody refreshes stops saying running by itself; "x min ago" is computed when it is
opened. Read `.blackhole/status-artifact.json`. Its shape is `{"url": "<claude.ai artifact link>",
"kind": "data", "created_at": "<ISO8601>", "template_version": <n>, "template_sha256": "<hex>"}`;
`template_sha256` (the SHA-256 of the `files/index.html` text last written) is absent on a
dashboard published before template version 3.

- **File absent** (first publish for this campaign): create the dashboard **once** from the
  Data artifact type (`Artifact` `action: "quickstart"`, `intent: "other"`, then publish with the
  returned `type_url`, a `title` and `auto_open: "after_first_write"`; the page declares the
  `assets` capability). Then:
  1. `bun run status --data .blackhole/.tmp/status-data`.
  2. Upload each row file as an asset (`Artifact` `url`, `asset: true`, `file_path`; a text file
     goes in a call of its own). Each result gives the file's `/_blob/<id>` url.
  3. Write, in one `ArtifactData` `batch`: `dash/meta` (`{title}`), one `datasets/<id>` per file
     (`{title, description, source: {kind: "file", url, name: "<id>.json", format: "json"},
     updated: {at, by: "claude"}, edit: {via: "claude", at}}`, `at` UTC ISO now), and
     `files/index.html` (`{text}` = the template; build the JSON for `file_path` with
     `bun -e 'console.log(JSON.stringify({text: await Bun.file(process.argv[1]).text()}))' <template>`).
  4. Write `{url, kind: "data", created_at, template_version, template_sha256}` to
     `.blackhole/status-artifact.json` (atomic `.tmp` + `mv`, `blackhole-state.md` § Write
     protocol); `template_version` is the template's `<meta name="bh-template-version">`,
     `template_sha256` the hash of the text written (`bun -e 'console.log(new Bun.CryptoHasher("sha256").update(await Bun.file(process.argv[1]).text()).digest("hex"))' <file>`).
     Print the link once.
- **File present, `kind: "data"`** (every checkpoint). Do not print the link again.
  1. Run step 1, then read the versions to pin: `ArtifactData` `list` of `datasets` (and `get`
     `files/index.html` and `dash/meta` when this refresh writes them). Every write below that
     updates an existing document carries `if_version` (the `version` just read).
  2. Upload each row file as an asset again (one call each, as above).
  3. In **one** `ArtifactData` `batch`: update `datasets/<id>.source.url` plus the `updated` and
     `edit` stamps of every dataset `--data` wrote, each with its `if_version`; **create** (`set`,
     no `if_version`) the `datasets/<id>` document of any id the listing does not have yet, in
     the shape of the first publish (a dashboard published before this template has none of the
     current ids); and, when step 4 rewrites the page, its `files/index.html` write plus the
     delete of every `datasets/<id>` document whose id is not in `STATUS_DATASET_IDS` (the old
     page's datasets, which the new page no longer reads), so page and data change together. On
     a version conflict, re-read that document and redo that one write; never retry blind and
     never overwrite.
  4. `files/index.html` is rewritten only when the template's `bh-template-version` differs from
     `status-artifact.json`'s `template_version`; decide its text before the step-3 batch.
     Re-read the stored file first: a person may
     have saved hand edits with the page's editor, and they are merged, never clobbered.
     - Its SHA-256 equals `status-artifact.json`'s `template_sha256`: nobody edited it; write the
       new template as is.
     - It differs, or `template_sha256` is absent (a page published before template version 3):
       treat the difference from the template it was built on as hand edits. Write the new
       template with each edit carried over where the element it changed still exists (a style
       rule, a label, an added section), keep the stored text in
       `.blackhole/.tmp/status-page-before-v<new version>.html`, and tell the owner in one line
       which edits could not be carried over.
     After the batch, update `template_version` and `template_sha256` in `status-artifact.json`.
  5. After the batch succeeds, delete each superseded asset: the id is the `<id>` of the old
     `source.url` (`/_blob/<id>`), removed with `Artifact` `action: "delete"`, `url`, `path: <id>`.
     Without it every checkpoint leaves one orphaned blob per dataset. A failed delete is
     reported in one line and does not undo the refresh.
- **File present without `kind`/`template_version`** (a hand-made dashboard or the old static
  page): leave its page and datasets alone, tell the owner once, and ask before adopting the
  template (the batch above, with the stored `url`).
- Never create a second dashboard once the file exists, and never delete it to "reset" it. If
  the stored URL can no longer be opened, tell the owner and ask before replacing it. A failed
  upload or batch is reported in one line and the old datasets keep serving.

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
