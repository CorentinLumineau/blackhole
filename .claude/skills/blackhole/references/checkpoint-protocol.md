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

## Harness-native resume (Pattern C)

On a harness offering a native run journal or `resumeFromRunId`-style mechanism (see
[claude-code-native.md](claude-code-native.md) § Resume path), that journal is a **supplementary**
crash-recovery layer for the background-safe fan-out phase only. It never substitutes for this
file's cross-harness SSOT: `.blackhole/campaign-checkpoint.md` plus `queue.json` and
`findings-ledger.json` remain the source of truth for resume regardless of harness or pattern.
Resuming from a harness journal still requires re-validating those files (`jq empty` + phase
inference per § Compaction recovery above) before continuing.

## Fields

| Field | Location | Description |
|-------|----------|-------------|
| `orchestrator_turn_id` | checkpoint frontmatter | Monotonic turn counter |
| `last_completed_phase` | checkpoint frontmatter | Last phase fully completed for primary in-flight issue |
| `review_iteration` | `queue.json` issues.* | Per-issue review loop counter |
| `in_flight_workers` | checkpoint body | Active worker spawns for resume |

## Failed-Approaches Log

Durable record of **Permanent**-classified failures (`orchestrator.md` § Error
Classification — sole taxonomy, not restated here), so a resumed campaign never
re-attempts a known dead end on the same issue.

```markdown
## Failed Approaches

- #298 | turn 14 | Tried: patched `db/client.ts` retry wrapper directly | Why it failed:
  root cause was a stale connection pool, not a missing retry — fix reverted | Class: Permanent
```

### Field rules

| Field | Description |
|-------|-------------|
| Issue ref | `#N` — the issue this attempt was made on |
| Turn id | `orchestrator_turn_id` at the time the attempt was recorded |
| What was tried | One-line summary of the approach attempted |
| Why it failed | One-line root cause, not a symptom restatement |
| Classification | `Transient` \| `Permanent` \| `Partial` — always `Permanent` per the append rule above (Transient/Partial failures resolve via retry/resume, not a log entry) |

**Append-only**: entries are never edited or removed once written — only appended, one
bullet per Permanent-classified failure.

**Non-goal for this issue**: `planner.md`/`implementer.md` are not Touch-Paths here, so
neither agent definition reads this log directly. Consumption on retry is wired at the
orchestrator's prompt-construction step only (`orchestrator.md` § Error Classification) —
the orchestrator includes an issue's existing entries verbatim in the next
`planner`/`implementer` respawn prompt's Objective field.

## Blocked-Iteration Counter

Per-issue counter tracked in `campaign-checkpoint.md` body, complementing the
Failed-Approaches Log above: incremented once per orchestrator turn an issue's `status`
remains `blocked` with no transition since the prior turn; reset to `0` the moment
`status` leaves `blocked`. See `orchestrator.md` § Human-in-the-Loop (HITL) & Blocker
Gating, "Blocked-Iteration Escalation" for the count-`3` escalation rule this counter
feeds — reusing `queue.json`'s existing free-form `notes` field
(`blocked-escalated:<Transient|Permanent|Partial>:<short-reason>`), no new schema field.

## Session handoff

Coordinator/orchestrator session handoff MUST include:

```
CHECKPOINT: turn <N> | in-flight: #<issues> | LEDGER OPEN: <count>
```

Optional trailing segment, appended only when one or more issues escalated at
Blocked-Iteration count 3 this turn (`orchestrator.md` § HITL, "Blocked-Iteration
Escalation") — omitted entirely otherwise, backward-compatible with the three-field line
above:

```
CHECKPOINT: turn <N> | in-flight: #<issues> | LEDGER OPEN: <count> | BLOCKED-ESCALATED: #<issue>[,#<issue>...]
```
<!-- GENERATED by scripts/build.ts from src/references/checkpoint-protocol.md — do not hand-edit -->
