---
type: adr
status: accepted
review_trigger: "on protocol change"
created: 2026-08-14
last_updated: 2026-08-14
related:
  - documentation/decisions/ADR-005-pr-merge-gate-dependency-ordering.md
  - documentation/decisions/ADR-006-kaizen-hunt.md
  - documentation/decisions/ADR-023-merge-conflict-preflight.md
---

# ADR-026 — In-campaign ActionMan/Workclaude merge-ready gate

## Status

Accepted — 2026-08-14 (design track, issue #677, `design-aggregate.ts` verdict `ready`, margin
32.9%–43.7% across primary + 2 blind critics, all three scorers agreeing on the winner).

## Context

Observed on the AI/mercure campaign (blackhole 0.20.0, `merge_mode: leave-open`): when a
consumer forge has ActionMan/workclaude (an external `ai-review:*`-labeling review bot)
installed, campaign implementers applied its findings, pushed, then posted a `/git-fix-pr`
slash comment — which asks the **bot** to implement again. Owner ruling: *"resolve PRs in the
campaign; ActionMan reviews; campaign implements."*

Merge-ready is independent of `merge_mode`; who merges is not:

| Criterion | Green when | Applies |
|---|---|---|
| C1 — pipeline verdict | Current HEAD SHA carries `ai-review:LGTM`, no pending `NEEDS_CHANGES`/`CRITICAL_ISSUES` | Only when the pipeline is detected |
| C2 — no merge conflict | `mergeable: true` | Always |
| C3 — CI green | Every check on HEAD SHA succeeds/neutral/skipped | Always |

`merge_mode` only names the merge **actor** (`leave-open` → human; `immediate`/`gated-batch` →
blackhole) — it must never gate whether C1–C3 are computed.

Two mechanisms already exist for C2 and C3: `phase-loop.md` § Merge protocol Step 0.5
(conflict preflight, ADR-023) and Step 1 (CI-wait poll). What was missing was C1, its
detection, and the behavioral prohibition on delegating fixes back to the bot. A
`leave-open` PR currently bypasses Step 0.5/Step 1 **entirely** (`merge-gate.md`'s bypass
note: "no `mergeEligible(issue)` call, no `gh pr merge`, no Step 0.5") — over-broad, since C2/C3
are PR-quality signals a human merge actor still benefits from, not admin scheduling; this ADR
narrows that bypass.

A 2026-08-10 parity audit (`documentation/audits/mercure-parity-matrix.md` PM-085,
`documentation/audits/mercure-parity-surface.md` §5e) classified "ActionMan bot polling" as
**N/A for blackhole** ("the reviewer *is* the review"; mercure's user-invocable `/git-fix-pr`
command has no equivalent surface in an orchestrator-internal campaign). That verdict is about
the **command surface** and stands — this ADR does not add a user-invocable command. It closes
a distinct, previously-unconsidered case: a *consumer* repo may run ActionMan independently of
blackhole's own review, and the campaign must respect it without a human ever typing a slash
command.

## Decision

### D1 — Detection: cached, campaign-level, reused not re-derived

`forge-sync.md`'s existing per-turn sync sequence gains one cheap step: scan the repo's label
set for an `ai-review:` prefix (reuse the `list_labels` MCP tool / `gh label list` — no new
forge primitive). Cache the boolean at `queue.json`'s **root** level — `pipeline_detection: {
actionman_workclaude: boolean, checked_at: <ISO8601> }` — parallel to the existing root-level
`refreshed_at`/`campaign_started_at` fields (`queue-dag.md` Schema). Per-PR verdict checks read
this cached flag rather than re-deriving detection per PR. When `false`, C1 is skipped
(two-criteria run) — matches the issue's explicit "when not detected, C1 is skipped" clause.

### D2 — Verdict gate: new discrete Merge-protocol step, not a 4th `mergeEligible()` condition

`merge-gate.md` gains a new `pipelineVerdict(pr, queue)` function (§6) returning `lgtm |
needs_changes | not_detected`, checked against the PR's **current HEAD SHA** (a stale LGTM
label from a prior SHA does not count — re-checked after every push). `phase-loop.md`'s Merge
protocol gains **Step 0.6** (between the existing Step 0.5 conflict preflight and Step 1
CI-wait) invoking it — mirrors the Step 0.5 precedent exactly (ADR-023 added a new discrete
step for C2 rather than a 4th `mergeEligible()` condition; C1 follows the same shape).
`mergeEligible()`'s existing three conditions (`merge_hold`, `merge_after`, gated-batch sibling
wait) are untouched — they are queue-level scheduling admin, not review/CI state, and stay that
way.

### D3 — Fix loop: reuse `review_iteration`, never a parallel counter

When Step 0.6 finds `needs_changes`/`critical_issues`, the orchestrator routes exactly like
`ci-diagnosis.md`'s existing CI-genuine-failure path: `queue.json` → `phase: implement`,
`status: ready`, `review_iteration += 1`; STOP the merge steps for this issue this turn; spawn
`implementer` with ActionMan's comment content as the Objective. This is the same primitive
`ci-diagnosis.md` already documents as shared, not duplicated, across BLOCK-fix and CI-fix
rounds ("Both share the same `review_iteration` escalation primitive... not a separate CI-fix
budget") — a third consumer of an existing mechanism, not a new one.

### D4 — Implementer discipline: never delegate to the bot

`implementer.md` gains a binding clause: when the pipeline is detected, apply ActionMan's
findings via the implementer's existing standard workflow (steps 1–7 — tests, incremental
edits, PR update) and never post `/git-fix-pr` or any other bot-invoking slash comment. A new
`V-GITFIX-01` (BLOCK) audits this at review time: `reviewer.md` scans the PR's own comment
thread (reused `get_pr_activity` MCP tool) for a bot-invoking slash comment authored by the
campaign, gated on `pipeline_detection.actionman_workclaude`.

### D5 — `leave-open` scope correction: C2/C3 apply there too

The existing `leave-open` bypass note ("no `mergeEligible(issue)` call, no `gh pr merge`, no
Step 0.5") is narrowed: it still means the campaign never calls `gh pr merge` and never
evaluates the three **admin-scheduling** `mergeEligible()` conditions (irrelevant when a human,
not blackhole, decides when to merge) — but Step 0.5 (C2) and Step 0.6 (C1, this ADR) and Step 1
(C3) now run for `leave-open` PRs too, as a **merge-readiness dry run** with no `gh pr merge`
call at the end. `phase-loop.md`'s `leave-open` "delivered-at-LGTM" annotation changes from
gating on `isLgtm(issue)` alone to gating on `isLgtm(issue) AND mergeReady(issue)` (a new small
helper composing C1+C2+C3, distinct from `mergeEligible()` which stays scoped to admin
scheduling). This closes a real gap: before this ADR, a `leave-open` PR could be annotated
"delivered" while carrying an unresolved merge conflict or red CI, because those steps were
never reached at all under the old unconditional bypass.

### D6 — Restack on observed human merge

`merge-gate.md` §3's forge-drift reconciliation already detects a `leave-open` PR merged
externally (`gh pr view --json state,mergedAt`, the designed completion path, no `V-MERGE-01`/
`V-MERGE-02`). This ADR adds a sub-step there: on that observation, rescan the campaign's other
open PRs and re-run Step 0.5's existing conflict-preflight (reusing `merge-conflict-protocol.md`'s
existing `implementer` conflict-resolution spawn — no new resolution mechanism) against `main`'s
new HEAD, restacking any that would now conflict.

### D7 — No new config knob

Detection is unconditional and automatic; there is no campaign-level toggle to disable honoring
an installed ActionMan pipeline (YAGNI — no stated need for an opt-out, and an opt-out would
recreate the exact anti-pattern this issue reports).

## Alternatives considered

| Option | Rejected because |
|---|---|
| **B** — Dedicated parallel gate file + new `pr_fix_iteration` counter/escalation table, fully separate from `review_iteration` | Both blind critics independently flagged this **discriminating CRITICAL**: two independently-evolving iteration/escalation systems tracking the same underlying question ("how stuck is this PR") can desync, with no single source of truth. Direct `V-DRY-01`/`V-INT-02` exposure; `ci-diagnosis.md` already established the reuse precedent this option would abandon |
| **C** — Fold ActionMan verdict into `review-core.md`'s `isLgtm()` as a 5th criterion | Both critics independently flagged this **discriminating CRITICAL**: `isLgtm()` feeds `merge-gate.md` § 1 Condition 3 (`all(isLgtm(sibling))` for the whole gated-batch scope) — folding in ActionMan's verdict would silently make every gated-batch sibling's merge depend on ActionMan approval too, an unscoped behavior change the issue never asked for. It also sits close to the issue's own explicit out-of-scope boundary ("never let campaign-reviewer LGTM substitute for ActionMan LGTM") — muddying what "LGTM" means codebase-wide for a real but narrower need |
| **D** (strawman) — Port mercure's user-invocable `git-pr fix` command literally | Already rejected on evidence, `documentation/audits/mercure-parity-matrix.md` PM-085: blackhole's PR-fix flow is orchestrator-internal with no human-invoked command surface. A literal port would also re-introduce the exact anti-pattern this issue reports — a slash-command surface framed around asking a bot to act |

## Consequences

- `VCODE_TABLE_ROW_COUNT` increments by 1 (`V-GITFIX-01`); `EXPECTED_CHECK_COUNT` unchanged (no
  new `scripts/checks/*.check.ts` module — this ADR adds no mechanical script check).
- Positive: closes a real, owner-reported anti-pattern; reuses existing primitives throughout
  (`review_iteration`, `merge-conflict-protocol.md`'s implementer spawn, the Step-0.5 precedent,
  the root-level cache-field convention) rather than inventing parallel machinery.
- Negative: `review_iteration`'s single ceiling is now shared across three distinct trigger
  sources (blackhole-reviewer BLOCK, CI-genuine-failure, ActionMan needs-changes) — a PR needing
  several rounds of more than one source reaches the escalate-at-4/hard-ceiling-5 threshold from
  combined rounds. Accepted per the existing `ci-diagnosis.md` precedent; not re-justified with a
  wider ceiling in this ADR (no evidence this combination has occurred in practice yet).
- `leave-open` PRs now run Step 0.5/0.6/1 (a genuine behavior change, D5) — bounded cost: the
  same conflict/CI/pipeline checks blackhole already runs for `immediate`/`gated-batch`, just
  without the terminal `gh pr merge` call.
