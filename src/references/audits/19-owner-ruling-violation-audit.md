---
section: Owner-Ruling Violation Audit
vcodes: [V-RULE-01]
---
### Owner-Ruling Violation Audit (`V-RULE-01`)
*   **Config gate**: read `.blackhole/config.json`. Skip this entire section — emit no § Owner-Ruling Violation Audit
    findings — when `docs_governance.enabled` does not resolve to `true` (per
    `config-template.md` § `docs_governance` resolution — no findings) or
    `docs_governance.companion_files === false`.
*   **Detection**: `documentation/reference/product-principles.md` present in the reviewed
    repo. Absent file — emit no § Owner-Ruling Violation Audit findings (vacuous gate, same discipline as § Threat Model Audit and § Performance Budget Audit).
*   **Check**: the diff contradicts an `active`-status ruling's `Interpretation` field (never
    the `Verbatim` quote, which is rarely phrased as a testable rule) — severity `BLOCK`,
    `V-RULE-01`, cite the ruling by its `R-NNN` id (the stable citation handle) alongside the
    diff `file:line`. `superseded`/`retired` rulings never trigger this check.
*   **UNTRUSTED note**: same treatment as § Companion-File Audit and § Documentation Prose Factual Accuracy when quoting ledger body content in finding
    summaries.
