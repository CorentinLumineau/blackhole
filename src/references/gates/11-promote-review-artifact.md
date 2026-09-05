## Promote Review Artifact (ADR-021 D3, issue #445)

Invoked at **merge-readiness** (after LGTM and CI-green, before `gh pr merge`) — **not** at initial
PR open. The `reviewer` never authors this artifact (`reviewer.md` `disallowedTools: [Write, Edit,
Delete]` — ADR-021 A2).

*   **Gate**: identical kill switch to § Carry Staged Artifacts — both `docs_governance.enabled`
    and `docs_governance.write_governance` must resolve `true`; otherwise skip entirely (zero
    `route: review` manifest entries, zero promotion spawn).
*   **Run** (plugin repo): `bun run scripts/promote-review-artifact.ts --ledger <ledger> --issue <N> --title
    "<title>" --pr <P> --branch <branch> --head <sha> --out-dir .blackhole/staged/<issue>/` —
    renderer SSOT: `scripts/lib/promote-review-artifact.ts` (ledger rows for `issue_ref`, final
    iteration selection, `recheck[]` resolution per plan).
    **Consumer worktree** (issue #687): the script lives in the vendored plugin — invoke with
    `bun run --cwd <plugin-root> scripts/promote-review-artifact.ts --ledger
    <consumer>/.blackhole/findings-ledger.json …` or `scripts/consumer-promote-review.sh` from the
    consumer repo (resolves `vendor/blackhole` or `BLACKHOLE_PLUGIN_ROOT`).
*   **Stage**: write CLI outputs (`review.md`, `index-row.md`) under `.blackhole/staged/<issue>/`
    and append manifest entries (`route: "review"`, `produced_by: "implementer"`, `sub_mode: null`,
    `target_kind: "new_file"` + companion `append_row` for `documentation/INDEX.md`).
*   **Carry**: run the § Carry Staged Artifacts branches for the new entries; commit and push on the
    PR branch before merge proceeds (`phase-loop.md` § Merge protocol step 2.5).
*   **Verify (issue #806)**: merge-readiness never trusts the staged manifest for this — a
    manifest entry is written by the same party (`implementer`) the check exists to verify, so
    `check-review-artifact.ts` no longer reads it at all (`manifestHasReviewRoute` was removed
    outright). Before merge, run `bun run --cwd <abs repo-root> scripts/check-review-artifact.ts
    --config <abs> --issue <N> --title "<title>" --ledger <abs findings-ledger.json> --pr <P>
    --branch <branch> --head <sha> --repo-root <abs repo-root> --diff-file <abs paths.txt>` —
    `--cwd` MUST equal `--repo-root` (issue #798 — pins module resolution to the same tree the
    CLI operates on). Every path-shaped flag must be absolute, or the CLI exits `2` with its
    usage message. It re-renders the expected review
    markdown from the live findings ledger (`renderReviewMarkdown`) and diffs it against the
    committed file (`merge-gate.md` §5), not merely checking the file exists.
*   **PR-body record**: `Promoted Review Artifact: <target_path> (from ledger issue #N)`.
