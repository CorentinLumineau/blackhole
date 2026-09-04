## Plan Drift Check (conditional)

When the plan frontmatter carries `plan_base_commit`, before opening the PR:

*   Read `plan_base_commit` from the plan YAML frontmatter.
*   For each declared Touch-Path glob, run `git -C <main-clone> diff --name-only
    <plan_base_commit>..HEAD -- <pathspec>` using git pathspec rules — directory paths with a
    trailing `/` for directories.
*   If any Touch-Path file changed on `main` since the plan was stamped, emit a `Plan Drift
    Check:` PR-body line listing the drifted paths and recommend a planner re-run.
*   **Advisory WARN only** — never return `status: blocked` on drift alone.

---
