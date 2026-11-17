---
type: review
summary: "Readiness review of catchup-mode M1 (plugin-version warning, launch-gate Sleep row): LGTM with two LOW notes"
status: current
review_trigger: "on file change"
created: 2026-11-17
last_updated: 2026-11-17
related:
  - documentation/milestones/_active/catchup-mode/milestone-1.md
---

# Review: catchup-mode M1 (181066c7)

**Verdict: LGTM** - 0 CRITICAL, 0 HIGH, 0 MEDIUM, 2 LOW.

Diff: `13d217f5...181066c7`, branch `design/catchup-mode`. Read-only review; focused tests run through
`with-test-lock`: plugin-drift, hook-sources, launch-summary (66 pass), run-context (15 pass),
campaign-status (70 pass).

## Findings

| # | Sev | Where | Finding |
|---|-----|-------|---------|
| 1 | LOW | `scripts/lib/plugin-drift.ts` `readPluginVersionCheck` | A `null` element in an `installed_plugins.json` row array makes `r.version` throw, which would abort `status --summary` and `run-context` on a malformed file. `readInstalledPluginRows` guards the array but not its elements. Filter non-object rows. |
| 2 | LOW | `scripts/hook-sources.test.ts` | The plan (T1) called for extending this suite; it is unchanged. The extraction is covered by the existing suite passing and by the new `readInstalledPluginRows` cases in `plugin-drift.test.ts`. |

## Checks

- Callers of the moved `readPluginVersion` and the removed `MARKETPLACE_NAME` are all updated.
- `LAUNCH_ROW_KEYS` stays at eight; the committed fixture is unchanged (default `warnings = []`).
- `launch-gate.md` keeps its required markers and now lists the Sleep row.
- Exit codes are unchanged by the warning; `plugin` is an additive `run-context.json` key.
- Built outputs match `src/` edits (only the three reference files were changed).
