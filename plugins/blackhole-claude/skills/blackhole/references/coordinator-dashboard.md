# Coordinator Dashboard — Main Chat Status

The coordinator is the user's **visibility layer** in Multitask Mode. The orchestrator
runs in background; the main chat must stay informative without regurgitating full
orchestrator turn logs.

## Command

```bash
bun run status
# or: bun run "${BLACKHOLE_PLUGIN_ROOT:-.}"/scripts/campaign-status.ts --campaign-dir .blackhole
```

Reads `.blackhole/config.json`, `queue.json`, `findings-ledger.json`,
`campaign-checkpoint.md`, `owner-decisions.json`, and (when `gh` is available) scoped forge open
counts plus the review label, CI and mergeability of the open PRs the board shows.

Sibling subcommand — config summary only, no forge call, no queue/ledger render:

```bash
bun run status config-summary
```

Used by the routine resume confirmation gate (`coordinator.md` § Bootstrap preflight). It is not
part of the dashboard: the dashboard prints every orchestrator turn, this prints at campaign
launch confirmation only.

## Status page

Two report modes read the same state and the same count helpers as the dashboard, so their
numbers never diverge from `bun run status`:

```bash
bun run status --json                    # StatusReport JSON on stdout
bun run status --html [--out <path>]     # self-contained page, default .blackhole/.tmp/status.html
bun run status --data <dir>              # row files <dir>/<id>.json for the Claude Data dashboard
```

All accept `--campaign-dir` and `--no-gh`. `--json`, `--html` and `--data` are mutually exclusive, and
`--out` requires `--html`.

`--data <dir>` writes one JSON array of flat rows per dataset, all derived from the `StatusReport`
(`scripts/lib/campaign-status/data.ts`, `STATUS_DATASET_IDS`):

| Dataset | Rows |
|---------|------|
| `overview` | One: `title`, `headline`, `headline_source`, `state_kind`, `last_activity_at`, `stale_after_hours` (the one `STALE_AFTER_HOURS`, so the page computes stale when it is opened), `generated_at`, `forge_checked`, and the `stage_counts` |
| `moves` | `text`, `url`, `ref` per item of `moves` |
| `blockers` | `text`, `tone`, `source` |
| `board` | `stage`, `ref`, `kind`, `title`, `status`, `tone`, `url`, `stream` per card |
| `streams` | `stream`, `done`, `in_review`, `left`, `next` |
| `scope` | `kind` (`In`, `Parked`, `Deferred`, `Blocked upstream`, `Out`), `text`, `reason`, `date`; empty when no scope is recorded |
| `config` | `key`, `value` |
| `decisions` | `date`, `text`, newest first |
| `links` | `label`, `url` |

The page (`templates/status-dashboard/index.html`) reads these and nothing else; a contract test
(`dashboard-template.test.ts`) fails when it names a dataset or field the generator does not
write. Publishing it is `status-page.md`'s job.

`--json` emits the `StatusReport` type (`scripts/lib/campaign-status/types.ts`, the one
definition of the shape; bump `schema_version` on a breaking change):

| Field | Content |
|-------|---------|
| `schema_version`, `generated_at` | `1`, ISO time of the render |
| `campaign` | `repo`, `scope` (`milestone`, `labels`), `started_at`, `queue_refreshed_at` |
| `state` | The banner (additive): `kind` (`running` \| `waiting_on_you` \| `idle` \| `done` \| `stale`), `underlying` (the kind without the stale override), `reason`, `last_activity_at`, `stale_hours`, `next_action`. `done` = no active issue; `running` = the checkpoint names a worker or an issue is in flight (a PR delivered at LGTM is not work in flight); `waiting_on_you` = nothing runs and the owner has an item or a PR to merge; `idle` = otherwise. `kind` is `stale` when the newest of `checkpoint.refreshed_at` / `campaign.queue_refreshed_at` is older than `STALE_AFTER_HOURS` (2 h, `scripts/lib/campaign-status/staleness.ts`) or neither parses, and it wins over every other kind. `next_action` is the first owner item's note (gate token removed; its next step when the note is empty), else "Review and merge PR #N", else "Nothing — the campaign is running on its own." |
| `alerts` | Loud lines (additive), each `{kind, message}`: `stale_state` when the newest state write is older than `STALE_AFTER_HOURS` (the banner's rule, one helper), `page_never_published` when `status_page.enabled` is not `false`, the host publishes an artifact (`run-context.json` `context.host.value` is `claude`) and `.blackhole/status-artifact.json` is absent. Empty when all is well |
| `checkpoint` | `turn`, `refreshed_at`, `last_completed_phase`, `notes` (`## Notes` lines), `active_workers` (`## In-flight workers` lines with the list bullet stripped; an empty marker such as `none` is dropped, so it is never counted as a worker) |
| `forge` | Open issue/PR counts and `ok`/`error`, as on the dashboard's **Forge** line |
| `counts` | `queue` (`active`, `done`, `in_flight`, `blocked`, `ready`, `unclassified`, `by_status`) and `ledger` (`open`, `block`, `warn`, `note`, `deferred`) — the dashboard's **Queue** and **Ledger** lines |
| `queue_health` | `healthy` \| `stalled` \| `degraded` |
| `ready_to_merge` | Open PRs that wait on the owner to merge, each a status item plus `pr_url`: delivered at LGTM, or held by the low-risk merge gate (`notes` start with `needs-chef`, `merge-gate.md` § 9; the item then carries `held_for`, the categories the note names). Additive; `schema_version` stays `1`. A delivered item is ready when its queue entry is `in-flight`, has a `pr`, and its `notes` start with `delivered-at-LGTM` — the `leave-open` marker `phase-loop.md` § Merge protocol writes only after LGTM, no conflict and CI green. Read offline from `queue.json`, no forge call. `pr_url` is `https://github.com/<repo>/pull/<n>` (GitHub) or `https://<host>/<repo>/pulls/<n>` (Gitea, host from the origin remote); an item whose URL cannot be built (GitLab, unknown Gitea host, non-`owner/name` repo) is left out |
| `waiting_on_owner` | Blocked items only the owner can clear (`awaiting-*`, `blocked-escalated:`); an item with a PR also carries `pr_url` |
| `in_flight`, `in_review` | In-flight items split by `phase: review`, each `{issue, title, phase, status, pr, notes, next_step}` |
| `blocked` | Groups `{waits_on, owner, count, issues}`; `waits_on` is the `awaiting-*` token, `blocked-escalated`, `dependency`, `overlap`, `merge-conflict` or `other` |
| `ready` | The ready set |
| `blocked_classes` | The non-owner part of `blocked` regrouped by reason class (`class`, `label`, `count`, `issues`), in display order: `tracking_issue`, `dependency`, `merge_conflict`, `overlap`, `sequenced_phase`, `other`, `another_lane`; each class also carries `attention` (true when a non-lane item's note starts `owner:` or says `needs-owner`; the page renders that class open). Every non-owner blocked issue is in exactly one class. Classified once by `classifyBlocked()` in `blocked-classes.ts` (re-exported by `report.ts`), first match wins: a foreign-lane label (`in-progress:*` / `agent:*` whose lane is not `claude` or `blackhole`, the lanes the contributor contract gives the campaign; no config key declares them), then a note saying `tracking issue`, then `in sequence`, then a merge-conflict or overlap wait, then a dependency (unmet `depends_on`, or a note starting `dependency`/`upstream` or saying `depends on`), else `other`. Additive; `blocked` is unchanged |
| `unclassified` | Active items whose `status` is missing or not a documented value, so no other list holds them; `next_step` names the valid values. Additive; counted in `counts.queue.unclassified` and shown on the dashboard's **Queue** line when non-zero |
| `untracked_prs` | Open forge PRs no queue entry's `pr` names (`{pr, title}`, lowest first): work opened without an issue, such as a trunk fix or a dependency bump. Taken from the open-PR list the `forge` counts already fetch, so no extra call; `null` when that list was not fetched (`--no-gh`, forge failure), never an unchecked `[]`. Additive |
| `recently_done` | Newest merged/closed items, highest PR then issue number first (the queue holds no merge time), at most 5 |
| `ledger_open` | Every open finding, BLOCK first then most recent (`id`, `vcode`, `severity`, `summary`, `issue_ref`) |
| `host` | `pace` (the pace line or `null`) and `notes` (plugin-drift lines) |
| `scope_record` | `recorded` and the `entries` of `config.json` `campaign_scope` (`kind`, `text`, `set_at`, optional `reason`, `refs`, `filter`); malformed entries are dropped. Additive |
| `decisions` | `owner-decisions.json`, newest first (`date`, `text`, optional `refs`). Additive |
| `headline` | `{text, source}`: the checkpoint's `## Headline` (`checkpoint`), else one sentence from the stage counts (`generated`). Additive |
| `blockers` | `{text, tone, source}`: the checkpoint's `## Blocking the run` lines, matched on a heading that starts its line (`none` ⇒ empty), else the failing or conflicting PRs, the three largest blocked reason classes and, offline, a "forge not checked" line; then one warning line when `drift` is not empty. Additive |
| `drift` | Queue entries the forge contradicts: `{issue, pr, title, queue, forge}` where `queue` is the queue's status and `forge` is `merged`. The board shows each as done, with "merged on the forge; queue said …", the counts and workstream totals follow, and `blockers` gets one warning line; the next sync brings `queue.json` in line. Empty when the merged PRs were not read. Additive |
| `forge_checked` | True when the forge counts and the PR signals were read this render; false under `--no-gh` or a forge failure. Additive |
| `board` | One card per queue entry, per `untracked_prs` entry and per merged campaign PR no entry names (a `done` card): `stage` (`ready`, `review`, `active`, `blocked`, `you`, `todo`, `parked`, `done`), `ref` (the PR when there is one), `kind`, `issue`, `pr`, `title`, `status`, `tone` (`ok`, `warn`, `bad`, `info` or empty), `url`, `stream`. Placed by `board.ts`: done; a non-`in` scope entry naming it (parked, or blocked for `blocked_upstream`); an undocumented status; an owner gate; in flight without a PR (`active`); an open PR by its signal (conflict or failing CI ⇒ blocked; LGTM, or a delivered-at-LGTM marker, with green CI ⇒ ready; otherwise review), or by the queue with "CI not checked" when there is no signal; blocked; ready ⇒ `todo`. Additive |
| `stage_counts` | `done`, `in_review` (`ready` + `review` + `active`), `on_you` (the length of `moves`), `blocked`, `parked`, `not_started` (`you` + `todo`), `total`. Additive |
| `moves` | `{text, url, ref}`: PRs delivered at LGTM or held for the owner, then owner gates, then other ready PRs. Additive |
| `streams` | Per workstream (`status_page.streams`, `config-template.md`): `done`, `in_review`, `left` (not parked), `next` (the first card still to move). Additive |
| `links` | The forge's PR, issue and CI pages (GitHub, or Gitea with a known host), then `status_page.links` (http(s) only). Additive |
| `config_rows` | Merge mode, autonomy, concurrency, verification, issue filter, kaizen and plugin version, read from `config.json`. Additive |

The text dashboard prints the same `alerts` lines above its output, and `--html` prints them on stderr (stdout stays the page path). `--html` leads with a state banner (turn, state, last activity relative and in UTC, the owner's
next action), then the sections of `status-page.md` § Page layout (headline, board counts and quick links; **Your move**; **Blocking the run**; the five-column **Stage board**; **Workstreams**; **Scope**, **Config**, **Your decisions**), then **In progress**, **Waiting on you** (PRs ready to merge with their links, and
owner gates), **Waiting on something else** (non-owner blocked items by reason class: one visible line per class with its count and first 3 issue numbers, the full list with each item's note in a folded native `<details>`; then, when non-empty, an **Unknown queue status** class (`unclassified`, rendered open) and an **Open PR with no queue entry** class (`untracked_prs`), both built by `elseClasses()` in `report.ts`),
**Up next**, **Recently done**, and a native `<details>` holding host, checkpoint notes and open
findings. A stale state is shown as `STALE` so a frozen page never looks live.

Every string comes from campaign state, and issue titles are untrusted: `--html` escapes each
value, inlines its CSS (theme tokens with a dark-mode block, readable at ~400px) and loads
nothing from the network. Its only links are anchors (`target=_blank rel=noopener`, http(s) URLs only): the quick links, the
moves and board cards, and the `Open PR` / `Files changed` anchors of **Waiting on you**. Publishing it is `status-page.md`'s job.

## When to print (REQUIRED)

| Event | Who | Action |
|-------|-----|--------|
| Campaign start (before spawning orchestrator) | `coordinator` | Run `bun run status` → print **full** output to user |
| Orchestrator background turn completes (idle notification) | `coordinator` | Run `bun run status` → print **full** output, then resume orchestrator if work remains — fires only when orchestrator has cleared its in-flight worker barrier and ended its turn |
| User asks `status` / `@blackhole status` | Coordinator or orchestrator | Run `bun run status` → print full output; do not spawn workers |
| Intake files a GitHub issue | `coordinator` | Print one line: `📋 Filed #N — <title> (milestone <M>)` then re-run status if campaign is active |
| Orchestrator ends turn | `orchestrator` | Ensure checkpoint written; coordinator prints dashboard on notification |

### When to publish the status page

Skipped entirely when `status_page.enabled` is `false`. Procedure and per-harness view:
`status-page.md`.

| Event | Who | Action |
|-------|-----|--------|
| Campaign start | `coordinator` or main-chat orchestrator | Claude Code: `bun run status --data` → create the Data dashboard once (saves `.blackhole/status-artifact.json`); elsewhere `bun run status --html` → publish |
| Every checkpoint write | `orchestrator` | Claude Code: `bun run status --data` → upload the row files and update the datasets of the same dashboard; else `bun run status --html` → refresh the `Blackhole status` canvas / rewrite the local file (`checkpoint-protocol.md` § Write order, step 5) |
| Main chat hands the turn back with workers in flight (Pattern C) | main-chat orchestrator | Same refresh as a checkpoint write |
| User asks `status` | Coordinator or orchestrator | Print the dashboard as above, then refresh the page |

**Do not** collapse the dashboard to a one-line confirmation. Users rely on the main
chat for campaign overview.

## Dashboard sections

The status script emits markdown with:

1. **Header** — scope (milestone/labels), orchestrator turn, queue `refreshed_at`
2. **Counts** — the report's `headline` and stage board counts, the owner's moves, the recorded
   scope ("Scope not recorded" when none) and the three newest decisions, then forge open issues/PRs, queue active/done/in-flight/blocked/ready, ledger
   severities, and a **Queue health** verdict (`✓ HEALTHY` / `⚠ STALLED` / `✗ DEGRADED`) computed
   from forge availability plus the blocked/in-flight counts already shown here. Scoped
   deliberately narrow: it says nothing about plugin-cache drift or doc-tree health — those are
   separate signals read (and, for plugin-drift, rendered) elsewhere.
3. **In-flight** — table: issue, phase, PR, notes
4. **Blocked** — one line per owner gate (`awaiting-*`, `blocked-escalated:`) with its note, then one line per reason class: label, count, first 3 issue numbers and "and N more". The same `classifyBlocked()` as `blocked_classes` (`scripts/lib/campaign-status/blocked-classes.ts`), so counts match `--json`
5. **Ready** — Pareto-ready issue numbers
6. **Routing** — per active issue carrying a `route{}`: the **planned** conditional chain
   `Handle → [research?] → [investigate?] → [design-gate?] → Plan(tier) → Implement → Review([security?])`
   with the current phase bracket-marked (`▸…◂`) and per-flag confidence (`split/design/plan/sec`).
   This is planned-path + current-position, **not** an actual-history traversal (`route{}` carries
   no transition log). `research`/`investigate` render as conditional route-driven steps (handled
   by the `investigator` agent's research/investigate sub-modes). Omitted when no active issue
   carries a route. Capped at 10 issue blocks with a `…and N more` line beyond that.
7. **Waves** — execution waves from a topological sort on `depends_on`, behaviorally identical to
   `queue-dag.md` § Step 4 (Wave 0 = no unsatisfied deps; Wave N = deps placed in prior waves;
   merged/closed deps count as satisfied). Dependency cycles surface in an **Unresolved** line,
   never silently dropped. Omitted when there are no active issues. Capped at 10 `Wave N` lines
   with a `…and N more` line beyond that.
8. **Completed** — merged/closed in queue
9. **Issues filed** — ledger rows with `deferred_to_issue` (discovery filings)
10. **Ledger open** — top open V-code findings, capped at 10 with a `…and N more` line beyond
    that.
11. **Active workers** — from checkpoint `## In-flight workers` section

## Coordinator turn flow (with visibility)

```
Orchestrator turn completes (notification)
  ↓
Coordinator: bun run status → print full dashboard to user
  ↓
If queue work remains and not blocked on user: resume orchestrator
  ↓
END TURN
```

## Anti-patterns

- "Turn 5 complete" with no dashboard
- Resuming orchestrator without printing status when user has not seen progress
- Replacing dashboard with subagent `user_visible_high_level_summary` only — summary is a teaser; dashboard is SSOT for chat
- Orchestrator ends turn with `## In-flight workers` populated — campaign stalls; workers complete but no agent triages (`multitask-mode.md` § Cursor Pattern B — Background worker barrier)

## References

- Phase 0 dashboard: `SKILL.md`
- Checkpoint: `checkpoint-protocol.md`
- Forge sync one-liner: `forge-sync.md` § sync summary (orchestrator logs; coordinator runs full status)
<!-- GENERATED by scripts/build.ts from src/references/coordinator-dashboard.md — do not hand-edit -->
