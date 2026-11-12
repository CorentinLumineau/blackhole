# Coordinator Dashboard — Main Chat Status

The coordinator is the user's **visibility layer** in Multitask Mode. The orchestrator
runs in background; the main chat must stay informative without regurgitating full
orchestrator turn logs.

## Command

```bash
bun run status
# or: bun run scripts/campaign-status.ts --campaign-dir .blackhole
```

Reads `.blackhole/config.json`, `queue.json`, `findings-ledger.json`,
`campaign-checkpoint.md`, and (when `gh` is available) scoped forge open counts.

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
```

Both accept `--campaign-dir` and `--no-gh`. `--json` and `--html` are mutually exclusive, and
`--out` requires `--html`.

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
| `counts` | `queue` (`active`, `done`, `in_flight`, `blocked`, `ready`, `by_status`) and `ledger` (`open`, `block`, `warn`, `note`, `deferred`) — the dashboard's **Queue** and **Ledger** lines |
| `queue_health` | `healthy` \| `stalled` \| `degraded` |
| `ready_to_merge` | Open PRs delivered at LGTM, each a status item plus `pr_url` (additive; `schema_version` stays `1`). An item is ready when its queue entry is `in-flight`, has a `pr`, and its `notes` start with `delivered-at-LGTM` — the `leave-open` marker `phase-loop.md` § Merge protocol writes only after LGTM, no conflict and CI green. Read offline from `queue.json`, no forge call. `pr_url` is `https://github.com/<repo>/pull/<n>` (GitHub) or `https://<host>/<repo>/pulls/<n>` (Gitea, host from the origin remote); an item whose URL cannot be built (GitLab, unknown Gitea host, non-`owner/name` repo) is left out |
| `waiting_on_owner` | Blocked items only the owner can clear (`awaiting-*`, `blocked-escalated:`); an item with a PR also carries `pr_url` |
| `in_flight`, `in_review` | In-flight items split by `phase: review`, each `{issue, title, phase, status, pr, notes, next_step}` |
| `blocked` | Groups `{waits_on, owner, count, issues}`; `waits_on` is the `awaiting-*` token, `blocked-escalated`, `dependency`, `overlap`, `merge-conflict` or `other` |
| `ready` | The ready set |
| `blocked_classes` | The non-owner part of `blocked` regrouped by reason class (`class`, `label`, `count`, `issues`), in display order: `tracking_issue`, `dependency`, `merge_conflict`, `overlap`, `sequenced_phase`, `other`, `another_lane`; each class also carries `attention` (true when a non-lane item's note starts `owner:` or says `needs-owner`; the page renders that class open). Every non-owner blocked issue is in exactly one class. Classified once by `classifyBlocked()` in `report.ts`, first match wins: a foreign-lane label (`in-progress:*` / `agent:*` whose lane is not `claude` or `blackhole`, the lanes the contributor contract gives the campaign; no config key declares them), then a note saying `tracking issue`, then `in sequence`, then a merge-conflict or overlap wait, then a dependency (unmet `depends_on`, or a note starting `dependency`/`upstream` or saying `depends on`), else `other`. Additive; `blocked` is unchanged |
| `recently_done` | Newest merged/closed items, highest PR then issue number first (the queue holds no merge time), at most 5 |
| `ledger_open` | Every open finding, BLOCK first then most recent (`id`, `vcode`, `severity`, `summary`, `issue_ref`) |
| `host` | `pace` (the pace line or `null`) and `notes` (plugin-drift lines) |

The text dashboard prints the same `alerts` lines above its output, and `--html` prints them on stderr (stdout stays the page path). `--html` leads with a state banner (turn, state, last activity relative and in UTC, the owner's
next action), then **In progress**, **Waiting on you** (PRs ready to merge with their links, and
owner gates), **Waiting on something else** (non-owner blocked items by reason class: one visible line per class with its count and first 3 issue numbers, the full list with each item's note in a folded native `<details>`),
**Up next**, **Recently done**, and a native `<details>` holding host, checkpoint notes and open
findings. A stale state is shown as `STALE` so a frozen page never looks live.

Every string comes from campaign state, and issue titles are untrusted: `--html` escapes each
value, inlines its CSS (theme tokens with a dark-mode block, readable at ~400px) and loads
nothing from the network. Its only links are the `Open PR` / `Files changed` anchors of the
**Waiting on you** section (`target=_blank rel=noopener`, http(s) URLs only). Publishing it is `status-page.md`'s job.

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
| Campaign start | `coordinator` or main-chat orchestrator | `bun run status --html` → publish (first publish saves `.blackhole/status-artifact.json`) |
| Every checkpoint write | `orchestrator` | `bun run status --html` → redeploy the same artifact / refresh the `Blackhole status` canvas / rewrite the local file (`checkpoint-protocol.md` § Write order, step 5) |
| User asks `status` | Coordinator or orchestrator | Print the dashboard as above, then refresh the page |

**Do not** collapse the dashboard to a one-line confirmation. Users rely on the main
chat for campaign overview.

## Dashboard sections

The status script emits markdown with:

1. **Header** — scope (milestone/labels), orchestrator turn, queue `refreshed_at`
2. **Counts** — forge open issues/PRs, queue active/done/in-flight/blocked/ready, ledger
   severities, and a **Queue health** verdict (`✓ HEALTHY` / `⚠ STALLED` / `✗ DEGRADED`) computed
   from forge availability plus the blocked/in-flight counts already shown here. Scoped
   deliberately narrow: it says nothing about plugin-cache drift or doc-tree health — those are
   separate signals read (and, for plugin-drift, rendered) elsewhere.
3. **In-flight** — table: issue, phase, PR, notes
4. **Blocked** — issue list with blocker reason
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
