# Review Core — Shared Review Infrastructure

Canonical definitions for review delegation, aggregation, iteration budgets, and gating. Referenced by `phase-review.md` and `bc-reviewer`.

## Review pipeline

```
bc-reviewer (raw findings JSON)
        ↓
scripts/review-aggregate.ts (deterministic dedup, Pareto rank)
        ↓
orchestrator (ledger append, phase routing)
```

The orchestrator calls `scripts/review-aggregate.ts` after reviewer completion — no LLM aggregation subagent.

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
2. `scripts/review-aggregate.ts` returned `lgtm: true` and `blockers_count === 0`
3. No unresolved BLOCK rows in ledger for this issue/PR

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

`review-aggregate.ts` performs exact-key dedup with severity merge (`BLOCK` > `WARN` > `NOTE`/`INFO`); orchestrator performs the same key check at write time.

## Review iteration budget

Tracked on queue entry as `review_iteration` (integer, default 0).

| Iteration | Action |
|-----------|--------|
| 1–3 | BLOCK → spawn implementer fix → re-review (automatic) |
| 4+ | Escalate to user via coordinator (`AskQuestion`) |
| Hard ceiling: 5 | Stop auto-fix; require human triage |

Increment `review_iteration` after each aggregate run that returns `changes_requested`.

Reset `review_iteration` to 0 when PR merges or issue returns to plan phase.

## Reviewer prompt requirements

Every `bc-reviewer` delegation MUST include:

1. PR number + diff summary
2. Plan Touch-Paths and schema baseline
3. Full V-code audit checklist from `{{VCODES_PATH}}`
4. Output format per `worker-schemas.md` reviewer contract

## Aggregate invocation

After `bc-reviewer` completes, the orchestrator runs:

```bash
bun run scripts/review-aggregate.ts \
  --reviewer-file <path> \
  --issue-ref <N> \
  [--pr-ref <P>] \
  [--prior-file <ledger-rows.json>]
```

Output schema: `worker-schemas.md` § Review aggregate.

## Docs-only PRs

Orchestrator may perform direct review for docs-only PRs, but must still run `review-aggregate.ts` on findings before ledger append.

## Revisit condition

Re-introduce a dedicated aggregation agent only if bc-campaign adopts parallel multi-reviewer swarms (2+ independent reviewers per PR). See ADR-003.
