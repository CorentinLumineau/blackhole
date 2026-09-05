## Bugfix Gate

`task_type: bugfix` on any plan (stamped by `planner.md` § Quick Track's or § Standard Track's
Bugfix classification bullet) activates this gate — x-fix parity. When the plan frontmatter does
not carry `task_type: bugfix`, this subsection does not apply; step 3's default TDD mandate is
unchanged.
Scout Check (above) and step 7's Continuous Discovery are unconditional and apply the same
whether or not this gate is active.

*   **Root-Cause Verification gate (unconditional)**: before the first edit, produce a short
    Decision Record (Root cause identified / Alternatives considered / Why this fix), recorded in
    the PR description. No code path skips this when `task_type: bugfix` is present — same
    "no bypass" shape as `planner.md`'s Design Track `needs_design` gate. Also append this
    Decision Record as a `decision_records[]` row with `kind: "root-cause"` in the return JSON —
    see `implementer-schemas.md` § `decision_records[]` for the row shape.
*   **Escalation triggers**: after 2 distinct failed fix attempts within the session (a fix
    applied, tests still failing, tried again, tests still failing) — stop; do not attempt a third
    approach. Return `status: blocked`, `escalation_trigger: "failed_attempts"`. If the fix has
    touched (or would need to touch) 3+ files beyond the plan's declared Touch-Paths — stop.
    Return `status: blocked`, `escalation_trigger: "touch_paths_overrun"`.
*   **Scout Check**: see the canonical Scout Check section above — unconditional for every
    execution mode and plan track, not specific to this gate; applies here exactly as it applies
    after any other successful implementation.

---
