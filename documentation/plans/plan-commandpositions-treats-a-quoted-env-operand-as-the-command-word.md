---
type: plan
summary: "Make commandPositions skip every env operand that contains an equals sign (quoted or not) so the real command word after env is checked, and pin that a quoted NAME=VALUE at top-level command position is not an assignment"
status: current
review_trigger: "on file change"
created: 2026-11-18
last_updated: 2026-11-18
---

# Plan: commandPositions treats a quoted env operand as the command word (issue #1295)

## Objective
`commandPositions` (`templates/hooks/pretooluse/utils/bash-write-target-guard.js`, ~line 213 at the base) returns the quoted operand of `env "A=1" 'tee' <main>/x` as the command word, so `tee` is never seen as a command position and the write into the main clone gets no verdict. After the fix the `env` operand run is skipped and `tee` is checked.

## Base (stacked)
Stacks on PR #1258 head `blackhole/issue-1252-substitutions` (fd60d0f6), which carries #1257's round-10 guard rewrite. Both PRs wait on owner decision PD-2; the owner's stacking exception covers a dependent on a PR waiting for the owner. The PR targets that branch, not main. If #1258 rebases, rebase this branch onto it.

## Root cause (V-FIX-01)
The loop in `commandPositions` skips leading assignments with `/^[A-Za-z_]\w*=/` on the RAW token. That is right for the shell (bash does not read a quoted word in command position as an assignment: `"A=1" true` is "command not found"), but `env` is a program that reads `NAME=VALUE` from its argv AFTER quote removal, so inside `env` any operand containing `=` is an assignment, quoted or not. The function applies the shell's rule to `env`'s operands.

## Design decisions (80/20)
- **Change only `commandPositions`.** Track the name of the prefix word just consumed. When it is `env`, after its options, skip operands (raw text not starting with `-`) whose raw text contains `=`, until the first operand without `=`: that is env's command word. A literal `=` in the raw token survives quote removal and expansion, so the raw test is exact for `"A=1"`, `'A=1'`, `A="1"`, `"A"=1`; a spelling with no literal `=` (`$'\x3d'`) is not skipped, so it stays a command position (stricter, never hides a command).
- **Top-level rule stays as is.** A quoted `"A=1"` at the clause start does not match the raw regexp, so it already counts as the command word. Add a test row pinning that, so no later "unquote assignments" change regresses it.
- **Same rule as #1257's `findGitTraceTargets`** (issue statement): env operand with `=` is a slot; no second divergent rule in the file for the same concern (V-INT-04). Do not refactor `findGitTraceTargets` onto the new code (V-SCOPE-01).
- **Option parsing unchanged**: env options (`-u NAME`, `-C dir`) keep using `PREFIX_VALUE_OPTIONS`; the new skip runs only after them, mirroring env's own getopt (options end at the first non-option).
- **Not touched**: other wrappers. `sudo "A=1" cmd` has the same shape (sudo reads NAME=VALUE operands); file it as a separate issue, outside this plan's scope.

## F-00643 interaction (open BLOCK on #1257: trace-scan command positions on raw tokens)
F-00643 is a different defect: a leading redirect (`</dev/null export GIT_TRACE=/x`) or a split `$(` prefix puts a non-command token at index 0, so `commandPositions` anchors on that token and `env`/declarer is never a position. This change adds an env-operand skip after `env`; it does not touch how the first command word is found, so it covers F-00643 **none**. Leading-redirect skipping would be a 3-line addition in the same loop but changes the start-of-clause rule for every finder, belongs to #1257/#1258's own fix, and would conflict with it on the stacked base. Left out; the implementer must not claim it.

## Touch-Paths
- `templates/hooks/pretooluse/utils/bash-write-target-guard.js` (`commandPositions` only)
- `scripts/hooks-bash-write-escapes.test.ts` (new verdict rows; the implementer may use the sibling `scripts/hooks-bash-write-options.test.ts` if its table fits the env rows better)
- plus all generated dist trees per `scripts/lib/build/targets.ts`

No version bump (owner waived V-PLUGIN-01 for this change). No documentation change: `blackhole-protocol.md` § Recursive `rm` describes parsing limits of the worktree-removal guard, a different file.

## Documentation Impact
None - internal parsing fix of a hook guard; no public interface, config key or documented behavior changes.

## Task Steps (red first)
1. Tests first (verdict rows, `[label, (m) => command]` shape used in the sibling files, each asserting a deny verdict for a write into the main clone `m`): `env "A=1" 'tee' <m>/x`, `env 'A=1' tee <m>/x`, `env A="1" tee <m>/x`, `env "A=1" "B=2" tee <m>/x`, `env -u X "A=1" tee <m>/x`, `sudo env "A=1" tee <m>/x`, `env A=1 "B=2" cp a <m>/b`. Allow/no-regression rows: `env "A=1" true`, `"A=1" tee <m>/x` is NOT read as an assignment (command word is `"A=1"`, so no `tee` position: assert the guard's existing verdict, null), and an existing unquoted `env A=1 tee <m>/x` still denies. Run the focused spec once, confirm the new deny rows red.
2. Edit `commandPositions`: track the consumed prefix name; after the option loop, when it was `env`, advance past raw tokens containing `=` that do not start with `-`. Keep the existing leading-assignment loop untouched.
3. `bun run build`; commit source, tests and regenerated output together; push to a branch based on `blackhole/issue-1252-substitutions`; open the PR against that branch with `Closes #1295`.

## Task Breakdown / Acceptance Criteria
- T1 deny rows - **AC**: the seven deny rows above fail on fd60d0f6 and pass after T2 (`bun test scripts/hooks-bash-write-escapes.test.ts`, one focused run via with-test-lock); each returns a deny verdict naming the write target.
- T2 no regression - **AC**: `env "A=1" true` and `"A=1" tee <m>/x` return the same verdict (null) before and after; every existing row in `scripts/hooks-bash-write-*.test.ts` stays green (CI `bun run verify`).
- T3 scope - **AC**: `git diff --stat origin/blackhole/issue-1252-substitutions...HEAD` lists only the Touch-Paths and generated trees; the diff of `bash-write-target-guard.js` is confined to `commandPositions`.
- T4 build - **AC**: `bun run build` exits 0 and `bun run verify` finds no stale generated tree.

## Test Strategy
TDD, red first, behavior through the guard's public verdict entry (the same one the sibling verdict tables call), never the private `commandPositions`. Local: only the one focused spec; full suite and verify run in CI.

## Stop conditions
- If a new deny row stays green on fd60d0f6, stop: the row does not exercise `commandPositions`; fix the row first.
- If the fix needs a change outside `commandPositions` (including leading-redirect handling), stop and record it against F-00643 / #1257 instead of widening this PR.
- If #1258 changes `commandPositions` before this lands, rebase and re-run the red rows before continuing.

## Track / Classification
Quick; `task_type: bugfix`; `route.security_review_required: true` (R-00102). Threat screen: touches the write-containment guard, no auth, no user data, no endpoint added; STRIDE-lite answers: auth/authz no, user data no, endpoint no.

## Pareto
Gain 4, Effort 3, Priority = 4 x 8 = 32 (>= 30). V-SEC-02.
