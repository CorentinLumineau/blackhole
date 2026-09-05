## Carry Staged Artifacts (unconditional, ADR-021 D2)

Referenced from step 6 "Verify & Open PR" above (same reference-not-restate pattern as the
Companion-doc sync bullet). Promotes artifacts staged at thinking time
(`planner`/`investigator`, `blackhole-state.md` § Staging, ADR-021 D1) into their
`documentation/` targets, committed inside this issue's own PR. The manifest shape guard,
`target_kind` dispatch, 9-row frontmatter rewrite mapping, and `append_row` dedup for both
discriminator shapes are mechanized by `scripts/carry-staged-artifacts.ts` (issue #715, R-10) —
this section states only what the script does not decide.

*   **Gate**: `docs_governance.enabled` and `docs_governance.write_governance` both resolve
    `true` (absent config block ⇒ both default `true` per `config-template.md`; an explicit
    `false` on either ⇒ this entire section is inert — skip, do not invoke the script).
*   **Search-before-write** (investigator `new_file` entries only — the one live-repo judgment
    the script cannot make): before the script writes a rewritten doc to `target_path`, check
    whether an existing doc at the target directory already covers the same concern; if so,
    update it in place (bump `last_updated`, preserve its original `created`) instead of letting
    the script create a duplicate.
*   **Invoke**: `bun run --cwd <this worktree's absolute path> scripts/carry-staged-artifacts.ts
    --manifest {repo_root}/.blackhole/staged/<issue>/manifest.json --repo-root <this worktree's
    absolute path> --staging-root {repo_root}` — `--cwd` MUST equal `--repo-root` (issue #798 —
    pins module resolution to the worktree, the same tree the CLI operates on). `{repo_root}` is
    the same main-clone absolute path already established for the plan file (§ "Plan artifact
    paths (worktree rule)"); `staged_path` entries live only in the main clone (`blackhole-state.md`
    § Staging), never in the worktree, so `--staging-root` must point there while `--repo-root`
    (and `--cwd`) stay the worktree (issue #760).
    Prints the carried target paths as JSON. Absent manifest ⇒ `[]`, exit 0 (nothing was staged
    for this issue). A manifest that **exists but is zero-byte or fails to parse as JSON** exits
    1 — distinct from absent (issue #558): it means a staging write was attempted and failed, so
    treating it identically to "nothing staged" would silently drop staged artifacts. On exit 1,
    log a `new_findings[]` row (`kind: bug`) citing the manifest path and skip the carry for this
    issue this run — the script itself never writes to the ledger. A malformed individual entry
    (missing field, out-of-enum `target_kind`) is reported on stderr and skipped without failing
    the run; log each such line as its own `new_findings[]` row (`kind: bug`). A declared
    `staged_path` missing under `--staging-root` also exits 1 — the message names both roots and
    the entry index, never a bare ENOENT — fails loudly instead of the pre-#760 silent-`[]` bug
    when a relative manifest path happened to resolve against the wrong cwd; log it the same way
    as the zero-byte case above.
*   **What the script dispatches** (ported verbatim from this section's pre-#715 prose, not
    restated here): `new_file` entries copy verbatim except an investigator analyze/investigate
    note, which gets the 9-row frontmatter rewrite (working-note schema → `doc-governance.md`
    lifecycle schema); `append_row` entries dedup idempotently on two discriminator shapes — the
    pipe-table row's `path` column value for `documentation/decisions/INDEX.md` /
    `documentation/INDEX.md`, and, when `target_path === "ARCHITECTURE.md"` (bullet-list
    target, `## Active Constraints`), the citation suffix — the mandatory trailing
    `(ADR-{NNN})` or `(analyze: issue #N)` attribution `planner.md` appends to every constraint
    bullet, the same discriminator `planner.md`'s own near-duplicate check already uses (§
    Workflow & Planning Steps step 4) — reused, not reinvented (`V-INT-02`); `target_path` is
    constrained to an allowlist (`documentation/**` and root `ARCHITECTURE.md` — issue #784
    AC1), and every write-step filesystem failure skips that one entry with a reason rather than
    throwing, so neither an out-of-allowlist target nor a write error ever denies the rest of the
    manifest.
*   **Commit**: carried files land in the same PR (same commit as the code change, or a
    dedicated `docs: promote staged artifacts for issue #N` commit within the same PR) — never
    a separate PR, never an orchestrator write.
*   **PR-body record** (mirrors the Reuse Check Gate pattern — falsifiable, produced even on
    the negative case): one line per carried artifact, `Carried Artifact: <target_path>
    (<target_kind>, from <route>)`, or `Carried Artifacts: none (no manifest for this issue)`
    when nothing was staged. No new `implementer-schemas.md` return field — the PR-body record is
    the falsifiable evidence.
*   **Do not delete** `.blackhole/staged/<issue>/` after carrying — it remains as campaign
    state so the reviewer audit (`reviewer.md` § Staged Artifact Carry Audit, `V-AUTO-02`) has stable data to diff
    against, and so a resumed session after interruption can re-derive what was already carried
    via the script's idempotent dedup.
*   **Declared-ADR-supersession stamping** (`V-ADR-06` leg 1, independent of the manifest.json
    branch above — `supersedes_adr` is read directly from the plan's own frontmatter, already
    available via `<PLAN_CONTEXT>`, never staged). When the plan's `supersedes_adr` is
    non-empty, before opening the PR: for each named `ADR-NNN`, append one dated bullet to that
    ADR's `## Post-acceptance amendments` section (create the section at file end if absent),
    citing this issue number and a one-sentence reason drawn from the plan's Objective; then
    update that ADR's `documentation/decisions/INDEX.md` summary cell with a short "amended —
    see § Post-acceptance amendments" clause. **Idempotency**: skip an ADR whose amendments
    section already cites this issue number — re-spawn safe, same discriminator shape as the
    `append_row` guard above.
