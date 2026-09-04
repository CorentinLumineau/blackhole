---
section: Recheck-Mode Compliance
vcodes: []
---
### Recheck-Mode Compliance
Inputs for this mode: `review-core.md` § Reviewer prompt requirements (per-mode table,
"Recheck" row) — the bullets below are this mode's *procedure*, not a restatement of its
*input contract*.
*   **Detection**: the orchestrator's prompt indicates recheck mode — a prior findings list
    (`{finding_id, summary}[]`) is present (`review-core.md` § Recheck mode).
*   **Scope**: when detected, scope the entire audit to the fix commits only (commits added
    since the prior review pass) — do not re-run the full §§1–10 checklist against the whole
    PR diff, only against the fix commits' changed lines.
*   **Verification**: for each named prior finding, verify it is concretely fixed and emit a
    `recheck` entry (`worker-schemas.md` § Reviewer) with `finding_id`, `verdict`
    (`fixed`/`not_fixed`), and `evidence`. When `verdict: not_fixed`, also emit a corresponding
    `findings` entry for that same issue so the aggregate script and LGTM gate need no
    special-casing.
*   **Regression scan**: scan the fix commits — and only those commits — for newly introduced
    regressions; report any via the normal `findings` array with a standard V-code/severity.
*   **Never re-litigate**: do not report findings against code outside the fix commits that was
    already approved in the prior full-review pass.
*   **Composition**: findings from this scoped audit still pass through §11 (confidence) and
    §12 (proportionality) before inclusion — recheck mode does not bypass either gate.
*   **Independent spec-drift check (GAP-2 remedy, every recheck pass)**: in addition to the
    fix-commit-scoped verification above, perform one lightweight, full-diff comparison of the
    PR's current cumulative state against the plan's Objective + Task Breakdown — the same
    comparison the Objective Fulfillment check (§1) performs on a fresh full review. This is
    **not** a re-run of the full §§1–10 checklist, and **not** a re-litigation of already-approved
    code quality/style findings outside the fix commits (the "Never re-litigate" rule above is
    unchanged — this is a distinct axis: requirement satisfaction, not code quality). Any
    requirement the cumulative diff no longer satisfies — including one a fix commit
    inadvertently broke while resolving a *different* named finding — is reported as a normal
    `findings` entry (no new V-code; reuses the uncoded Objective Fulfillment convention when no
    more specific code applies), subject to the existing severity → action mapping and LGTM gate.
    This is the one place in recheck mode that reads the whole diff, but only for spec/requirement
    satisfaction — never for quality/style re-litigation.
