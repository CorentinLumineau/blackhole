---
issue: #951
type: plan
summary: "Measures V-DOC-06 source-comment citation drift (~550 lines/~192 files under scripts/**+src/**) and amends the rule to grandfather pre-existing per-file citation conventions instead of sweeping"
status: current
review_trigger: "on file change"
created: 2026-09-07
last_updated: 2026-09-07
---


# Plan - Issue #951

## Objective

`V-DOC-06` (incident archaeology in source comments) is written as a blanket no-citation rule,
but is in practice enforced only on new files (PR #944 removed citations from 4 new module
headers; PR #946, an hour later, deliberately deferred WARNs on the same pattern in existing
files to avoid making those files internally inconsistent). Both calls were individually
defensible under the WARN contract, but together they mean the rule's real meaning diverges
from its written text.

This plan (1) measures the actual drift so the decision isn't made blind, and (2) resolves the
issue's own "sweep vs. amend" question — with a Decision Record stating the choice and why.
Measured now (`scripts/lib/fs.ts`'s file walker, comment-line-only, `.ts`/`.js` under
`scripts/**`/`src/**`, `.md` excluded, `describe()`/`test()`/`it()` title lines excluded):
**~550 `#NNN`-citing comment lines across ~192 files.** That is two orders of magnitude past
"one reviewable PR" (the issue's own AC #5 threshold) and, per the Pareto Gate below, a
repo-wide sweep does not clear the campaign's own `Priority >= 30` bar. The chosen path is
**amend `V-DOC-06`'s boundaries**, not sweep: add a fourth settled boundary that formalizes
exactly the distinction the two PRs already drew (new/previously-citation-free file → rule
applies; file that already carries pre-existing citations → a new comment there may keep the
file's convention). No source comment is edited by this plan — only the rule text (two
`src/references/**` doctrine files) and a new, reusable measurement tool that makes the next
re-measurement (if house style ever changes) a command, not a fresh manual grep.

### Decision Record (Hard Choice Protocol)

- **Context**: `V-DOC-06`'s written rule (no issue/PR citations in source comments) diverges
  from ~550 lines/~192 files of actual repo practice; two same-week PRs enforced it
  inconsistently for structurally sound reasons.
- **Alternatives**:
  - *Easy path — leave the rule as written, keep deferring WARNs case-by-case.* Costs nothing
    today, but guarantees the same PR #944/#946 disagreement recurs on every future diff to an
    existing file, forever, because the rule text gives the reviewer no basis to resolve it
    consistently.
  - *Hard-but-wrong path — sweep the repo.* ~550 lines/~192 files of pure comment churn, zero
    behavior change, multi-PR (issue's own AC #5), high merge-collision surface across a live
    6-way parallel campaign (`wave_scheduling.hot_files_max_one_per_wave` already flags
    contention risk on far smaller hot files). Pareto Priority for this alternative: Gain 3
    (marginal, cosmetic consistency only) × (11 − Effort 9) = **6 < 30** — fails the campaign's
    own filing/build gate (`V-PARETO-03`-shaped reasoning applied to a rule change, not a hunt
    filing, but the same formula and threshold this campaign holds every discretionary spend
    to).
  - *Chosen — amend the rule.* Formalizes what both PRs already independently concluded, with
    zero source-comment churn and a small, reviewable diff.
- **Choice**: Amend `V-DOC-06`'s written boundaries to add boundary (4): a file that already
  carries pre-existing citations is grandfathered; a genuinely new or previously-citation-free
  file still follows the plain no-citation rule.
- **Rationale**: Short-term cost (two doctrine-file edits + one small measurement tool, ~4
  effort points) buys long-term benefit (the PR #944/#946 disagreement cannot recur — the rule
  text now says explicitly what both reviewers already independently did) without the
  Pareto-negative sweep.
- **Confidence**: High — the measured count is an order of magnitude past what the issue's own
  AC #5 calls unreviewable, and the amendment does nothing but write down the exact boundary the
  two real PRs already drew.

## Touch-Paths

- `src/references/blackhole-vcodes.md` (plus all generated dist trees per
  `scripts/lib/build/targets.ts`) — V-DOC-06 row, existing Rule cell, append boundary (4); no
  new table row.
- `src/references/audits/26-comment-discipline-audit.md` (plus all generated dist trees per
  `scripts/lib/build/targets.ts`) — Incident-archaeology check bullet, sync to the same four
  boundaries (boundaries 1-3 already exist in the vcodes.md SSOT but were never mirrored into
  this doctrine file; closed here alongside the new boundary 4, same edit).
- `scripts/lib/doc06-citation-scan.ts` (new) — pure citation-detection functions + a
  `walkFilesAbs`-backed directory scan.
- `scripts/lib/doc06-citation-scan.test.ts` (new) — unit + fixture-directory tests.
- `scripts/analyze-doc06-citations.ts` (new) — thin CLI wrapper printing the per-file/total
  report.
- `scripts/analyze-doc06-citations.test.ts` (new) — CLI smoke test (`spawnSync`, same pattern as
  `scripts/decision-log-append.test.ts`).

## Documentation Impact

- `src/references/blackhole-vcodes.md` and `src/references/audits/26-comment-discipline-audit.md`
  are agent/skill reference docs under `src/references/**`, not `documentation/` tree docs —
  `doc-governance.md`'s canonical-naming/search-before-write obligations don't apply to this
  diff; they apply to `documentation/` tree files only, and this plan creates none by hand.
- The one `documentation/` artifact this plan produces is the durable plan copy staged per
  ADR-021 D3 (`documentation/plans/plan-v-doc-06-is-enforced-on-new-files-only-decide-whether-to-sweep-source-comment-ci.md`)
  — mechanically staged by this planner run (see staged artifacts), carried into the PR by the
  implementer's carry-step, not hand-authored.
- No other consumer doc references `V-DOC-06`'s boundaries outside these two `src/references/**`
  files and their generated dist siblings (confirmed by a repo-wide `V-DOC-06` grep during
  planning — the only two non-generated hits are these SSOT files; `.claude/rules/`,
  `.cursor/`, `skills/`, `plugins/`, `codex-skills/`, `.agents/build/` copies are all build
  output).

## Codebase Conventions

| Touchpoint | Convention | Evidence |
|---|---|---|
| Directory walking | Reuse `walkFilesAbs` from `scripts/lib/fs.ts` — "the one shared tree-walker" (ADR-007 R6). Never hand-roll a recursive `readdirSync` walk (`V-INT-02`). | `scripts/lib/fs.ts` header comment: "build.ts, verify checks, tree-shape tests, and bun:test fixtures across scripts/ migrate onto these three primitives instead of each defining its own recursive walk" |
| Repo-root resolution | Reuse `root` exported from `scripts/checks/check-utils.ts`. Never hardcode an absolute path or rely on `process.cwd()`. | `scripts/lib/check-common.ts:4` imports `root` this way; same pattern in `scripts/decision-log-append.ts:5` |
| Temp-dir test fixtures | Reuse `makeTempDir` from `scripts/lib/fs.ts` for the integration-style directory-scan test, not a hand-rolled `fs.mkdtempSync`. | `scripts/lib/fs.ts`'s own header comment names `makeTempDir` as one of "the three primitives" |
| CLI flag parsing (if any flags are added) | Reuse `parseFlags` from `scripts/lib/argv-flags.ts`. MVP needs none — no flags are added (`V-YAGNI-01`). | `scripts/decision-log-append.ts:6`, `scripts/plan-quality-gate.ts:9` |
| Test framework | `bun:test` (`describe`/`test`/`expect` imported from `'bun:test'`), matching every existing `scripts/**/*.test.ts` sibling file. | `scripts/decision-log-append.test.ts:1` |
| Test file location | Colocated `*.test.ts` sibling to the module under test — not a separate `tests/`/`__tests__/` tree. This is the established, universal convention across `scripts/**` (`scripts/lib/check-common.test.ts`, `scripts/decision-log-append.test.ts`, etc.), overriding the generic global default for this repo (`V-INT-01`). | `scripts/lib/check-common.ts` + `scripts/lib/check-common.test.ts` sit side by side; same for every other `scripts/**` module |
| Doc source vs. dist tree | Edit only `src/references/**` (SSOT); dist trees (`.claude/`, `.cursor/`, `skills/`, `plugins/`, `codex-skills/`, `.agents/build/`) are regenerated by `bun run build`, never hand-edited. | `.claude/rules/blackhole-vcodes.md`'s own trailer: `<!-- GENERATED by scripts/build.ts from src/references/blackhole-vcodes.md -->`; `.claude/agents/reviewer.md`'s trailer lists `src/references/audits/26-comment-discipline-audit.md` as one of its includes |
| V-code table row shape | `blackhole-vcodes.md`'s table is `\| Code \| Rule \| Severity \| Primary enforcement site \|` (4 columns) — the amendment appends prose to the existing V-DOC-06 row's Rule cell; it is a single existing row extended, never an additional row (boundaries 1-3 were added to this same cell in a prior PR, same pattern). | `src/references/blackhole-vcodes.md` V-DOC-06 row, already carries 3 numbered boundaries in one cell |

## Task Breakdown

- [ ] **TDD Baseline Verification**: Run `flock /tmp/blackhole-verify.lock -c 'bun test'` to
      confirm the existing suite is green before touching anything. — **AC**: baseline run
      completes; pass/fail counts quoted verbatim in the completion evidence.
- [ ] **Write failing tests for the citation-detection primitives**: Create
      `scripts/lib/doc06-citation-scan.test.ts` covering `isCommentLine(line)`,
      `isIssueCitationLine(line)`, and `countCitationsInFile(content)` — fixtures include a
      `//` line comment citing `#951`, a `/* ... */` block-comment continuation line (`* ...`)
      citing an issue, a non-comment code line containing `#123` (must NOT count), a
      `describe('...#123...')` title line (must NOT count — it's code, not a comment, but the
      fixture makes the exemption explicit and testable per the issue's AC #3), and a plain
      prose line with no digits after `#` (must NOT count, guards against `#fff`-style
      false positives). — **AC**: `bun test scripts/lib/doc06-citation-scan.test.ts` fails
      (module/functions not found) before implementation exists.
- [ ] **Implement the citation-detection primitives**: Implement
      `scripts/lib/doc06-citation-scan.ts` exporting `isCommentLine`, `isIssueCitationLine`,
      `countCitationsInFile`, and `scanDirsForCitations(absDirs: string[]): { file: string;
      count: number }[]` (the last one built on `walkFilesAbs` from `./fs.ts`, filtered to
      `.ts`/`.js` extensions only — `.md` is never walked). — **AC**: the tests from the
      previous task now pass (`bun test scripts/lib/doc06-citation-scan.test.ts` green); no
      file outside this plan's Touch-Paths is modified.
- [ ] **Write and pass the exemption-fixture integration test**: Extend
      `scripts/lib/doc06-citation-scan.test.ts` with a `makeTempDir()`-backed fixture directory
      containing (a) a `.ts` file with a `#951`-citing comment line, (b) a `.md` file with a
      `#951`-citing line, and (c) a `.ts` file whose only citation appears inside a
      `describe('regression for #951', () => ...)` title (code, not a comment). Assert
      `scanDirsForCitations([fixtureDir])` reports exactly 1 finding (the `.ts` comment line),
      excluding both (b) and (c) — the two settled exemptions the issue's own AC #3 requires a
      test for. — **AC**: this specific test passes and, run against a deliberately mutated
      fixture where the `.md` line is moved into a `.ts` comment, the count changes from 1 to
      2 (proves the assertion is falsifiable, not vacuously true).
- [ ] **Implement and test the CLI wrapper**: Implement `scripts/analyze-doc06-citations.ts`
      (CLI entry, `import.meta.main` guard matching `scripts/plan-quality-gate.ts`'s shape)
      that calls `scanDirsForCitations([path.join(root, 'scripts'), path.join(root, 'src')])`,
      prints a per-file breakdown (descending by count) and a `Total files: <M>` /
      `Total citing comment lines: <N>` summary, and exits 0. Add
      `scripts/analyze-doc06-citations.test.ts` (`spawnSync`, same pattern as
      `scripts/decision-log-append.test.ts`) asserting exit code 0 and that stdout contains
      both summary lines. — **AC**: `bun test scripts/analyze-doc06-citations.test.ts` green.
- [ ] **Run the measurement and record it**: Run
      `flock /tmp/blackhole-verify.lock -c 'bun run scripts/analyze-doc06-citations.ts'` against
      the live tree and paste the exact output (totals + top files) into the PR description's
      Decision Record section, replacing this plan's ~550/~192 estimate with the live-recomputed
      number — satisfies the issue's AC #1 ("measured and reported, by file, before any edit").
      — **AC**: command exits 0; PR description contains the literal `Total files:` /
      `Total citing comment lines:` lines from this run.
- [ ] **Amend `src/references/blackhole-vcodes.md`'s V-DOC-06 row**: Append boundary (4) to the
      existing Rule cell (grandfather clause — see Objective for exact wording), citing the
      live-measured count from the previous task. Do not touch the row's Severity or Primary
      enforcement site columns, and do not add a new table row (see Codebase Conventions —
      `V-code table row shape`). — **AC**: `grep -c "pre-existing" src/references/blackhole-vcodes.md`
      returns `>= 1`; a diff of the file shows changes confined to the single V-DOC-06 row line.
- [ ] **Sync `src/references/audits/26-comment-discipline-audit.md`**: Rewrite the
      Incident-archaeology check bullet to enumerate the same four boundaries (concise
      operational restatement citing `blackhole-vcodes.md` as the canonical full text, per
      `V-DOC-05` — not a verbatim duplicate). — **AC**: the bullet mentions all of
      `describe()`/`test()`/`it()`, module-header, markdown-prose, and the new grandfather
      boundary; `grep -c "pre-existing" src/references/audits/26-comment-discipline-audit.md`
      returns `>= 1`.
- [ ] **Rebuild dist trees**: Run `flock /tmp/blackhole-verify.lock -c 'bun run build'`. — **AC**:
      exit code 0; `grep -c "pre-existing" .claude/rules/blackhole-vcodes.md` and
      `grep -c "pre-existing" .claude/agents/reviewer.md` both return `>= 1`, proving the
      amendment reached the generated dist trees, not just the `src/**` source.
- [ ] **Verify Integrity**: Run
      `flock /tmp/blackhole-verify.lock -c 'bun test scripts/lib/doc06-citation-scan.test.ts scripts/analyze-doc06-citations.test.ts'`
      and `flock /tmp/blackhole-verify.lock -c 'bun run verify'`. — **AC**: both commands exit
      0; `git diff --stat` (scoped to this plan's Touch-Paths) shows only the six files listed
      above — no file outside Touch-Paths modified, and critically, **zero source-comment
      lines changed anywhere else in the repo** (the invariance the issue's AC #4 asks for,
      trivially true here since no sweep is performed).

## Execution Strategy & Stop Conditions

- If the live re-measurement (task 6) comes back an order of magnitude past this plan's ~550
  line / ~192 file estimate (e.g. > 2000 lines or > 400 files), **halt before amending the rule
  text** and escalate to a design-track follow-up instead — a discrepancy that large signals
  something structurally different from what was analyzed here, and a plain WARN-boundary edit
  would be the wrong-sized response.
- If `git diff --stat` after the dist-tree rebuild (task 9) touches any file outside this plan's
  declared Touch-Paths and their known generated dist siblings, **abort and investigate before
  committing** — do not force through unexpected build drift.
- If the citation-scan tests (task 2-4) cannot be made to pass without modifying a file outside
  this plan's Touch-Paths (e.g. a shared helper needs a signature change), **abort and request a
  Touch-Paths widening** via the plan's Scope Amendments mechanism rather than silently
  expanding scope.

## Sprint Contract

Definition of done is the per-task **AC** lines above; there is no task relying on the blanket
"all tests and linters pass" fallback — every task's AC is independently machine-verifiable.

## Quality Gate Results

| Check | Result |
|---|---|
| `touch_paths_declared` | PASS — 6 concrete paths listed, no globs |
| `schema_baseline` | PASS — N/A, no DB/API schema touched |
| `ac_mapping` | PASS (`bun run scripts/plan-quality-gate.ts`) |
| `critical_files_exist` | PASS — no `## Critical Files` section (none pre-existing/sensitive touched) |
| `mitigation_concrete` | PASS (`bun run scripts/plan-quality-gate.ts`) |
| `ac_sweep_conflict` | PASS — no sweep-to-zero AC present in this plan (sweep was declined, not performed) |
| `ac_sweep_scope` | PASS — same reason |
| `touch_paths_ssot_gap` | PASS (`findTouchPathSsotGaps`) — `blackhole-vcodes.md` is touched, but the edit only extends the pre-existing V-DOC-06 cell (no additional row, no minting, no insertion language anywhere in this plan), so the `VCODE_TABLE_ROW_COUNT` companion trigger correctly does not fire |
| `ac_facts_literal_bump` | PASS — `scripts/lib/build/facts.ts` is not touched by this plan |
