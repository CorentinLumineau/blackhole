---
section: Performance Budget Audit
vcodes: [V-PERF-01, V-PERF-02]
---
### Performance Budget Audit (`V-PERF-01/02`)
*   **Detection**: read the plan file at `PLAN_ABSOLUTE_PATH` (from `<PLAN_CONTEXT>`, the same
    field § 8's Docs-Only detection already reads) for a `## Performance Budget` heading listing
    budgeted components. Absent heading — emit no §17 findings (vacuous gate; mirrors mercure's
    own "runs when the plan includes a `## Performance Budget` section" gate exactly).
*   **Anti-pattern check (`V-PERF-01`, `BLOCK`)**: when the heading is present, the diff touching
    a listed component introduces no N+1 query, unindexed sort, sync I/O in a hot path,
    full-table scan, or unbounded pagination — a violation is severity `BLOCK`, cite `file:line`.
*   **Regression-vs-threshold check (`V-PERF-02`, `WARN`)**: the diff touching a listed component
    does not visibly regress against its documented threshold (e.g. an added query inside a loop
    where the budget states "single query") — a violation is severity `WARN`, cite `file:line`.
