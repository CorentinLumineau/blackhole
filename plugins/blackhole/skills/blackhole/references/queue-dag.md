# Queue DAG — Schema + Scheduling

Path: `.blackhole/queue.json` (gitignored at runtime).

## Schema

```json
{
  "refreshed_at": "2026-07-04T12:00:00.000Z",
  "campaign_started_at": "2026-07-04T10:00:00.000Z",
  "user_queue_order": [301, 298, 275],
  "issues": {
    "298": {
      "title": "Cashflow v3 epic",
      "phase": "handle",
      "status": "blocked",
      "depends_on": [],
      "blocks": [301, 302],
      "worktree": null,
      "pr": null,
      "migration_slot": false,
      "touch_paths": ["lib/cashflow/**", "app/(app)/cashflow/**"],
      "size": "xl",
      "epic_parent": null,
      "review_iteration": 0,
      "notes": "awaiting PO sign-off"
    }
  }
}
```

### Field rules

| Field | Values | Notes |
|-------|--------|-------|
| `phase` | `handle` \| `plan` \| `implement` \| `review` \| `done` | Current lifecycle phase |
| `status` | `blocked` \| `ready` \| `in-flight` \| `merged` \| `closed` | Scheduling state |
| `review_iteration` | number | Review loop counter (default 0); see `review-core.md` |
| `notes` | string \| null | e.g. `awaiting-user-clarification`, `awaiting-plan-approval`, `overlap with #N` |
| `depends_on` | number[] | Issue numbers that must be merged/closed first; bidirectional sync with forge issue bodies via [forge-sync.md](forge-sync.md) §6.5 write-back |
| `merge_hold` | boolean | Optional (ADR-005, default `false`); when `true`, blocks this issue's PR from merging regardless of LGTM status. Distinct from `depends_on`: `depends_on` gates when implementation may *start*, `merge_hold` gates only when the PR may *merge*. Consulted by `merge-gate.md`'s `mergeEligible()` |
| `merge_after` | number[] | Optional (ADR-005, default `[]`); issue numbers whose PR must merge before this issue's PR may merge. Resolves on `status: merged` **OR** `status: closed`, mirroring the exact satisfaction rule `depends_on` already uses (Step 2 below). Distinct field from `depends_on` — a merge-time-only gate, not an implementation-start gate; not forge-synced (queue.json-only for v1). Consulted by `merge-gate.md`'s `mergeEligible()` |
| `milestone` | string \| null | Optional (ADR-005); the issue's forge milestone **title** (not number), synced from forge every turn (`forge-sync.md` § 5 — never hand-edited). Consumed by `merge-gate.md` § 1 Condition 3 for gated-batch scope matching against `config.json`'s `scope_milestone` |
| `labels` | string[] | Optional (ADR-005, default `[]`); the issue's forge label names, synced from forge every turn (`forge-sync.md` § 5 — never hand-edited). Consumed by `merge-gate.md` § 1 Condition 3 for gated-batch scope matching against `config.json`'s `scope_labels` |
| `merged_by` | `"blackhole"` \| absent | Optional (ADR-005); set **only** by `phase-loop.md` § Merge protocol step 4, in the same atomic write that sets `status: merged` — a causal marker meaning "blackhole's own orchestrator executed this merge." Absent (not `false` — absent) means "not merged by blackhole in this session" (either not merged at all, or merged by an external actor). This is the sole signal `merge-gate.md` § 3 uses to attribute `V-MERGE-01` vs `V-MERGE-02` — deliberately **not** `status: in-flight`, which reflects concurrent worker activity unrelated to who called `gh pr merge` |
| `blocks` | number[] | Inverse index (optional, for display) |
| `migration_slot` | boolean | True if issue owns schema migration |
| `touch_paths` | string[] | Glob patterns for conflict detection |
| `epic_parent` | number \| null | Child issues link to parent epic |
| `route` | object \| absent | Optional (ADR-004); absent == today's behavior (`plan_mode: full`). See `### \`route\` object` subsection |

### `route` object (optional — ADR-004)

```json
"route": {
  "needs_split": false,
  "needs_clarification": false,
  "needs_research": false,
  "needs_investigation": true,
  "needs_design": false,
  "needs_brainstorm": false,
  "needs_analysis": false,
  "task_type": "bugfix",
  "plan_mode": "quick",
  "security_review_required": false,
  "docs_impact": false,
  "confidence": { "split": 95, "design": 80, "plan_mode": 70, "security": 90, "docs": 85, "brainstorm": 20, "analysis": 70 },
  "body_hash": "<sha of issue title+body at classification time>",
  "computed_at_phase": "handle",
  "revision": 1
}
```

| Field | Values | Notes |
|-------|--------|-------|
| `needs_split` | boolean | Confidence-gated (`confidence.split` vs. `router_confidence_thresholds.split`, default 70); low-confidence cautious default: `true`. Hard rule: when true, voids all sibling flags — children re-enter at dedup with their own route |
| `needs_clarification` | boolean | Triggers `status: blocked` (existing AskQuestion gate) |
| `needs_research` | boolean | Would trigger investigator · research sub-mode (step 6 — not yet implemented) |
| `needs_investigation` | boolean | Would trigger investigator · investigate sub-mode (step 6 — not yet implemented) |
| `needs_design` | boolean | Would trigger planner design track + hard human gate (step 4 — not yet implemented) |
| `needs_brainstorm` | boolean | Confidence-gated (`confidence.brainstorm` vs. `router_confidence_thresholds.brainstorm`, default 70); low-confidence cautious default: `true` (ADR-010 D1). Hard rule: when resolved `true` (post confidence-gate), voids `plan_mode`/`needs_design` for this dispatch — the issue is never directly planned; other flags (`needs_research`, `needs_investigation`, `security_review_required`, `docs_impact`) are unaffected. |
| `needs_analysis` | boolean | Confidence-gated (`confidence.analysis` vs. `router_confidence_thresholds.analysis`, default 70); cautious default `true` for `size:l`+ or `needs_design: true` issues, else `false` (ADR-010 D1) — triggers investigator · analyze sub-mode (step 6), additionally gated by `autonomy.enabled && autonomy.analyze_routing` |
| `task_type` | `feature` \| `bugfix` \| `refactor` \| `docs` | Content-derived, never from forge labels; labels are a cautious tie-break only |
| `plan_mode` | `skip` \| `quick` \| `full` | Would select planner track (steps 3-4 — not yet implemented) |
| `security_review_required` | boolean | Would select reviewer security mode (step 8 — not yet implemented) |
| `docs_impact` | boolean | Would select planner/reviewer docs-impact enrichment (dispatch out of scope — computed and confidence-gated only; see #177) |
| `confidence` | object `{ split, design, plan_mode, security, docs, brainstorm, analysis }`, each 0-100 | Per-flag confidence; low confidence resolves to that flag's cautious default (`needs_split → true`, `plan_mode → full`, `security_review_required → true`, `needs_design → true`, `docs_impact → true`, `needs_brainstorm → true`, `needs_analysis → true`) |
| `body_hash` | string | sha of issue title+body at classification time; staleness marker |
| `computed_at_phase` | `handle` \| `plan` \| `implement` \| `review` | Phase at which this route was computed |
| `revision` | number | Bumped on every re-route; never retroactively changes already-executed chain steps |

**Consumer status** (per-flag, updated as ADR-004 steps land): `plan_mode`, `needs_split`,
and `needs_design` are now read by orchestrator dispatch (`orchestrator.md` §
Route-derived dispatch, #93); `needs_research` and `needs_investigation` are now read by
Handle's investigator spawn condition (`phase-handle.md` § Investigator agent, step 6 —
#96, PR #125), and `security_review_required` is now read by the review phase's
security-mode trigger (`review-core.md` § Security-mode review, `phase-review.md`, step 8
— #98, PR #124); the `router` agent (step 1 — #95, PR #118) has landed, but every issue in
today's live queue still falls through the "void route" fallback and dispatches exactly as
it did before ADR-004, only because none has re-entered Handle since #118 merged.
docs_impact is router-computed and orchestrator-confidence-gated as of #177, but has no
dispatch consumer yet. `needs_brainstorm` is router-computed and orchestrator-dispatched as of
ADR-010 M4 (`orchestrator.md` § Route-derived dispatch, Step 2.5).

**Route backfill (ADR-008 rollout)**: to populate `route{}` on the standing queue so the
dashboard's Routing section (`coordinator-dashboard.md` § Dashboard sections) renders real
classifications, spawn `router` with `trigger: "initial"` for each in-scope issue.
**Scope**: issues with `route` absent AND `status` ∉ {`in-flight`, `merged`, `closed`} AND
`phase != done` (a populated route for finished work adds dashboard rows with no display
value). **Safety** (no `queue.json` lock strategy — see `blackhole-state.md` § Write protocol):
run the backfill **sequentially**, one `router` spawn at a time, **never** parallel-batched with
regular Ready-set worker spawns; skipping `in-flight` avoids a concurrent-write collision with an
active worker mutating the same issue entry. Backfilling a route is **display-only** — it never
re-evaluates an already-executed dispatch decision (`orchestrator.md` § Route-derived dispatch
reads `route{}` once, immediately before spawning `planner`; issues already past `phase: plan`
are unaffected). One-time backfill, run before that turn's Step 2 Ready-set computation. The
`route` object schema table above is unchanged (frozen per `router.md` § Schema reference).

### Status transitions

```
blocked → ready        (dependencies satisfied, user gate cleared)
ready → in-flight      (worker spawned)
in-flight → ready      (review found BLOCK — back to implement, still in-flight until worker ends)
in-flight → merged     (PR merged, issue closed)
* → closed             (superseded, duplicate, or wontfix)
```

## Scheduling algorithm

Run **forge sync first** (automatic, every iteration), then:

### Step 1 — Forge sync

See `forge-sync.md`. Refresh open/closed state, PR links, labels.

### Step 2 — Ready set

An issue is **ready** when ALL hold:

1. `status` is `ready` (not `blocked`, `in-flight`, `merged`, `closed`)
2. `notes` does not contain `awaiting-user` or `awaiting-plan` (user gates)
2. Every `depends_on` issue has `status: merged` or `closed` on forge
3. No active `migration_slot` holder unless this issue holds the slot
4. Issue is open on forge **within campaign scope** (`gh issue view --json state` plus
   `issueMatchesScope` when `scope_milestone` / `scope_labels` are configured)

Promote `blocked → ready` when dependencies clear and user gates pass.

### Step 3 — Conflict filter

For each pair in ready set, if `touch_paths` globs overlap on likely files,
keep the issue earlier in `user_queue_order`; defer the other (set `blocked`
with note `overlap with #N`).

**Migration slot:** at most one `in-flight` issue with `migration_slot: true`.
Others with `migration_slot: true` stay `blocked` until slot frees.

### Step 4 — Wave computation

Before batch selection, compute **execution waves** via topological sort on `depends_on`:

1. Wave 0: issues with empty `depends_on` (and ready per Step 2)
2. Wave N: issues whose dependencies are all `merged` or `closed` in prior waves
3. Within each wave, apply conflict filter (Step 3) and Pareto sort (descending Priority)

Log wave number before spawning: `WAVE <N>: issues [301, 298, ...]`.

Waves respect both dependency order and touch_paths conflict deferral. An issue deferred for overlap joins the next wave when the blocker clears.

### Step 5 — Batch selection

Take up to `parallel_max` (default 4 from config) from the **current wave's** ready set, ordered by
`user_queue_order` then Pareto Priority. Spawn workers in **one orchestrator turn**.

### Step 6 — Persist

When `depends_on` changed this turn, run [forge-sync.md](forge-sync.md) §6.5 write-back
**before** bumping `refreshed_at` (skip when `auto_sync: false`).

Bump `refreshed_at` on every mutation:

```bash
jq '.refreshed_at = (now | todate)' .blackhole/queue.json \
  > .blackhole/queue.json.tmp \
  && mv .blackhole/queue.json.tmp .blackhole/queue.json
```

## Initialize from forge

On first `sync` with empty queue:

```bash
gh issue list --state open --json number,title,labels,milestone --limit 200 \
  $(bun scripts/forge-scope.ts list-args)
```

Create one `issues.<n>` entry per open issue: `phase: handle`, `status: ready`,
`depends_on` parsed from body "Blocked by #N" / "Depends on #N".
<!-- GENERATED by scripts/build.ts from src/references/queue-dag.md — do not hand-edit -->
