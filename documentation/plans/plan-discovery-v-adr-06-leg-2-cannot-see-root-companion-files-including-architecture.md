---
issue: 766
rulings_checked_at: 5
ruling_conflicts: []
type: plan
status: current
summary: "Implementation plan widening V-ADR-06 leg 2's scan to the three root companion files (ARCHITECTURE.md, AGENTS.md, README.md) via an explicit file list, closing the coverage gap that left ARCHITECTURE.md's Active Constraints section unscanned for undisclosed ADR reversals"
review_trigger: "on file change"
created: 2026-09-04
last_updated: 2026-09-04
---

# Plan - Issue #766: V-ADR-06 leg 2 cannot see root companion files

## Objective

`collectPhraseScanViolations` (`scripts/checks/adr-supersession.check.ts`, V-ADR-06 leg 2) only
scans `src/**/*.md` and `documentation/**/*.md` (excluding `documentation/decisions/`). Root
companion files — `ARCHITECTURE.md`, `AGENTS.md`, `README.md` — sit outside both roots and are
never scanned, even though `ARCHITECTURE.md` is the single file most likely to carry an
undisclosed ADR reversal (it holds the `## Active Constraints` section that ADR-021 D1 staging
deposits ADR-provenance bullets into). Widen leg 2 to scan the three root companion files as an
explicit file list — not a directory walk — so build-output copies under `.claude/`, `.cursor/`,
`plugins/`, `skills/`, `codex-*`, `.agents/build/` remain excluded by construction, exactly as
issue #712 intentionally scoped the original walk.

## Touch-Paths

- `scripts/lib/companion-file-sync.ts` — add one new exported constant naming the root companion
  file set (see Codebase Conventions below for why this file is the correct home).
- `scripts/checks/adr-supersession.check.ts` — leg 2's `collectPhraseScanViolations` consumes the
  new constant to add the three root files to its scan set.
- `scripts/verify.adr-supersession.test.ts` — regression tests (see Test Plan).
- `src/references/blackhole-vcodes.md` — correct the V-ADR-06 row's stated scope (`V-DOCFACT-01`)
  — plus all generated dist trees per `scripts/lib/build/targets.ts`.

## Root-Cause Decision Record (bugfix)

- **Context**: V-ADR-06 leg 2's file collection was scoped in #712 to `src/**/*.md` +
  `documentation/**/*.md` (excluding `documentation/decisions/`); that scoping never included the
  three root companion files, which are outside both roots.
- **Root cause**: the original AC (#712) enumerated `src/` and `documentation/` as "the tracked
  prose surfaces that discuss ADR reversals" and did not consider repo-root files as a third,
  distinct surface — a genuine coverage gap in the original scope, not a regression.
- **Alternatives**: (a) widen the walk to the full repo root — rejected by #712 and reaffirmed
  here: it would recurse into every generated build-output tree and re-match each dist copy of
  every `src/**/*.md` file, producing duplicate findings per target tree; (b) add the three root
  files as an explicit, non-recursive list — chosen, matches the AC and the existing
  `companion-file-sync.ts` shape for this exact file set.
- **Fix**: add the three root companion files to leg 2's scan set as explicit
  `path.join(repoRoot, name)` entries (existence-checked, not walked).
- **Confidence**: High — the check's own architecture already separates "walk a directory" from
  "check a named file", so this fix reuses an established shape rather than inventing one.

## Codebase Conventions

| Concern | Convention | Touchpoint |
|---|---|---|
| Root companion file identity | `scripts/lib/companion-file-sync.ts` already owns per-file logic for `ARCHITECTURE.md` (`needsArchitectureRepair`) and `AGENTS.md` (`needsAgentsSymlinkRepair`) | `scripts/lib/companion-file-sync.ts` |
| Directory walk vs. explicit list | `collectPhraseScanViolations` already mixes `walkMdFilesAbs` (directories) with an exclusion filter — adding explicit root-file entries to the same `files` array is additive | `scripts/checks/adr-supersession.check.ts:139-145` |
| Repo-root abs-path resolution | `root` from `./check-utils.ts`, `path.join(repoRoot, name)` — same idiom `findAdrFileByNumber`/`needsArchitectureRepair` already use | `scripts/checks/adr-supersession.check.ts`, `scripts/lib/companion-file-sync.ts` |
| Test fixtures | `withTempDir` (`scripts/lib/test-fixtures.ts`) for filesystem-backed collector tests | `scripts/verify.adr-supersession.test.ts` |

No file in the repo exports a single constant naming all three root companion files as one set
prior to this plan; `companion-file-sync.ts` references `'ARCHITECTURE.md'` and `'AGENTS.md'` as
separate per-function literals. This plan adds one new exported constant,
`ROOT_COMPANION_MD_FILES`, to that file rather than declaring a second, independent list in
`adr-supersession.check.ts` (`V-INT-02`).

## Task Breakdown

1. Add `ROOT_COMPANION_MD_FILES = ['ARCHITECTURE.md', 'AGENTS.md', 'README.md'] as const` (exported)
   to `scripts/lib/companion-file-sync.ts`.
   — **AC**: the exported array's 3 values match exactly, asserted by a unit test.
2. Widen `collectPhraseScanViolations` in `scripts/checks/adr-supersession.check.ts` to import
   `ROOT_COMPANION_MD_FILES`, resolve each name against the repo root, keep only existing files,
   and append them to the existing `files` array (no change to the directory-walk calls).
   — **AC**: a temp-dir fixture with a trigger phrase in root `ARCHITECTURE.md` and no matching
   amendments section produces exactly one citation naming `ARCHITECTURE.md:<line>`.
3. Correct the V-ADR-06 row in `src/references/blackhole-vcodes.md` to name the three root
   companion files, worded so it does not itself contain a trigger phrase adjacent to an
   `ADR-\d+` token.
   — **AC**: the existing self-scan guard test in `verify.adr-supersession.test.ts` keeps passing.
4. Add two regression tests to `scripts/verify.adr-supersession.test.ts`'s
   `collectPhraseScanViolations` describe block: (a) a root-`ARCHITECTURE.md` trigger-phrase case
   producing one violation; (b) the same phrase duplicated under a simulated dist-tree path
   (e.g. `.claude/ARCHITECTURE.md`) producing exactly one violation (root only), proving the
   explicit-list approach does not introduce a repo-root walk.
   — **AC**: both tests pass; test count increases by exactly 2; zero regressions elsewhere.

## Test Plan (TDD)

1. RED: write the two new tests against the current, unfixed collector — the root-file test must
   fail.
2. GREEN: implement the constant + widened scan; re-run the full test file.
3. Re-run after the V-ADR-06 row correction to confirm the self-scan guard still passes.
4. Full regression: `bun run verify`.

## References

- Issue: #766
- Prior scoping: original leg-2 AC (issue #712, deliberately narrow)
- Enforcement site: `scripts/checks/adr-supersession.check.ts`
- V-code table: `src/references/blackhole-vcodes.md` (V-ADR-06 row)
- Pattern source: `scripts/lib/companion-file-sync.ts`
