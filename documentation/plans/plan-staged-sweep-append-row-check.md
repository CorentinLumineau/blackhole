---
type: plan
summary: "Make the staged-promotion sweep verify an append_row row is present in its target before reporting carried"
status: current
review_trigger: "on file change"
created: 2026-11-26
last_updated: 2026-11-26
---
# Plan: issue #1661 — sweep must verify an append_row row is in its target

## Objective
`sweepStaged` (scripts/lib/staged-promotion-sweep.ts) classifies an `append_row` entry as `carried` whenever its target file exists on the ref. Make it `carried` only when the staged row's dedup key is already present in that target, using the carry step's own dedup functions (V-INT-02, no reimplementation).

## Touch-Paths
- scripts/lib/staged-promotion-sweep.ts
- scripts/lib/staged-promotion-sweep.test.ts
- scripts/staged-promotion-sweep.ts (inject target/staged content readers)
- scripts/staged-promotion-sweep.test.ts
- plus all generated dist trees per `scripts/lib/build/targets.ts` (the `plugins/blackhole-claude/scripts/**` mirrors; one build)

No changes to scripts/lib/carry-staged-artifacts.ts or check-common.ts (reuse only; `appendConstraintBulletIfAbsent`, `appendPipeTableRowIfAbsent` already exported). Branch from latest origin/main; PR #1663 touches the carry step, not these files.

## Task Steps
1. Branch from latest `origin/main` in a dedicated worktree (never checkout in the main clone).
2. TESTS FIRST (show failing before the fix), in `staged-promotion-sweep.test.ts` (lib, pure) with new optional `SweepInput` readers `readTarget(targetPath): string | null` and `readStaged(stagedPath): string | null`:
   - `documentation/decisions/INDEX.md` append_row, target exists but lacks the staged row's path -> `unpromoted_merged` (currently `carried`).
   - same, target contains the row -> `carried`.
   - `ARCHITECTURE.md` append_row, bullet citation suffix absent -> `unpromoted_merged`; present -> `carried`.
   - open issue + row absent -> `pending_open_issue`.
   - root `documentation/INDEX.md` append_row (retired by the carry step) with target present -> still `carried`.
   - append_row, target present, staged unreadable -> `staged_path_missing` (cannot verify; never claims carried).
   - fragment that fails `assertIndexFragmentShape` -> treated as not carried (not thrown).
   - `new_file` entries unchanged (existence only).
   CLI test (`scripts/staged-promotion-sweep.test.ts`): temp git repo with a decisions INDEX.md missing the staged row -> `unpromoted_merged`; containing it -> `carried`.
3. Implement: in `sweepStaged`, for `target_kind === 'append_row'` with an existing target, other than `ROOT_DOC_INDEX_PATH`, read both contents and call `appendConstraintBulletIfAbsent` (ARCHITECTURE.md) or `appendPipeTableRowIfAbsent` (else) — the same dispatch as `carry-staged-artifacts.ts`; `appended === false` means carried. Wrap in try/catch -> not carried. Pass `today` irrelevant (dedup only; result content discarded).
4. CLI: `readTarget` via `git -C <repo> show <ref>:<target>`; `readStaged` via fs read of the staged path.
5. Run only the two changed test files through `with-test-lock` after `free -m` MemAvailable >= 2500 MB; show red then green. Typecheck changed files only.
6. Regenerate generated mirrors with ONE `bun run build` through `with-test-lock`; verify only the mirror diff of the touched scripts. CI runs the rest.
7. Do not raise the implementer (11,300) or reviewer (14,000) token ceilings; this change touches no agent/reference prose.

## Acceptance Criteria (machine-verifiable)
- **AC1**: `bun test scripts/lib/staged-promotion-sweep.test.ts` — the append_row missing-row cases fail on the base commit and pass after the fix.
- **AC2**: `bun test scripts/staged-promotion-sweep.test.ts` passes, including the missing-row and present-row CLI cases.
- **AC3**: `grep -c "appendPipeTableRowIfAbsent\|appendConstraintBulletIfAbsent" scripts/lib/staged-promotion-sweep.ts` >= 2 and no new dedup/row-parsing logic duplicated (V-INT-02).
- **AC4**: `git diff --stat origin/main` shows no edit to carry-staged-artifacts.ts, check-common.ts, or token-ceiling constants.

## Pareto
Gain 5 x (11 - Effort 2) = 45 >= 30.

## Risks
- Retired root-INDEX append_row entries must stay `carried` (explicit test).
- Dedup of the ADR-style INDEX uses `today`; result is discarded, so any date is safe.
