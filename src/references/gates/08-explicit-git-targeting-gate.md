## Explicit Git Targeting Gate (unconditional, issue #516)

Applies to **every** execution mode and plan track — no branch skips it. The session's process
cwd can silently drift to a sibling worktree, and campaign branches can end up mis-tracked at
creation independent of any drift — see `phase-implement.md` § "Git operations must not depend
on inherited cwd" for the incident write-up and confirmed root cause. Every git command in this
session MUST name its target explicitly rather than trust the inherited cwd.

*   **`-C` on every git command**: `git -C <absolute worktree path> <cmd>` — the worktree path is
    the one the orchestrator passed at spawn time (`phase-implement.md` § "Plan artifact paths
    (worktree rule)" convention, and its new § "Git operations must not depend on inherited cwd"
    section). Never a bare `git <cmd>` that trusts the process cwd.
*   **Explicit refspec on push, never `-u`, never bare**: `git -C <path> push origin
    <branch>:<branch>`. A bare `git push` or `git push -u` risks setting or reading upstream
    tracking against whatever branch the (possibly wrong) cwd happens to be on — exactly the
    class of failure `phase-implement.md`'s incident write-up describes.
*   **Post-push verification (mandatory before `status: complete`)**: run `git -C <path>
    ls-remote origin refs/heads/<branch>` and compare its SHA against `git -C <path> rev-parse
    HEAD`. A mismatch means the push landed on the wrong branch or the wrong remote — stop, do
    not claim `status: complete`; return `status: blocked` instead and report the mismatch as a
    finding.
