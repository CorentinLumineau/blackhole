---
type: plan
status: current
issue: #767
review_trigger: "on file change"
created: 2026-09-03
last_updated: 2026-09-03
supersedes_adr: null
---

# Plan - Issue #767

## Objective

Item (1) of the original filing (17 uncommitted decision-log rows) is already resolved on
`main` (PR #770, commit `221e7030`) — verified clean via `git status
documentation/reference/decision-log.md`. This plan closes the sole remaining item: record an
explicit, evidence-backed decision on whether `decision_log_silent_prs` is expected steady-state
or a live defect, and write that decision durably into `documentation/reference/decision-log.md`
so the open question in the doc-health signal does not get re-litigated on every turn.

**Investigation (completed by this plan, not deferred to implement)**: `decision_log_silent_prs`
is currently 168 (was 161 at filing; the count grows with every merge that predates or evades
the mechanism, an expected drift explained below). `computeDecisionLogSilentPrs`
(`scripts/doc-health-signal.ts`) only checks whether a merged PR's number appears anywhere in
`decision-log.md`'s Records table — it has no visibility into whether that PR's implementer
worker actually returned a non-empty `decision_records[]`, so the raw count alone cannot
distinguish "legitimately nothing to log" from "mechanism failed to fire." Resolving the
question required git-archaeology instead:

- `documentation/reference/decision-log.md` and the orchestrator's append step did not exist
  before commit `ca1f6a1d` (2026-07-20, issue #421/#422, M4 Tasks 3-5). Every one of the 183
  merged-with-PR-number issues in `queue.json` that landed before that date is *structurally*
  silent — there is no mechanism they could have hit. This is expected, not a defect, and is
  permanent (unrecoverable) history.
- The *documented* mechanism (`src/agents/orchestrator.md` § Decision Record Append) existed
  from `ca1f6a1d` onward, but the actual invocable script, `scripts/decision-log-append.ts`,
  was not created until commit `2fe253e9` (2026-09-02, issue #750) — roughly six weeks
  (`ca1f6a1d` 2026-07-20 → `2fe253e9` 2026-09-02) where any worker-emitted `decision_records[]`
  had no automated path into the log. This was a real reliability gap, now closed. Issue #749 /
  PR #770 (commit `221e7030`) already recovered the 17 rows that happened to survive in an
  uncommitted working-tree file from that window; any other records from that window that were
  never persisted anywhere (ephemeral worker JSON, never written to disk) are permanently
  unrecoverable — there is no source to re-derive them from, so there is nothing further to
  "fix" retroactively for that window.
- Since `2fe253e9` landed, the mechanism has run again: PR #810's root-cause/reuse/improvement
  rows landed via commit `2e51e674`, confirming the wiring works going forward.

**Conclusion**: the count is dominated by two structural, non-defect causes (pre-mechanism
history and a now-closed implementation gap) rather than an ongoing reliability problem. It will
never shrink (history is unrecoverable) and its current value is the expected steady-state
floor from this point forward. The only thing worth watching going forward is *growth* past
this floor — a future merged PR whose implementer worker returned a non-empty
`decision_records[]` that still fails to reach the log — which would indicate the wiring broke
again. This matches the existing advisory framing of the signal (`V-DOCHEALTH-03`: `doc_debt`
stays advisory, no ledger append, no phase gate) — this plan does not change that framing, only
closes the open question about *why* the number is what it is.

## Touch-Paths

- `documentation/reference/decision-log.md`

## Documentation Impact

`documentation/reference/decision-log.md` is the file being updated — this *is* the
documentation change; there is no separate consumer doc affected. Per `doc-governance.md` §
Search-Before-Write: the file already exists and already owns this exact concern (it is the
target the `decision_log_silent_prs` signal measures against), so this is an in-place update,
not a new file — no search-before-write duplicate-concern risk.

## Task Steps

1. In `documentation/reference/decision-log.md`, add a new `## Known Baseline
   (decision_log_silent_prs)` section immediately after the existing `## Rotation` section (and
   before `## Records`), containing the steady-state conclusion above in condensed form: (a)
   pre-`ca1f6a1d` (2026-07-20) merges are structurally silent by definition, (b) the
   `ca1f6a1d` → `2fe253e9` (2026-09-02, issue #750) window is a closed, unrecoverable
   implementation gap already partially recovered by PR #770, (c) the current count is the
   expected floor and only *growth past it post-2026-09-02* signals a live defect worth
   investigating. Cite issue #767, and commits `ca1f6a1d` / `2fe253e9` / `2e51e674` /
   `221e7030` by short SHA. — **AC**: `grep -q "Known Baseline" documentation/reference/decision-log.md` succeeds, and the section names both commit SHAs `ca1f6a1d` and `2fe253e9`.
2. Bump the file's frontmatter `last_updated` field to the date the edit lands. — **AC**:
   `last_updated` in the frontmatter is a valid `YYYY-MM-DD` no earlier than `2026-09-03`.
3. No `queue.json` / `findings-ledger.json` mutation and no ledger append is required — this is
   a docs-only clarification of an already-advisory signal (`V-DOCHEALTH-03`), not a new gate or
   check. — **AC**: diff touches only `documentation/reference/decision-log.md`.
