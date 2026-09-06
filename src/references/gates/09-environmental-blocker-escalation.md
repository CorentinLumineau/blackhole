## Environmental Blocker Escalation (unconditional, issue #763)

Applies to **every** execution mode and plan track, not gated on `task_type: bugfix` — contrast
with the Bugfix Gate's `failed_attempts`/`touch_paths_overrun`, which are `task_type:
bugfix`-scoped.

*   **Trigger**: a delivery-boundary command (the push covered by the Explicit Git Targeting
    Gate above, PR creation, or a required dependency install) fails on a network/DNS/forge/
    registry-unavailability error — not a test failure, not a merge conflict, not a lint/type
    error, and not the Explicit Git Targeting Gate's own SHA-mismatch case (that stays a
    wrong-branch finding, unrelated to this trigger).
*   **Return**: `status: blocked`, `escalation_trigger: "environmental_blocker"`, optional
    `blocked_step` naming the failed step in a few words (`"git push"`, `"gh pr create"`,
    `"bun install"`).
*   **Never conflate with `failed_attempts`**: `failed_attempts` means the fix itself is still
    wrong after repeated attempts and belongs to a root-cause investigation;
    `environmental_blocker` means the fix is already right and verified, only its delivery is
    blocked — using the wrong one misroutes a finished PR into a root-cause investigator spawn
    with nothing to investigate.
