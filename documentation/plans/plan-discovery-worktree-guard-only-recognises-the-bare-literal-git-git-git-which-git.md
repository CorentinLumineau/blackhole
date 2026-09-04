---
type: plan
summary: "Standard-track plan for issue #788 — normalize-then-basename-compare fix closing 5 measured spelling bypasses (\\git, \"git\", 'git', \"/usr/bin/git\", g\"\"it) in worktree-removal-guard.js, plus a bounded refusal for $(which git)/env-var indirection"
status: current
review_trigger: "on file change"
created: 2026-09-03
last_updated: 2026-09-03
---


# Plan - Issue #788

## Objective

Close the one-character data-loss bypass in `worktree-removal-guard.js`: every shell-accepted
spelling of the `git` executable other than the bare literal token (`\git`, `"git"`, `'git'`,
`"/usr/bin/git"`, `g""it`) yields zero detected invocations, so `evaluateWorktreeRemoval`
returns `null` and `git worktree remove` proceeds with **no unpushed-commit check at all**.
`$(which git)` / backtick substitution and env-var indirection (`GIT=... $GIT`) must be either
covered or explicitly refused as unresolvable — never silently allowed.

## Touch-Paths

- `templates/hooks/pretooluse/utils/worktree-removal-guard.js` — plus all generated dist trees
  per `scripts/lib/build/targets.ts` (confirmed canonical source via `scripts/lib/build/trees.ts`'s
  `copyHooksDir`; `plugins/blackhole{,-claude}/hooks/utils/`, `.claude/hooks/utils/`, and
  `.agents/build/hooks/utils/` are generated copies — do not hand-edit)
- `scripts/hooks-validate-bash.test.ts`

## Documentation Impact

None — `route.docs_impact: false` confirmed; this is an internal detection-logic fix to an
existing hook with no protocol-surface or agent-contract change.

## Codebase Conventions

- `evaluateWorktreeRemoval` is the only export this module exposes outside itself and its test
  file (confirmed by grep); `scripts/hooks-validate-bash.test.ts` exercises the guard
  exclusively end-to-end via `runPreToolUseHook`, never importing internal helpers directly — so
  the internal refactor below (removing the old exact-token comparison) carries no external-API
  risk.
- Reuse `isCommandWordStart`'s existing boundary predicate, `computeMaskedSpans`, and
  `clauseTailFrom` unchanged — this fix is a detection-stage normalization change, not a new
  parsing pipeline (`V-INT-02`/`V-DRY-01`).
- The guard already has a `worktree-remove-unresolvable-path` refusal for the analogous
  unresolvable-argument case — reuse that same refusal shape for `$(which git)` /
  env-var-indirection rather than inventing a second "can't tell" outcome.

## Database/API Schema Changes

None.

## Threat Model

`route.security_review_required: true` — this is exactly a data-loss/tampering bypass in a
safety guard.

| Threat | Severity | Mitigation status |
|---|---|---|
| **Spoofing** — n/a, no identity/auth surface in this guard | Low | Accepted Risk — unaffected |
| **Tampering** — a caller spells the executable to evade detection, causing an unpushed-commit worktree to be silently removed | Critical | Mitigated — replace the literal-`'git'`-text-anchored `tokens[0] !== 'git'` comparison with a normalize-then-basename-compare step (strip surrounding quotes and backslash escapes, compare basename) covering `\git`, `"git"`, `'git'`, `"/usr/bin/git"`, `g""it` in one code path by construction, verified per-spelling by a parameterized regression test |
| **Repudiation** — n/a, no audit-trail change | Low | Accepted Risk — unaffected |
| **Information Disclosure** — n/a | Low | Accepted Risk — unaffected |
| **Denial of Service** — a legitimate `git worktree remove` call could be wrongly refused if the new normalization is over-eager | Medium | Mitigated — the retained-rejection tests from #774 (`--git-dir=/x/.git`, `--git-dir=/x/git`) must still pass unchanged, and the bounded "looks-dynamic + worktree/remove tokens present" heuristic for `$(which git)`/env-var cases is scoped narrowly enough to avoid new false positives against the existing test suite's other commands — if that assumption doesn't hold during implementation, fall back to an explicit `worktree-remove-unresolvable-path` refusal for those two cases instead of a heuristic allow/deny |
| **Elevation of Privilege** — n/a, this guard only gates `git worktree remove`, not a broader privilege boundary | Low | Accepted Risk — unaffected |

## Execution Strategy & Stop Conditions

1. Normalize the executable token before the `tokens[0]` comparison: strip surrounding quotes
   and backslash escapes, then compare the **basename** — one code path, not a growing list of
   predecessor-character exemptions.
2. For `$(which git)` and env-var indirection (`GIT=... $GIT`): implement the bounded
   "looks-dynamic + worktree/remove tokens present" heuristic (reliably fires for both measured
   cases per hand-tracing against the token-array shift). **Stop condition**: if this heuristic
   produces a new false-positive block anywhere in the existing test suite's command shapes
   during implementation, abandon the heuristic and fall back to the documented-out-of-scope
   path (explicit `worktree-remove-unresolvable-path` refusal) instead of shipping an unreliable
   heuristic in a data-loss-prevention guard. This drops 2 of the 9 task-level ACs below but
   leaves the mandatory core fix (AC1/AC2/AC5) fully intact.
3. Keep the diff minimal and localized to the token-normalization detection stage — issue #781
   is queued against the same file in a parallel wave; a narrow diff keeps that rebase mechanical.
4. Secondary, lower-priority: correct `worktree-removal-guard.js`'s docstring (~:115), which
   claims a `git` interior path segment (`-C /home/user/git/repo`) is admitted but cannot form an
   invocation — false when `git` is the **trailing** segment (`/srv/git`, `~/git`). Either say
   "interior segment" explicitly, or make the predicate reject the trailing case so the stated
   universal becomes true. Not a bypass (duplicate invocation, `ANY`-unsafe fold can only
   tighten) — do this only after the primary fix and its tests are green.

## Task Breakdown

- [ ] **TDD Baseline Verification**: run `scripts/hooks-validate-bash.test.ts` to confirm current green state, including the retained #774 rejection tests. — **AC**: baseline suite run, pass/fail counts quoted in the completion evidence.
- [ ] **Write the parameterized bypass regression test**: one test per spelling in the bypass table (`\git`, `"git"`, `'git'`, `"/usr/bin/git"`, `g""it`) asserting a guarded invocation is detected; state the mutation check both directions (fails before the fix, passes after). — **AC**: all five parameterized cases exist and fail for the expected reason before implementation.
- [ ] **Write the `$(which git)` / env-var-indirection tests**: assert either a guarded invocation or an explicit `worktree-remove-unresolvable-path` refusal (per which path is chosen during implementation) — never a silent allow. — **AC**: both cases exist and fail (or assert the fallback refusal) before implementation.
- [ ] **Confirm retained-rejection tests still pass**: `--git-dir=/x/.git`, `--git-dir=/x/git` must not start matching after the fix. — **AC**: both existing #774 tests remain green throughout.
- [ ] **Implement the normalize-then-basename-compare fix**: replace the exact `tokens[0] !== 'git'` comparison in `findWorktreeRemoveInvocations`, reusing `isCommandWordStart`/`computeMaskedSpans`/`clauseTailFrom` unchanged. — **AC**: all parameterized bypass tests now pass; no file outside Touch-Paths modified.
- [ ] **Implement the `$(which git)`/env-var handling** per the Execution Strategy's chosen path (heuristic or explicit-refusal fallback). — **AC**: the corresponding tests from above pass; the guard never silently allows either case.
- [ ] **Fix the docstring** (secondary, ~:115): correct "interior segment" language or adjust the predicate. — **AC**: docstring's claim is true as written, or the predicate change is covered by a test.
- [ ] **Verify Integrity**: run the full hook test suite and the project's lint/typecheck. — **AC**: full suite green, lint clean, both quoted in the completion evidence.

## Sprint Contract

Definition of done = every `## Task Breakdown` AC above satisfied. If the `$(which git)`/env-var
heuristic is abandoned per the Execution Strategy's stop condition, its two ACs are replaced by
"explicit `worktree-remove-unresolvable-path` refusal fires for both cases" — the mandatory core
fix (parameterized bypass tests, retained-rejection tests, docstring) is never optional.

## Quality Gate Results

| Check | Result |
|---|---|
| `touch_paths_declared` | PASS |
| `schema_baseline` | PASS — no schema/API changes |
| `ac_mapping` | PASS |
| `critical_files_exist` | PASS — `templates/hooks/pretooluse/utils/worktree-removal-guard.js` exists on disk |
| `mitigation_concrete` | PASS — Threat Model mitigations name concrete mechanisms (normalize-then-basename-compare, retained #774 tests, bounded heuristic with a named fallback), not "monitor"/"be careful" |
| `ac_sweep_conflict` | PASS |
| `ac_sweep_scope` | PASS |
| `touch_paths_ssot_gap` | PASS |
