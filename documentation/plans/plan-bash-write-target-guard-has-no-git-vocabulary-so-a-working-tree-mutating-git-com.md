---
type: plan
summary: "Implementation plan for the main-clone git working-tree-mutation guard (ADR-043) — 9 tasks extending findRemovalInvocations' clause walk at its CERTAIN git dispatch point, a sibling git-main-clone-guard.js policy module, recoverability-graded tiers, and an F1-F11 red-first falsifiability suite"
status: current
review_trigger: "on ADR acceptance"
created: 2026-09-06
last_updated: 2026-09-06
related:
  - documentation/decisions/ADR-043-main-clone-git-mutation-guard.md
  - documentation/decisions/ADR-029-bash-write-target-worktree-containment.md
  - documentation/decisions/ADR-030-plugin-cache-version-bump-gate.md
  - documentation/decisions/ADR-041-hook-event-anomalous-git-fallback-sink.md
---
# Issue #897 — Main-clone git working-tree-mutation guard

Implements **ADR-043** (owner-ruled Option A, `resume_context: design_approved`). The design note
at `.blackhole/plans/issue-897-design.md` is the substantive record; this plan is the execution
contract. Do not re-open the option choice.

## Objective

A `git` subcommand that destroys working-tree state is refused when its **effective repository is
the main clone**, and is untouched when it targets a linked worktree. Detection extends
`findRemovalInvocations`' existing clause walk; policy lives in a new sibling module.

## Touch-Paths

- `templates/hooks/pretooluse/utils/git-main-clone-guard.js` (new)
- `templates/hooks/pretooluse/utils/worktree-removal-guard.js`
- `templates/hooks/pretooluse/validate-bash-command.js`
- `scripts/hooks-validate-bash.test.ts`
- `src/references/hook-schemas.md`
- `package.json` (`version` only)
- plus all generated dist trees per `scripts/lib/build/targets.ts`

## Critical Files

- `templates/hooks/pretooluse/utils/worktree-removal-guard.js`
- `templates/hooks/pretooluse/validate-bash-command.js`
- `templates/hooks/pretooluse/utils/hook-event-log.js`
- `scripts/hooks-validate-bash.test.ts`

## Documentation Impact

`src/references/hook-schemas.md` § pattern-id catalogue gains the new ids (update in place — the
concern is already documented there; search-before-write satisfied, no new file). ADR-043 and its
`documentation/decisions/INDEX.md` row are staged, not authored here. `ARCHITECTURE.md`
`## Active Constraints` gains one bullet, staged.

## Codebase Conventions

| Concern | Established pattern | Site |
|---|---|---|
| Guard module shape | `evaluateX(command, cwd)` returning `null` \| `{tier, pattern_id, reason}` | `bash-write-target-guard.js:284` |
| Dispatch | `require` at top, block-then-warn branch in `main()` | `validate-bash-command.js:15,66,80` |
| Repo identity | `worktreeRoot` / `mainCloneRoot` from `hook-event-log.js` | `hook-event-log.js:69,86` |
| Caller-side throw containment | Each caller wraps its own `mainCloneRoot` call; never change `mainCloneRoot` | ADR-041 Decision pt. 2 |
| Refusal prose | Every block carries an explicit `Remedy:` clause | `worktree-removal-guard.js:1071+` |
| Tests | Black-box via `runPreToolUseHook` + `withLinkedWorktree`; never import guard internals | `hooks-validate-bash.test.ts:37` |

## Database/API Schema Changes

None. The only contract additions are new `pattern_id` string values (documented in
`hook-schemas.md`) and a new invocation `kind` internal to `findRemovalInvocations`' return array.

## Threat Model

`route.security_review_required: true`. Six STRIDE rows, severity per mercure's four-tier
vocabulary.

| Category | Threat | Severity | Mitigation status |
|---|---|---|---|
| Spoofing | A command spells `git` so the walk misidentifies the executable (`g""it`, `$(which git)`) | High | **Mitigated** — reuses `normalizeShellWord` + the `#788` dynamic-executable path unchanged |
| Tampering | Destructive git command overwrites the user's uncommitted main-clone state (F-00034) | Critical | **Mitigated** — this issue's whole purpose; F1/F3/F6 |
| Repudiation | A refusal or warn leaves no durable trace | Medium | **Mitigated** — every decision goes through `denyAndRecord`/`warnAndRecord` into `.blackhole/hook-events/` |
| Information Disclosure | Refusal prose leaks absolute paths into transcripts | Low | **Accepted Risk** — matches existing guard prose, which already names resolved paths |
| Denial of Service | A false block halts an unattended worker; identity resolution adds subprocess latency under a fail-open 5s wrapper timeout | High | **Mitigated** — match confined to the CERTAIN executable position (F7/F8); identity read gated behind the subcommand match; unresolvable identity warns, never blocks (F9a) |
| Elevation of Privilege | Guard bypassed via wrapper/`eval`/subshell to reach the main clone | High | **Accepted Risk** — under-detection of wrapper-hidden mutations is the deliberate trade for not refusing prose that quotes git commands (design note § Adversarial Evaluation, mitigation 2; Assumption Audit A4) |

## Dependency Blast-Radius

Omitted — the consumer scan found fewer than 3 affected consumers on any changed interface
(design note § Refactoring Impact Analysis: 5 TRANSPARENT, 1 DEPRECATION, 1 BREAKING, of which
only `package.json` is BREAKING and it is a version bump, not a call site).

## Task Breakdown

1. **Red-first test suite.** Add the F1-F11 cases to `scripts/hooks-validate-bash.test.ts` using
   `withLinkedWorktree` and `runPreToolUseHook`. Run them against `plan_base_commit` and quote the
   failure output for each.
   — **AC**: every one of F1, F3, F6, F9a, F10 fails on the pre-change tree with its output quoted
   in the PR body, and F2, F4, F5, F7, F8, F9b pass on the pre-change tree (they assert
   today's behavior). `V-TEST-01/02`, `V-UNFALSIFIABLE-01`.

2. **`extractGitRepoOverride(tokens, start)`** in `worktree-removal-guard.js` — returns the value
   of the last `-C` / `--git-dir` / `--work-tree` (separate-token or `--name=value` form) in the
   global-option run, else `null`. `skipGitGlobalOptions` is **not** modified.
   — **AC**: `git diff plan_base_commit..HEAD -- templates/hooks/pretooluse/utils/worktree-removal-guard.js`
   shows zero changed lines inside `skipGitGlobalOptions`' body; F5 and F6 both pass.

3. **Emit `kind: 'git-mutation'`** from `findRemovalInvocations`' existing `git` branch, only when
   `cursor === certainCursor` (CERTAIN position). The UNCERTAIN branch keeps `cursor += 1; continue`
   verbatim.
   — **AC**: the F-00064 and F-00065 cases at `hooks-validate-bash.test.ts:2383+` pass unmodified,
   and F7 (`gh pr comment --body "... git checkout -- ."`) returns exit 0 with zero events.

4. **`git-main-clone-guard.js`** — `evaluateGitMainCloneMutation(command, cwd)`. Subcommand→tier
   table per ADR-043 § Decision; effective dir = `extractGitRepoOverride` value else the
   `cd`-simulated candidate; main clone iff `worktreeRoot(dir) === mainCloneRoot(dir)`; the
   identity read wrapped in `try/catch` resolving a throw to warn-tier
   `main-clone-target-unresolvable`.
   — **AC**: F1, F2, F3, F4, F9a, F9b, F10 all pass; every `tier: 'block'` return string contains
   the literal `Remedy:`, asserted by a test iterating the module's block outcomes.

5. **Dispatch** in `validate-bash-command.js`, after the worktree-removal check and before the
   write-target check, using the existing block-then-warn shape.
   — **AC**: the full pre-existing suite passes **unmodified** — `git diff plan_base_commit..HEAD --
   scripts/hooks-validate-bash.test.ts` shows only additions, zero deletions or modifications to
   existing lines. `V-TEST-10`.

6. **Orchestrator-vocabulary allow suite.** One table-driven case per command in `fetch`,
   `worktree prune`, `worktree remove`, `show`, `merge-base`, `rev-parse`, `log`, `grep`,
   `clone --shared`, `diff`, `ls-remote`, each run in `mainRepo`.
   — **AC**: all 11 return exit 0 with zero hook events recorded.

7. **`hook-schemas.md`** — document the new pattern ids and their tiers.
   — **AC**: `grep -c 'main-clone-' src/references/hook-schemas.md` returns at least 8 (one per
   staged pattern id).

8. **Version bump + build.** Bump `package.json` `version` (re-read at write time; `0.21.9` at
   `plan_base_commit`) and run `bun run build`.
   — **AC**: `git diff plan_base_commit..HEAD -- package.json | grep -c '^+.*"version"'` returns 1,
   and `bun run verify` passes with no compiled-tree drift. `V-PLUGIN-01`.

9. **Carry staged artifacts** per `implementer.md` § Carry Staged Artifacts.
   — **AC**: all 5 manifest entries land in the PR; `V-AUTO-02` clean.

## Execution Strategy & Stop Conditions

- If any of F1/F3/F6/F9a/F10 **passes** on the pre-change tree, the case does not discriminate the
  fix — **stop**, rewrite the case, and re-run before writing any implementation code.
- If task 3 requires changing the UNCERTAIN branch's `cursor += 1; continue`, **abort** the task
  and report: that is the F-00064/F-00065 regression path and is out of scope.
- If `bun run verify` reports a compiled-tree drift after `bun run build`, **halt** and report
  rather than hand-editing any file under a dist tree.
- If any pre-existing case in `hooks-validate-bash.test.ts` requires modification to pass,
  **stop and report** — R4 forbids it; that is Option C's disqualifier reappearing.
- If implementation surfaces a legitimate main-clone use of a blocked subcommand, **stop and
  report** — do not reintroduce an orchestrator carve-out (owner ruling, point 2).
- If the identity check would need to modify `mainCloneRoot` itself, **abort** — ADR-041 point 1
  is binding; wrap at the call site only.

## Sprint Contract

Per-task ACs above are binding. For any task without a narrower AC, done means `bun run verify`
green and the full test suite passing.

## Quality Gate Results

| Check | Result |
|---|---|
| `touch_paths_declared` | PASS |
| `schema_baseline` | PASS (no schema change; new `pattern_id` values documented) |
| `ac_mapping` | PASS |
| `critical_files_exist` | PASS |
| `mitigation_concrete` | PASS |
