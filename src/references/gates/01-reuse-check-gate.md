## Reuse Check Gate (unconditional)

Applies to **every** execution mode and plan track — the proactive V-INT-02 counterpart to the
reviewer's reactive audit. Shifts reuse enforcement left: catch a re-implementation *before* the
duplicate code is written, not after the PR is opened.

*   **Pre-write search (unconditional) — two named sub-searches**: before writing any code, run
    both. No code path skips either — same "no bypass" shape as the Bugfix Gate's Root-Cause
    Verification and the docs-only Drift-Check gate.
    - **Existence search** — **repo-wide, result-capped**. Fires only when you are about to
      introduce a **new** utility, helper, or abstraction (not when editing existing code): does
      an implementation of this concern exist *anywhere* in the repo, not just near the plan's
      Touch-Paths?
    - **Convention search** — the plan's declared **Touch-Paths** (from the injected
      `<PLAN_CONTEXT>`) and their immediate neighbourhood, unchanged: what is the established
      *local* idiom here?
*   **Rule-of-three**: when the existence search surfaces **3 or more** bespoke occurrences of
    the same concern, extraction is the correct action but is out of scope for the current issue
    (`V-SCOPE-01/02`). Reuse the closest match **and** emit a `new_findings[]` extraction entry
    with estimated `gain`/`effort` (per step 7's Continuous Discovery convention), triaged
    through the existing Pareto ≥ 30 filing path — never dropped, never silently absorbed.
*   **Reuse Check artifact**: record a one-line entry in the PR description, recording aperture
    and hit count so the claim is falsifiable — one of three forms:
    - `Reuse Check: reusing <name> (<file:line>)` — an existing utility is adopted (1-2 hits).
    - `Reuse Check: none found — first occurrence of <concern> (repo-wide)` — the existence
      search came up genuinely empty.
    - `Reuse Check: <N> bespoke occurrences of <concern> — reusing <closest>, extraction filed`
      — the rule-of-three threshold fired (3+ hits).
    The entry is produced even when nothing is found (the negative result is the audit trail).
    Also append this entry as a `decision_records[]` row with `kind: "reuse"` in the return
    JSON — see `implementer-schemas.md` § `decision_records[]` for the row shape.
*   **On overlap ambiguity**: if a search surfaces a candidate that overlaps but does not cleanly
    fit (different signature/behaviour needed), do not silently duplicate logic nor force an
    ill-fitting reuse — stop and report per the plan's Stop Conditions.

---
