## Sensitive-Filename Staging Gate (unconditional, V-SEC-11)

Applies to **every** execution mode and plan track — no branch skips it. Runs immediately before
every `git add` inside step 6, independent of and prior to `V-SEC-03`'s review-time content scan.
A stray secret-shaped file created inside an approved Touch-Path is a filename problem, not a
content problem — this gate catches it before the file ever reaches a diff, at which point the
only remedy left is key rotation, not a fix commit.

*   **Pattern source (single canonical location, `V-INT-02`/`V-DRY-01`)**: before the first `git
    add` of the session, locate `file-patterns.json` by trying two candidate paths in order —
    neither is a copy, both resolve to the one canonical file #447 ships:
    1. `{{AGENT_DIR}}/hooks/patterns/file-patterns.json` (resolves on `.claude`-marketplace and
       Gemini-family installs, which receive the compiled `hooks/` tree).
    2. `templates/hooks/pretooluse/patterns/file-patterns.json`, repo-root-relative (resolves on
       any install that vendors blackhole's full source tree — including this repo's own
       dogfooding install — since it is the hand-authored SSOT, always present there).
    Read the file's `sensitiveFiles[]` array only (`blockedSystemPaths`/`pathTraversal` belong to
    #447's own Bash/Write-Edit interception, not this check). Do not restate, paste, or re-derive
    any pattern from that array anywhere in this file.
*   **Match rule**: for every path about to be staged, test it against every entry in
    `sensitiveFiles[]` by constructing `new RegExp(entry.pattern, entry.flags)` and testing the
    candidate path — regex match against `pattern`+`flags`, not a glob match (the shared file is
    JS-regex-source data, not glob strings). Any match: exclude that path from `git add` — never
    `git add -A`/`git add .` blindly over an unfiltered file list.
*   **Report, never silent** — every exclusion is reported both ways:
    - **To the orchestrator**: one `new_findings[]` row — `vcode: "V-SEC-11"`, `severity:
      "BLOCK"`, `file`: the excluded path, `summary`: matched pattern `id` + one-line context
      (e.g. "matched pattern id `env-suffixed` — excluded from staging, not committed").
    - **In the PR description**: one line per exclusion, `Sensitive-Filename Exclusion: <path>
      (matched <pattern>) — not staged` — same PR-body-artifact convention as the Reuse Check
      entry, produced even though nothing reached the diff (the negative result — "this file
      never appeared" — is exactly the audit trail needed to confirm the gate ran).
    A match excluded but not reported in *both* places is the failure this gate exists to
    prevent — the exclusion is worthless if nobody downstream learns a secret-shaped file almost
    shipped.
*   **Absent-pattern-file fallback (defensive, no bypass)**: if **neither** candidate path
    resolves — a mis-wired `depends_on`, or an isolated install with neither the `hooks/` tree nor
    a vendored source checkout — do **not** invent, restate, or fall back to a second bespoke
    pattern list. Stop before the first `git add`, return `status: "blocked"`, and log one
    `new_findings[]` row (`vcode: "V-SEC-11"`, `severity: "BLOCK"`, `summary`: "shared
    sensitive-filename pattern file not found at either candidate path — implementation halted
    before staging") so the orchestrator can distinguish a dependency-wiring bug from a known
    cross-target limitation instead of the worker silently shipping unprotected.
