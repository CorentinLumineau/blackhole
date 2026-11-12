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

A refresh is cheap and idempotent: regenerate, then update the existing view. A failed refresh is
reported in one line and never blocks the turn — the checkpoint is the SSOT, this page only
shows it.

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
from `${BLACKHOLE_PLUGIN_ROOT:-.}`). Its datasets are `summary`, `in_progress`, `waiting_on_you`,
`waiting_else`, `waiting_else_items`, `up_next`, `recently_done` and `notes` (the ids and fields:
`scripts/lib/campaign-status/data.ts`). The page works STALE out in the reader's browser from
`summary.last_activity_at` and `summary.stale_after_hours` (the one `STALE_AFTER_HOURS`), so a
dashboard nobody refreshes stops saying RUNNING by itself; "x min ago" is computed when it is
opened. Read `.blackhole/status-artifact.json`. Its shape is `{"url": "<claude.ai artifact link>",
"kind": "data", "created_at": "<ISO8601>", "template_version": <n>}`.

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
  4. Write `{url, kind: "data", created_at, template_version}` to `.blackhole/status-artifact.json`
     (atomic `.tmp` + `mv`, `blackhole-state.md` § Write protocol); `template_version` is the
     template's `<meta name="bh-template-version">`. Print the link once.
- **File present, `kind: "data"`** (every checkpoint). Do not print the link again.
  1. Run step 1, then read the versions to pin: `ArtifactData` `list` of `datasets` (and `get`
     `files/index.html` and `dash/meta` when this refresh writes them). Every write below is
     an update of an existing document, so each carries `if_version` (the `version` just read).
  2. Upload each row file as an asset again (one call each, as above).
  3. Update `datasets/<id>.source.url` plus the `updated` and `edit` stamps for all datasets in
     **one** `ArtifactData` `batch`, every entry with its `if_version`. On a version conflict,
     re-read that document and redo that one write; never retry blind and never overwrite.
  4. `files/index.html` is written only when the template's `bh-template-version` differs from
     `status-artifact.json`'s `template_version`, and only after re-reading the stored file (a
     person may have saved hand edits with the page's editor; merge, do not clobber). Then
     update `template_version` in `status-artifact.json`.
  5. After the batch succeeds, delete each superseded asset: the id is the `<id>` of the old
     `source.url` (`/_blob/<id>`), removed with `Artifact` `action: "delete"`, `url`, `path: <id>`.
     Without it every checkpoint leaves 8 orphaned blobs. A failed delete is reported in one
     line and does not undo the refresh.
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

Top to bottom (`scripts/lib/campaign-status/html.ts` for `--html`, `templates/status-dashboard/index.html` for the Data dashboard, same sections), so the owner sees at once whether the
campaign is working, which turn it is and what to do:

0. **State banner** — turn, `RUNNING` / `WAITING ON YOU` / `IDLE` / `DONE`, last activity
   (relative and UTC) and "Your next action". `STALE` replaces the state when the newest of the
   checkpoint and queue write times is older than `STALE_AFTER_HOURS` (`staleness.ts`), saying
   "state last written Xh ago, so what follows may be out of date" (`state`); the Data dashboard
   decides this in the reader's browser, against the time it is opened
1. **In progress** — in-flight and in-review issues, each with its next step
2. **Waiting on you** — PRs delivered at LGTM (`Open PR ↗` and `Files changed ↗` links) and
   owner gates (`awaiting-*`, `blocked-escalated:`); empty state "Nothing is waiting on you."
3. **Waiting on something else** — blocked items the owner cannot clear, one line per reason class
   (tracking issue, dependency / upstream, sequenced phase, other, another lane: count plus first
   3 issues), each class's full list with notes in a folded native `<details>` (`blocked_classes`)
   The campaign's own lanes are `claude` and `blackhole`; an `in-progress:*` / `agent:*` label
   naming any other lane puts the item in "another lane". The rule reads issue labels, not
   `contributor-contract.json`. Merge-conflict and overlap waits keep their own classes, and a
   class holding a note that addresses the owner (`owner:` or `needs-owner`) renders open
4. **Up next** — the ready set, capped
5. **Recently done** — newest merged/closed items (`recently_done`)
6. **Details** — a collapsed native `<details>`: host and environment, the checkpoint's
   `## Notes` and `## In-flight workers` lines, open findings

## State file

`.blackhole/status-artifact.json` is the one state file meant to be committed in a consumer repo
(`blackhole-state.md` § Paths), so every session and machine reuses the same link. On
`state_store: branch` it also travels with the state branch.
<!-- GENERATED by scripts/build.ts from src/references/status-page.md — do not hand-edit -->
