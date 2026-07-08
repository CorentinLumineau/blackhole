# Phase 2 — Plan

## Checklist

```
- [ ] queue entry: phase plan (from handle)
- [ ] Spawn planner to create Plan artifact → plans/<issue>.md or issue comment
- [ ] Plan-time V-code scan → findings-ledger (phase: plan)
- [ ] Out-of-scope → gh issue create + ledger deferred_to_issue
- [ ] issue-splitting.md — if plan reveals multi-PR scope, split NOW
- [ ] clarify-gates.md — AskQuestion if still ambiguous
- [ ] User plan approval if scope was unclear or split occurred
- [ ] Planner returns worker-schemas.md contract (`status`, `plan_path`, `failing_checks`)
- [ ] Plan artifact exists: `{repo_root}/.blackhole/plans/issue-N.md`
- [ ] Planner JSON `status: ready` — do NOT spawn implementer if `blocked`
- [ ] queue.json: phase implement, status ready OR blocked (awaiting-plan-approval)
```

## Planner return format

See [worker-schemas.md](worker-schemas.md) planner contract. On `status: blocked`, set queue `notes: awaiting-user-clarification` or `awaiting-plan-approval` per failing checks, or `awaiting-design-approval` when `track: design` (`failing_checks` includes `design_pending_approval`).
See [multitask-mode.md](multitask-mode.md) § Claude Code harness notes for how to verify a blocked/idle worker's status without chat polling.

## Plan approval gate

| Situation | Before implement |
|-----------|------------------|
| Clear AC from start, single PR, no product choices | May set `ready` (note waive in queue) |
| Any AskQuestion during handle/plan | User confirms plan → unblock |
| Split filed during plan | User confirms child breakdown |
| Epic / PO gate | User sign-off per runbook |
| Design track (ADR-004) | ALWAYS AskQuestion — no confidence bypass, regardless of AC clarity |

Set `notes: awaiting-plan-approval` until user confirms.

## V-code scan (plan-time)
 
- Touch paths: V-INT-02, V-DRY-01/02, V-KISS-01 → ledger before turn end.
- **Touch-Paths Definition**: The plan MUST explicitly declare the exact list of files allowed to be modified during implementation. This serves as the scope boundary baseline (`V-SCOPE-02`).
- **API/Schema Baseline**: The plan MUST declare any changes to public APIs, database columns, or configuration keys (`V-API-01`).
- `touch_paths_declared` (`V-SCOPE-02`) and `schema_baseline` (`V-API-01`) quality gates apply to `quick`/`standard` tracks only. Design-track plan-artifact naming is `issue-N-design.md` (distinct from `issue-N.md`).
 
 ## Scope growth
 
 If plan exceeds one reviewable PR → stop, split per `issue-splitting.md`,
 AskQuestion, do not spawn implement.
