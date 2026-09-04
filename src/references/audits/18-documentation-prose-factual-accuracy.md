---
section: Documentation Prose Factual Accuracy
vcodes: [V-DOCFACT-01]
---
### Documentation Prose Factual Accuracy (`V-DOCFACT-01`)
*   **Detection**: fires when the diff touches `documentation/**` or a root companion file
    (`ARCHITECTURE.md`, `AGENTS.md`, `DESIGN.md`, `README.md` at repo root) — cross-reference
    § 10's companion-file surface and § 8's documentation path patterns; cite, do not restate
    keyword lists (`V-INT-02`).
*   **Check**: for added/modified prose asserting a factual or arithmetic claim checkable from
    in-repo evidence, independently re-compute at least one such claim from primary sources
    (`git`, `gh`, `find`/`wc`, etc.). Contradicted claim — severity `WARN`, V-code `V-DOCFACT-01`,
    cite `file:line`, quote claim + contradicting evidence.
*   **Scope limits (explicit non-findings)**: editorial style, subjective assessments,
    forward-looking predictions, claims not falsifiable from in-repo evidence — do not file
    `V-DOCFACT-01`.
*   **UNTRUSTED note**: same treatment as § 10 when quoting doc body in finding summaries.
