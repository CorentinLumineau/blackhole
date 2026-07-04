# Phase 2 — Plan

## Checklist

```
- [ ] queue entry: phase plan (from handle)
- [ ] Plan artifact → plans/<issue>.md or issue comment
- [ ] Plan-time V-code scan → findings-ledger (phase: plan)
- [ ] Out-of-scope → gh issue create + ledger deferred_to_issue
- [ ] issue-splitting.md — if plan reveals multi-PR scope, split NOW
- [ ] clarify-gates.md — AskQuestion if still ambiguous
- [ ] User plan approval if scope was unclear or split occurred
- [ ] queue.json: phase implement, status ready OR blocked (awaiting-plan-approval)
```

## Plan approval gate

| Situation | Before implement |
|-----------|------------------|
| Clear AC from start, single PR, no product choices | May set `ready` (note waive in queue) |
| Any AskQuestion during handle/plan | User confirms plan → unblock |
| Split filed during plan | User confirms child breakdown |
| Epic / PO gate | User sign-off per runbook |

Set `notes: awaiting-plan-approval` until user confirms.

## V-code scan (plan-time)
 
- Touch paths: V-INT-02, V-DRY-01/02, V-KISS-01 → ledger before turn end.
- **Touch-Paths Definition**: The plan MUST explicitly declare the exact list of files allowed to be modified during implementation. This serves as the scope boundary baseline (`V-SCOPE-02`).
- **API/Schema Baseline**: The plan MUST declare any changes to public APIs, database columns, or configuration keys (`V-API-01`).
 
 ## Scope growth
 
 If plan exceeds one reviewable PR → stop, split per `issue-splitting.md`,
 AskQuestion, do not spawn implement.
