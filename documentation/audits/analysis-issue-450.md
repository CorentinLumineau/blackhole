---
type: analysis
summary: "Pre-plan architecture analysis mapping the merge-conflict gap to phase-loop/merge-gate module boundaries and existing blocker/ledger conventions"
status: current
created: 2026-08-12
last_updated: 2026-08-12
review_trigger: on file change
issue: 450
confidence: 86
computed_at_revision: 1
---

# Analysis — Issue #450: No rebase or merge-conflict protocol

## Conventions Catalog

Patterns at integration touchpoints reachable from declared `touch_paths` (`src/**`, `scripts/**`, `fixtures/**`). Usage counts are `rg` hits under `src/` unless noted.

| Pattern | Source | Usage (`src/`) | Relevance to #450 |
|---------|--------|----------------|-------------------|
| **Merge eligibility vs merge mechanics split** — `mergeEligible(issue)` is a delegated precondition; `gh pr merge` mechanics live separately | `src/references/merge-gate.md:3-8`, `src/references/phase-loop.md:42-45` | `mergeEligible`: 18 refs across 5 files; `gh pr merge`: 6 refs across 3 files | New rebase/conflict step must respect this boundary: eligibility/trigger classification in `merge-gate.md` (or a cited sibling §), execution in `phase-loop.md` |
| **Phase-loop merge protocol steps 0–5** — step 0 gate → HEAD check → CI-wait → build → `gh pr merge --squash` → post-merge | `src/references/phase-loop.md:42-80` | 2 direct `gh pr merge` occurrences (both in `phase-loop.md`) | No step exists between LGTM and merge for base freshness or conflict detection; issue body claim confirmed |
| **CI transient retry, then Permanent** — `cancelled` rerun once; "Base branch was modified" re-fetch once; 2-retry cap → `orchestrator-runtime.md` § Error Classification | `src/references/phase-loop.md:60-71`, `src/references/merge-gate.md:34-37` | `Error Classification`: 11 refs across 7 files | "Base branch was modified" handles CI race, not git merge conflicts; after 2 retries a conflicting PR is classified Permanent and skipped — stall path |
| **`touch_paths` implementation-time conflict deferral** — overlapping globs defer later issue with `notes: overlap with #N` | `src/references/queue-dag.md:153-157` | `touch_paths`: 42 refs across 20 files; `overlap with #`: 2 (both `queue-dag.md`) | Prevents parallel *implementation* on overlapping paths; does **not** prevent merge-time conflicts (adjacent edits, lockfiles, generated aggregates, post-wave base movement) |
| **Wave scheduling + `parallel_max`** — topological waves, conflict filter inside wave, batch up to `parallel_max` | `src/references/queue-dag.md:162-177`, `src/references/config-template.md` | `parallel_max` in `config-template.md` + campaign `config.json` | Live campaign runs `parallel_max: 8`, `merge_mode: immediate` — high concurrency against a moving `main` |
| **V-MERGE drift attribution** — `merged_by: blackhole` marker; `V-MERGE-01`/`V-MERGE-02` on external/ineligible merge | `src/references/merge-gate.md:170-221`, `src/references/blackhole-vcodes.md:74-75` | `V-MERGE`: 13 refs across 5 files | Establishes ledger + V-code precedent for merge-path audit; mechanical conflict resolutions should follow same append-only ledger pattern (issue AC) |
| **Blocker `notes` free-form tokens** — `awaiting-*`, `blocked-escalated:Permanent:<reason>`, `merge-order cycle with #N` | `src/references/orchestrator-runtime.md:106-110`, `src/references/merge-gate.md:157-158`, `src/references/checkpoint-protocol.md:139-147` | `awaiting-`: 8+ gate tokens across worker/orchestrator docs | Semantic-conflict `status: blocked` with hunk detail fits existing `notes` convention; no new queue schema field required |
| **Blocked-Iteration Counter + Failed-Approaches Log** — count-3 escalation; Permanent failures append-only | `src/references/checkpoint-protocol.md:107-147` | 2 dedicated sections + 4 `orchestrator-runtime.md` cross-refs | Natural home for retry cap before blocking (issue AC escalation threshold) |
| **Merge escalation gate class** — `clarify-gates.md` table points semantic HITL to `merge-gate.md` | `src/references/clarify-gates.md:60` | 1 gate-class row | Semantic conflicts should surface via coordinator `AskQuestion` under merge escalation, not silent Permanent skip |
| **`recovery-protocol` worktree safety** — mentions "post-push rebase" only in unpushed-commit removal guard | `src/references/recovery-protocol.md:120-122`, `src/references/blackhole-protocol.md:84` | `rebase`: 2 hits in `src/` (both removal-safety prose, zero protocol) | Confirms issue grep finding; recovery-protocol is the wrong module for PR merge-conflict resolution |
| **Scripts layer** — validation, forge-scope, recovery-drift; no git merge/rebase automation | `scripts/` tree (0 `rebase`/`gh pr merge` hits) | 0 merge-conflict scripts | Implementation likely adds `scripts/` helper(s) + reference-doc spec; `fixtures/` may need merge-conflict scenario fixtures |
| **Mercure parity reference** — gap filed from `mode-resolve.md § B` | `documentation/audits/mercure-parity-surface.md:271`, `mercure-parity-matrix.md:139` | external | Upstream pattern exists; blackhole has not adapted it |

## Architecture Coherence

### Confirmed gap

The issue body's core claim is accurate:

1. **`grep -ri rebase src/` → 0 protocol hits** — only two incidental mentions in worktree-removal safety prose (`recovery-protocol.md:122`, `blackhole-protocol.md:84`).
2. **`phase-loop.md` calls `gh pr merge --squash` directly** at step 4 (`phase-loop.md:73-79`) after eligibility (step 0) and CI-wait (step 2).
3. **No merge-conflict classification path** — `mergeStateStatus` appears only for CI "Base branch was modified" retry (`phase-loop.md:65-67`), not for `CONFLICTING`/`DIRTY` mergeability.
4. **Failure lands in generic Permanent path** — `orchestrator-runtime.md:9-10` Permanent → "skip optional steps with a warning" + Failed-Approaches entry; no `status: blocked` with actionable hunk context, so the issue can remain `in-flight` at merge phase indefinitely.

### Why parallel campaigns make this recurring (not edge-case)

| Mechanism | What it prevents | What it does **not** prevent |
|-----------|------------------|------------------------------|
| `touch_paths` deferral (`queue-dag.md:153-157`) | Two implementers editing overlapping globs in the same wave | Sequential waves merging into a moving base; non-overlapping paths that still conflict (lockfile, `facts.ts` hot-file exceptions, generated build output) |
| `depends_on` / `merge_after` (ADR-005) | Starting or merging out of declared order | Same-file semantic conflicts when ordering is unspecified |
| `merge_hold` | Merging before human batch review | Conflicts once hold clears |

Live campaign config amplifies exposure: `parallel_max: 8`, `merge_mode: immediate` (`.blackhole/config.json:5-6,21`). Owner-recorded rationale: "3 of 4 merges on 2026-08-10 needed manual rebasing" (`config.json` `wave_scheduling.rationale`).

### Module-boundary fit (where new protocol should live)

ADR-005 (`documentation/decisions/ADR-005-pr-merge-gate-dependency-ordering.md`) deliberately scoped **`merge-gate.md` to eligibility/ordering** and left **`phase-loop.md` as the sole merge-mechanics owner**. A coherent #450 design should extend that split, not collapse it:

```
merge-gate.md (eligibility + triggers)
    └── new §: mergeability / base-freshness precondition (when to attempt rebase)
phase-loop.md (mechanics)
    └── new step(s): rebase/update branch → classify conflict → resolve or block
        between current step 0 (mergeEligible) and step 1 (HEAD check),
        OR immediately before step 4 (gh pr merge)
scripts/ (optional, testable)
    └── conflict hunk parser / mechanical-vs-semantic classifier
findings-ledger.md + blackhole-vcodes.md
    └── record mechanical resolutions; new V-code(s) if needed
```

**Do not place** PR merge-conflict logic in:

- `recovery-protocol.md` — dirty/mixed worktree recovery, not forge mergeability
- `phase-implement.md` — implementers push feature branches; they do not own merge gate
- `queue-dag.md` touch_paths filter — wrong lifecycle phase (scheduling ≠ merge)

**Cross-link** `recovery-protocol.md` §6(c) post-rebase unpushed-commit guard — any autonomous rebase in the worktree must re-use the existing `@{u}..HEAD` safety check before worktree removal.

### Alignment with issue design constraints

| Constraint | Existing machinery to reuse | Gap |
|------------|----------------------------|-----|
| Rebase-before-merge with defined trigger | `mergeEligible()` short-circuit pattern; CI-wait "Base branch modified" retry | No `mergeable`/`behind_by` probe; no rebase command spec |
| Mechanical vs semantic rule (explicit, not worker judgment) | Checker scripts pattern (`scripts/checks/*.check.ts`); V-code severity tiers | No classifier spec or allowlist (lockfile, changelog, import order) |
| Mechanical → autonomous resolve + ledger record | `findings-ledger.md` append protocol; `V-MERGE-*` precedent | No resolution worker/spawn contract; no ledger row shape |
| Semantic → `status: blocked` + hunk in blocker message | `notes` tokens; `clarify-gates.md` merge escalation class; coordinator Resolving Blockers | Today → Permanent skip without block |
| Escalation threshold before block | Blocked-Iteration Counter (count 3); Failed-Approaches Log | Not wired to merge-conflict retries |

### Route flags (planner input)

From `queue.json` issue #450 at `route.revision: 1`:

- `needs_design: true`, `needs_analysis: true` (this note satisfies analysis)
- `task_type: feature`, `plan_mode: full`, `docs_impact: true`
- `touch_paths`: `src/**`, `scripts/**`, `fixtures/**`

Design track is appropriate: mechanical/semantic threshold is a protocol design decision (issue body explicitly rejects ad-hoc worker judgment). Expect plan touch-paths centered on `src/references/phase-loop.md`, `src/references/merge-gate.md`, possibly new `src/references/merge-conflict-protocol.md` (or a `merge-gate.md` §5) plus `scripts/` classifier and `fixtures/` scenarios.

### V-INT / pattern-variant risks

| Risk | Mitigation |
|------|------------|
| **V-INT-02** — second scope-matching or merge-check implementation | Delegate triggers to `mergeEligible()` extension; cite single doc |
| **V-INT-01** — parallel error-taxonomy for conflicts | Route all outcomes through existing Transient/Permanent/blocked trichotomy in `orchestrator-runtime.md` |
| **V-BRANCH-01** — rebase onto `main` must not force-push protected branches | Rebase happens on `blackhole/issue-N` in worktree; push uses explicit refspec (`phase-implement.md` § Explicit Git Targeting Gate) |
| **V-GIT-01** — post-rebase PR must retain `Closes #N` | Rebase does not recreate PR; verify PR body unchanged after conflict resolution commit |

### Related issues (coordination, not blockers)

- **#451** — red CI diagnosis (adjacent merge-time failure class; shares `phase-loop.md` step 2)
- **#447** — PreToolUse hooks (rebase/git commands in worktree may need hook coverage audit)

## Performance Baselines

No automated merge/rebase latency or conflict-rate metrics exist in the codebase. Measurable campaign signals only:

| Signal | Source | Value |
|--------|--------|-------|
| Manual rebase incidence (anecdotal) | `.blackhole/config.json` `wave_scheduling.rationale` | "3 of 4 merges on 2026-08-10 needed manual rebasing" |
| Parallel concurrency | `.blackhole/config.json` `parallel_max` | 8 |
| Merge mode | `.blackhole/config.json` `merge_mode` | `immediate` (no batch buffer before merge) |
| CI-wait background cap | `src/references/merge-gate.md:29-33` | 20 minutes per PR (CI only, not conflict resolution) |
| CI-wait poll interval | `src/references/merge-gate.md:27-28` | 60 seconds |

No `gh pr view --json mergeable,mergeStateStatus` probe is scripted today; establishing conflict-rate baseline post-implementation would require new telemetry (out of current touch-path instrumentation).
