---
type: plan
summary: "Plan for issue #1269 (rev 2): replace the bash-only printf %q in the SessionStart hook with a POSIX writer, warn on stderr when the export cannot be written, and test it under dash"
status: current
review_trigger: "on file change"
created: 2026-11-18
last_updated: 2026-11-18
---

# Plan: issue 1269 (rev 2) — SessionStart hook exports an empty BLACKHOLE_PLUGIN_ROOT under dash

## Objective
Root cause (investigation, confidence 92, `documentation/investigations/session-start-hook-exports-an-empty-blackhole-plugin-root-under-dash.md`): `SESSION_START_EXPORT_COMMAND` (`scripts/lib/build/claude-plugin-runtime.ts:17-19`) uses bash-only `printf %q`. Claude Code runs shell-form hooks via `sh -c` (dash on this Linux host). Dash prints `export BLACKHOLE_PLUGIN_ROOT=`, aborts on the invalid `%q` without the value or a newline, and the trailing `; exit 0` hides the error. Every session on this host exported the variable empty, and each repeat SessionStart appends another 29-byte prefix with no newline. `CLAUDE_PLUGIN_ROOT` IS set inside the hook; the desktop app is incidental. The rev-1 plan (loud `:?` fallback) is superseded: that treats the symptom and is now owned by #1328, after a fresh-session confirmation.

Fix: (A) a POSIX-sh writer in `SESSION_START_EXPORT_COMMAND`; (B) a stderr warning when `CLAUDE_ENV_FILE` or `CLAUDE_PLUGIN_ROOT` is missing; (C) a regression test that RUNS the command under `dash -c` and `sh -c`. `PLUGIN_ROOT_SHELL_EXPR` (`${BLACKHOLE_PLUGIN_ROOT:-.}`) stays unchanged (#1328). One PR, `Closes #1269`. Pareto: Gain 8, Effort 2, Priority 8 x 9 = 72 (>= 30). Version bump waived by the owner (V-PLUGIN-01).

## Codebase Conventions
- The command is a build-generated constant in `scripts/lib/build/claude-plugin-runtime.ts`, merged into `hooks/hooks.json` by `withSessionStartExport` (line ~99, which detects an existing entry by the substring `BLACKHOLE_PLUGIN_ROOT`, so keep that token in the command). Fix the constant, never the generated `plugins/blackhole-claude/hooks/hooks.json`.
- Tests: `bun:test`, `withTempDir` from `scripts/lib/test-fixtures.ts`, existing `describe('withSessionStartExport')` block in `claude-plugin-runtime.test.ts`. Spawn shells with `child_process.spawnSync` and an explicit minimal env (no inherited `BLACKHOLE_PLUGIN_ROOT`).
- Command must be strict POSIX sh: no `%q`, no `[[ ]]`, no `${var//}`, no `local`. `exit 0` always (a hook must never block the session).
- Comment discipline: one canonical comment at the constant explaining dash/`%q`; no issue numbers in source comments (V-DOC-06).
- Build outputs under all dist trees per `scripts/lib/build/targets.ts` are regenerated with `bun run build`, never hand-edited.

## Touch-Paths
- `scripts/lib/build/claude-plugin-runtime.ts` (`SESSION_START_EXPORT_COMMAND` only; optionally a one-sentence `PLUGIN_ROOT_NOTE` tweak is NOT needed)
- `scripts/lib/build/claude-plugin-runtime.test.ts` (new tests, red first)
- plus all generated dist trees per `scripts/lib/build/targets.ts` (the hooks.json carrying the command)
- Not touched: `PLUGIN_ROOT_SHELL_EXPR`, `src/references/status-page.md`, `templates/hooks/**`, `package.json` version, `scripts/consumer-promote-review.sh`.

## Documentation Impact
None — no doc describes the hook's printf; `PLUGIN_ROOT_NOTE` statement ("exports `$BLACKHOLE_PLUGIN_ROOT`") stays true. The investigation note ships under `documentation/investigations/` via the staging carry.

## Target command (POSIX, verified under dash)
```sh
[ -z "$BLACKHOLE_PLUGIN_ROOT" ] || exit 0
if [ -n "$CLAUDE_ENV_FILE" ] && [ -n "$CLAUDE_PLUGIN_ROOT" ]; then
  printf "\nexport BLACKHOLE_PLUGIN_ROOT='%s'\n" "$(printf %s "$CLAUDE_PLUGIN_ROOT" | sed "s/'/'\\\\''/g")" >> "$CLAUDE_ENV_FILE"
else
  echo "blackhole: cannot export BLACKHOLE_PLUGIN_ROOT (CLAUDE_ENV_FILE or CLAUDE_PLUGIN_ROOT unset); scripts will not resolve" >&2
fi
exit 0
```
(Single-line in the constant, `;`-joined.) The leading `\n` terminates a poisoned, newline-less 29-byte prefix left by older versions so the new line parses on its own. Single quotes with the `'\''` escape make space, `'`, `$` and backticks inert when bash sources the env file.

## Re-entry guard decision
Keep `[ -z "$BLACKHOLE_PLUGIN_ROOT" ]` unchanged. Its purpose is to respect a user-pinned value; it was never what stopped repeats. SessionStart refires on resume/compact within one session and appends a duplicate `export` line; duplicates are identical and harmless (last wins, same value). Under the old bug the guard re-appended garbage because the variable stayed empty; with a working writer each line is a valid, idempotent export. No tweak needed (a "grep before append" would add complexity for no behavioural gain, V-KISS-01).

## Task Steps
1. Red: in `claude-plugin-runtime.test.ts` add a helper `runHook(shell, env)` that spawns `<shell> -c SESSION_START_EXPORT_COMMAND` with a temp `CLAUDE_ENV_FILE` and returns `{status, stderr, envFile}`. Tests (for `dash` and `sh`; skip `dash` with an explicit `test.skipIf(!hasDash)` when absent): (a) `CLAUDE_PLUGIN_ROOT` set to each of `/plain/path`, `/with space/p`, `/it's/p`, `/d$ollar/p`, `` /back`tick`/p ``: exit 0, empty stderr, then `bash -c 'set -e; . envfile; printf %s "$BLACKHOLE_PLUGIN_ROOT"'` equals the exact path; (b) env file pre-seeded with the poisoned bytes `export BLACKHOLE_PLUGIN_ROOT=` (no newline) then hook run: sourcing yields the real path; (c) hook run twice: sourcing yields the path, file has two valid lines; (d) `CLAUDE_ENV_FILE` unset: exit 0, stderr contains `BLACKHOLE_PLUGIN_ROOT`, nothing written; same for `CLAUDE_PLUGIN_ROOT` unset; (e) `BLACKHOLE_PLUGIN_ROOT` pre-set: silent, nothing written. Run only this file; confirm (a)-(c) fail on the current `%q` command under dash.
2. Green: rewrite `SESSION_START_EXPORT_COMMAND` per the target command above with one canonical comment (dash has no `%q`; `sh -c` is the runner).
3. `bun run build` to regenerate dist trees; run only the touched test file and `claude-dist.check.ts` scoped through `with-test-lock`. CI runs the full suite.
4. PR body: `Closes #1269`; state root cause; state that the fix reaches installed plugins only at release (version-keyed cache, V-PLUGIN-01 waived by owner) and how to verify after reinstall and a fresh session: `cat "$CLAUDE_ENV_FILE"` (or `ls -l ~/.claude/session-env/*/sessionstart-hook-*.sh`) shows `export BLACKHOLE_PLUGIN_ROOT='/…/blackhole/<version>'`, a real path, and `echo "$BLACKHOLE_PLUGIN_ROOT"` in a Bash call prints it. Note follow-ups: #1328 owns fail-loud `:?`/`:-.` replacement.

## Acceptance Criteria
- **AC1**: `SESSION_START_EXPORT_COMMAND` contains no `%q` (`grep -c '%q' scripts/lib/build/claude-plugin-runtime.ts` returns 0; scope that file and `plugins/blackhole-claude/hooks/hooks.json`, no exemptions).
- **AC2**: for each of dash and sh and each of the five paths in step 1(a), running the command then sourcing the env file in bash reproduces `CLAUDE_PLUGIN_ROOT` byte-exactly; test fails red on the pre-fix command under dash.
- **AC3**: a poisoned pre-existing env file (`export BLACKHOLE_PLUGIN_ROOT=` without newline) followed by one hook run sources to the real path.
- **AC4**: with `CLAUDE_ENV_FILE` or `CLAUDE_PLUGIN_ROOT` unset, the command exits 0, writes nothing, and stderr is non-empty and names `BLACKHOLE_PLUGIN_ROOT`; with the variable pre-set it is silent and writes nothing.
- **AC5**: `claudePluginRuntimeErrors` still returns `[]` for the rebuilt bundle (`claude-dist.check.ts` green), `bun run build` leaves no dist drift, and the touched test file passes.
- **AC6**: `PLUGIN_ROOT_SHELL_EXPR` is byte-unchanged (`git diff` shows no change to that line).

## Test Strategy
Red first, behavioural: the test executes the real generated string in real shells (no mocking of the command), then verifies with an independent bash source. Offline, temp dirs only. Local: this one test file via `with-test-lock`; full suite is CI's job (ci-first-verification).

## Execution Strategy & Stop Conditions
- If the new command does not round-trip a path under dash, then stop and revise the quoting; do not fall back to `%q` or `"shell":"bash"` (the docs' `shell` default contradicts observation, so it is not relied on).
- If `dash` is unavailable on a runner, then the dash cases skip explicitly with a reason and the `sh` cases still run; if `sh` is also not dash there, report it in `order_note`.
- If `withSessionStartExport`'s existing-entry detection stops matching the new command, then abort and keep the `BLACKHOLE_PLUGIN_ROOT` token in the command.
- If any fix to `PLUGIN_ROOT_SHELL_EXPR` seems necessary, then stop; that is #1328's scope.
