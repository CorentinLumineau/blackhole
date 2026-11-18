---
type: plan
summary: "Plan for issue 1270: the text status dashboard shows the newest 10 completed entries and filed issues with an overflow count, newest first, and prints Scope from the same source as the summary"
status: current
review_trigger: "on a change to the status dashboard sections"
created: 2026-11-18
last_updated: 2026-11-18
related: [src/references/coordinator-dashboard.md]
---

# Plan: status dashboard caps and scope (issue 1270)

Objective: stop the default text dashboard from dumping every completed entry, list filed issues newest first with a cap, and make `### Scope` read the same source as `--summary`.

Tasks (full acceptance criteria in the working plan for the issue):

1. Red-first tests: Completed shows the 10 highest issue numbers descending plus an overflow line; Issues filed likewise; `### Scope` falls back to the shared scope label when nothing is recorded.
2. Implement in `scripts/lib/campaign-status/dashboard.ts` with the existing `SECTION_CAP` and `capOverflowLine`; the JSON report, HTML page and data rows are unchanged.
3. Update the two lines in `src/references/coordinator-dashboard.md`.

Interpretation (UI gate, approved by the orchestrator under autonomy full): N = 10; newest = highest issue number; headings unchanged. The HTML page keeps "Scope not recorded" and is left for a follow-up.

Test strategy: unit tests on the render functions, one focused spec through `formatDashboard`; CI runs the suites.
