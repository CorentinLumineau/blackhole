---
type: research
summary: "Interpreters that read their script from stdin (heredoc, here-string, pipe, input file) were invisible to the write-target guard; root cause, fix and residual risks"
status: current
created: 2026-11-18
last_updated: 2026-11-18
review_trigger: "on file change"
issue: 1237
---

# Issue #1237: interpreters that read their script from stdin

## Bypass class

An interpreter (`python3`, `node`, `perl`, `ruby`, `bun`) or a shell that reads its script from a
heredoc, here-string, input file or pipe runs code the command string only shows as data. The
write-target guard inspected `-e`/`-c` one-liners but let these through with no verdict.

## Root cause

Detection looked only at inline script flags. The stdin sources were never modelled, and two
shapes slipped past the first fix as well:

- A newline after the pipe (`cat x.js |` then `node` on the next line): `PIPE_INTO_RE` captured an
  empty clause because its clause text stopped at the newline.
- A redirect written before the command word (`< evil.js node`): `stdinRedirectScript` scanned
  only the tokens after the command word.

## Fix

- `interpreterReadsStdinScript` / `shellReadsStdinScript` decide whether stdin carries the script
  (a `-` or `/dev/stdin` operand, or no operand at all).
- `PIPE_INTO_RE` skips whitespace and newlines after the pipe, so the clause starts on the next line.
- `stdinRedirectScript` scans every token except the command word, so a leading redirect counts.
- A stdin script that may write yields the warn tier (`bash-write-target-unresolvable`), never a
  silent allow. Read-only scripts, script-file operands and `-m` modules stay allowed.

Tests: `scripts/hooks-bash-write-stdin-scripts.test.ts`.

## Residual risks

- The warn tier is advisory: the guard cannot prove what a stdin script does, so it warns rather
  than blocks.
- Interpreters outside the `INTERPRETERS` table (`php`, `lua`, `deno`, ...) are not covered.
