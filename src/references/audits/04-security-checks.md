---
section: Security Checks
vcodes: [V-SEC-01, V-SEC-02, V-SEC-03, V-SEC-04, V-SEC-11, V-SEC-13]
---
### Security Checks
*   No hardcoded secrets, API keys, or credentials (`V-SEC-03/04`).
*   Verify proper input validation is implemented.
*   **Sensitive-Filename Staging Audit (`V-SEC-11`, `BLOCK`)**: independently recompute the
    implementer's Sensitive-Filename Staging Gate (`implementer.md` § Sensitive-Filename
    Staging Gate) rather than trusting its self-report. Resolve `file-patterns.json` via the
    same two-candidate path order that gate uses (`{{AGENT_DIR}}/hooks/patterns/file-patterns.json`,
    then `templates/hooks/pretooluse/patterns/file-patterns.json` repo-root-relative — cited, not
    restated, `V-INT-02`), then test every file path actually present in the PR diff against
    each `sensitiveFiles[]` entry (`new RegExp(entry.pattern, entry.flags)` match against the
    path, not a glob match). Evidence that satisfies this check:
    - A `sensitiveFiles[]` match found among the diff's files — a sensitive-shaped file was
      actually committed — is `BLOCK` regardless of any PR-body exclusion claim (a failed
      exclusion is worse than an undeclared one).
    - Cross-check every `Sensitive-Filename Exclusion: <path> (matched <pattern>) — not staged`
      line the PR body claims against the actual diff file list: a path listed as excluded but
      still present in the diff is itself `BLOCK` (the exclusion claim is false).
    - Neither candidate pattern-file path resolving is a gap in the implementer's own gate, not
      this audit — confirm the PR body/worker JSON carries the `new_findings[]` row
      `implementer.md`'s Absent-pattern-file fallback mandates for that case; a missing row when
      no exclusion lines are present either — `BLOCK` (the gate may have silently no-opped).
*   **Authz Test Audit (`V-SEC-13`, `BLOCK`)**: for every new or changed endpoint in the diff
    (route handler, server action, middleware/`proxy.ts` matcher, resolver, webhook, API/MCP
    tool — definition §2 of Mercure `mercure-plugin/rules/references/security-sensitive-surfaces.md` (single source of truth: https://github.com/CorentinLumineau/mercure/blob/main/mercure-plugin/rules/references/security-sensitive-surfaces.md — do not copy its lists here)), confirm the PR adds/updates authz tests covering §3: 401
    (no/invalid/revoked/expired credential), cross-account 403/404 including forged ids, 403
    insufficient scope (or a stated "no scopes"), and the middleware/proxy matcher when it
    changed. Name the test file and assertion; "covered indirectly" does not satisfy it. A skip
    is valid only under the §4 trivial exemption AND with the §5 `## Security opt-out` block in
    the PR body — otherwise `BLOCK`.
*   **Security-mode attack-signature scan** (when `review-core.md` § Security-mode review's gate
    resolves `true`): run the diff-scoped pattern scan per
    `src/references/security-attack-signatures.md` — cite by path; do not restate patterns in
    this section. Apply only signatures whose matching constructs appear on changed lines.
*   **Non-goal**: a pattern match alone is never sufficient for a `BLOCK` finding — every
    security issue still requires a concrete attack scenario per `V-SEC-06`.
