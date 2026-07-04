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
- [ ] Spawn parallel batch (up to parallel_max) — one turn, end turn
- [ ] Open issues + open PRs both zero? → campaign complete
```

## Merge protocol

1. `gh pr view <n> --json headRefOid` equals local HEAD
2. `gh pr checks <n>` green (except Vercel preview — expected fail)
3. `bun run build` in main clone
4. `gh pr merge --squash` (use `&&` only, never `;`)
5. Post-merge: migration apply if schema PR; deploy verify per runbook

## Ledger cleanup on merge

For issue N, PR P:

- `fixed-in-pr` → `resolved`, `resolved_at` set
- `open` BLOCK on merged files → file new issue or `resolved` if obsolete
- `deferred` → keep until deferred issue merges

## Next batch

1. Run forge sync
2. Build ready set per `queue-dag.md`
3. For each selected issue, set `in-flight`, spawn worker at correct phase:
   - New issues start at **handle** or **plan** if handle complete
   - Returned-from-review start at **implement**

## Campaign complete

```
gh issue list --state open → []
gh pr list --state open → []
queue.json: no in-flight entries
```

Report to user: SHIPPED summary, LEDGER OPEN count, any deferred issues filed.
