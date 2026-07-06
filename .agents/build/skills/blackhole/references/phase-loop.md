# Phase 5 — Loop

## Checklist

```
- [ ] Auto forge sync (native — no user prompt)
- [ ] BLOCK/WARN unresolved? → phase implement (same issue)
- [ ] LGTM? → merge PR (runbook quality gates)
- [ ] queue.json: status merged, phase done
- [ ] Resolve/defer ledger entries for this issue/PR
- [ ] forge-sync.md protocol
- [ ] Compute ready set (queue-dag.md)
- [ ] Persist queue.json → findings-ledger.json → campaign-checkpoint.md when in-flight work exists (checkpoint-protocol.md)
- [ ] Spawn parallel batch (up to parallel_max) — one turn, end turn
- [ ] Open issues + open PRs both zero? → campaign complete
```

## Merge protocol

1. `gh pr view <n> --json headRefOid` equals local HEAD
2. `gh pr checks <n>` green (except Vercel preview — expected fail)
3. Run the project's build command in main clone (if applicable)
4. `gh pr merge --squash` (use `&&` only, never `;`)
5. Post-merge: migration apply if schema PR; deploy verify per runbook

## Ledger cleanup on merge

For issue N, PR P:

- Reset `review_iteration` to 0 on merge
- `fixed-in-pr` → `resolved`, `resolved_at` set
- `open` BLOCK on merged files → file new issue or `resolved` if obsolete
- `deferred` → keep until deferred issue merges

## Next batch

1. Run forge sync
2. Build ready set per `queue-dag.md` and **sort in descending order** of their Pareto Priority score.
3. For each selected issue, set `in-flight`, spawn worker at correct phase:
   - New issues start at **handle** or **plan** if handle complete
   - Returned-from-review start at **implement**

## Continuous Discovery of Improvements (Backlog Growth)
 
- The orchestrator triages all discoveries logged in the findings ledger.
- For every codebase improvement suggestion:
  1. Calculate the Priority score: $\text{Priority} = \text{Gain} \times (11 - \text{Effort})$.
  2. If $\text{Priority} \ge 30$:
     - If not yet filed, execute `gh issue create --title "[Discovery] <Name>" --body "..." $(bun scripts/forge-scope.ts create-args)` (explain context, gain, effort, and priority score).
     - Map the ledger's `deferred_to_issue` field to the new issue ID.
     - The next auto-sync step reconciles the new issue into `queue.json` as a new campaign backlog item.
  3. If $\text{Priority} < 30$:
     - Set status in findings ledger to `archived` (marked as low-value). Do not file a GitHub issue to keep the backlog clean and noise-free.
 
## Campaign complete
 
```
gh issue list --state open $(bun scripts/forge-scope.ts list-args) → []
gh pr list --state open → []
queue.json: no in-flight entries
```
 
Report to user: SHIPPED summary, LEDGER OPEN count, any deferred issues filed.
