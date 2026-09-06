---
type: plan
summary: "Quick Track implementation plan pinning two undocumented degenerate-input behaviour changes in canonicalIndexPath (scripts/lib/check-common.ts) that followed PR #898's href-regex widening — adds both cases to the existing test.each characterisation matrix with a mutation-based falsifiability check, and records inline that all three degenerate shapes (including the already-documented `[]()` case) are accepted risks, with canonicalIndexPath's best-effort unwrap left as-is; no production code change"
status: current
review_trigger: "on file change"
created: 2026-09-06
last_updated: 2026-09-06
---

# Plan - Issue #901

## Objective

Pin, via characterisation tests, two undocumented degenerate-input behaviour changes that
followed from PR #898's widening of `canonicalIndexPath`'s href capture group
(`scripts/lib/check-common.ts:224-228`, `[^)]*` → `(.*)`), and record — inline, next to the
existing `[]()` judgment comment — that all three degenerate shapes are accepted risks rather
than defects. **No production code changes.** This is a `task_type: docs` plan
(router-classified; content overrides the GitHub `bug` label per ADR-004 — issue #901's own AC4
explicitly permits "no production behaviour change" as the outcome), not a bugfix: the plan
frontmatter's `task_type` stays `null`, distinct from `route.task_type: docs`.

**Framing (state this, do not imply an active bug)**: nothing is broken in production today.
`git grep` over both `documentation/INDEX.md` and `documentation/decisions/INDEX.md` at
`plan_base_commit` finds zero link-wrapped rows, and all three `RootIndexRow` producers
(`doc-index-generate.ts` walks real files, `companion-file-sync.ts` uses a hardcoded literal,
`carry-staged-artifacts.ts` uses a staged `target_path`) structurally cannot emit either
degenerate shape (`[a](b))` or `[a](b) [c](d)`). This work pins behaviour that already exists so
a future regex change cannot alter it silently — worth doing because this exact helper has
already been through one silent regression once (PR #898's own predecessor `([^)]*)` form
reintroduced both defects it was meant to fix, and its tests never exercised this input space).

Verified independently (re-ran both regexes, did not just re-state the issue's numbers):

| Input | Old `[^)]*` (`link` match) | New `(.*)` (`link` match) |
|---|---|---|
| `"[a](b))"` | no match → `canonicalIndexPath` falls back to the trimmed raw cell, `"[a](b))"` | `"b)"` |
| `"[a](b) [c](d)"` | no match → falls back to `"[a](b) [c](d)"` | `"b) [c](d"` |
| `"[docs/notes(final).md](docs/notes(final).md)"` (the case the widening was for) | no match → falls back to the raw cell (the reported regression) | `"docs/notes(final).md"` (correct) |

Reconciles `F-00095` (`V-TEST-05`, WARN, reviewer confidence 78) raised on the PR #898 recheck.

## Touch-Paths
- `scripts/lib/check-common.test.ts`

## [If docs_governance.enabled] Documentation Impact
None — the change is confined to `scripts/lib/check-common.test.ts`'s existing pinned-behavior
`test.each` matrix and an inline judgment comment; no production code, `ARCHITECTURE.md`, or
`documentation/decisions/INDEX.md` entry is affected. (This plan's own durable copy is staged
separately per ADR-021 D3 — that is the plan's own promotion, not a Documentation-Impact
consequence of the Touch-Paths.)

## Task Breakdown

1. **Add both degenerate rows to the existing `test.each` matrix** (do not create a parallel
   test block) in `scripts/lib/check-common.test.ts`'s `describe('canonicalizes %s', ...)`
   array (currently 7 rows, `check-common.test.ts:290-303` at `plan_base_commit`). Append,
   in order, immediately after the existing `'bare path with parens...'` row and before the
   `'self-referential link...'` row (grouping the two new degenerate cases together, ahead of
   the one legitimate case they contrast with):

   ```js
   [
     'a link immediately followed by a stray closing paren — degenerate, canonicalizes past its true boundary',
     '[a](b))',
     'b)',
   ],
   [
     'two links folded into one cell — degenerate, greedy backtrack garbles across both',
     '[a](b) [c](d)',
     'b) [c](d',
   ],
   ```

   These assert the **current** (post-#898) behaviour, not an aspirational one: on unmodified
   `main` both rows already pass, because the shared `test.each` body already asserts
   `appended === false` and `content` unchanged for any tuple whose `existingCell` and
   `offeredPath` canonicalize to the same string — which the new `(.*)` regex makes true for
   both new tuples (`"b)"` and `"b) [c](d"` respectively).
   — **AC**: `bun test scripts/lib/check-common.test.ts` passes with both new rows present,
   AND quote the pass count in the completion evidence.

2. **Falsifiability evidence (V-UNFALSIFIABLE-01 — mandatory, run before marking Task 1 done)**:
   a characterisation test cannot be red-before-green in the usual sense (it pins existing
   behaviour, it does not drive new behaviour into existence), so the falsifiability
   demonstration is a **mutation**, not a TDD red phase. In the same worktree, temporarily edit
   `scripts/lib/check-common.ts:225`'s href capture group from `(.*)` back to `([^)]*)` (the
   pre-#898 form), then re-run `bun test scripts/lib/check-common.test.ts`. — **AC**: both new
   rows from Task 1 (and only those two — the pre-existing 7-row matrix's other cases and the
   dedicated `'a parenthetical self-referential link...'` regression test must also flip to
   failing at this mutation, since the mutation reverts the very regex the whole matrix
   exercises; if some other row unexpectedly stays green while the two new ones fail, that is
   still an acceptable outcome — the two new rows failing is what the AC requires) flip from
   passing to failing (red) under the mutation; quote the failing test output as completion
   evidence, then `git checkout -- scripts/lib/check-common.ts` (or equivalent) to discard the
   mutation before finishing — the mutation must never reach the diff.

3. **Record the decision inline**, following the `[]()` precedent already in the file
   (`check-common.test.ts:343-349` — an inline judgment comment, not an ADR), placed immediately
   above the `test.each` block edited in Task 1 (or immediately above the existing `[]()`
   comment it extends — either placement satisfies the AC below, as long as it reads as one
   continuous judgment note rather than two disconnected fragments). The comment must:
   - Name all three degenerate shapes (`[]()`, `[a](b))`, `[a](b) [c](d)`) as accepted
     unspecified-input behaviour, not defects.
   - State the producer argument as what it is — a claim about **today's** `RootIndexRow`
     producers (none can emit either non-`[]()` shape), not a structural invariant the parser
     enforces: `parseIndexTableRows` filters only a literally-empty raw cell, not a link that
     canonicalizes to empty, so a malformed row entering by another route (a hand edit, a
     foreign repo's file, a future producer) is not structurally ruled out — self-limiting
     (doc-health's dangling-row check would surface a resulting collision, nothing corrupts),
     but a real gap between what the comment claims and what the code enforces.
   - Record the issue's AC3 resolution: `canonicalIndexPath` keeps its current best-effort
     unwrap rather than rejecting a cell outside doc-governance.md's two schema-supported row
     shapes (a bare path, or an exact `[path](path)`) outright — because no current consumer is
     affected, and a stricter regex risks re-breaking the parenthetical-path case (the
     `notes(final).md` row) the widening was written to fix. **Do not propose or land a
     stricter regex under this plan** — that trade needs its own issue with its own evidence.
   - Must NOT embed the issue number (`#901`) or PR number (`#898`) in the comment prose itself
     (`V-DOC-06` — a regression test may carry an issue number in its **function/test name**
     only, and this is a plain comment, not a test title); the PR description carries the
     `Closes #901` linkage instead (`V-GIT-01`).
   — **AC**: the comment is present in `scripts/lib/check-common.test.ts` adjacent to (immediately
   before or immediately after) the existing `[]()` judgment comment, names all three shapes,
   states the producer-claim-vs-invariant nuance, and records the "leave `canonicalIndexPath` as
   is" AC3/AC4 resolution — verify with
   `grep -c 'best-effort unwrap' scripts/lib/check-common.test.ts` returning `1` (or the
   implementer's equivalent phrasing substituted consistently into both this AC's grep target
   and the comment itself).

## Sprint Contract

Definition of done for this plan: `bun test scripts/lib/check-common.test.ts` green with the two
new rows present (Task 1 AC), the mutation-based falsifiability check run and reported (Task 2
AC), and the inline decision comment present (Task 3 AC). No file outside
`scripts/lib/check-common.test.ts` is touched. The implementer should return a
`decision_records[]` entry summarizing the AC3 "leave as is" decision for the orchestrator to
append to `documentation/reference/decision-log.md` post-barrier — this plan does not itself
stage or write that file.

## Quality Gate (informational — Quick Track, advisory only)

`bun run scripts/plan-quality-gate.ts --plan-file .blackhole/plans/issue-901.md --repo-root
<repo-root>` was run against this plan per the orchestrator's explicit request, even though Step
8's CLI invocation is scoped "Standard track only" in `planner.md`. Result:
`{"ac_mapping": true, "critical_files_exist": true, "mitigation_concrete": true}`.
`critical_files_exist` and `mitigation_concrete` are vacuously true — this plan carries neither a
`## Critical Files` nor an `## Execution Strategy & Stop Conditions` heading (both Standard-only
per the Quick Track template shape), so the CLI's `extractSection` finds nothing to check.
`ac_mapping` is **not** vacuous here: this plan's `## Task Breakdown` numbered list matches the
CLI's `/^\d+\.\s+\*\*(.+?)\*\*/` bullet-detection pattern, so all 3 tasks were genuinely checked
for a trailing `**AC**:` marker and all 3 pass.
