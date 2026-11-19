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

The guard follows the three-tier contract in
[`issue-1246-guard-contract.md`](issue-1246-guard-contract.md): what resolves and blocks, what
warns, and the named residuals R1-R8 and R10-R14. That document is normative; this one keeps the narrative.

History: review rounds 6 to 9 of PR #1257 grew per-spelling decoding (`$'…'` decoding, an
`env -S` splitter, a raw-text `set -a` match), and each round found holes in the parsing the
previous round added. Round 10 deleted that parsing (`decodeQuotedWord`, the `-S` splitter,
`ALLEXPORT_RE`) and replaced it with one exact/opaque word classifier that warns wherever a
word's text cannot be read from the command string.

Tests: `scripts/hooks-bash-write-options.test.ts`, section `GIT_TRACE* variables write files (#1246)`,
including one row per closure-table row of the contract.
