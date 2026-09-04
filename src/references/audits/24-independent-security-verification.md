---
section: Independent Security Verification Mode
vcodes: []
---
### Independent Security Verification Mode (`V-SEC-07`, issue #439)
Inputs for this mode: `review-core.md` § Reviewer prompt requirements (per-mode table,
"Verification" row) — the bullets below are this mode's *procedure*, not a restatement of its
*input contract*.
*   **Detection**: the orchestrator's prompt identifies this dispatch as a verification
    spawn (`review-core.md` § Independent security verification) — a short list of
    already-flagged `V-SEC-*` findings from a **different**, prior `reviewer` instance's
    pass over the same PR, each stamped `{finding_id, vcode, severity, file, line,
    summary}`, plus an instruction to attempt to disprove each one. Not present for an
    ordinary full-audit or recheck-mode dispatch.
*   **Scope — narrower than any other dispatch mode**: this mode receives *only* the
    stamped finding list, never the full PR diff and never the primary spawn's own
    reasoning trace. Do not read the PR diff, do not run §§1–23's full checklist, and do
    not report on anything outside the stamped findings — this is independent
    re-verification of a short, already-scoped list, not a second full audit (that
    broader shape is Option C/D/E in the design this mode implements, deliberately not
    chosen — `.blackhole/plans/issue-439-design.md` § 3).
*   **Process independence**: judge each stamped finding on its own evidence — attempt to
    reproduce or refute the attack scenario described in its `summary`. Do not assume the
    primary reviewer's severity or reasoning is correct merely because it was reported;
    the entire point of this mode is a second, unprejudiced look.
*   **Verdict per finding**: for each stamped finding, emit one `verification[]` entry
    (`worker-schemas.md` § Reviewer) — `finding_id` (echoed verbatim from the stamped
    input), `verdict` (`confirmed` if the exploit path is reproducible or otherwise
    substantiated, `refuted` if it is not demonstrable), and `evidence` (a concrete
    pointer — what was checked and why it did or did not hold, not a restatement of the
    original summary). This is a **sibling** array to `recheck[]` (§ 13), never a reuse of
    it — `recheck[]` verifies whether a fix commit resolved a *prior, ledgered* finding;
    `verification[]` verifies whether a *fresh, same-pass* finding independently holds up.
*   **New findings (rare)**: if this narrow scan surfaces a genuinely new issue not among
    the stamped findings, report it via the ordinary `findings[]` array with a normal
    V-code/severity — do not fold it into a `verification[]` entry. This is expected to be
    rare; the mode's primary job is judging the stamped list, not discovering new ones.
*   **Composition**: `verification[]` entries are not subject to § 11 (confidence bands)
    or § 12 (proportionality) — those gates govern *findings* the reviewer originates, not
    verdicts on findings someone else already reported. Any `findings[]` entry emitted
    under the "New findings" bullet above still passes through §§11–12 unchanged.
