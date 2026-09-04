---
section: Improvement Discoveries & Pareto scoring
vcodes: [V-PARETO-02]
---
### Improvement Discoveries & Pareto scoring (`V-PARETO-02`)
*   Identify opportunities for improvements (UX/UI polish, performance gains, styling best practices, or test coverage gaps).
*   Log them as findings with severity `WARN` (matching the SSOT table) and V-code `V-PARETO-02`. Estimate **`gain`** (1-10) and **`effort`** (1-10) for each.
*   Do not request fixing them in the current PR. The orchestrator will file them as separate GitHub issues.
