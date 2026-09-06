---
issue: 878
supersedes_adr: null
type: plan
summary: "Fix companion-file-sync.ts's unpinned Usage help-text and widen cwd-pin-guard's sweep to scripts/checks/cwd-pin-guard.check.ts's own registered TARGET_SCRIPTS"
status: current
review_trigger: "on file change"
created: 2026-09-06
last_updated: 2026-09-06
---


# Plan - Issue #878

## Objective
`scripts/lib/companion-file-sync.ts`'s two `Usage:` help-text strings (both branches of the
`if (import.meta.main)` block) print the unpinned invocation form (`bun run scripts/lib/companion-file-sync.ts --repo-root <path> ...`)
instead of the pinned form its two sibling scripts already use
(`bun run --cwd <abs repo-root> scripts/...`). Exact locations on `origin/main`:
lines 276-277 (`if (!repoRoot)` branch) and 293-294 (trailing `else` branch). This reproduces the exact defect class issue #840
/ PR #851 fixed at the `src/SKILL.md` call site: when a user or agent follows this help text from
a cwd that differs from `--repo-root` (a worktree, a plugin root, a consumer-repo invocation),
`bun run`'s relative `./lib/...` imports resolve against the *wrong* tree, silently — no error,
just divergent library code (issue #798's root cause). `scripts/checks/cwd-pin-guard.check.ts`
cannot see this today because its `sweepTargets()` sweep scope is markdown-only
(`src/agents/*.md`, `src/references/*.md`, `src/SKILL.md`, build-input module dirs) — no `.ts`
file under `scripts/` is ever scanned, by scope, not oversight.

## Touch-Paths
- `scripts/checks/cwd-pin-guard.check.ts`
- `scripts/lib/companion-file-sync.ts`
- `scripts/verify.cwd-pin-guard.test.ts`

## Documentation Impact
None — the fix is confined to a help-text string and the guard's own sweep scope.
`blackhole-vcodes.md`'s `V-CWDPIN-01` row already names `scripts/lib/companion-file-sync.ts`
as one of the three scripts a documented invocation must pin; widening the guard's *sweep
targets* to additionally scan those scripts' own source (so the guard also catches an unpinned
literal embedded in the script itself, not only in prose that mentions it) does not change that
row's wording or the `TARGET_SCRIPTS` invocation-name list it already covers. No other
`documentation/` file references the guard's sweep scope.

## Scope Decision (AC escape hatch)

The issue's acceptance criteria literally ask to widen guard coverage to `scripts/**/*.ts`. This
plan takes the AC's explicit escape hatch instead ("or, if disproportionate, an explicit
recorded decision") and scopes the fix narrower: add only the four `TARGET_SCRIPTS` files
(`scripts/check-review-artifact.ts`, `scripts/carry-staged-artifacts.ts`,
`scripts/lib/companion-file-sync.ts`, `scripts/plan-quality-gate.ts` — the guard's own existing
registered list, `cwd-pin-guard.check.ts:15-20`) as additional `sweepTargets()` entries, reusing
the existing `findMissingCwdPin` / `invocationRegex` machinery unchanged. Zero new regex logic;
the scan scope grows only to the guard's own registered class of vulnerable scripts.

**Evidence for the narrower scope** (from `router-878`'s repo-wide sweep, re-verified here):
- Of the four `TARGET_SCRIPTS`, only `companion-file-sync.ts` (lines ~276, ~293) is currently
  stale. `check-review-artifact.ts:11`, `carry-staged-artifacts.ts:14`, and
  `plan-quality-gate.ts:41` already print the pinned form in their own `Usage:` text — confirmed
  by direct read of each file at `origin/main`.
- Every other `Usage:`-bearing script in the repo (`scripts/backfill-adr-frontmatter.ts`,
  `scripts/campaign-resume-signal.ts`, `scripts/ci-diagnosis.ts`, `scripts/design-aggregate.ts`,
  `scripts/lib/state-write-guard.ts`, `scripts/review-aggregate.ts`,
  `scripts/v-test09-hooks-claim.ts`, `scripts/validate-worker-json.ts`) takes no `--repo-root`
  distinct from its own invocation cwd — none belongs to the vulnerable class `V-CWDPIN-01`
  exists to guard, so a blanket `scripts/**/*.ts` sweep would flag them as false positives and
  erode trust in the guard.

A future script added to `TARGET_SCRIPTS` (the guard's own SSOT for "which scripts take a
`--repo-root` distinct from their own cwd") is automatically covered by this same widened
`sweepTargets()` — no further guard change needed when the vulnerable class grows.

## Task Steps

- [ ] **TDD Baseline Verification**: Run `bun test scripts/verify.cwd-pin-guard.test.ts` and the
  full `bun run verify` suite to confirm current pass/fail counts before any change. — **AC**:
  baseline suite run, pass/fail counts quoted in the completion evidence.

- [ ] **Extend the guard's sweep scope (red first)**: In `scripts/checks/cwd-pin-guard.check.ts`,
  add the existing `TARGET_SCRIPTS` array's four entries as additional `sweepTargets()` output
  (alongside the existing `SWEEP_DIRS`/`buildInputModuleDirs()`/`SWEEP_FILES` entries) — no new
  regex, no new detection function, `findMissingCwdPin` unchanged. Add regression tests to
  `scripts/verify.cwd-pin-guard.test.ts`: (a) `sweepTargets()` includes all four `TARGET_SCRIPTS`
  paths (assert each is present in the returned array); (b) `runChecks()` against the real tree,
  run at this point in the sequence, is expected to **fail** (`ok: false`) because
  `companion-file-sync.ts`'s live Usage strings are still unpinned — this is the demonstration
  that the widened guard would have caught the defect. — **AC**: `bun test
  scripts/verify.cwd-pin-guard.test.ts` shows the new sweep-membership assertions passing, and
  the pre-existing "passes against the current tree" test failing with a `detail` naming
  `scripts/lib/companion-file-sync.ts` at the two unpinned Usage lines — quote the actual failure
  output in the completion evidence as the red-before-green proof.

- [ ] **Fix the Usage help-text (green)**: In `scripts/lib/companion-file-sync.ts`, replace both
  occurrences of the unpinned `Usage:` string (the `if (!repoRoot)` branch and the trailing
  `else` branch of `if (import.meta.main)`) with the pinned form
  `bun run --cwd <path> scripts/lib/companion-file-sync.ts --repo-root <path> ...`, matching the
  convention already used by `check-review-artifact.ts`, `carry-staged-artifacts.ts`, and
  `src/SKILL.md`. Extract the (now-identical, previously near-duplicated) two-line message into
  a single module-level `USAGE` constant referenced by both branches, so a future edit to the
  invocation form only needs to change one literal instead of two kept in sync by hand — the
  exact failure mode this issue is a report of. — **AC**: both branches emit the corrected
  `--cwd`-pinned string; `bun test scripts/verify.cwd-pin-guard.test.ts` now shows the
  "passes against the current tree" test green again (full suite, no regression from Task 2).

- [ ] **Verify Integrity**: Run `bun run verify` (full check + test suite) and confirm clean.
  — **AC**: full suite green, lint/typecheck clean, both quoted in the completion evidence.

## Sprint Contract
Per-task ACs above are the definition of done; no task in this plan falls back to the blanket
"all tests and linters pass" phrasing.
