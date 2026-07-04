# Phase 4 — Review

Binding: [review-core.md](review-core.md), [worker-schemas.md](worker-schemas.md).

## Checklist

```
- [ ] queue.json: phase review
- [ ] Spawn backlog-reviewer to perform PR audit
- [ ] Spawn backlog-synthesizer to aggregate reviewer findings
- [ ] Synthesizer output → ledger append (phase: review)
- [ ] BLOCK → increment review_iteration; back to phase implement (see review-core iteration budget)
- [ ] review_iteration >= 4 → escalate to coordinator (AskQuestion)
- [ ] WARN → fix in PR OR defer (file issue + ledger deferred_to_issue)
- [ ] Docs-only PR → orchestrator direct review, still run synthesizer
- [ ] LGTM (synthesizer lgtm: true) → proceed to phase loop (merge)
- [ ] Write campaign-checkpoint.md per checkpoint-protocol.md
```

## Review pipeline

1. **Reviewer** — spawn `backlog-reviewer` with PR diff, plan Touch-Paths, V-code checklist.
2. **Synthesizer** — spawn `backlog-synthesizer` with reviewer JSON + issue/PR context + `review_iteration`.
3. **Orchestrator** — append synthesizer `findings` to ledger; route by `lgtm` and iteration budget.

The orchestrator **never** aggregates findings inline.

## Reviewer prompt must include

- PR number + diff summary
- Full V-code audit checklist from `{{VCODES_PATH}}`
- Model: use the designated worker agent (`backlog-reviewer`)
- Output format: `worker-schemas.md` reviewer contract

## Synthesizer prompt must include

- Reviewer JSON output (raw)
- Issue ref, PR ref, current `review_iteration`
- Output format: `worker-schemas.md` synthesizer contract
- Model: `backlog-synthesizer` (`quick` mode on iteration 2+ when ≤10 findings)

## Audit Checklist Extensions

- **PR Linkage (`V-GIT-01`)**: Reviewer/Orchestrator must confirm the PR description contains `Closes #N` or `Fixes #N`.
- **Plan Compliance (`V-SCOPE-02`, `V-API-01`)**: Audit for Touch-Paths and API/Schema contract drift against the Plan.
- **Anti-Slop Audit**: Explicitly check for AI-generated code slop:
  - `V-KISS-03` (Empty scaffolding/no-op functions)
  - `V-YAGNI-03` (Single-consumer abstractions)
  - `V-DRY-04` (Template copy-paste renames)
- **Improvement Discoveries**: Audit the code for UX/UI polish, performance gains, test coverage gaps, and styling best practices. Log them as WARN findings with detailed summaries. Do not demand resolving them in the current PR (prevents `V-SCOPE-02` scope creep); the orchestrator will file them as new GitHub issues.

## Gating

See [review-core.md](review-core.md) for severity mapping, LGTM definition, and iteration budget.

| Severity | Action |
|----------|--------|
| BLOCK | Must fix before merge; re-run review after fix |
| WARN | Fix in PR, or document in PR body + ledger defer with filed issue |
| NOTE | Optional fix; ledger row optional |

Never merge on a direct commit to main (`V-BRANCH-02`) or if force-pushing occurred (`V-BRANCH-01`).
Never merge on errored review — empty findings from failed agent is not LGTM.

## Ledger before turn end

All synthesizer findings appended to `findings-ledger.json` with `pr_ref` set.
Unresolved BLOCK rows stay `status: open`.
