## Scout Check (unconditional)

Applies to **every** execution mode and plan track — leave the code you touch better than you
found it, bounded strictly by the diff boundary (`V-SCOPE-01`). This is the single canonical
statement of Scout Check; the Bugfix Gate below only points here, it does not restate it.

*   After a successful implementation or fix, apply **one** in-scope improvement to
    already-touched code (naming, error handling, a stale comment, a dead import) and record it
    as an Improvement Record in the PR description — never deferred to `new_findings` (step 7's
    Continuous Discovery is for *unrelated* code the diff does not otherwise touch, not a
    substitute for this).
*   If the touched code is already clean, record "no improvement needed — code already clean" —
    the reviewer verifies the entry's presence, not a forced change.
*   Also append this Improvement Record as a `decision_records[]` row with `kind: "improvement"`
    in the return JSON — see `implementer-schemas.md` § `decision_records[]` for the row shape.
*   The diff boundary (`V-SCOPE-01`) — not the execution mode or `task_type` — is the sole
    discriminator between this section and step 7's Continuous Discovery.

---
