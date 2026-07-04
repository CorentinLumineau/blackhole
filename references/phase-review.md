# Phase 4 — Review

## Checklist

```
- [ ] queue.json: phase review
- [ ] Spawn reviewer (x-reviewer if mercure present, else generalPurpose)
- [ ] Every finding: V-code + file:line → ledger (phase: review)
- [ ] BLOCK → queue status in-flight, back to phase implement
- [ ] WARN → fix in PR OR defer (file issue + ledger deferred_to_issue)
- [ ] Docs-only PR → orchestrator direct review, same ledger rules
- [ ] LGTM → proceed to phase loop (merge)
```

## Reviewer prompt must include

- PR number + diff summary
- Full V-code audit checklist from `{{AGENT_DIR}}/rules/backlog-campaign-vcodes.mdc`
- `model: "composer-2.5"`
- Output format: list of `{ vcode, severity, file, line, summary }`

## Gating

| Severity | Action |
|----------|--------|
| BLOCK | Must fix before merge; re-run review after fix |
| WARN | Fix in PR, or document in PR body + ledger defer with filed issue |
| NOTE | Optional fix; ledger row optional |

Never merge on errored review — empty findings from failed agent is not LGTM.

## Ledger before turn end

All review findings appended to `findings-ledger.json` with `pr_ref` set.
Unresolved BLOCK rows stay `status: open`.
