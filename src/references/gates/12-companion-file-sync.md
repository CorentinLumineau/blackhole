## Companion-file Sync (Phase 5.5, V-ADA auto-repair)

Gated by `docs_governance.enabled === true` and `docs_governance.companion_files !== false`
(same gate shape as `reviewer.md` §10). Unconditional within that gate for every execution mode
when the diff trigger predicates in `companion-file-sync.md` are true.

*   **When**: after incremental implementation, **before** the Sensitive-Filename Staging Gate's
    first `git add` — collect the list of paths about to be staged.
*   **Run**:
    ```bash
    bun run --cwd <worktree-abs> scripts/lib/companion-file-sync.ts --repo-root <worktree-abs> --diff-file <paths.txt>
    ```
    `--cwd` MUST equal `--repo-root` (issue #798 — pins module resolution to the worktree).
    Templates are read from `templates/companion-files/` per `companion-file-sync.md` — never
    inlined in the agent prompt.
*   **Apply** only repairs the CLI reports as needed; stage repair files in the **same PR** as the
    triggering change. Never create `ARCHITECTURE.md` or repair `AGENTS.md` when triggers are false
    (no drive-by).
*   **PR body**: one `Companion-file repair:` line per repair (`vcode`, `file`, `action`).
*   **Return JSON**: `companion_repairs[]` — one `{ vcode, file, action }` row per repair
    performed (`implementer-schemas.md` § Implementer).

Full trigger tables, ledger contract, and helper names: `src/references/companion-file-sync.md`.

---
