# Campaign Checkpoint — Resume Protocol

Lightweight persistence for orchestrator crash/compaction recovery. Complements `queue.json` and `findings-ledger.json`.

## Files

| File | Purpose |
|------|---------|
| `.blackhole/queue.json` | Scheduling DAG (primary) |
| `.blackhole/findings-ledger.json` | Findings SSOT (primary) |
| `.blackhole/campaign-checkpoint.md` | Human-readable resume summary (**required when any queue issue is `in-flight`**) |

## Write order

On every orchestrator turn end, persist in this order:

1. `queue.json` (atomic tmp + mv)
2. `findings-ledger.json` (atomic tmp + mv)
3. `campaign-checkpoint.md` (when in-flight work exists)

Never write checkpoint before queue and ledger are valid (`jq empty` on both).

## Turn ID rules

- **Normal turn end:** `orchestrator_turn_id = (previous checkpoint value || 0) + 1`
- **Post-compaction/recovery first turn:** increment per compaction recovery step 5 (even if no other state changed)
- **`last_completed_phase`:** last phase fully completed for primary in-flight issue this turn (`handle` | `plan` | `implement` | `review`)

## Checkpoint template

Path: `.blackhole/campaign-checkpoint.md`

```markdown
---
refreshed_at: 2026-07-05T00:00:00.000Z
orchestrator_turn_id: 12
last_completed_phase: review
---

# Campaign Checkpoint

## In-flight

| Issue | Phase | Status | PR | Review iteration |
|-------|-------|--------|-----|------------------|
| 298 | review | in-flight | 42 | 2 |

## In-flight workers

- reviewer on #298 PR 42 (spawned turn 12)

## Ready set

301, 275

## Ledger open

BLOCK: 1 | WARN: 3 | deferred: 2

## Notes

Awaiting implement fix for V-KISS-03 on #298.
```

## Compaction recovery

See also: [recovery-protocol.md](recovery-protocol.md) (dirty worktree / mixed-issue stash recovery).

After context loss or session restart:

1. Read `campaign-checkpoint.md` if present; else infer from `queue.json`
2. Run forge sync (`forge-sync.md`)
3. Validate `jq empty` on queue + ledger
4. Resume in-flight issues at their `phase` — do not re-spawn completed work
4b. If an in-flight issue has an associated `wt-<issue>` and the worktree is dirty (or stash contains recovery tags), **pause implementer respawn** and follow [recovery-protocol.md](recovery-protocol.md) before continuing
5. Increment `orchestrator_turn_id` on first post-recovery turn

## Fields

| Field | Location | Description |
|-------|----------|-------------|
| `orchestrator_turn_id` | checkpoint frontmatter | Monotonic turn counter |
| `last_completed_phase` | checkpoint frontmatter | Last phase fully completed for primary in-flight issue |
| `review_iteration` | `queue.json` issues.* | Per-issue review loop counter |
| `in_flight_workers` | checkpoint body | Active worker spawns for resume |

## Session handoff

Coordinator/orchestrator session handoff MUST include:

```
CHECKPOINT: turn <N> | in-flight: #<issues> | LEDGER OPEN: <count>
```
