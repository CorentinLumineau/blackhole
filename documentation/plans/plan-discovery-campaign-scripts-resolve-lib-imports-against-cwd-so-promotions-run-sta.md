---
issue: 798
type: plan
status: current
review_trigger: "on file change"
created: 2026-09-04
last_updated: 2026-09-04
related:
  - .blackhole/plans/issue-798-investigation.md
---

# Plan: Campaign scripts resolve `./lib` imports against cwd (#798)

## Root-Cause Decision Record (V-FIX-01 — Bugfix Gate)

- **Context**: `bun run scripts/<name>.ts` resolves the entry file and every subsequent
  relative `./lib/...` import against the **process cwd**, not against any `--repo-root`/
  `--config`/`--ledger` argument value — so whichever git worktree cwd happens to point into
  supplies the entire module graph for `check-review-artifact.ts`, `carry-staged-artifacts.ts`,
  and `scripts/lib/companion-file-sync.ts`, independent of which tree those scripts are told to
  operate on. `.blackhole/plans/issue-798-investigation.md` confirms this is still fully live
  after this session's #792 (main-clone-vs-origin freshness) and #806 (CLI-argument-path-
  absoluteness) merges — both operate on orthogonal axes and leave module resolution untouched
  — and traces a concrete incident (PR #790 / issue #743) where a fix living only on an
  unmerged worktree branch's `scripts/lib/check-common.ts` was silently skipped because
  `carry-staged-artifacts.ts` ran from the main-clone cwd instead of the worktree.

- **Alternatives**:
  - **(a) Detect-and-fail-loudly** — the issue's own AC2: `git rev-parse HEAD` compare between
    cwd's tree and `--repo-root`'s tree, fail loudly on mismatch. Strongest case for this
    alone: it needs no change to Bun's own resolution behavior, and a HEAD-SHA compare is
    simple to reason about. Investigator-confirmed gap: it passes when both trees share a HEAD
    SHA but either has uncommitted/staged edits under `scripts/lib/` (mid-edit, stash, WIP
    hotfix) — the check reports "match" while the code that actually executed still differs.
  - **(b) Structural `--cwd` pin** — the investigator's precedented alternative:
    `scripts/consumer-promote-review.sh` and `blackhole-state.md` §"Write protocol" already run
    `bun run --cwd <target-root> scripts/<name>.ts` for the *vendored-plugin-vs-consumer-repo*
    boundary. Bun's own `--cwd` flag ("Absolute path to resolve files & entry points from. This
    just changes the process' cwd.") pins both the entry-path lookup and every transitive
    relative import to a named directory, eliminating the divergence class structurally rather
    than detecting it after the fact. Strongest case against relying on it *alone*: it protects
    only the documented, agent-followed invocation path — a human or a future new call site that
    forgets to pass `--cwd` gets no runtime signal.
  - **(c) Both** — investigator's explicit recommendation: "(b) as the primary fix shape for
    AC1/AC2 together, with the HEAD/dirty-check as a defense-in-depth regression guard (AC2/AC3)
    rather than the only line of defense."

- **Choice**: (c), realized as **(b) as the structural fix** for every self-hosting
  main-clone-vs-worktree invocation of the three named scripts, plus **a static doc-invariant
  regression check** (`scripts/checks/cwd-pin-guard.check.ts`) as the defense-in-depth leg —
  not a literal port of (a)'s runtime `git rev-parse`/dirty-check.

- **Rationale**: Once every cross-tree invocation is pinned via `--cwd <repo-root>`, there is no
  longer a separate "process cwd" for a runtime check to compare against `--repo-root` — Bun's
  `--cwd` argument *becomes* the resolution root, so (a)'s HEAD-SHA-plus-dirty-check would be
  comparing a tree against itself once the fix lands; the mismatch it was built to catch cannot
  occur through the documented invocation path anymore. The residual risk (a`) is narrower than
  what AC2 was written against: only a manually-run or future-undocumented invocation that
  forgets `--cwd` remains exposed, and that is exactly what a static content-gate check catches
  during `bun run verify` (CI-blocking), before any such code change merges — the same
  regression-class-not-instance framing `scripts/checks/jq-empty-guard.check.ts` already uses
  for a comparable repeated-incident class (#536/#546/#553). Building and maintaining a second,
  runtime git-cross-tree-compare mechanism inside three separate scripts to catch a strictly
  narrower residual than what the static check already catches at review time is disproportionate
  effort for this bugfix's actual risk reduction (V-PARETO-01/V-KISS-01) — deferred, not
  forgotten: if a future incident shows the documented-harness-only assumption doesn't hold (an
  ad hoc, non-agent-driven invocation actually happens in practice), promoting to a runtime
  check is a scoped follow-up, not a redesign.
- **Confidence**: High.

## Objective

Eliminate the cwd-vs-`--repo-root` module-resolution divergence for every self-hosting
(main-clone-vs-worktree, same-repo) invocation of `check-review-artifact.ts`,
`carry-staged-artifacts.ts`, and `scripts/lib/companion-file-sync.ts`, by pinning `bun run`'s
`--cwd` flag to the same absolute path already passed as `--repo-root`, and add a static
regression guard so the pin cannot be silently dropped from the documented invocation strings
later.

**Explicitly out of scope**: `scripts/promote-review-artifact.ts`'s self-hosting ("plugin
repo") invocation (`implementer.md` §"Promote Review Artifact") — it takes no `--repo-root`/
cross-tree argument at all; its only inputs are the main-clone-resident `--ledger` file and
issue/PR/branch/head metadata strings, so there is no second tree whose code it could
accidentally borrow from. Its **consumer-worktree** variant is already `--cwd`-pinned
(`scripts/consumer-promote-review.sh`, ADR-021 D3 / issue #687) and is a different boundary
(vendored-plugin-root vs. consumer-repo) than this issue's self-hosting scope. Extending
`--cwd` treatment to a consumer-repo wrapper for `check-review-artifact.ts` is a candidate
follow-up, not part of this fix (V-SCOPE-01 — no drive-by).

## Touch-Paths

- `src/agents/implementer.md` (source; plus all generated dist trees per
  `scripts/lib/build/targets.ts`)
- `src/references/merge-gate.md` (source; plus all generated dist trees per
  `scripts/lib/build/targets.ts`)
- `src/references/phase-loop.md` (source; plus all generated dist trees per
  `scripts/lib/build/targets.ts`)
- `src/references/companion-file-sync.md` (source; plus all generated dist trees per
  `scripts/lib/build/targets.ts`)
- `src/references/blackhole-vcodes.md` (source; plus all generated dist trees per
  `scripts/lib/build/targets.ts`)
- `scripts/check-review-artifact.ts` (usage message + inline comment only — no parsing/behavior
  change)
- `scripts/carry-staged-artifacts.ts` (usage message + inline comment only — no parsing/behavior
  change)
- `scripts/checks/cwd-pin-guard.check.ts` (new file)
- `scripts/verify.cwd-pin-guard.test.ts` (new file)

## Documentation Impact

None — no `documentation/**` file is created or modified. Every touched file is either agent/
skill instruction content (`src/agents/`, `src/references/`) built to `.claude/`/other platform
trees, or campaign tooling (`scripts/`). `docs_governance.enabled` is `true` for this campaign,
but its scope (search-before-write, lifecycle frontmatter, canonical naming) applies to the
`documentation/` tree, which this change does not touch.

## Critical Files

- `scripts/check-review-artifact.ts` — merge-readiness gate; a mistake here can silently pass or
  silently block every campaign merge (see merge-gate.md §5).
- `scripts/carry-staged-artifacts.ts` — ADR-021 D2 carry-step; a mistake here can silently drop
  staged plan/design/analysis artifacts from a PR.

## Codebase Conventions

| Concern | Convention | Touchpoint |
|---|---|---|
| Cross-repo-boundary `bun run` invocation | `bun run --cwd <target-root> scripts/<name>.ts ...` — already established for the vendored-plugin-vs-consumer-repo boundary | `scripts/consumer-promote-review.sh`, `blackhole-state.md` §"Write protocol" (`state-write-guard.ts` consumer invocation), `scripts/promote-review-artifact.ts`'s own usage() comment |
| Static content-gate check shape | A `scripts/checks/<name>.check.ts` exporting a pure detector function plus `runChecks(): CheckResult[]`, glob-discovered by `scripts/verify.ts` — no manual registration/count bump needed | `scripts/checks/jq-empty-guard.check.ts` (regression-class-not-instance framing for a repeated real-incident class), `scripts/checks/check-utils.ts` (`root`, `CheckResult`, `read`) |
| Paired regression test naming | `scripts/verify.<check-name>.test.ts` imports the check's exported pure functions plus `runChecks` and asserts both synthetic fixtures and the live tree | `scripts/verify.jq-empty-guard.test.ts` |
| V-code table registration | New checks get a row in `src/references/blackhole-vcodes.md` (Code, Rule, Severity, Primary enforcement site) | `blackhole-vcodes.md` existing rows for `scripts/checks/*.check.ts`-backed codes (e.g. `V-ADR-01..03`, `V-CONFIG-02`) |

## Task Breakdown

1. **Pin `--cwd` for `check-review-artifact.ts`'s three self-hosting invocation sites**
   — `src/references/merge-gate.md` (the "Mechanical check:" line), `src/references/phase-loop.md`
   (step 2.5's `check-review-artifact.ts` line), `src/agents/implementer.md` (§"Promote Review
   Artifact"'s "Verify (issue #806)" line). Rewrite each `bun run scripts/check-review-artifact.ts
   --config <abs> ...` to `bun run --cwd <abs repo-root> scripts/check-review-artifact.ts --config
   <abs> ... --repo-root <abs repo-root> ...`, stating inline that the `--cwd` value MUST equal
   the `--repo-root` value. Update `scripts/check-review-artifact.ts`'s `usage()` string (line 10)
   to show the `--cwd`-prefixed form, and extend the existing `#806 AC4` inline comment (lines
   11-12) with a sibling sentence naming issue #798 and the `--cwd` pin.
   — **AC**: all three doc sites' invocation lines contain `--cwd` immediately after `bun run`
   and before `scripts/check-review-artifact.ts`; `scripts/check-review-artifact.ts`'s usage()
   string and its lines-11-12 comment both mention `#798`; `bun run scripts/check-review-artifact.test.ts`
   still passes unmodified (CLI parsing/behavior unchanged).

2. **Pin `--cwd` for `carry-staged-artifacts.ts`'s invocation site**
   — `src/agents/implementer.md` §"Carry Staged Artifacts"'s "Invoke:" line. Rewrite `bun run
   scripts/carry-staged-artifacts.ts --manifest {repo_root}/.blackhole/staged/<issue>/manifest.json
   --repo-root <this worktree's absolute path> --staging-root {repo_root}` to `bun run --cwd
   <this worktree's absolute path> scripts/carry-staged-artifacts.ts --manifest ... --repo-root
   <this worktree's absolute path> --staging-root {repo_root}` — `--staging-root` stays
   `{repo_root}` (staged artifacts only ever live in the main clone, unaffected by this fix) while
   `--cwd` and `--repo-root` both take the worktree path. Update `scripts/carry-staged-artifacts.ts`'s
   `usage()` string and add an inline comment citing #798, mirroring `check-review-artifact.ts`'s
   Task 1 comment shape.
   — **AC**: `implementer.md`'s Invoke line contains `--cwd` immediately after `bun run` and before
   `scripts/carry-staged-artifacts.ts`; the usage() string and a new inline comment both mention
   `#798`; `bun run scripts/carry-staged-artifacts.test.ts` still passes unmodified.

3. **Pin `--cwd` for `scripts/lib/companion-file-sync.ts`'s two invocation sites**
   — `src/agents/implementer.md` §"Companion-file Sync"'s fenced `bun run` line, and
   `src/references/companion-file-sync.md` §"Procedure (implementer)" step 2's identical fenced
   line. Rewrite `bun run scripts/lib/companion-file-sync.ts --repo-root <worktree-abs>
   --diff-file <paths.txt>` to `bun run --cwd <worktree-abs> scripts/lib/companion-file-sync.ts
   --repo-root <worktree-abs> --diff-file <paths.txt>`.
   — **AC**: both fenced invocation lines contain `--cwd <worktree-abs>` immediately after
   `bun run` and before `scripts/lib/companion-file-sync.ts`; `bun run scripts/companion-file-sync.test.ts`
   still passes unmodified.

4. **Add the static regression guard `scripts/checks/cwd-pin-guard.check.ts`**
   — Export a pure detector `findMissingCwdPin(content: string, label: string): string[]`
   (same `(content, label) -> violations[]` shape as `findBareJqEmptyPrescriptions`) that scans
   markdown content line-by-line for a `bun run scripts/check-review-artifact.ts`,
   `bun run scripts/carry-staged-artifacts.ts`, or `bun run scripts/lib/companion-file-sync.ts`
   invocation and flags any such line (or fenced-code-block invocation spanning to the next
   non-continuation line) that does not carry `--cwd` immediately after `bun run`. Export
   `runChecks(): CheckResult[]` returning one `{ id: 'V-CWDPIN-01', ok, detail }` result computed
   by walking `src/agents/*.md` + `src/references/*.md` via `walkMdFilesAbs` (reused from
   `scripts/lib/check-common.ts`, `V-INT-02` — do not re-walk by hand). Add the paired
   `scripts/verify.cwd-pin-guard.test.ts` mirroring `scripts/verify.jq-empty-guard.test.ts`'s
   structure: unit tests for `findMissingCwdPin` against a red fixture (invocation string missing
   `--cwd`) and a green fixture (invocation string with `--cwd` present), plus a
   `runChecks()`-against-the-live-tree test asserting exactly one `V-CWDPIN-01` result with
   `ok: true` once Tasks 1-3 land.
   — **Sweep scope and exemption clause**: scope path is `src/agents/*.md` + `src/references/*.md`;
   no exemptions — every matching invocation-line pattern across those two directories must
   carry `--cwd`, including any future new call site of the three named scripts.
   `scripts/promote-review-artifact.ts` invocation lines are excluded from the pattern set itself
   (not exempted from an otherwise-matching pattern) because that script takes no `--repo-root`/
   cross-tree argument — see Objective's "Explicitly out of scope" note.
   — **AC**: `bun run scripts/verify.cwd-pin-guard.test.ts` passes with both the red-fixture and
   green-fixture unit tests green, and the live-tree `runChecks()` test returns exactly one
   `{ id: 'V-CWDPIN-01', ok: true }` result.

5. **Register `V-CWDPIN-01` in the V-codes table**
   — Add a row to `src/references/blackhole-vcodes.md`'s table: `V-CWDPIN-01 | A documented
   bun run invocation of check-review-artifact.ts, carry-staged-artifacts.ts, or
   scripts/lib/companion-file-sync.ts omits a --cwd pin matching its --repo-root value | BLOCK |
   scripts/checks/cwd-pin-guard.check.ts`. Rebuild dist trees.
   — **AC**: `grep -c 'V-CWDPIN-01' src/references/blackhole-vcodes.md` returns `1`; `bun run build`
   exits `0`; `bun run verify` exits `0` with the new check's `V-CWDPIN-01` result `ok: true`
   among its output.

## Test Plan

- Unit: `scripts/verify.cwd-pin-guard.test.ts` (new, Task 4) — red/green fixtures for
  `findMissingCwdPin`, plus a live-tree `runChecks()` assertion.
- Regression: `scripts/check-review-artifact.test.ts`, `scripts/carry-staged-artifacts.test.ts`,
  `scripts/companion-file-sync.test.ts` — unmodified CLI parsing/behavior, must stay green
  (doc-only + comment-only changes to their respective scripts' non-executed lines).
- Full gate: `bun run verify` (CI-blocking runner; glob-discovers the new check automatically,
  no manual registration).
- Build: `bun run build` — confirms the four edited `src/agents/*.md`/`src/references/*.md`
  sources compile cleanly to every generated dist tree.

## Execution Strategy & Stop Conditions

- If any of the three script `.test.ts` suites (`check-review-artifact.test.ts`,
  `carry-staged-artifacts.test.ts`, `companion-file-sync.test.ts`) fails after the Task 1-3 doc/
  comment-only edits, halt and revert the offending script edit — a red suite means the edit
  touched executed code, not just usage()/comment text, which is out of this plan's declared
  scope.
- If `scripts/verify.cwd-pin-guard.test.ts`'s live-tree `runChecks()` assertion returns more than
  one violation after Tasks 1-3 land, halt before Task 5 and re-audit Tasks 1-3 for a missed
  invocation site rather than loosening the check's pattern set.
- If `bun run verify` fails on any check other than the new `V-CWDPIN-01` one after Task 5, abort
  the merge and treat the failure as a pre-existing-tree regression signal, not a defect in this
  plan's tasks — re-run `bun run verify` against `plan_base_commit` to confirm before attributing
  it here.

## Sprint Contract

Each task's `**AC**:` line above is its acceptance criterion; there is no task in this plan whose
definition of done falls back to the blanket "all tests and linters pass" phrasing.

## Quality Gate Results

| Check | Result |
|---|---|
| `touch_paths_declared` | PASS |
| `schema_baseline` | PASS — no database/API schema change in this plan |
| `ac_mapping` | PASS |
| `critical_files_exist` | PASS |
| `mitigation_concrete` | PASS |

Computed via `bun run scripts/plan-quality-gate.ts --plan-file .blackhole/plans/issue-798.md`
(issue #716): `{"ac_mapping": true, "critical_files_exist": true, "mitigation_concrete": true}`.

## References

- Investigation: `.blackhole/plans/issue-798-investigation.md` (authoritative root-cause
  evidence; do not re-derive)
- Precedent: `scripts/consumer-promote-review.sh`, `src/references/blackhole-state.md`
  §"Write protocol" (existing `--cwd` pin for the vendored-plugin-vs-consumer-repo boundary)
- Related, non-overlapping: issue #792 (main-clone-vs-origin freshness), issue #806 (CLI-argument
  path absoluteness) — both refuted as closers for #798 by the investigation
