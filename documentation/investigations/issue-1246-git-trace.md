---
type: research
summary: "GIT_TRACE* assignments that are quoted, quote their name or use += were not read as write targets; root cause, fix and residual risks"
status: current
created: 2026-11-18
last_updated: 2026-11-18
review_trigger: "on file change"
issue: 1246
---

# Issue #1246: `GIT_TRACE*` variables write files

## Bypass class

Git appends a trace to the file a `GIT_TRACE*` variable names (`GIT_TRACE`, `GIT_TRACE_PACKET`,
`GIT_TRACE2_EVENT`, …) when the value is an absolute path. `GIT_TRACE=<main-clone>/x git status`
writes into the main clone from a worktree, so it must be checked like any other write target.
Three spellings of the same assignment were still missed:

- `env "GIT_TRACE=<main>/x" git status` and `export "GIT_TRACE=<main>/x"`: the whole assignment
  is quoted, so the word starts with a quote and the name pattern never matched.
- `env 'GIT_TRACE'=<main>/x git status`: the variable name is quoted.
- `GIT_TRACE+=<main>/x git status` and `export GIT_TRACE+=…`: the `+=` form.

## Root cause

`findGitTraceTargets` matched `^GIT_TRACE\w*=` against the raw token. A quoted word and the `+=`
operator never matched it.

## Fix

- The token is dequoted with `normalizeShellWord` before the match, and the pattern accepts `+=`.
- A word that starts with a quote counts as an assignment only where the shell expects one: a
  command word (`env "GIT_TRACE=/x" git`, also behind `sudo env` and `env -i`) or an operand of
  `export`/`declare`/`typeset`/`local`/`readonly`. Once one of those opens a clause, every later
  operand is scanned, so a bare name before it (`export FOO "GIT_TRACE=/x"`) does not end the scan.
  A quoted word elsewhere is data, so
  `git commit -m 'GIT_TRACE=/x'` and `echo "GIT_TRACE=/x"` stay allowed.
- An ANSI-C `$'...'` word is not decoded. Where the shell expects an assignment (a command word, or
  any operand after a declarer), one that still names `GIT_TRACE` once its quotes are dropped warns:
  `env $'GIT_TRACE=/x' git`, `export A $'GIT_TRACE=/x'`, `env $'GIT_TRACE'=/x git`,
  `export GIT_$'TRACE'=/x`. Fail closed by design: decoding `$'\x2f...'` is not attempted, so the
  path is never compared against the root. Elsewhere (`echo $'GIT_TRACE=/x'`) the word is data.
- A dynamic value (`$LOG`, `` `pwd` ``, `~/t`) is unresolvable and warns, as for the unquoted form.
- Values git ignores (`1`, `true`, `0`, `false`, `2`–`9`, relative paths) stay allowed.

Tests: `scripts/hooks-bash-write-options.test.ts`, section `GIT_TRACE* variables write files (#1246)`.

## Residual risks

- A trace variable set through `git -c`, a config include, or a shell function that exports it is
  not seen; `git -c` execution keys are covered separately.
- `env -S 'GIT_TRACE=/x git status'` hides the assignment inside one quoted string.
- `GIT_TRACE` assigned through `eval` or a variable (`export "$NAME=/x"`) is dynamic and not read.
