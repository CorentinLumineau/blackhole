---
type: analysis
summary: "Why BLACKHOLE_PLUGIN_ROOT is empty in every session: the SessionStart hook uses bash-only printf %q but Claude Code runs it via sh (dash), which aborts after printing the export prefix"
status: current
review_trigger: "on file change"
created: 2026-11-18
last_updated: 2026-11-18
related: [documentation/plans/plan-session-start-hook-posix-plugin-root-export.md]
---

# BLACKHOLE_PLUGIN_ROOT exported empty by the SessionStart hook (issue 1269)

Confidence 92. Evidence gathered on a Linux host where `/bin/sh` is dash.

## Symptoms
- Every session env file written by the hook is 29 bytes: `export BLACKHOLE_PLUGIN_ROOT=` with no value and no trailing newline. Across 448 env files none ever held a value.
- Files from repeated SessionStarts (resume, compact) are k x 29 bytes: the prefix is appended again with no newline between copies.
- Consequence: compiled `"${BLACKHOLE_PLUGIN_ROOT:-.}"/scripts/...` calls resolve to the consumer repo's `./scripts/` ("Module not found").

## Hypotheses
1. **dash rejects `printf %q` (CONFIRMED).** `SESSION_START_EXPORT_COMMAND` (`scripts/lib/build/claude-plugin-runtime.ts:17-19`) uses `%q`, a bash extension. Exact repro: `dash -c 'printf "export BLACKHOLE_PLUGIN_ROOT=%q\n" /x/y' | od -c` yields 29 bytes and an "invalid directive" error. Dash emits the literal prefix, aborts at the directive (no value, no newline), and the command's trailing `; exit 0` swallows the failure.
2. **`CLAUDE_PLUGIN_ROOT` empty inside the hook (REFUTED).** The guard `[ -n "$CLAUDE_PLUGIN_ROOT" ]` precedes the printf, so an empty value would have written nothing; the 29-byte files prove the guard passed. PreToolUse hooks that use the variable also work.
3. **Another writer (REFUTED).** No other `hooks.json` or settings writer exists; the installed 0.30.1 command is byte-identical to the source.

## Documentation check
Claude Code docs (code.claude.com/docs/en/hooks): shell-form hooks run via `sh -c` on macOS and Linux. The docs' `shell` field says it defaults to `"bash"`, which contradicts the observation, so a fix must not rely on `"shell":"bash"`. The desktop app is incidental: any Linux host with dash reproduces it.

## Resolution
1. POSIX writer: `printf "\nexport BLACKHOLE_PLUGIN_ROOT='%s'\n" "$(printf %s "$CLAUDE_PLUGIN_ROOT" | sed "s/'/'\\\\''/g")" >> "$CLAUDE_ENV_FILE"`. Verified under dash for a space, `'`, `$` and backticks in the path. The leading newline repairs env files poisoned by the old prefix.
2. Warn on stderr when the export cannot be written (`CLAUDE_ENV_FILE` or `CLAUDE_PLUGIN_ROOT` missing).
3. Fail-loud replacement of the `:-.` fallback is deferred to issue 1328, after a fresh-session confirmation that the variable is now populated.

Plan: `documentation/plans/plan-session-start-hook-posix-plugin-root-export.md`. Fail-loud replacement of the `:-.` fallback is tracked in #1328.
