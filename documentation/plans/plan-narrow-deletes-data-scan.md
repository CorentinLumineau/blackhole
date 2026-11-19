---
type: plan
summary: "Narrow merge-risk's deletes-data keyword scan so docs, tests and the matcher's own source no longer raise it (issue #1343)"
status: current
review_trigger: "on file change"
created: 2026-11-19
last_updated: 2026-11-19
related: [scripts/lib/merge-gate/merge-risk.ts, scripts/lib/merge-gate/merge-risk.test.ts]
---

# Plan: narrow the deletes-data scan (issue #1343)

Track: Quick (one source file, one test file, no schema or API change). Owner decision PD-1, 2026-11-19.
Plan base: origin/main 243e078c. Pareto: Gain 7 x (11 - Effort 2) = 63 (>= 30).

## Objective

`classifyMergeRisk` (`scripts/lib/merge-gate/merge-risk.ts`, patch loop near line 208) runs
`DESTRUCTIVE_SQL` over every patch except those `isTestPath` matches. A docs diff, or a diff to
the matcher's own source (which contains the `DELETE FROM` / `DROP TABLE` regex literal), therefore
raises `deletes-data` and parks the PR as needs-chef (#1294). Make the keyword scan apply only to
real data files and non-test, non-doc code. Release (`release-tag`) and workflow
(`github-workflows`) holds are unchanged.

## Decision Record (V-FIX-01 / V-CHOICE-01)

- Root cause: the keyword scan's exclusion list is only `isTestPath`; it has no notion of
  documentation, and the matcher's own file is code that quotes the keywords as data.
- Chosen: add a scan-exemption predicate `isKeywordScanExempt(p)` = test path OR doc path OR the
  matcher's own source path, with real data files (`.sql`, `.dump`, migration paths) always
  scanned even when under a test/doc directory. One predicate, one branch in the patch loop.
- Harder alternative considered: parse added lines and drop comments/string literals/markdown
  prose before matching, so no path list is needed. Rejected: needs a per-language tokenizer, a
  false negative on a real `db.exec("DELETE FROM x")` string in production code is a safety
  regression, and the owner's decision is expressed in path terms.
- Residual risk accepted: a production file merely quoting the keywords still holds (needs-chef is
  the safe failure); only the matcher's own path is exempted by name.

## Touch-Paths

- `scripts/lib/merge-gate/merge-risk.ts`
- `scripts/lib/merge-gate/merge-risk.test.ts`
- `src/references/merge-gate.md` only if its section 9 states the deletes-data scope (update that
  sentence; plus all generated dist trees per `scripts/lib/build/targets.ts`, via `bun run build`)

## Codebase Conventions / reuse (V-INT-02)

- Reuse the existing `isTestPath` (same file, exported, already tested) and `posix`; do not add a
  second test-path classifier.
- Reuse existing `DATA_EXT` (`sql|dump|csv`) and the `migrations` `PATH_RULES` entry for the
  "real data file" test instead of new regexes; export nothing new unless a test needs it.
- No other repo helper classifies doc paths (grep for `isDocPath`/`isDocsPath` found none), so one
  small `isDocPath` (`documentation/` or `docs/` prefix, `.md`/`.mdx` extension) is added beside
  `isTestPath`, exported and tested the same way.
- Own-source path: a single constant `MATCHER_SOURCE = 'scripts/lib/merge-gate/merge-risk.ts'`.

## Task Steps (test first, red before green)

1. In `merge-risk.test.ts` add failing cases (each via `classifyMergeRisk` with
   `headRef: 'blackhole/issue-1'`):
   - docs-only: patch `+ DROP TABLE accounts` on `documentation/merge-gate.md` -> no `deletes-data`, `low_risk` true.
   - test-file mention: `+ DELETE FROM users` on `scripts/lib/foo.test.ts` -> no `deletes-data` (regression guard, already green).
   - matcher source: `+ DELETE FROM` on `scripts/lib/merge-gate/merge-risk.ts` -> no `deletes-data`.
   - migration/SQL still raised: `+ DROP TABLE t` on `db/migrations/001.sql` and on `ops/reset.sql` -> contains `deletes-data`.
   - production `.ts`: `+ DELETE FROM users` on `src/cleanup.ts` -> contains `deletes-data`.
   - `isDocPath` unit test: `documentation/x.md` and `README.md` true, `src/a.ts` false.
   - release/workflow unchanged: existing "each high-risk category refuses automerge" test stays green.
2. In `merge-risk.ts` add `isDocPath`, `MATCHER_SOURCE`, and gate the patch loop:
   scan when `isDataFile(p)` (`.sql`/`.dump` or migrations path) OR not (`isTestPath(p)` || `isDocPath(p)` || `p === MATCHER_SOURCE`). Leave the `package.json` release-tag line independent of the gate (move it above the `continue` so a test/doc path cannot skip it, preserving current behavior: today it is skipped only for test paths, keep that exactly).
3. Update the merge-gate doc sentence if present; run `bun run build` only if a `src/` file changed.
4. Verify per CI-first rule: one focused `bun test scripts/lib/merge-gate/merge-risk.test.ts` through `with-test-lock`; CI runs the rest.

## Acceptance Criteria (measurable)

- **AC1**: docs-only diff (`documentation/*.md`) mentioning DROP/DELETE yields `reasons` without `deletes-data` and `automerge` true on a campaign branch (test asserts).
- **AC2**: test-file diff mentioning DROP/DELETE yields no `deletes-data`.
- **AC3**: diff to `scripts/lib/merge-gate/merge-risk.ts` containing the keywords yields no `deletes-data`.
- **AC4**: `.sql` and migration-path patches containing destructive SQL still yield `deletes-data`.
- **AC5**: a production `src/**/*.ts` patch with `DELETE FROM` still yields `deletes-data`.
- **AC6**: existing merge-risk tests (release-tag, github-workflows, data-file deletion, CLI) pass unmodified.
- **AC7**: #1294 re-evaluates without the hold (verified post-merge by running the merge-risk CLI on its snapshot).

## Stop conditions

- If AC4 or AC5 test fails after the change, revert the gate and re-plan rather than widening exemptions.
- If any existing test needs editing to pass (other than additions), stop: scope has drifted.

## Documentation Impact

`src/references/merge-gate.md` section 9 if it describes the deletes-data scan; otherwise None, behavior is internal to the classifier.
Root `documentation/INDEX.md` is regenerated by the implementer carry-step, not here.
