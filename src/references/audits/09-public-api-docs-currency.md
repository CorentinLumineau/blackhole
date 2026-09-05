---
section: Public-API / Docs Currency
vcodes: [V-DOCSYNC-01, V-DOC-01]
---
### Public-API / Docs Currency (`V-DOCSYNC-01`)
*   **Detection**: the diff touches the public-API/schema/config surface defined in § 5-Field Contract & Plan Compliance's `V-API-01` bullet (public interfaces, configurations, or database schemas) in a file outside § Docs-Only Execution Mode Compliance's documentation path patterns (`**/*.md`, `documentation/**`, `codex-agents/*.yaml`).
*   **Check**: when detection is true, the diff must include a same-PR update to a doc file matching § Docs-Only Execution Mode Compliance's globs (`**/*.md`, `documentation/**`) or an inline docstring/comment on the changed symbol. A missing update — severity `BLOCK`, V-code `V-DOCSYNC-01`, cite the `file:line` of the undocumented change.
*   **Docstring check (`V-DOC-01`, `WARN`)**: when detection is true, every newly exported public symbol (function, class, type, or module boundary) added or modified in the diff must carry a docstring/JSDoc on that symbol. A public symbol with no docstring — severity `WARN`, cite `file:line`.
