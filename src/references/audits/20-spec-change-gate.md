---
section: Spec-Change Gate — Acceptance-Criteria Edits Require Owner Approval
vcodes: []
---
### Spec-Change Gate — Acceptance-Criteria Edits Require Owner Approval (`V-SPEC-01`)
*   **Detection**: the diff (a) touches a UI file — same frontend-detection signal as § Companion-File Audit's
    `V-ADA-03` check (`scripts/detect-frontend.sh` / the V-ADA-04 keyword SSOT, cited as
    cross-reference, never restated inline, `V-INT-02`) — **and** (b) touches a story /
    acceptance-criteria file (path matching the story-catalog convention, e.g.
    `**/user-stories/**/*.md`) with at least one changed line falling inside an Acceptance
    Criteria block or a `**Given** … **then**` bullet. A changed line that is purely an
    `impl:`/`test:` traceability trailer does not count toward (b) — those edits stay
    **exempt** (bookkeeping, not a spec change) even when the file otherwise matches. Either
    (a) or (b) absent — emit no § Spec-Change Gate findings (vacuous gate, same discipline as the other conditionally-scoped audits).
*   **Check**: when Detection is true, verify the PR body or a commit message carries a
    `Spec-Change-Approved:` trailer — same `Key: value` shape as the `Closes #N` (§ PR & Git Hygiene) and
    `Reuse Check:` (§ Integration Coherence) trailers — referencing the clarify-gate answer or design approval that
    authorized the rewrite.
*   **Finding on gap (`V-SPEC-01`, `BLOCK`, repo-local — not yet in `blackhole-vcodes.md`, same
    disclaimer as § Decision Record Audit's `V-DECISION-01`)**: Detection true and no `Spec-Change-Approved:`
    trailer found — severity `BLOCK`, cite the story file's `file:line` of the edited
    criterion. This closes the spec-after-code failure mode: a worker rewrites acceptance
    criteria in the same PR that implements them, so review then verifies the code against a
    spec the code itself authored.
*   **Non-goal**: this gate requires no story-catalog config or `story_driven.enabled` flag
    (unlike the broader `V-STORY-01..04` proposal in
    `documentation/plans/story-driven-conformance.md`) — it fires on path convention and
    line-content matching alone.
