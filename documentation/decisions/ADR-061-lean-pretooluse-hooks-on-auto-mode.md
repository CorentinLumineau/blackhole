---
type: adr
summary: "PreToolUse guards are kept only where Claude Code auto mode cannot cover them (harnesses without auto mode, campaign state); the worktree-removal guard is removed, the shared shell scanner survives as shell-invocation-scan.js, and #1495 stays a separate fix"
status: accepted
review_trigger: "on adding a PreToolUse guard, on a harness gaining or losing a native auto mode, or on a fix round for the Bash write-target guard or the main-clone git guard"
created: 2026-11-24
last_updated: 2026-11-24
related:
  - templates/hooks/pretooluse/README.md
  - src/references/hook-schemas.md
  - src/references/recovery-protocol.md
  - documentation/decisions/ADR-029-bash-write-target-worktree-containment.md
  - documentation/decisions/ADR-043-main-clone-git-mutation-guard.md
  - documentation/decisions/ADR-047-hook-containment-scoped-to-campaign-workers.md
---

# ADR-061: Lean PreToolUse hooks on Claude Code auto mode

## Status

Accepted — 2026-11-24, owner direction on issue #1496 (supersedes the closed PR #1494).

## Context

The PreToolUse hooks grew to about 6.7k lines under `templates/hooks/pretooluse/`. Claude Code
auto mode now blocks by default and allows case by case, so generic safety no longer needs a
hook-side parser. The worktree-removal guard (1491 lines) showed the cost: it refused three safe
removals, because

1. a relative path was resolved against the shell cwd instead of the `git -C` target,
2. a branch pushed as `HEAD:main` was refused, since only `refs/remotes/origin/<same-name>` counted,
3. a configured upstream (`@{u}`) was ignored when it did not match the branch name.

Each fix would add more parsing to the code the owner wants smaller, and auto mode already prompts
before a destructive removal, so the guard added friction without catching a risk auto mode misses.

## Decision

Audit each guard against two questions: does auto mode cover it, and is it needed on a harness
with no auto mode (Cursor, Codex, Antigravity)?

| Guard | Auto mode covers it | Needed without auto mode | Verdict |
|---|---|---|---|
| Worktree-removal guard (`git worktree remove`, recursive `rm` of a worktree) | Yes, a removal prompt | Marginal: git refuses a dirty tree without `--force`, and the push-first rule stays as prose | **Removed** |
| Static destructive patterns (`bash-patterns.json`) | Partly | Yes, data only, no parser | Keep; revisit in follow-up B |
| Sensitive-file and system-path denial (`file-patterns.json`, `validate-file-changes.js`) | Yes | Yes, data driven | Keep |
| Campaign state-dir write guard and assigned-worktree containment (`validate-file-changes.js`, `bash-write-target-guard.js`) | No: auto mode cannot know `.blackhole/queue.json` and the ledger are state one bad write wipes | Yes | Keep (owner-named exception) |
| Main-clone git guard (`git-main-clone-guard.js`, campaign workers only) | Partly | Yes: a worker's `git clean` or `reset --hard` in the shared clone destroys other workers' work | Keep; revisit in follow-up B |
| Oversize and scan-budget refusals | No: the native wrapper fails open on its 5 s timeout | Yes | Keep, moved to `utils/oversize-command.js` |
| Sibling-plugin defer | n/a, not a safety guard | n/a | Keep |

`utils/worktree-removal-guard.js` doubled as the shell scanner the two surviving guards import
(`findRemovalInvocations`, `normalizeShellWord`, clause splitting). Deleting the file outright
would have broken them, so the scanner stays as `utils/shell-invocation-scan.js` and only the
evaluation half (the unpushed, detached, dirty and registration checks, about 700 lines of code
and its header prose) is removed. `findRemovalInvocations` still reports the `git worktree
remove` and `rm` shapes it detects; trimming that detection is follow-up B.

### Issue #1495

The `BLACKHOLE_SCRATCHPAD_DIR` case that switches the Bash write guard off concerns a guard this
ADR keeps. #1495 is therefore not closed by this ADR and keeps its own fix. A later trim of the
Bash write-target guard must keep the fallback #1495 asks for.

### Follow-ups

- A: trim the Bash write-target guard (1911 lines) to the state-dir and worktree-containment core.
- B: re-audit the main-clone guard and the static patterns after auto-mode behaviour is observed
  over a campaign; drop the removal-shape detection from `findRemovalInvocations`.
- C: fix #1495 in the guard that stays.

## Consequences

- A Cursor, Codex or Antigravity worker can remove a worktree holding unpushed commits. Accepted:
  git still refuses a dirty tree without `--force`, and `recovery-protocol.md` § 6(c) still tells
  the worker to push first.
- About 2,100 lines of removal-guard tests and about 1,400 lines of guard code go away. The
  pattern ids `worktree-remove-*` and `too-many-removal-targets` no longer exist.
- The unpushed-work rule is prose in `blackhole-protocol.md` and `recovery-protocol.md`; the
  hook-enforced wording is removed from both.
