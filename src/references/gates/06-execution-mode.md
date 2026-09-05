## Execution Mode

`execution_mode` (`standard` \| `refactor-strict` \| `docs-only`) branches step 3's TDD
mandate. When the orchestrator's spawn prompt does not carry an `execution_mode`
directive, treat it as absent — behave exactly as `standard`.

*   **`standard`** (default): unchanged step-3 mandate verbatim — write failing tests
    first, then implement (`V-TEST-01/02`). No behavior change for the common case.
*   **`refactor-strict`**: zero-regression branch. Failing-tests-first is suppressed in
    favor of: capture the baseline test file list and pass/fail state **before** editing,
    then again **after**. The pre-existing test suite must pass **unmodified** — the diff
    must show zero added or deleted test files during the session.
    - **Refactoring Verification gate (unconditional)**: before the first edit, produce a short
      Decision Record (deep vs. shallow restructuring choice, coupling-impact assessment),
      recorded in the PR description — same "no bypass" shape, reusing the Bugfix Gate's
      Decision-Record mechanism above. Also append this Decision Record as a `decision_records[]`
      row with `kind: "refactor"` in the return JSON — see `implementer-schemas.md` §
      `decision_records[]` for the row shape.
    - **Per-step commit/rollback**: extends step 4's "Incremental Implementation" cadence
      (unchanged step granularity) — each incremental change is tested **and committed** before
      the next; a failing step `git reset --hard`s to the last known-good commit, not just
      "stop and diagnose."
*   **`docs-only`**: failing-test-first mandate suppressed entirely. Touch-Paths are
    restricted to documentation paths (e.g. `**/*.md`, `documentation/**`) — touching any
    non-doc file is a Touch-Paths violation (`V-SCOPE-02`), not merely a style note.
    - **Staleness/Drift-Check gate (unconditional)**: before editing any doc, compare the
      doc's existing claims (signatures, examples, described behavior) against the current
      code they describe. Produce a Drift-Check Table in the PR description — one row per
      touched doc claim: `Doc claim | Current code state | Drift type (none |
      api-signature-changed | new-feature-undocumented | behavior-changed | file-moved) |
      Required action`. Same "no bypass" shape as the Bugfix Gate / Refactoring Verification
      gate — the table is produced even when every row resolves to `none`.
    - **Example verification**: every code block written or touched in the diff must be
      syntactically valid against the current API — verify the referenced symbol/signature
      against its actual current source location (parameter names, return shape, import
      path). Record a one-line confirmation per verified block in the PR description.
    - **Write-governance (`doc-governance.md`, gated by `docs_governance.write_governance`)**:
      when the diff creates a new file under `documentation/`, apply search-before-write and
      canonical-naming before creating it. When the diff substantially replaces an existing
      doc's content, apply supersede-on-overwrite instead — mark the old doc `status:
      deprecated`, link `supersedes:` from the new file — rather than overwriting in place.
      Inert when `docs_governance.enabled` does not resolve to `true` (per `config-template.md`
      § `docs_governance` resolution — step stays a no-op) or
      `docs_governance.write_governance === false`.

---
