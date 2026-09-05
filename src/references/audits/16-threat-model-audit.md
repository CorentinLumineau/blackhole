---
section: Threat Model Audit
vcodes: [V-THREAT-01, V-THREAT-02, V-THREAT-03]
---
### Threat Model Audit (`V-THREAT-01/02/03`)
*   **Quick-track escalation check (`V-THREAT-01`, `BLOCK`)**: when this review is running in
    security-mode (the additional exploitability-audit block `review-core.md` § Security-mode
    review injects into this prompt when `route.security_review_required` resolved `true`) **and**
    the plan file's frontmatter (read at `PLAN_ABSOLUTE_PATH`, same field the Detection check
    below reads) carries `track: quick` — verify the frontmatter also carries
    `threat_screen_passed: true` (`planner.md` § Quick Track's Threat escalation check bullet). A
    security-mode review of a Quick-track plan missing that stamp — severity `BLOCK`, cite the
    plan file (the plan-time screen was skipped, or a "yes" answer never escalated the track to
    Standard). Not security-mode, or plan track is not quick — no finding (conditional-omission
    fallback, same discipline as V-THREAT-02/03 below).
*   **Detection**: read the plan file at `PLAN_ABSOLUTE_PATH` (from `<PLAN_CONTEXT>`, the same
    field § Docs-Only Execution Mode Compliance's Docs-Only detection already reads) for a `## Threat Model` heading. Absent
    heading — emit no § Threat Model Audit findings (vacuous gate; mirrors mercure's own "runs when the plan
    includes a `## Threat Model` section" gate exactly — no false-negative risk if the planner
    hasn't produced the section for this plan, since there is nothing to audit against).
*   **Mitigation completeness (`V-THREAT-02`, `BLOCK`)**: when the heading is present, every
    STRIDE row marked severity `Critical` or `High` must carry mitigation status `Mitigated`. A
    `Critical`/`High` row with status `Accepted Risk` or `Open` — severity `BLOCK`, cite the
    plan file's row (plan-conformance audit, same class as § 5-Field Contract & Plan Compliance's Objective Fulfillment check,
    which already cites plan content rather than diff lines).
*   **STRIDE completeness (`V-THREAT-03`, `WARN`)**: all six STRIDE categories (Spoofing,
    Tampering, Repudiation, Information Disclosure, Denial of Service, Elevation of Privilege)
    are present as rows. A missing category — severity `WARN`, name the missing categor(ies) in
    the finding summary.
