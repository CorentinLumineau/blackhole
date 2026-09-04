---
type: plan
summary: "Protocol fix: mandatory post-merge + turn-start main-clone freshness refresh so orchestrator repo-facts reads never operate on a stale checkout"
status: current
review_trigger: "on file change"
created: 2026-09-03
last_updated: 2026-09-03
---

# Plan - Issue #792

## Objective

The orchestrator's main-clone checkout is created once per campaign and never refreshed. Nothing
in the protocol fast-forwards it after a merge or at turn start, so repo-facts reads (the plugin
cache drift signal, the planner's `plan-quality-gate.ts` reads, the merge-step build-in-main-clone)
can silently operate against a stale tree. This session hit the failure mode directly: the main
clone sat stale for the whole session and only surfaced when a reviewer's independent check
disagreed with what the stale checkout showed, immediately after issue #806/PR #823 changed a
script's own CLI signature. Fix: add a mandatory post-merge freshness refresh to `phase-loop.md`'s
Merge protocol (closes the exact gap that caused the incident), plus a turn-start freshness refresh
in `orchestrator-runtime.md`'s Session resume & recovery sequence as a belt-and-suspenders net for
drift from causes other than blackhole's own merges (e.g. a human pushing to the shared branch
mid-campaign — the scenario issue #792's forge body itself describes).

**Why both, not one**: the post-merge refresh alone only closes the window opened by blackhole's
*own* merges — it does nothing for drift that accumulates before the first merge of a turn, or
drift introduced by an external push. The turn-start refresh alone would bound staleness to "at
most one turn," which is exactly the window the real incident happened inside (multiple
facts-reads occurred within a single stale turn). Neither alone reproduces the guarantee the other
gives; together they bound staleness to (a) immediately after every blackhole merge and (b) at
most once per turn otherwise. The post-merge step is the mandatory fix (it is the literal moment
that caused this session's incident); the turn-start step is the secondary safety net.

## Touch-Paths

- `src/references/phase-loop.md` plus all generated dist trees per `scripts/lib/build/targets.ts`
- `src/references/orchestrator-runtime.md` plus all generated dist trees per
  `scripts/lib/build/targets.ts`

## Fix summary

1. **`src/references/phase-loop.md`, Merge protocol** — new step 4.5, inserted between the
   existing step 4 (`gh pr merge --squash` + `merged_by` stamp) and step 5 (post-merge
   migration/deploy): run `git fetch origin main && git merge --ff-only origin/main` in the
   orchestrator's own main clone immediately after every merge. `.blackhole/` is fully
   `.gitignore`-excluded so this cannot conflict with campaign state; `--ff-only` fails closed on
   a dirty tracked-file working tree rather than corrupting anything.
2. **`src/references/orchestrator-runtime.md`, Session resume & recovery** — new step 1 (turn
   start, before all other steps in that section, existing steps renumbered 2-5): the same
   `git fetch origin main && git merge --ff-only origin/main` refresh, run ahead of the
   plugin-cache drift signal scan (renumbered step 5) specifically, since that scan compares
   plugin-cache content against the live tree and was identified as the highest-risk unmitigated
   call site for a stale checkout.

Full task-by-task before/after text: `.blackhole/plans/issue-792.md` (working plan) and the PR
diff itself.

## References

- Analysis note: `documentation/audits/analysis-issue-792.md`
- Incident: this session's main clone sat stale for its full duration, surfaced only when a
  reviewer's independent check disagreed with the stale checkout, immediately after issue
  #806/PR #823 changed a script's CLI signature. Reactive fix applied mid-session
  (`git fetch origin main && git merge --ff-only origin/main` after each merge) is now
  protocol-ized by this plan.
