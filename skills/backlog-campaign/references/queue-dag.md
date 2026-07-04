# Queue DAG — Schema + Scheduling

Path: `.backlog-campaign/queue.json` (gitignored at runtime).

## Schema

```json
{
  "refreshed_at": "2026-07-04T12:00:00.000Z",
  "campaign_started_at": "2026-07-04T10:00:00.000Z",
  "user_queue_order": [301, 298, 275],
  "issues": {
    "298": {
      "title": "Cashflow v3 epic",
      "phase": "handle",
      "status": "blocked",
      "depends_on": [],
      "blocks": [301, 302],
      "worktree": null,
      "pr": null,
      "migration_slot": false,
      "touch_paths": ["lib/cashflow/**", "app/(app)/cashflow/**"],
      "size": "xl",
      "epic_parent": null,
      "notes": "awaiting PO sign-off"
    }
  }
}
```

### Field rules

| Field | Values | Notes |
|-------|--------|-------|
| `phase` | `handle` \| `plan` \| `implement` \| `review` \| `done` | Current lifecycle phase |
| `status` | `blocked` \| `ready` \| `in-flight` \| `merged` \| `closed` | Scheduling state |
| `notes` | string \| null | e.g. `awaiting-user-clarification`, `awaiting-plan-approval`, `overlap with #N` |
| `depends_on` | number[] | Issue numbers that must be merged/closed first |
| `blocks` | number[] | Inverse index (optional, for display) |
| `migration_slot` | boolean | True if issue owns schema migration |
| `touch_paths` | string[] | Glob patterns for conflict detection |
| `epic_parent` | number \| null | Child issues link to parent epic |

### Status transitions

```
blocked → ready        (dependencies satisfied, user gate cleared)
ready → in-flight      (worker spawned)
in-flight → ready      (review found BLOCK — back to implement, still in-flight until worker ends)
in-flight → merged     (PR merged, issue closed)
* → closed             (superseded, duplicate, or wontfix)
```

## Scheduling algorithm

Run **forge sync first** (automatic, every iteration), then:

### Step 1 — Forge sync

See `forge-sync.md`. Refresh open/closed state, PR links, labels.

### Step 2 — Ready set

An issue is **ready** when ALL hold:

1. `status` is `ready` (not `blocked`, `in-flight`, `merged`, `closed`)
2. `notes` does not contain `awaiting-user` or `awaiting-plan` (user gates)
2. Every `depends_on` issue has `status: merged` or `closed` on forge
3. No active `migration_slot` holder unless this issue holds the slot
4. Issue is open on forge (`gh issue view --json state`)

Promote `blocked → ready` when dependencies clear and user gates pass.

### Step 3 — Conflict filter

For each pair in ready set, if `touch_paths` globs overlap on likely files,
keep the issue earlier in `user_queue_order`; defer the other (set `blocked`
with note `overlap with #N`).

**Migration slot:** at most one `in-flight` issue with `migration_slot: true`.
Others with `migration_slot: true` stay `blocked` until slot frees.

### Step 4 — Batch selection

Take up to `parallel_max` (default 4 from config) from ready set, ordered by
`user_queue_order`. Spawn workers in **one orchestrator turn**.

### Step 5 — Persist

Bump `refreshed_at` on every mutation:

```bash
jq '.refreshed_at = (now | todate)' .backlog-campaign/queue.json \
  > .backlog-campaign/queue.json.tmp \
  && mv .backlog-campaign/queue.json.tmp .backlog-campaign/queue.json
```

## Initialize from forge

On first `sync` with empty queue:

```bash
gh issue list --state open --json number,title,labels --limit 200
```

Create one `issues.<n>` entry per open issue: `phase: handle`, `status: ready`,
`depends_on` parsed from body "Blocked by #N" / "Depends on #N".
