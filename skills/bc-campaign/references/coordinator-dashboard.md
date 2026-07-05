# Coordinator Dashboard — Main Chat Status

The coordinator is the user's **visibility layer** in Multitask Mode. The orchestrator
runs in background; the main chat must stay informative without regurgitating full
orchestrator turn logs.

## Command

```bash
bun run status
# or: bun run scripts/campaign-status.ts --campaign-dir .bc-campaign
```

Reads `.bc-campaign/config.json`, `queue.json`, `findings-ledger.json`,
`campaign-checkpoint.md`, and (when `gh` is available) scoped forge open counts.

## When to print (REQUIRED)

| Event | Who | Action |
|-------|-----|--------|
| Campaign start (before spawning orchestrator) | `bc-coordinator` | Run `bun run status` → print **full** output to user |
| Orchestrator background turn completes | `bc-coordinator` | Run `bun run status` → print **full** output, then resume orchestrator if work remains |
| User asks `status` / `@bc-campaign status` | Coordinator or orchestrator | Run `bun run status` → print full output; do not spawn workers |
| Intake files a GitHub issue | `bc-coordinator` | Print one line: `📋 Filed #N — <title> (milestone <M>)` then re-run status if campaign is active |
| Orchestrator ends turn | `bc-orchestrator` | Ensure checkpoint written; coordinator prints dashboard on notification |

**Do not** collapse the dashboard to a one-line confirmation. Users rely on the main
chat for campaign overview.

## Dashboard sections

The status script emits markdown with:

1. **Header** — scope (milestone/labels), orchestrator turn, queue `refreshed_at`
2. **Counts** — forge open issues/PRs, queue active/done/in-flight/blocked/ready, ledger severities
3. **In-flight** — table: issue, phase, PR, notes
4. **Blocked** — issue list with blocker reason
5. **Ready** — Pareto-ready issue numbers
6. **Completed** — merged/closed in queue
7. **Issues filed** — ledger rows with `deferred_to_issue` (discovery filings)
8. **Ledger open** — top open V-code findings
9. **Active workers** — from checkpoint `## In-flight workers` section

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

## References

- Phase 0 dashboard: `SKILL.md`
- Checkpoint: `checkpoint-protocol.md`
- Forge sync one-liner: `forge-sync.md` § sync summary (orchestrator logs; coordinator runs full status)
