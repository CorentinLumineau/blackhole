---
section: Runtime Proof Audit
vcodes: [V-PROOF-01]
---
### Runtime Proof Audit (`V-PROOF-01`)
*   **Entry condition**: the PR diff is a user-visible change per
    `gates/14-visual-evidence-capture.md` § Runtime Proof. Independent of `display_targets` and of
    UI detection. Not user-visible — emit no finding.
*   **Missing section (`BLOCK`)**: the PR body has no `## Proof` section.
*   **Generic reason (`BLOCK`)**: the section carries neither commands run with pass/fail, nor an
    `unavailable: <reason>` naming a concrete, checkable cause. A generic reason (`n/a`, `none`,
    `unavailable`, empty) is the same finding.
*   **Concrete reason**: an `unavailable:` reason that names a checkable cause satisfies the check
    but is quoted in the review output — never silently passed.
