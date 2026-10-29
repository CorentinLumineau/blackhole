---
section: Independent Security Verification Mode
vcodes: []
---
### Independent Security Verification Mode (`V-SEC-07`, issue #439)
Input contract: `review-core.md` § Reviewer prompt requirements ("Verification" row); the bullets
below are the procedure only.
*   **Detection**: the orchestrator's prompt identifies this dispatch as a verification
    spawn (`review-core.md` § Independent security verification) — a short list of
    already-flagged `V-SEC-*` findings from a **different**, prior `reviewer` instance's
    pass over the same PR, each stamped `{finding_id, vcode, severity, file, line,
    summary}`, plus an instruction to attempt to disprove each one. Not present for an
    ordinary full-audit or recheck-mode dispatch.
*   **Scope — narrower than any other dispatch mode**: this mode receives *only* the
    stamped finding list, never the full PR diff and never the primary spawn's own
    reasoning trace. Do not read the PR diff, do not run the full core audit checklist, and do
    not report on anything outside the stamped findings — this is re-verification of a short,
    already-scoped list, not a second full audit.
*   **Process independence**: judge each stamped finding on its own evidence — attempt to
    reproduce or refute the attack scenario described in its `summary`. Do not assume the
    primary reviewer's severity or reasoning is correct merely because it was reported;
    this mode exists for a second, unprejudiced look.
*   **Verdict per finding**: for each stamped finding, emit one `verification[]` entry
    (`worker-schemas.md` § Reviewer) — `finding_id` (echoed verbatim from the stamped
    input), `verdict` (`confirmed` if the exploit path is reproducible or otherwise
    substantiated, `refuted` if it is not demonstrable), and `evidence` (a concrete
    pointer — what was checked and why it did or did not hold, not a restatement of the
    original summary). This is a **sibling** array to `recheck[]` (§ Recheck-Mode Compliance), never
    a reuse of it: `recheck[]` verifies a fix against a *prior, ledgered* finding; `verification[]`
    verifies a *fresh, same-pass* finding.
*   **New findings (rare)**: if this narrow scan surfaces a genuinely new issue not among
    the stamped findings, report it via the ordinary `findings[]` array with a normal
    V-code/severity — do not fold it into a `verification[]` entry. Expected to be rare.
*   **Composition**: `verification[]` entries are not subject to § Confidence-Based Finding
    Filtering & Consolidation or § Suggestion Proportionality Gate — those gates govern
    *findings* the reviewer originates, not verdicts on someone else's findings. Any `findings[]`
    entry from the "New findings" bullet still passes through both gates unchanged.
