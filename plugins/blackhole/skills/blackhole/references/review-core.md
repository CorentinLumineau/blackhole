# Review Core — Shared Review Infrastructure

Canonical definitions for review delegation, aggregation, iteration budgets, and gating. Referenced by `phase-review.md` and `reviewer`.

## Review pipeline

```
reviewer (raw findings JSON)
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

1. `reviewer` returned `status: "complete"` (not `error`)
2. `scripts/review-aggregate.ts` returned `lgtm: true` and `blockers_count === 0`
3. No unresolved BLOCK rows in ledger for this issue/PR
4. When the Security-mode review gate resolved `true` for this PR, the merge-gate validator (`V-SEC-08`) passes — no unresolved `BLOCK` security finding without a populated attack-scenario field. Not applicable when the gate resolved `false` or `route` was absent.

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

## Security-mode review (ADR-004 step 8)

1. **Trigger**: read `route.security_review_required` from the issue's `queue.json` entry
   at review-phase spawn time. `route` absent → not applicable, unconditional
   current-checklist-only review (`queue-dag.md` "void route" convention).
2. **Confidence gate**: mirrors `orchestrator.md` § Route-derived dispatch's exact
   precedence — before consulting the flag, compare `route.confidence.security` against
   `.blackhole/config.json` `router_confidence_thresholds.security` (default 70); below
   threshold, treat as `true` (cautious default, matches `orchestrator.md`'s own stated
   note verbatim).
3. **Mechanism**: single `reviewer` spawn — when the gate resolves `true`, the Reviewer
   prompt requirements (below) gain an additional block: a diff-scoped exploitability
   audit, self-contained instructions (not a vendored import), scoped to the PR's changed
   lines only.
4. **Exploitability gate (`V-SEC-06`)**: cross-reference only — see
   `blackhole-vcodes.md`'s existing row. Every security finding must carry a concrete
   attack scenario (who/what/result); findings without one are downgraded to
   `NOTE`/INFO-equivalent, never `BLOCK`.
5. **Adversarial re-verification (`V-SEC-07`)**: the same single spawn's prompt instructs
   a second, self-adversarial check per finding before inclusion — attempt to disprove the
   exploit path; default to reject (omit or downgrade) if not demonstrable.
6. **Merge-gate validator (`V-SEC-08`)**: before merge on a security-mode PR, the
   orchestrator confirms every `V-SEC-06`/`V-SEC-07`-tagged finding in the reviewer's
   output carries a populated attack-scenario field — documented manual gate, mirroring
   `V-GIT-01`'s own script-free treatment exactly.

## Skip-PR compensating control (ADR-004 step 8)

1. **Trigger**: `route.plan_mode === 'skip'` (from `queue.json`; `route` absent → not
   applicable, unconditional full audit unchanged).
2. **Rule**: plan-conformance auditing (`V-API-01` API/schema drift, `V-SCOPE-02`
   touch-paths-vs-plan) is scoped to `route.plan_mode ∈ {quick, full}` — a skip PR's
   4-line rationale record has no contract section to diff against.
3. **Compensating check**: for `plan_mode: skip` PRs, reviewer instead independently
   verifies the diff touches no public API/schema surface (no exported function
   signature, DB schema, config key, or route/response-shape change).
4. **Unchanged path**: `plan_mode ∈ {quick, full}` (and absent `route`) → plan-conformance
   audit runs exactly as today, no behavior change.

## Reviewer prompt requirements

Every `reviewer` delegation MUST include:

1. PR number + diff summary
2. Plan Touch-Paths and schema baseline
3. Full V-code audit checklist from `plugins/blackhole/rules/blackhole-vcodes.md`
4. Output format per `worker-schemas.md` reviewer contract
5. When Security-mode review's trigger (above) resolves `true`, the diff-scoped
   exploitability audit instructions (§ Security-mode review, step 3).

## Aggregate invocation

After `reviewer` completes, the orchestrator runs:

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

Re-introduce a dedicated aggregation agent only if blackhole adopts parallel multi-reviewer swarms (2+ independent reviewers per PR). See ADR-003.
<!-- GENERATED by scripts/build.ts from src/references/review-core.md — do not hand-edit -->
