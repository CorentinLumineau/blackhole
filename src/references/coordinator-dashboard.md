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

## When to print (REQUIRED)

| Event | Who | Action |
|-------|-----|--------|
| Campaign start (before spawning orchestrator) | `coordinator` | Run `bun run status` → print **full** output to user |
| Orchestrator background turn completes (idle notification) | `coordinator` | Run `bun run status` → print **full** output, then resume orchestrator if work remains — fires only when orchestrator has cleared its in-flight worker barrier and ended its turn |
| User asks `status` / `@blackhole status` | Coordinator or orchestrator | Run `bun run status` → print full output; do not spawn workers |
| Intake files a GitHub issue | `coordinator` | Print one line: `📋 Filed #N — <title> (milestone <M>)` then re-run status if campaign is active |
| Orchestrator ends turn | `orchestrator` | Ensure checkpoint written; coordinator prints dashboard on notification |

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
