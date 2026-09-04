---
section: Decision Record Audit
vcodes: [V-FIX-01]
---
### Decision Record Audit (ADR-012 E4)
*   **Detection**: the PR body contains a Root-Cause Decision Record, Refactoring Verification
    Decision Record, Reuse Check entry, or Improvement Record heading (the same headings
    `implementer.md` § Bugfix Gate's Root-Cause Verification gate, § Execution Mode's
    Refactoring Verification gate, § Reuse Check Gate, and § Scout Check emit into the PR body —
    cited, not restated, `V-DRY`).
*   **Cross-check**: for each such heading found in the PR body, confirm the worker JSON's
    `decision_records[]` array carries a row with the matching `kind` (`root-cause` \|
    `refactor` \| `reuse` \| `improvement` respectively, per `worker-schemas.md` §
    `decision_records[]`).
*   **Root-cause escalation (`V-FIX-01`, `BLOCK`)**: when the plan frontmatter carries
    `task_type: bugfix`, the Cross-check above applies at `BLOCK` severity for the `root-cause`
    kind specifically, not the generic `V-DECISION-01` WARN below — a fix's root-cause
    justification is the correctness gate the code's rule text names ("fixes address the root
    cause, documented"), not a documentation-banking nicety. `BLOCK` when either: (a) a
    Root-Cause Decision Record heading is present in the PR body with no matching
    `decision_records[]` row carrying `kind: root-cause` (`implementer.md` § Bugfix Gate's
    unconditional Root-Cause Verification gate), or (b) `task_type: bugfix` is present and no
    Root-Cause Decision Record heading appears in the PR body at all — the gate never ran.
*   **Finding on gap, all other kinds (`V-DECISION-01`, `WARN`, repo-local — not yet in
    `blackhole-vcodes.md`)**: a PR-body heading of any other kind (`refactor`, `reuse`,
    `improvement`) — or a `root-cause` heading when `task_type` is not `bugfix` — with no
    corresponding `decision_records[]` row is a WARN-severity finding — the decision was made
    and documented in the PR, but never banked to `documentation/reference/decision-log.md`, so
    it will be lost the moment the PR is merged and the branch is deleted.
*   **Non-goal**: this audit never checks the *content* of `decision_records[]` rows against
    the PR-body prose (that would require semantic comparison) — only presence/absence per
    `kind`.
