---
type: adr
status: accepted
scope: orchestration
review_trigger: "on protocol change"
created: 2026-08-12
last_updated: 2026-08-12
related:
  - documentation/decisions/ADR-005-pr-merge-gate-dependency-ordering.md
  - documentation/decisions/ADR-010-autonomous-thinking-routes.md
  - documentation/audits/mercure-parity-surface.md
---

# ADR-023 — Rebase & Conflict Preflight before squash-merge

## Status

Accepted — 2026-08-12 (design track, issue #450, `design-aggregate.ts` verdict `ready`).

## Context

Blackhole's merge pipeline (`phase-loop.md` § Merge protocol) calls `gh pr merge --squash`
directly after eligibility (`mergeEligible`) and CI-wait. When `main` moves while a PR sits in
review, the PR can become `CONFLICTING`. Today that failure lands in the generic Permanent path
(`orchestrator-runtime.md` § Error Classification) — skip with warning, no rebase, no mechanical
resolution, no owner-facing hunk detail — stalling the issue indefinitely.

Live campaign evidence (2026-08-10): four PRs in one session needed manual rebasing (#497 semantic
counter, #487 mixed real/stale-build-output, #505 stacked-branch squash-base, #510 post-rebase
rebuild). Campaign config amplifies exposure: `parallel_max: 8`, `merge_mode: immediate`.

ADR-005 scoped `merge-gate.md` to **eligibility and ordering** only; `phase-loop.md` owns merge
**mechanics**. `touch_paths` deferral (`queue-dag.md`) prevents parallel *implementation*
collisions but not merge-time conflicts (lockfiles, generated build output, post-wave base
movement). `grep -ri rebase src/` returns zero protocol hits — only worktree-removal safety prose.

Mercure's `git-ci resolve` skill is an interactive slash-command unavailable to blackhole's
`Agent`-spawned workers — a native protocol is required, not a runtime delegate.

## Decision

### D1 — Dedicated protocol doc + Step 0.5 (extends ADR-005 split)

Add `src/references/merge-conflict-protocol.md` as the **single SSOT** for classification,
resolution procedures, attempt cap, worker delegation summary, ledger recording, and blocker
surfacing. `phase-loop.md` § Merge protocol gains **Step 0.5** (named, non-renumbering) between
step 0 (`mergeEligible`) and step 1 (`headRefOid` check). Steps 1-5 keep their numbers — six+
external citations depend on them.

Trigger: `gh pr view <n> --json mergeStateStatus,mergeable`. `mergeable == "MERGEABLE"` → proceed
to step 1 unchanged. `mergeable == "CONFLICTING"` → run protocol. Bypassed under
`merge_mode: leave-open` (same as steps 0-5).

### D2 — Explicit mechanical vs semantic classification (not worker judgment)

A hunk is **mechanical** iff it matches one of four stated classes:

1. Generated build-output tree (self-verified by rebuild idempotency — `scripts/lib/build/targets.ts` SSOT list).
2. Recognized lockfile (`bun.lockb`, `package-lock.json`, etc.) — regenerate via install command.
3. Pure two-sided insertion (union-mergeable).
4. Import-block reordering with no changed import targets — format/lint autofix.

**Everything else is semantic** — explicitly including every counter, threshold, or derived-literal
conflict. No automatic delta computation (`V-YAGNI-01` — no structural SSOT marker convention
exists today).

### D3 — Attempt cap 2 (reuses existing convention)

Attempt 1: plain `git rebase origin/main`, or direct cherry-pick when stacked-branch signal is
already known (`merge_after` predecessor merged after branch point). Attempt 2: the other
strategy. Reuses `orchestrator-runtime.md` § Error Classification's 2-retry-then-reclassify
convention — no new configurable threshold.

Post-resolution: mandatory rebuild after any successful rebase/cherry-pick before quality gate
and push (PR #510 evidence).

### D4 — Mechanical → implementer; semantic → HITL blocker

Mechanical hunks: orchestrator spawns `implementer` in existing `wt-<issue>` worktree per
5-Field Delegation Contract (`implementer.md` § Conflict Resolution Gate). One `V-MERGE-03` (NOTE)
ledger row per resolved hunk — audit trail, not a defect.

Semantic hunks: abort rebase/cherry-pick; `queue.json` `status: blocked`,
`notes: "merge-conflict-semantic:<file1>,<file2>,..."`; implementer returns
`escalation_trigger: merge_conflict_semantic` with non-empty `conflict_hunks[]` (`file`, `lines`,
`excerpt`). `orchestrator-dispatch.md` routes this trigger to HITL (`coordinator.md` presents hunks
per ruling R-003), **never** to `investigator`.

### D5 — Worker-JSON extension

Add `merge_conflict_semantic` to `escalation_trigger` enum. `conflict_hunks[]` required non-empty
when that trigger is set — validated in `scripts/lib/worker-json/validators/implementer.ts` +
fixture pair (existing optional-field ship pattern).

## Consequences

- Positive: recurring merge stalls eliminated; mechanical resolutions auditable; semantic conflicts
  actionable per R-003 instead of Permanent skip.
- Negative: 15-file additive touch-path surface; `force-with-lease` push after rebase requires
  worktree discipline (`recovery-protocol.md` §6(c) unpushed-commit guard still applies).
- `V-MERGE-03` table row in `blackhole-vcodes.md` deferred while hot-file lock (#508) — ledger
  accepts unregistered vcode strings today.
- Counter auto-resolution explicitly deferred to a future issue once a real annotation convention
  exists.

## Alternatives considered

| Option | Rejected because |
|--------|------------------|
| Extend `merge-gate.md` only | Collapses eligibility + resolution against ADR-005 boundary |
| `scripts/` classifier only | Cannot own rebuild verification, cherry-pick fallback, or delegation contract without duplicating agent instructions |
| Auto-delta counter resolution | Silently-wrong arithmetic worse than human fix; no SSOT marker convention |
| Blocked-Iteration Counter count-3 | New retry number; issue AC requires reusing established 2-attempt convention |
