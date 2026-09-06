---
issue: #923
supersedes_adr: null
rulings_checked_at: 5
ruling_conflicts: []
type: plan
summary: "Backfill missing doc-governance.md lifecycle frontmatter keys (type, summary, review_trigger, created, last_updated) across 37 non-compliant ADR files via a one-time migration script that copies summary/review_trigger from documentation/decisions/INDEX.md and derives created/last_updated from git history"
status: current
review_trigger: "on file change"
created: 2026-09-06
last_updated: 2026-09-06
related: [decisions/ADR-031-generate-documentation-index.md]
---

# Plan - Issue #923 — ADR lifecycle frontmatter backfill

## Objective

Backfill the six required `doc-governance.md` lifecycle frontmatter keys (`type`, `summary`,
`status`, `review_trigger`, `created`, `last_updated`) onto every `documentation/decisions/ADR-*.md`
file that is missing at least one. The issue title ("ADR-037 carries only `status:` in
frontmatter") names one instance; verification against the live `origin/main` tree at
`dba54799` shows the same gap on 37 of 42 ADR files — the router/orchestrator widened this
issue's scope to the full sweep rather than fixing ADR-037 alone, and that widened scope is
carried into this plan as given (verified independently below, not re-derived).

**Verified state (`origin/main@dba54799`)**:

| Group | Count | Files | Has |
|---|---|---|---|
| Fully compliant | 5 | ADR-038 … ADR-042 | all 6 keys |
| `status:` only | 7 | ADR-030, 031, 032, 033, 035, 036, 037 | `status` |
| `type` + `status` | 8 | ADR-001–006, 010, 014 | `type`, `status` |
| Missing `summary` only | 20 | ADR-007–009, 011–013, 015–027, 034 | `type`, `status`, `review_trigger`, `created`, `last_updated` |
| Missing `summary` + `review_trigger` | 2 | ADR-028, 029 | `type`, `status`, `created`, `last_updated` |

37 + 5 = 42 (all accounted for). `V-ADR-01/02/03` (frontmatter `status:` enum, INDEX agreement,
in-body `## Status` agreement) are already green on all 42 and are untouched by this change —
this plan only ever *adds* missing keys, never edits an existing value.

**Key insight — three of six keys need zero new authoring**: `documentation/decisions/INDEX.md`
already carries a verbatim `summary` and `review_trigger` for all 42 ADRs (confirmed: 42 rows,
5-column blackhole schema), and `type` is the constant `"adr"` for every file in this folder.
Copying from INDEX.md instead of authoring prose is strictly better — it is mechanical, and it
*guarantees* the new frontmatter `summary` matches the INDEX row exactly, which is what
`doc-governance.md` requires anyway. Only `created`/`last_updated` need derivation (git history),
and only for the 15 files in the "status: only" and "type + status" groups.

## Per-Key Sourcing Table

| Frontmatter key | Source | Derivation |
|---|---|---|
| `type` | Constant | `"adr"` for every file in `documentation/decisions/` |
| `summary` | `documentation/decisions/INDEX.md` | Copy the row's `summary` cell verbatim (JSON-quoted for YAML safety — same `encodeYamlScalar`/`decodeYamlScalar` idiom as the precedent script) |
| `status` | Already present on all 42 | **Never touched** — untouched value, already governed by `V-ADR-01` |
| `review_trigger` | `documentation/decisions/INDEX.md` | Copy the row's `review_trigger` cell verbatim (same quoting idiom) |
| `created` | `git log --diff-filter=A --format=%ad --date=short -- <path>` (oldest match) | Only for the 15 files lacking it; stop and report, do not invent, if unresolvable |
| `last_updated` | `git log -1 --format=%ad --date=short -- <path>` (most recent match) | Only for the 15 files lacking it |

Verified worked example: `ADR-037-adr-watch-threshold-dispositions.md` → `created=2026-09-04`,
`last_updated=2026-09-04`. `ADR-001` (`five-phase-lifecycle`, oldest ADR) →
`created=2026-07-05`, `last_updated=2026-08-07` (a later bulk status-enum normalization pass
touched it after creation; that history is preserved, not invented).

## Touch-Paths

- `scripts/backfill-adr-frontmatter.ts` (new — one-time migration CLI)
- `scripts/backfill-adr-frontmatter.test.ts` (new — TDD tests for the pure planning function)
- `documentation/decisions/ADR-001-five-phase-lifecycle.md`
- `documentation/decisions/ADR-002-synthesizer-extraction.md`
- `documentation/decisions/ADR-003-synthesizer-removal.md`
- `documentation/decisions/ADR-004-adaptive-phase-routing.md`
- `documentation/decisions/ADR-005-pr-merge-gate-dependency-ordering.md`
- `documentation/decisions/ADR-006-kaizen-hunt.md`
- `documentation/decisions/ADR-007-drift-proof-toolchain-reseating.md`
- `documentation/decisions/ADR-008-routing-visibility-reuse-gate.md`
- `documentation/decisions/ADR-009-claude-marketplace-bundle-isolation.md`
- `documentation/decisions/ADR-010-autonomous-thinking-routes.md`
- `documentation/decisions/ADR-011-implement-time-accretion-control.md`
- `documentation/decisions/ADR-012-shared-artifact-substrate.md`
- `documentation/decisions/ADR-013-mercure-parity-program.md`
- `documentation/decisions/ADR-014-autonomy-default-only-mode.md`
- `documentation/decisions/ADR-015-routine-resume-confirmation-gate.md`
- `documentation/decisions/ADR-016-story-driven-conformance-adoption.md`
- `documentation/decisions/ADR-017-plan-time-ui-gate.md`
- `documentation/decisions/ADR-018-visual-evidence-gate.md`
- `documentation/decisions/ADR-019-ux-coherence-hunt-kind.md`
- `documentation/decisions/ADR-020-ruling-watermark-phase-gate-revalidation.md`
- `documentation/decisions/ADR-021-durable-artifact-staging.md`
- `documentation/decisions/ADR-022-backlog-hunt-kind.md`
- `documentation/decisions/ADR-023-merge-conflict-preflight.md`
- `documentation/decisions/ADR-024-v-pareto-code-split.md`
- `documentation/decisions/ADR-025-agent-plugins-skills-only-shell.md`
- `documentation/decisions/ADR-026-actionman-workclaude-merge-ready-gate.md`
- `documentation/decisions/ADR-027-forge-adapter-interface.md`
- `documentation/decisions/ADR-028-cursor-pattern-c-lite.md`
- `documentation/decisions/ADR-029-bash-write-target-worktree-containment.md`
- `documentation/decisions/ADR-030-plugin-cache-version-bump-gate.md`
- `documentation/decisions/ADR-031-generate-documentation-index.md`
- `documentation/decisions/ADR-032-unfalsifiable-test-review-check.md`
- `documentation/decisions/ADR-033-durable-research-notes.md`
- `documentation/decisions/ADR-034-audit-module-seam.md`
- `documentation/decisions/ADR-035-unfalsifiable-control-checklist-item.md`
- `documentation/decisions/ADR-036-executed-vs-reasoned-verification.md`
- `documentation/decisions/ADR-037-adr-watch-threshold-dispositions.md`

**Exemption clause**: no exemptions — every one of the 37 non-compliant files above must be
fully compliant (all 6 keys) after this change. `ADR-038` through `ADR-042` are explicitly
**out of scope** (already compliant; the migration script must be idempotent and a no-op on
them).

**Explicitly out of scope**: `documentation/decisions/INDEX.md` (source of truth this backfill
*reads*, never a write target) and the root `documentation/INDEX.md`
(`scripts/lib/doc-index-generate.ts:30` excludes `decisions/**` from its tree walk, so this
change has no interaction with that generator or issue #832's work — the two issues are
independent).

## Documentation Impact

None beyond the Touch-Paths ADR files themselves. `documentation/decisions/INDEX.md` is read,
not written. The root `documentation/INDEX.md` generator excludes `decisions/**`, so it has no
downstream consumer of this change to update.

## Migration Design Notes

**Reused conventions (`V-INT-01`/`V-INT-02`)**: the ADR-031 precedent migration,
`scripts/migrate-doc-index-summaries.ts`, established the pattern this script follows:
frontmatter parsing via `parseMdFrontmatter` (`scripts/lib/build/content.ts`), INDEX row parsing
via `parseIndexTableRows` (`scripts/lib/check-common.ts`), and a JSON-based
`encodeYamlScalar`/`decodeYamlScalar` idiom for YAML-safe string values. This plan's script
reuses all three rather than re-deriving them. It is a **new script**, not an extension of
`migrate-doc-index-summaries.ts`, because that file's `isExcludedPath` explicitly excludes
`decisions/**` from its own walk (`scripts/migrate-doc-index-summaries.ts:20`), and this
migration's 5-key, two-independent-I/O-source shape is materially different from that script's
single-field, single-source migration. Widening the existing script was considered and rejected
as a worse shape than a small dedicated script (`V-KISS-01`).

**All-or-nothing per file**: a file whose frontmatter cannot be round-trip-parsed, or whose
`created` date cannot be resolved via git history, is left completely untouched and reported in
an exceptions list rather than partially written.

**Rewrite shape**: the script fully regenerates each file's 6-line frontmatter block in the
canonical `doc-governance.md` field order (`type`, `summary`, `status`, `review_trigger`,
`created`, `last_updated`), carrying forward the existing `status` value and any already-present
`created`/`last_updated` values unchanged, filling only the keys that are absent. The body is
untouched byte-for-byte.

**Keep-or-delete decision: KEEP the script** (and its test file), unwired from
`package.json`/`verify`, matching the ADR-031 precedent exactly. Rationale: (1) reproducibility;
(2) the mandatory TDD tests need a surviving artifact to exercise; (3) `V-INT-01` (follow the
established convention at this exact touchpoint) outweighs a generic `V-YAGNI-03` concern here,
because the established convention at this touchpoint is "kept and tested, not deleted."

**Red-before-green spec (runs against committed content)**: `bash scripts/detect-doc-schema.sh
frontmatter <path>` discriminates on `last_updated`/`review_trigger` (blackhole-only) vs.
mercure-only keys — neither set present today on ADR-037, hence `ambiguous`. The implementer's
own worktree is freshly checked out from the current branch tip, so its working-tree copy is
authoritative at execution time (unlike the planner's stale main-clone checkout at plan time).
The spec:

1. **Before**: `bash scripts/detect-doc-schema.sh frontmatter documentation/decisions/ADR-037-adr-watch-threshold-dispositions.md` → must print `schema=ambiguous`.
2. **After** (same command, after the migration is applied in that worktree) → must print
   `schema=blackhole`.

## Task Steps

- [ ] **TDD Baseline Verification**: Run the project's test suite to confirm all existing tests
  pass before touching any file. — **AC**: baseline suite run, pass/fail counts quoted in the
  completion evidence.
- [ ] **Task 1 — Write failing tests**: Author `scripts/backfill-adr-frontmatter.test.ts` for a
  pure function `computeAdrFrontmatterBackfillPlan(adrDir, indexContent, dateLookup)` where
  `dateLookup: (relPath: string) => { created: string; lastUpdated: string } | null` is an
  injected callback. Cover: status-only, type+status, missing-summary-only, missing-summary+
  review_trigger, fully-compliant (skipped), no-INDEX-row (exception), unresolvable-date
  (exception), and YAML-safe encode/decode round-trip. — **AC**: all tests exist and fail before
  implementation.
- [ ] **Task 2 — Implement the pure planning function**: Implement
  `computeAdrFrontmatterBackfillPlan` in `scripts/backfill-adr-frontmatter.ts`. — **AC**: all
  Task 1 tests pass.
- [ ] **Task 3 — Implement the CLI + real git-log date resolver**: Add a CLI entrypoint with a
  real `dateLookup`, a file-rewrite step, `--dry-run`, and `--verify`. — **AC**:
  `bun run scripts/backfill-adr-frontmatter.ts --dry-run` prints exactly 37 planned entries and
  0 for ADR-038…042; exit code 0.
- [ ] **Task 4 — Run the migration**: Execute `bun run scripts/backfill-adr-frontmatter.ts`. —
  **AC**: `git diff --stat -- documentation/decisions/ADR-*.md` shows exactly the 37 Touch-Paths
  files changed, zero changes to ADR-038…042, all previously-present values byte-for-byte
  unchanged.
- [ ] **Task 5 — Verify summary parity across all 42**: Run
  `bun run scripts/backfill-adr-frontmatter.ts --verify`. — **AC**: exits 0, 0 mismatches across
  all 42 files.
- [ ] **Task 6 — Red-before-green schema check**: Execute the two-step spec above and quote both
  outputs verbatim. — **AC**: step 1 = `schema=ambiguous`; step 2 = `schema=blackhole`.
- [ ] **Verify Integrity**: Run the full test suite and lint. — **AC**: full suite green, lint
  clean, both quoted in the completion evidence.

## Sprint Contract

Every task above carries its own machine-verifiable AC. Definition of done = all seven ACs above
hold simultaneously, plus the unconditional TDD Baseline and Verify Integrity steps.
