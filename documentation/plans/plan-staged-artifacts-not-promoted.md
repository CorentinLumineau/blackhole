---
type: plan
summary: "Post-merge staged-artifact promotion sweep plus package-scoped carry allowlist for monorepos (issue 1394)"
status: current
review_trigger: "on file change"
created: 2026-11-26
last_updated: 2026-11-26
---

# Plan - Issue #1394

## Objective
Staged artifacts that never reach `documentation/` must become visible and, for the monorepo case, carriable. Two defects, one root symptom ("staged, never promoted, nothing noticed"):

1. **#1394 proper (detection gap)**: V-AUTO-02 is a pre-merge, reviewer-time audit only (`src/references/audit-modules/25-staged-artifact-carry-audit.md`). Nothing re-checks `.blackhole/staged/*` after merge, so a carry that was skipped, never run, or run against a legacy manifest shape goes unnoticed. Fix: a post-merge sweep script plus one orchestrator step.
2. **Monorepo evidence (monorepo #5658 / PR #5979) is a SIBLING defect, not the same defect**: the planner staged `target_path: services/clauderr/documentation/plans/...`; `isCarryTargetAllowed` (`scripts/lib/carry-target-allowlist.ts:15-25`, `CARRY_TARGET_ALLOWLIST = ['documentation/**','ARCHITECTURE.md']`) rejects it and `carryManifest` (`scripts/lib/carry-staged-artifacts.ts:~393`) pushes it to `skipped`. Same user-visible outcome as #1394 (staged but not promoted) but a different cause (prescriptive allowlist too narrow vs. per-service doc trees) with a different fix (package-scoped allowlist). It is also a case the new sweep will surface (`target_outside_allowlist`), so the two share a detector but not a root cause. Both land in this one PR; they are separable tasks and the PR body must say "closes #1394; folds in the sibling monorepo allowlist defect".

Evidence not reproduced here: the issue's own mix of "bare list or {entries:[...]}" manifests shows legacy bare-array manifests exist in consumers; `loadManifest` (`carry-staged-artifacts.ts:65-82`) hard-refuses them, so they never carry. The sweep must tolerate and flag that shape rather than crash on it.

## Touch-Paths
- `scripts/staged-promotion-sweep.ts` (new CLI)
- `scripts/lib/staged-promotion-sweep.ts` (new, pure logic)
- `scripts/lib/staged-promotion-sweep.test.ts` (new)
- `scripts/lib/carry-target-allowlist.ts`
- `scripts/lib/carry-staged-artifacts.ts`
- `scripts/lib/carry-staged-artifacts.test.ts`
- `scripts/carry-staged-artifacts.ts` (add `--package-root` flag)
- `src/references/gates/10-carry-staged-artifacts.md` (on-demand gate module, not inlined in `implementer.md`)
- `src/references/audit-modules/25-staged-artifact-carry-audit.md` (on-demand module, not inlined in `reviewer.md`)
- `src/references/phase-loop.md` (one post-merge step)
- `src/references/blackhole-state.md` (§ Staging: one sentence on the sweep and the allowlist)
- `src/agents/planner.md` (Step 7.2: one sentence on package-scoped plan targets)
- plus all generated dist trees per `scripts/lib/build/targets.ts`

## Design Decision (monorepo target, reversible)
Narrow widening, not a general one: add an optional `packageRoot` to the allowlist. With a valid `packageRoot` (repo-relative, normalized, no `..`, not absolute, none of `<`, `|`, whitespace, not under `.git`/`.github` - same sanitizer the plan frontmatter already applies, reuse the existing `package_root` parsing used by `scripts/stack-parent.ts --plan-touch-paths`, do not reimplement, V-INT-02) the allowed targets become `documentation/**`, `ARCHITECTURE.md`, `<packageRoot>/documentation/**`, `<packageRoot>/ARCHITECTURE.md`. Without the flag behavior is byte-identical to today (#784 posture preserved: `package.json`, `.github/workflows/*`, `.git/hooks/*` stay refused). Normalization stays first (`path.posix.normalize`) so `services/x/documentation/../../../package.json` still fails.
Rejected alternative: force the planner to always stage under root `documentation/`. Zero security change, but contradicts `doc-governance.md` § Repo Convention Precedence for repos with per-service doc trees. Chosen widening is owner-reversible by dropping the flag. Per-package `documentation/INDEX.md` regeneration is out of scope: package-tree entries do not set `regenerateRootIndex` (only root `documentation/**` does) and the PR notes this limit.

## Task Breakdown
1. **Sweep logic** (`scripts/lib/staged-promotion-sweep.ts`): pure `sweepStaged({stagedDirs, queue, targetExists, allowed})` returning rows `{issue, issue_status, entry_index, target_path, state}` with `state` in `carried | pending_open_issue | unpromoted_merged | target_outside_allowlist | legacy_manifest_shape | manifest_unreadable | staged_path_missing`. Reads both manifest shapes (bare array tolerated and flagged, never thrown on). Reuses `isCarryTargetAllowed` and `QUEUE_STATUSES`/`DONE_STATUSES` from `scripts/lib/campaign-status/queue.ts`. Presence check is injected; the CLI binds it to `git cat-file -e <ref>:<target>` against `origin/main` (existence on the merged trunk, not the dirty worktree).
   **AC**: `bun test scripts/lib/staged-promotion-sweep.test.ts` passes, with one test per state above, including a merged issue whose target is absent on the ref returning `unpromoted_merged`, a bare-array manifest returning `legacy_manifest_shape`, and `services/p/documentation/plans/x.md` with no package root returning `target_outside_allowlist`. Red-before-green recorded (V-TEST-02).
2. **Sweep CLI** (`scripts/staged-promotion-sweep.ts`): `--campaign-dir <abs .blackhole> --repo-root <abs> [--ref origin/main] [--package-root <dir>]`; prints JSON rows, exit 0 always for findings (advisory), exit 1 only for unusable invocation; uses `parseFlags`/`unknownFlagKeys` (V-ARGV-01). Read-only: never writes queue/ledger (single-writer invariant).
   **AC**: `bun run --cwd <repo> scripts/staged-promotion-sweep.ts --campaign-dir <fixture> --repo-root <fixture>` against a fixture dir prints the expected rows as JSON; unknown flag exits 2.
3. **Package-scoped allowlist**: extend `isCarryTargetAllowed(targetPath, packageRoot?)`, thread `packageRoot` through `carryManifest` opts and a `--package-root` CLI flag in `scripts/carry-staged-artifacts.ts`.
   **AC**: `bun test scripts/lib/carry-staged-artifacts.test.ts` passes with new cases: `services/clauderr/documentation/plans/p.md` carried with packageRoot `services/clauderr`; same path skipped without it; `services/clauderr/../../package.json`, `services/clauderr/package.json`, `.github/workflows/x.yml`, and a packageRoot of `..` or `/etc` still skipped with the allowlist reason.
4. **Wiring prose** (judgment only, no mechanical logic restated, V-DRY-01): `phase-loop.md` post-merge step runs the sweep and appends one ledger row per `unpromoted_merged`/`target_outside_allowlist` row through the orchestrator (V-AUTO-02 post-merge leg, deferral via forge issue per never-drop); `10-carry-staged-artifacts.md` documents `--package-root` (value from plan `package_root`); `25-staged-artifact-carry-audit.md` notes the audit is pre-merge and names the sweep as the post-merge counterpart; `blackhole-state.md` § Staging one sentence; `planner.md` Step 7.2: when `package_root` is set and the package owns a `documentation/` tree, `target_path` is `<package_root>/documentation/plans/...`.
   **AC**: `grep -c 'staged-promotion-sweep' src/references/phase-loop.md` is >= 1 and `grep -c 'package-root' src/references/gates/10-carry-staged-artifacts.md` is >= 1.
5. **Build mirrors + gates**: one `bun run build` through `with-test-lock` only if generated mirrors are required; then run only the changed test files.
   **AC**: `bun test scripts/worker-context-size.test.ts` passes unchanged (implementer 11,300 and reviewer 14,000 ceilings NOT raised; `implementer.md` and `reviewer.md` bodies are not edited, only on-demand modules).

## Critical Files
- `scripts/lib/carry-target-allowlist.ts`
- `scripts/lib/carry-staged-artifacts.ts`
- `scripts/carry-staged-artifacts.ts`
- `src/references/phase-loop.md`

## Execution Strategy & Stop Conditions
- If any edit would grow `src/agents/implementer.md` or `src/agents/reviewer.md`, then abort that edit and move the text to the on-demand module instead.
- If `bun test scripts/worker-context-size.test.ts` fails after the change, then revert the prose edit that caused it; never raise a ceiling.
- If the package-root sanitizer cannot reuse the existing `stack-parent.ts` parsing without a circular import, then stop and hoist it into one shared helper rather than copy it.
- If the sweep needs a network call to decide a row, then halt: it must stay a pure function of files plus `git cat-file`.
- If an owner decision on the allowlist widening is required before merge, then park (see Owner Question).

## Dependency Blast-Radius
`isCarryTargetAllowed`: direct consumers `scripts/lib/carry-staged-artifacts.ts` and its test (verify with `grep -rn isCarryTargetAllowed scripts`). New optional parameter is backward compatible. Security-sensitive (V-SEC): allowlist widening requires the reviewer security leg; `security_review_required: true`.

## Owner Question (non-blocking, default chosen)
Default taken: package-scoped widening as above. Alternative if the owner prefers zero allowlist change: drop Task 3 and change only the planner rule so plans always stage to root `documentation/`.

## Quality Gate Results
- touch_paths_declared: PASS
- schema_baseline: PASS (no schema change; CLI flag additions only)
- ac_mapping: PASS
- critical_files_exist: PASS
- mitigation_concrete: PASS
