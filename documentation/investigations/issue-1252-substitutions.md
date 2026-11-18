---
type: research
summary: "A backslash-newline between a substitution opener and its parenthesis hid the body from the write-target guard; root cause, fix and residual risks"
status: current
created: 2026-11-18
last_updated: 2026-11-18
review_trigger: "on file change"
issue: 1252
---

# Issue #1252: writes inside command and process substitutions

## Bypass class

The commands inside `$(…)`, backticks, `<(…)` and `>(…)` run, so a write in one of them is a write
of the whole command: `echo "$(sed -i s/a/b/ <main>/x)"`. The guard scans each substitution body
as its own clause set. One spelling still hid the opener:

- `echo $\<newline>(cp a <main>/x)`: the shell removes a backslash-newline before it reads the
  opener, so `$\<newline>(` is `$(`. The scanner saw a `$` followed by a backslash, copied both
  and never opened the body, so the `cp` went unchecked. `<\<newline>(` and `>\<newline>(` behave
  the same.

## Root cause

`extractSubstitutions` tested the character right after `$`, `<` or `>` for `(`. A line
continuation between the two characters broke that adjacency.

## Fix

`extractSubstitutions` skips any run of backslash-newline pairs after the `$`, `<` or `>` before it
looks for the `(`. Each `$` scans its own run once, so the pass stays linear. The scan is local to
substitution openers on purpose: removing every backslash-newline from the command up front would
also join a heredoc body line to its terminator (`cat <<'EOF'` with a body line ending in `\`) and
hide the clauses after it.

Tests: `scripts/hooks-bash-write-substitutions.test.ts` (each form is denied into the main clone,
allowed into the worktree, and a continuation that opens nothing stays allowed).

## Quote-masking is decided once for the whole command

A substitution body runs in the outer shell, so it inherits the outer `PATH`, `BASH_CMDS` and
functions. `maskRedirectNoise` blanks quoted spans (`grep 'a>b'`) only when nothing can rebind what
a bare `grep` runs, and #1249 decided that per command. Scanning each body as its own command
dropped the outer clauses from that decision: `unset PATH; echo $(grep '<payload>')` was masked
inside the body and returned no verdict, although it blocks on `main`.

`evaluateBashWriteTargets` now computes `maskingAllowed` (no `SHELL_EXEC_RE` or
`QUOTE_REINTERPRETING_RE` hit, every clause passive) for the outer text and every body, and masks
only when all of them pass. `unset PATH; echo $(grep …)`, `PATH=.; echo "$(grep …)"`,
`BASH_CMDS[grep]=./g; cat <(grep …)`, `grep() { eval "$1"; }; echo $(grep …)` and
`echo $(cd <main> && echo hi > f)` block again; `echo $(unset PATH; grep …)` still blocks. The 30
`REBINDING_ROWS` (now shared from `scripts/lib/test-fixtures.ts`) run wrapped in `$(…)`, backticks,
`"$(…)"` and `<(…)`, and with the rebinding outside each form. Cost: a command whose outer clauses
are not all passive filters (`echo $(grep 'a>b' f)`, since `echo` is not on the passive list) keeps
the pre-#1252 behaviour and reads a quoted `>` inside the body as a redirect (a warn or block, as
on `main`).

## Residual risks

- A line continuation elsewhere (inside a command word, or between a command and its operands) is
  not joined by this scan. The probes tried (`c\<newline>p a /etc/x`, `cp a \<newline>/etc/x`) were
  still denied, but joining continuations everywhere was not designed or tested here.
- Backtick bodies and the unclosed-body fallback keep the continuation characters as written.
