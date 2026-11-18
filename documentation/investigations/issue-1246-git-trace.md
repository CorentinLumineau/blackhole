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
  `git commit -m 'GIT_TRACE=/x'` and `echo "GIT_TRACE=/x"` stay allowed. Every `env` operand
  holding `=` before its command is an assignment too, so `env "A=1" "GIT_TRACE=/x" git` is read.
- Where the shell expects an assignment (a command word, or any operand after a declarer), the
  word's unquoted spans are decoded before `env` or `export` sees it: ANSI-C `$'...'` (`\xHH`, octal `\N` to
  `\NNN`, `\u`, `\U`, `\cX` and the one-letter escapes) and locale-quoted `$"..."`. As in bash,
  each `$'...'` span ends at its first NUL (`\x00`, `\0`, `\400`, `\c@`, `\u0000`, ...), so
  `$'GIT_TRACE=/x\x00/../wt/y'` names `/x`; the text after the span is kept (`a$'x\0y'b` is
  `axb`). The decoder matches bash's `printf %s $'...'` on every escape except a byte at or above
  0x80, which it decodes to that code point where bash emits the raw byte; no name character or
  path separator is spelled that way, so no verdict depends on it. The
  decoded name and value are then judged like any other assignment, so `env $'GIT_TRACE=/x' git`,
  `export $'GIT_TRAC\x45=/x'`, `export $'\107IT_TRACE=/x'`, `env $'GIT_TRACE=/x' git`,
  `export GIT_$'TRACE'=/x` and `export $"GIT_TRACE=/x"` all resolve to `GIT_TRACE=/x` and are
  compared against the root. A decoded `$` stays literal (`$'GIT_TRACE=$LOG'` is the text `$LOG`).
  Elsewhere (`echo $'GIT_TRACE=/x'`, `git commit -m $'GIT_TRACE=/x'`) the word is data. The
  decoder is `decodeAnsiC` / `decodeQuotedWord` in `shell-lexer.js`, shared with `commandName`.
  Inside double or single quotes bash leaves `$'...'` and `$"..."` as text, so
  `export "GIT_TRACE=/m/a$'\x2f..'"` names the literal file `a$'\x2f..'` under `/m`, and a
  literal trace value is compared as the exact name git opens, even when it holds a quote or a
  `$`. A value with a glob or brace character (`*`, `?`, `[`, `{`) is unresolvable, since `env`
  and `export` operands are expanded.
- An `env` option that takes a value (`-u`, `-C`, `-S`, `-a`, `--unset`, `--chdir`,
  `--split-string`, `--argv0`, also quoted, clustered as `-iu` or with `=`) consumes its value
  without ending the assignments, so `env --unset B "GIT_TRACE=/x" git` is read. Any other option
  word, including an abbreviated long option, fails closed (warn). A `-S` string is split on whitespace and read like `env`'s own operands only when it holds no
  quote (`'` or `"`), `$`, backtick or backslash, neither in the word as written nor in the text
  `env` receives; otherwise the whole command is unresolvable and warns, since the shell expands
  `$X` and `$(…)` and `env` itself processes quotes, `\_` and `${VAR}` in that string.
- A dynamic value (`$LOG`, `` `pwd` ``, `~/t`) is unresolvable and warns, as for the unquoted form.
- Values git ignores (`1`, `true`, `0`, `false`, `2`–`9`, relative paths) stay allowed.

Tests: `scripts/hooks-bash-write-options.test.ts`, section `GIT_TRACE* variables write files (#1246)`.

## Residual risks

- A trace variable set through `git -c`, a config include, or a shell function that exports it is
  not seen; `git -c` execution keys are covered separately.
- `env` is read fail-closed: an option word that is not an exact known spelling (getopt_long
  also accepts unambiguous abbreviations such as `--uns`) makes the command unresolvable and it
  warns. A `-S` string is split on whitespace and read like `env`'s own operands only when it holds no
  quote (`'` or `"`), `$`, backtick or backslash, neither in the word as written nor in the text
  `env` receives; otherwise the whole command is unresolvable and warns, since the shell expands
  `$X` and `$(…)` and `env` itself processes quotes, `\_` and `${VAR}` in that string.
- A trace name exported with no value (`printf -v GIT_TRACE …; export GIT_TRACE`) carries a
  value set elsewhere, and one spelled with a brace (`export GIT_TRACE{,}`) expands to names the
  scan cannot list, so either warns whatever the command runs (git may start in a subshell,
  `bash -c` or a command substitution). A command that turns on `set -a` / `set -o allexport`
  and mentions `GIT_TRACE` warns too, since a later `read` or `printf -v` exports the value; a
  `set -a` spelled dynamically, or one in an earlier command of the session, is not seen.
- `GIT_TRACE` assigned through `eval` or a variable (`export "$NAME=/x"`) is dynamic and not read.
