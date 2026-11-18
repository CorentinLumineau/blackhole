# Status Page — One Live View of the Campaign

The owner checks campaign state on one page instead of asking the agent. The page is fed by
`bun run scripts/campaign-status.ts --json` (the same counts as the text dashboard, `coordinator-dashboard.md`
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
| `status` mode / the owner asks for status | whoever runs `bun run scripts/campaign-status.ts` |

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
what blocks most), and a campaign with no recorded scope shows its issue filter (`all open issues` when none is set).

Derived, never recorded: the stage of each card (queue state, the scope entry naming it, and the
PR's review label, CI and mergeability when the forge is read), the workstream of each issue
(`status_page.streams`, `config-template.md`; one stream when absent), the quick links (the
forge's PR, issue and CI pages, plus `status_page.links`) and the config rows (`config.json` and
the plugin version).

## Refresh procedure

1. Render the view for this harness. Claude Code publishes a live **Data dashboard** fed by
   `bun run scripts/campaign-status.ts --data .blackhole/.tmp/status-data` (one `<id>.json` row file per dataset,
   derived from the same `StatusReport` as `--json`, so the counts never diverge); every other
   harness renders `bun run scripts/campaign-status.ts --html`, which writes `.blackhole/.tmp/status.html` (override
   with `--out <path>`) and prints the path. `--html` escapes every value and loads nothing from
   the network. With no `queue.json` yet (a fresh checkout holding only
   `config.json`), run `bun run scripts/forge-sync.ts` first: it builds the queue and an empty ledger from
   the forge (`forge-sync.md` § Queue builder script).
2. Update the single view for this harness — the first matching row wins:


### Any other harness, or no artifact/canvas tool

Run `bun run scripts/campaign-status.ts --html`, then print the path once per session (`📄 Status page: .blackhole/.tmp/status.html`).
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
   the run** ("Nothing blocks the run.") and **Decisions waiting for you** (a count, then each
   question parked by sleep mode, most-blocking first, with its recommended answer;
   `pending-decisions.json`, read with `sleep-mode.md`'s helpers)
3. **Stage board** — five columns: in review (`ready`, `review`, `active`: work in flight
   without a PR yet), blocked, not started (`you`: an owner gate, `todo`), parked, done. Four
   cards per column, the rest in a native `<details>` "N more". Each card is a link `#ref title`
   and a one-line status whose colour repeats its words: green done, blue in review, orange your
   move, red a conflict, failing CI or a bad queue entry, grey otherwise
4. **Workstreams** — done / in review / left / next per stream. On the Data dashboard a stream
   button above the board, or a row, shows only that stream (no buttons when there is one
   stream); `--html` ships no script, so it has the table without the filter
5. **Scope** (in, parked, deferred, blocked upstream, out; the issue filter, `all open issues` when none is set, when no entry is recorded),
   **Config**, **Your decisions** (newest first; the Data dashboard shows four and folds the rest),
   **Hook denials** (top 5 rules by deny and warn count, or `no hook denials recorded`),
   **Usage budget** — see below — and **Run**: the run route from `run-context.json` (pattern,
   host, state store, question and forge channels, any missing capability), sleep mode on or off
   with the parked count, and the coordination role (solo, manager, or peer of its manager)

Every top-level config block names the dataset that shows it, or `none` with a reason, in
`config-template.md` § Status page coverage (`V-CONFIG-03`): a run feature that adds config adds
its row there, and its panel bumps `bh-template-version`.

**Usage budget** (`scripts/lib/campaign-status/budget.ts`) reads the host's usage source
(`usage-source.ts`; the host `run-context.json` records, else the environment's; Cursor has none, so
the panel says `usage not probed — <reason>`): on Claude or an unknown host, the rate-limit cache
`pace-gate.ts` and `usage-budget.ts` read (`resolveRateLimitCachePath`: `resource_policy.pace.cache_path`,
else `~/.claude/cache/rate-limits.json`; stale past `resource_policy.pace.max_age_seconds`) and
shows: the **5-hour** % and reset, only when the plan has a current five_hour window (a weekly-only
plan shows no 5-hour row); the **Weekly** % and reset; **Workers allowed** with the
`workersAllowed()` verdict and its first reason (`unavailable` with `parallel_max` when
`usage_budget` is off or invalid, as the CLI returns); one **Forecast** row per distinct weekly
threshold (`no_new_starts_at`, `stop_campaign_at`): `weekly X% reached around <day HH:MM UTC>`,
or `not reached before the reset`, from the pace since the weekly window opened at 0%
(`forecastWeekly()`); **Weekly target** (`usage_budget.weekly.target_at_reset`, when set); **Pace**; the reading's age; and **Usage windows**, the windows the reading shows and its source. With no current reading it says
`usage not probed — <reason>`, except when the cache is only older than `max_age_seconds` and still
carries a current weekly window: then it shows that last reading, its age and, with a target, where
the line from 0% at the window start to `target_at_reset` at the reset stands now
(`weekly 21% at Tue 17 Nov 05:54 UTC, 4h 15m old (stale); target line 22.5% now`). Pacing still
treats a stale cache as not probed. Times are UTC, so every host prints the same page.

**Pace** is on every Budget panel, probed, stale or not probed. `weeklyPace()` (`usage-budget.ts`)
reads `.blackhole/usage-history.jsonl` (the weekly readings `usage-probe.ts` appends) plus the
reading on hand, keeps the readings of the current weekly window, and compares the slope over the
last `PACE_RATE_WINDOW_HOURS` (3) hours (the two newest readings when fewer) with the rate needed
to land on `target_at_reset` at the reset, `(target - used) / hours to reset`: `ACCELERATE` below
0.85× the needed rate, `DECELERATE` above 1.15×, else `ON TRACK`. It also gives the points over or
under the straight line from the window's first reading to the target at the reset:
`Pace: DECELERATE — 3.5%/h now vs 0.6%/h needed; 12 points over the line`. Without a target, with
fewer than two readings in the window, or past the reset it says `Pace: unknown — <reason>`. The
row is visibility only: nothing throttles on it, the usage gate still sizes the rounds. On a cloud
or Remote session the history only grows if the orchestrator probes at every turn and heartbeat
(`run-context.md`, Claude usage sources, step 2).

`--html` keeps its detail sections after these: in progress, waiting on you, waiting on
something else by reason class (`elseClasses()`), up next, recently done, and a closed native
`<details>` with host, checkpoint notes, open findings and the top 5 hook rules by deny and warn count
(`deny_counts`; `no hook denials recorded` when empty). The text dashboard (`dashboard.ts`)
is shorter: it prints the headline, the board counts, your move, the scope, the newest
decisions and a **Usage budget** section (the same rows) above its queue sections, with no card list and no workstreams.
Among its queue sections, **Merge next** numbers every open PR in the order to merge it
(`mergeNextOrder`, `scripts/lib/merge-next.ts`): CI-fix PRs first, then parents, then children,
ordered over stack edges (`effectiveParent`), `depends_on` and trunk-red parking. A forge-declared dependency (a "blocked by" edge or a stacked base set on the forge) is a `depends_on` edge after the sync (`forge-sync.md` § 6.8), so it shows exactly like a campaign-declared one. The CI-fix tier is
the trunk-red base fixes the `waiting-on-trunk-fix #N` notes name (`trunkFixIssues`). Each line names
its blocker — `waits on #N (stacked on)`, `waits on #N (depends on)`, `waits on #N (trunk fix)`,
`waits on owner/repo#N (cross-repo, …)` (an unmet body line, `forge-sync.md` § 6.7, or a cross-repo edge declared on the PR, § 6.8),
`blocked: <notes>`, `after CI fix #N`, or `none` — and a loop of edges is printed as a `Cycle, not ordered` line instead of being walked.
It sits above "Stacked PR merge order", which it does not replace.
Visual rules: R-006 (`documentation/reference/product-principles.md`).

## State file

`.blackhole/status-artifact.json` is the one state file meant to be committed in a consumer repo
(`blackhole-state.md` § Paths), so every session and machine reuses the same link. On
`state_store: branch` it also travels with the state branch.
<!-- GENERATED by scripts/build.ts from src/references/status-page.md — do not hand-edit -->
