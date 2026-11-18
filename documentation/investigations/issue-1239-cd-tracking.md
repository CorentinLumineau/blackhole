---
type: research
summary: "A cd earlier in a command (or env -C DIR) moved the base of relative write targets with no verdict; root cause, fix and residual risks"
status: current
created: 2026-11-18
last_updated: 2026-11-18
review_trigger: "on file change"
issue: 1239
---

# Issue #1239: a preceding `cd` moves the base of relative write targets

## Bypass class

A relative write target is resolved against the directory the shell stands in when the write runs.
`cd <main-clone> && echo x > f` or `cd <main-clone> && git format-patch -1` wrote into the main
clone from a worktree with no verdict, because every target was resolved against the hook's `cwd`.

## Root cause

Targets were resolved against the session `cwd` only. Nothing tracked a directory change made
earlier in the same command, and nothing tracked the directory a wrapper such as `env -C DIR`
starts its command in.

## Fix

- `collectWriteSignals` walks the clauses in order and tracks the candidate directories (`dirs`)
  and an `unknown` flag. A `cd`, `pushd` or `popd` that surely runs replaces the base; one that may
  not run (after `||`, inside a compound command or function, in a pipeline or background job)
  only adds a candidate. A target that cannot be read statically makes the base `unknown`, so a
  later relative target warns.
- `CDPATH=` in the command makes a relative non-`.` target unresolvable.
- `envChdirBase` reads `env -C DIR`, `env -CDIR`, `env --chdir=DIR` and `--chdir DIR` (skipping
  `-u NAME` and `NAME=value` words) and resolves that clause's relative targets against DIR. A
  redirect on the same clause is opened by the shell before `env` runs, so it keeps the shell's base.

Tests: `scripts/hooks-bash-write-cd.test.ts`.

## Residual risks

- A directory change made through anything else (`exec -a`, `chroot`, `nsenter`, `make -C`,
  `git -C` outside the cases already covered) is not tracked.
- `env -S 'string'` splits a string into arguments; its `-C` is not read.
- `cd` through a variable, `~`, `-` or a glob stays unresolvable and warns instead of blocking.
