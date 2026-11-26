---
type: plan
summary: "Plan for issue #1395: let the advisory doc-health signal run against a consumer documentation/ tree via --repo-root and flag ADR files missing a decisions/INDEX.md row"
status: current
review_trigger: "on file change"
created: 2026-11-26
last_updated: 2026-11-26
---

# Plan - Issue #1395: Doc-health checks never see the consumer tree

## Objective
`scripts/doc-health-signal.ts` accepts `--repo-root`, so a campaign can write `.blackhole/doc-health.json` for a consumer `documentation/` tree. The signal also gains an advisory finding for an ADR file with no row in `decisions/INDEX.md`. The row ceiling and the line ceiling already exist in `evaluateDocTreeHealth`; they never ran on a consumer tree because `main()` pins to blackhole's own checkout.

## Design Decision
Owner gate: none. The issue's proposed fix is to parameterise the checks and run them read-only against the consumer worktree. The signal stays advisory (V-DOCHEALTH-03, `ok: true` always). The blocking `V-DOCHEALTH-01/02/04` stay Scope-1 and are not run on consumer trees.

- Chosen: add `--repo-root <abs>` to `doc-health-signal.ts` (default `root`, so self-hosting is unchanged), and add one advisory leg to `evaluateDocTreeHealth`. No new CLI, no new V-code.
- Rejected: invoking mercure's `detect-doc-debt.sh` (an optional external dependency, with no row or line ceiling verified); parameterising `doc-health.check.ts` `DOCS_DIR` (it is a verify entrypoint pinned by design).
- Consumer-index caution: `parseRootIndexRows` assumes the blackhole 5-column table. A foreign index (link-style paths, prose) must not produce a false row count, so the row-ceiling leg is skipped when `isRegenerableRootIndex` (`scripts/lib/doc-index-generate.ts:107`) is false, and the signal detail says "foreign root INDEX, row ceiling not evaluated". This is the same guard the carry step uses (#1388).

## Touch-Paths
- `scripts/doc-health-signal.ts` (`--repo-root` via `parseFlags` from `scripts/lib/argv-flags.ts`; default `root`)
- `scripts/checks/doc-health.check.ts` (new `findAdrsMissingIndexRow`, one detail leg in `evaluateDocTreeHealth`; foreign-index guard on the row-count leg)
- `scripts/doc-health-signal.test.ts`, `scripts/checks/doc-health.check.test.ts` (tests first)
- `src/references/blackhole-state.md` (§ Doc-Health Signal: consumer invocation and gate)
- `src/references/doc-governance.md` (§ Doc-Tree Health Signal: Scope-2 mechanical signal, advisory)
- `src/references/hunt/docs.md` (header paragraph: the claim "cannot reach a consumer tree" becomes "the signal reaches it via `--repo-root`; this kind stays the agent-driven complement")
- plus all generated dist trees per `scripts/lib/build/targets.ts`

Token ceilings: no edit to `src/agents/implementer.md` or `src/agents/reviewer.md`. Verify the content-gate budgets on the three reference files are not exceeded (V-CONTENTGATE-01).

## Task Breakdown
1. **Tests first (red)** in `doc-health.check.test.ts`.
   **AC**: `findAdrsMissingIndexRow` returns `ADR-070-x.md` for a fixture where `decisions/ADR-070-x.md` exists and `decisions/INDEX.md` mentions ADR-070 only in prose. It returns `[]` when a table row (a line starting `|`) carries the `ADR-070` token, in both bare-id and link form. It returns `[]` when `decisions/` or its INDEX is absent. Before implementation, `bun test scripts/checks/doc-health.check.test.ts` fails on these cases.
2. **Implement `findAdrsMissingIndexRow`**: row presence is decided on table lines only, keyed on the `ADR-\d+` token, matching `appendAdrIndexRowIfAbsent`'s discriminator. Wire it into `evaluateDocTreeHealth` as detail `ADR files with no decisions/INDEX.md row: ...`; `ok` stays true.
   **AC**: the task-1 tests pass, and `evaluateDocTreeHealth(<blackhole documentation>).ok === true`.
3. **Foreign-index guard**: skip the row-ceiling leg when the root INDEX is not regenerable and emit the "not evaluated" note.
   **AC**: a fixture root INDEX with a foreign header and 300 rows yields no `row count` detail and does yield the note; a blackhole-shaped index with 201 rows still yields `INDEX.md row count 201 exceeds 200`.
4. **`--repo-root` in `doc-health-signal.ts`**: derive `docsDir`, `campaignDir` and `queue.json` from the flag (default `root`); exit non-zero with a message when the dir is not an existing directory.
   **AC**: `bun run --cwd <abs> scripts/doc-health-signal.ts --repo-root <fixture>` writes `<fixture>/.blackhole/doc-health.json` with `doc_debt: "yes"` for an over-ceiling fixture. It never writes into blackhole's own `.blackhole/`. It exits 1 on a missing directory. A test covers a `main`-level path via an extracted `resolveRepoRoot(argv)` helper.
5. **Docs**: update the three reference files. `blackhole-state.md` replaces the existence gate on `scripts/checks/doc-health.check.ts` with: on a consumer repo, when `docs_governance.enabled` is true and `documentation/` exists, run `bun run --cwd "$BLACKHOLE_PLUGIN_ROOT" scripts/doc-health-signal.ts --repo-root <abs consumer root>`. Self-hosting is unchanged, and the step is inert otherwise.
   **AC**: `bun run verify` passes in CI (V-CWDPIN-01, V-INVOKE-01, V-CONTENTGATE-01, V-DOCHEALTH-*). The invocation names the script by source path with `--cwd`, not a package alias.
6. **Build mirrors**: one `bun run build` through `with-test-lock`, committing generated trees.
   **AC**: `git status` shows no uncommitted generated drift after the build.

## Execution Strategy & Stop Conditions
- Run only the two changed test files locally, through `with-test-lock`, after `free -m` MemAvailable >= 2500 MB. CI runs the full verify.
- If the `evaluateDocTreeHealth` change makes blackhole's own `bun run verify` report a new blocking result, stop and revert the leg to advisory-only detail.
- If any reference file would exceed its content-gate ceiling, halt and move the prose into an existing section rather than raising a budget.

## Dependency Blast-Radius
- `evaluateDocTreeHealth`: consumers are `doc-health-signal.ts` and `doc-health.check.ts`'s own `runChecks`. Run `grep -rn evaluateDocTreeHealth scripts` and cite the result in the PR body (V-INT-05).
- `check-utils.ts` (96 consumers) is not edited.

## Critical Files
- `scripts/checks/doc-health.check.ts`
- `scripts/doc-health-signal.ts`
- `src/references/blackhole-state.md`

## Documentation Impact
`src/references/blackhole-state.md`, `src/references/doc-governance.md`, `src/references/hunt/docs.md` (listed above). No ADR: this extends an existing advisory signal without reversing one.

## Quality Gate Results
- touch_paths_declared: PASS
- schema_baseline: PASS (the `doc-health.json` shape is unchanged; new content only appears in `detail`)
- ac_mapping: PASS
- critical_files_exist: PASS
- mitigation_concrete: PASS
