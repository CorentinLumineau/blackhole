# Review Core — Shared Review Infrastructure

Canonical definitions for review delegation, aggregation, iteration budgets, and gating. Referenced by `phase-review.md`, `bc-reviewer`, and `bc-synthesizer`.

## Review pipeline

```
bc-reviewer (raw findings)
        ↓
bc-synthesizer (dedup, cross-correlate, Pareto rank)
        ↓
orchestrator (ledger append, phase routing)
```

The orchestrator **never** aggregates findings inline — delegation to `bc-synthesizer` is mandatory.

## Severity → action mapping

| Severity | Action | Merge allowed? |
|----------|--------|----------------|
| `BLOCK` | Must fix before merge; re-run review after fix | No |
| `WARN` | Fix in PR, or defer (file issue + `deferred_to_issue`) | Yes, if addressed or deferred |
| `NOTE` | Optional fix; ledger row optional | Yes |

Never merge on a direct commit to main (`V-BRANCH-02`) or if force-pushing occurred (`V-BRANCH-01`).
Never merge on errored review — empty findings from a failed agent is not LGTM.

## LGTM definition

LGTM requires **all** of:

1. `bc-reviewer` returned `status: "complete"` (not `error`)
2. `bc-synthesizer` returned `status: "approved"` and `lgtm: true`
3. `blockers_count === 0`
4. No unresolved BLOCK rows in ledger for this issue/PR

## Pareto scoring

For discovery findings (`V-PARETO-02`):

$$\text{Priority} = \text{Gain} \times (11 - \text{Effort})$$

| Priority | Orchestrator action |
|----------|---------------------|
| ≥ 30 | File GitHub issue (`gh issue create` + `$(bun scripts/forge-scope.ts create-args)`); set `deferred_to_issue` |
| < 30 | Archive in ledger; do not file issue |

Aligns with `phase-loop.md` continuous discovery protocol.

## Dedup key

Before ledger append, deduplicate on `(vcode, file, line, issue_ref)` per `findings-ledger.md`.

Synthesizer performs semantic dedup upstream; orchestrator performs exact-key dedup at write time.

## Cross-correlation

When 2+ findings share the same root cause (same file + related vcodes, or identical intent):

- Keep one finding; note `multi_source: true`
- Promote severity one level (max `BLOCK`)

## Review iteration budget

Tracked on queue entry as `review_iteration` (integer, default 0).

| Iteration | Action |
|-----------|--------|
| 1–3 | BLOCK → spawn implementer fix → re-review (automatic) |
| 4+ | Escalate to user via coordinator (`AskQuestion`) |
| Hard ceiling: 5 | Stop auto-fix; require human triage |

Increment `review_iteration` after each synthesizer run that returns `changes_requested`.

Reset `review_iteration` to 0 when PR merges or issue returns to plan phase.

## Reviewer prompt requirements

Every `bc-reviewer` delegation MUST include:

1. PR number + diff summary
2. Plan Touch-Paths and schema baseline
3. Full V-code audit checklist from `.claude/rules/bc-campaign-vcodes.md`
4. Output format per `worker-schemas.md` reviewer contract

## Synthesizer prompt requirements

Every `bc-synthesizer` delegation MUST include:

1. Reviewer JSON output (raw)
2. Issue ref + PR ref
3. Current `review_iteration`
4. Optional prior ledger rows for same issue
5. Output format per `worker-schemas.md` synthesizer contract

## Docs-only PRs

Orchestrator may perform direct review for docs-only PRs, but must still run synthesizer on findings before ledger append.
