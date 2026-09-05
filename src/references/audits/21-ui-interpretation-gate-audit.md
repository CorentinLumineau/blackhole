---
section: UI Interpretation Gate Audit
vcodes: [V-UI-01]
---
### UI Interpretation Gate Audit (`V-UI-01`, ADR-017)
*   **Detection**: read the plan file's frontmatter at `PLAN_ABSOLUTE_PATH` (from
    `<PLAN_CONTEXT>`, the same field § Threat Model Audit's Detection reads) for `ui_gate`, when the issue's
    resolved `route.ui` was `true` for this issue **and** its size is not `size:xs`. `route.ui`
    not `true`, or trivial size — emit no § UI Interpretation Gate Audit findings (vacuous gate; mirrors mercure's own
    "runs when the plan includes a `## Threat Model` section" gate exactly — no false-negative
    risk if the gate never applied to this issue, since there is nothing to audit against).
*   **Approval check (`V-UI-01`, `BLOCK`)**: when Detection is true, `ui_gate` must read
    `approved`. `ui_gate` absent, or `pending` (not `approved`) — severity `BLOCK`, cite the
    plan file (either the plan-time UI Interpretation Gate section never emitted the stamp, or
    the owner has not yet approved the interpretation via the clarify gate). This mirrors
    `V-THREAT-01`'s Quick-track escalation check verbatim — same stamp-audit shape, different
    field name.
