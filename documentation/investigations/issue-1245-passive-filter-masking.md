---
type: analysis
summary: "Investigation for issue #1245: quoted-span masking in bash-write-target-guard let any earlier statement that rebinds a bare grep/rg/sed word hide a redirect write outside the worktree; masking now requires every clause to be an inert or passive filter"
status: current
created: 2026-11-18
last_updated: 2026-11-18
review_trigger: "on file change"
issue: 1245
---

# Issue #1245: passive-filter masking bypass

## Bypass class

`maskRedirectNoise` blanks quoted spans inside an inert `grep`/`rg`/`sed` clause so that
`grep 'a>b' f` is not read as a redirect. The mask trusted that the bare command word still meant
the real filter. Any earlier statement in the same command that rebinds the word (`unset PATH`,
`BASH_CMDS[grep]=...`, `printf -v PATH`, `read`/`mapfile`/`readarray PATH`, `declare -n`, `shopt` +
`BASH_ALIASES`, `cd sub &&`, `exec 3>f`, `let`, `. ./env`, `set -f`, `sort -o f x;`, `cat x > f;`)
makes the quoted payload (`cat > <main-clone>/x ; true`) executable. The guard had masked it and
returned `null` (allow) for 19 such forms at base `541b5beb`.

## Root cause

A denylist (`COMMAND_REBINDING_RE`) enumerated rebinding constructs. A denylist over shell
statements cannot be complete: bash has too many ways to change what a command word resolves to.

## Fix

Invert to an allowlist: masking applies only when every clause of the command is an inert
grep/rg/sed clause or a passive filter (`wc head tail sort cat uniq cut`, no redirect operator,
`sort` without an output option, `uniq` with at most one positional). Anything else leaves
`visible` unmasked, which is the base behaviour. The change is monotone: it can only switch
masking off, never on, so it cannot newly allow a write. The new gate subsumes
`COMMAND_REBINDING_RE`, which was deleted; the full `hooks-validate-bash` suite passes without it.
Rows pin all 19 forms plus the `uniq` and `sort` fences, and the original allow rows.

## Residual risks

- Accepted false positives, now `warn` instead of allow: `git log | grep 'a>b'`,
  `cd sub && grep 'a>b' f`, `grep ... | sort -k1 | head`. Widen the allowlist only on evidence of noise.
- Independent siblings, out of scope here: #1237 (python/node from stdin), #1239
  (`cd <main> && echo x > f`), #1243 (`\/path`), #1246 (`GIT_TRACE=`), #1252 (`$(...)`, `<(...)`).
- Installed plugin copies pick the fix up only after a version bump (V-PLUGIN-01 is awaiting an
  owner ruling; no bump in this PR).
