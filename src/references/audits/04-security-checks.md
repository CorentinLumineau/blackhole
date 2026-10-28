---
section: Security Checks
vcodes: [V-SEC-01, V-SEC-02, V-SEC-03, V-SEC-04, V-SEC-11, V-SEC-13, V-SEC-14]
---
### Security Checks
*   No hardcoded secrets, API keys, or credentials (`V-SEC-03/04`).
*   Verify proper input validation is implemented; no injection or auth bypass (`V-SEC-01/02`).
*   **Sensitive-Filename Staging Audit (`V-SEC-11`, `BLOCK`)**: independently recompute the
    implementer's Sensitive-Filename Staging Gate (`implementer.md` § Sensitive-Filename
    Staging Gate) rather than trusting its self-report. Resolve `file-patterns.json` via the
    same two-candidate path order that gate uses (`{{AGENT_DIR}}/hooks/patterns/file-patterns.json`,
    then `templates/hooks/pretooluse/patterns/file-patterns.json` repo-root-relative), then test
    every file path in the PR diff against each `sensitiveFiles[]` entry
    (`new RegExp(entry.pattern, entry.flags)`, not a glob). Evidence that satisfies this check:
    - A `sensitiveFiles[]` match found among the diff's files — a sensitive-shaped file was
      actually committed — is `BLOCK` regardless of any PR-body exclusion claim (a failed
      exclusion is worse than an undeclared one).
    - Cross-check every `Sensitive-Filename Exclusion: <path> (matched <pattern>) — not staged`
      line the PR body claims against the actual diff file list: a path listed as excluded but
      still present in the diff is itself `BLOCK` (the exclusion claim is false).
    - Neither candidate path resolving is a gap in the implementer's gate — confirm the PR
      body/worker JSON carries the `new_findings[]` row `implementer.md`'s Absent-pattern-file
      fallback mandates; a missing row with no exclusion lines either — `BLOCK`.
*   **Authz Test Audit (`V-SEC-13`, `BLOCK`)**: for every new or changed endpoint in the diff
    (route handler, server action, middleware/`proxy.ts` matcher, resolver, webhook, API/MCP
    tool — definition §2 of Mercure `mercure-plugin/rules/references/security-sensitive-surfaces.md` (single source of truth: https://github.com/CorentinLumineau/mercure/blob/main/mercure-plugin/rules/references/security-sensitive-surfaces.md — do not copy its lists here)), confirm the PR adds/updates authz tests covering §3: 401
    (no/invalid/revoked/expired credential), cross-account 403/404 including forged ids, 403
    insufficient scope (or a stated "no scopes"), and the middleware/proxy matcher when it
    changed. Name the test file and assertion; "covered indirectly" does not satisfy it. A skip
    is valid only under the §4 trivial exemption AND with the §5 `## Security opt-out` block in
    the PR body — otherwise `BLOCK`.
*   **Destructive-Operation Idempotency Audit (`V-SEC-14`, `BLOCK`)**: for every workflow,
    script, migration or release step the diff adds or changes that deletes tags, data or
    deployed resources, confirm three things: it creates (or verifies) the replacement before
    deleting the original, never delete-then-create; re-running it after a partial failure
    converges to the same end state; and the destruction has a dry-run path plus a backup or
    restore step. A missing leg is `BLOCK`; name the file:line of the destructive call. Covers
    logic the PR ships, not the worker's own shell commands (PreToolUse hooks).
*   **Security-mode attack-signature scan** (when `review-core.md` § Security-mode review's gate
    resolves `true`): run the diff-scoped pattern scan per
    `src/references/security-attack-signatures.md` — cite by path; do not restate patterns in
    this section. Apply only signatures whose matching constructs appear on changed lines.
*   **Non-goal**: a pattern match alone is never sufficient for a `BLOCK` finding — every
    security issue still requires a concrete attack scenario per `V-SEC-06`.
