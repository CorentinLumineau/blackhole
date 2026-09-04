---
type: plan
summary: "Adds throwing/warn-only git-status checks to test-fixtures.ts so a failed setup step names itself instead of surfacing as a downstream assertion failure"
status: current
review_trigger: "on file change"
created: 2026-09-03
last_updated: 2026-09-03
---

# Plan - Issue #756

## Objective
`scripts/lib/test-fixtures.ts` shells out to `git` via `spawnSync` at 11 call sites across
`withTempGitRepo`, `withLinkedWorktree`, and `withRemoteTrackedWorktree`, and never inspects
`status` or `error` on any of them. When a git step fails (as it did in CI for #747 — "Author
identity unknown" on `git commit --allow-empty`), the fixture proceeds against a repo that isn't
in the state the test believes, and the real cause surfaces as an unrelated downstream assertion
failure (or a raw `ENOENT` from `fs.realpathSync` on a worktree that was never created). Add one
shared, throwing status/error check for setup/action calls and one shared, non-throwing
warn-only check for cleanup calls in `finally` blocks, and route all 11 call sites through one
or the other.

**Scope correction (verified against the issue body, not assumed exhaustive)**: the issue's
Summary names only `withTempGitRepo` (1 call) and `withLinkedWorktree` (3 calls) — 4 sites. Grep
of the file shows a third fixture, `withRemoteTrackedWorktree` (lines 187-219), with **7 more**
unchecked `spawnSync` calls (bare-remote init, remote add, initial push, worktree add with
`-b`, the `push()` closure invoked from test bodies, and its own `finally` worktree-remove). The
issue's own AC #1 ("**every** `spawnSync` git call... checks the result") already covers these by
its literal wording, so this plan treats all 11 as in scope — not just the 4 named as examples.

## Touch-Paths
- `scripts/lib/test-fixtures.ts` — add `runGit` (throwing) and `warnGitCleanup` (non-throwing)
  helpers; route all 11 `spawnSync('git', ...)` call sites through one of the two
- `scripts/lib/test-fixtures.test.ts` — add the 3 new tests described below (this is the issue's
  own "its test" scope; `hooks-validate-bash.test.ts` / `hooks-validate-file.test.ts` are
  explicitly Out of scope per the issue body and are read-only regression surfaces here)

## Codebase Conventions
| Convention | Where established | How this plan follows it |
|---|---|---|
| `runGit(cwd, args): void` — `spawnSync('git', args, { cwd })`, throw `` `git ${args.join(' ')} failed in ${cwd}: ${stderr}` `` on `status !== 0` | `scripts/hooks-validate-bash.test.ts:726-736` (pre-existing, used by its own worktree-removal-guard regression tests since #532) | Reuse the identical helper name, signature shape, and message wording (V-INT-01) for the new `runGit` in `test-fixtures.ts` — this is not a new pattern, it is the established one, previously undiscovered by `test-fixtures.ts`'s own call sites. Two deltas, both required by issue AC #2 and #4 and absent from the existing local copy: (a) pass `encoding: 'utf-8'` so `stderr` is a string, and (b) check `result.error` first (spawn-itself failure) before checking `status` |
| Fixture helpers live in `scripts/lib/test-fixtures.ts` | File header comment, `scripts/lib/test-fixtures.ts:21-23` | New helpers are exported from the same file, alongside the fixtures that use them |

## Execution Strategy & Stop Conditions
- All 59 existing call sites of `withTempGitRepo`/`withLinkedWorktree`/`withRemoteTrackedWorktree`
  across `hooks-validate-bash.test.ts` and `hooks-validate-file.test.ts` were checked: none has an
  assertion or comment that depends on a git setup step failing silently. If a *new* failure
  surfaces in either file after this change lands, do not loosen the check — diagnose the git
  cause and fix the actual environment/test problem.
- Cleanup calls (`git worktree remove --force` in both `finally` blocks) MUST use
  `warnGitCleanup`, never `runGit` — throwing from a `finally` block replaces any real in-flight
  test failure with the cleanup failure, hiding the actual cause.

## Task Breakdown
- [ ] TDD Baseline Verification — full suite green before any edit.
- [ ] Direct helper coverage — `runGit` throws on non-zero status (non-repo cwd) and on spawn
  error (nonexistent cwd), naming the git subcommand in both messages.
- [ ] Discriminating mutation-check — `withLinkedWorktree` under a sandboxed, identity-less git
  environment fails against current `main` with a downstream `ENOENT`, and passes post-fix with
  an immediate `git commit`-attributed rejection.
- [ ] Implement — add `runGit`/`warnGitCleanup`, route all 11 call sites through one or the
  other; zero unchecked `spawnSync('git', ...)` calls remain.
- [ ] Verify Integrity — full suite + lint/typecheck green, including all 59 pre-existing
  fixture-consumer call sites.

## Sprint Contract
Baseline verified green; `runGit`/`warnGitCleanup` cover all 11 git call sites; the
mutation-check test fails pre-fix and passes post-fix; full suite + `bun run verify` green
post-change with no regression across the 59 pre-existing call sites.
