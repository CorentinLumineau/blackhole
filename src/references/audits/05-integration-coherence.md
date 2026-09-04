---
section: Integration Coherence
vcodes: [V-INT-01, V-INT-02, V-INT-03, V-INT-04, V-CONFIG-01]
---
### Integration Coherence
*   `V-INT-02` (No utility re-implementation): Reject code that reimplements existing utilities.
*   **Reuse Check artifact (verify — BLOCK if absent)**: confirm the PR body carries the
    implementer's one-line `Reuse Check:` entry (produced by `implementer.md` § Reuse Check Gate).
    Accept all three valid artifact forms (ADR-011 D1):
    - `Reuse Check: reusing <name> (<file:line>)` — an existing utility was adopted.
    - `Reuse Check: none found — first occurrence of <concern> (repo-wide)` — the repo-wide existence search came up empty.
    - `Reuse Check: <N> bespoke occurrences of <concern> — reusing <closest>, extraction filed` — the rule-of-three threshold fired; confirm a matching `new_findings[]` extraction entry is present in the worker's return payload.
    A missing entry (in any of the three forms) is severity `BLOCK` (`V-INT-02`) — the proactive
    gate was skipped.
    Spot-check accuracy: independently re-verify at least one `Reuse Check: reusing <name>` claim
    against the cited `file:line`, mirroring § 8's Drift-Check accuracy spot-check.
*   **Negative-claim spot-check (`none found` claims, BLOCK if refuted)**: do not take a
    `Reuse Check: none found` claim at face value — independently re-verify at least one such
    claim per PR with your own repo-wide grep for the stated concern. A refuted claim (your grep
    surfaces a pre-existing match the implementer missed) is severity `BLOCK`, `V-INT-02` — a
    false negative here silently reintroduces the duplication the gate exists to prevent, exactly
    the rubber-stamp risk this spot-check closes.
*   **Improvement Record presence (verify — WARN if absent)**: confirm the PR body carries an
    Improvement Record entry (produced by `implementer.md` § Scout Check, unconditional per
    ADR-011 D2). A missing Improvement Record is severity `WARN`, not `BLOCK` — Scout Check's
    review obligation is presence, not a claimed kaizen-yield benefit (D2 explicitly disclaims
    that benefit), and "no improvement needed — code already clean" is valid content. Check only
    that the entry exists; do not second-guess its substance.
*   `V-INT-01/03/04` (Conventions compliance): Verify touchpoint integration follows established conventions (e.g. error handling, logging, validation).
    *   **Live-grep fallback (when `Codebase Conventions = (none declared)`)**: the injected
        `<PLAN_CONTEXT>` carries no conventions for Quick-track plans. Do **not** silently skip
        `V-INT-01/03/04` — instead run a live Grep/Glob scan of the PR's touched files' immediate
        neighbourhood for the established convention (error handling, logging, validation, response
        shape) and audit the diff against what the scan finds. This mirrors mercure `x-review`'s
        live-search fallback; absence of a plan conventions table never means the audit is waived.
*   **Config/env key naming (`V-CONFIG-01`, `WARN`)**: a new config key or environment variable
    introduced by the diff follows the naming convention the plan's Codebase Conventions table
    documents for config, or — absent a documented convention — the same live-grep fallback as
    `V-INT-01/03/04` above applied to the touched config surface (e.g. `.blackhole/config.json`'s
    existing key casing/grouping, `config-template.md`'s documented schema, or the target repo's
    own `.env.example`/config-schema file). A newly introduced key that breaks the established
    casing/prefix/grouping convention with no documented rationale — `WARN`, cite `file:line`.
*   **Config key registration (`V-CONFIG-02`, `WARN`)**: a key present in committed
    `.blackhole/config.json` must appear in `config-template.md`'s field table (nested keys as
    dot-paths). Spot-check when the diff adds or changes config keys — unregistered keys are
    `WARN`, cite `scripts/checks/config-registration.check.ts` for the mechanical check.
