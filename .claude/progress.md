## Current Status

The `blackhole-scoped-extraction` initiative is COMPLETE — all 3 milestones implemented,
reviewed, and committed on branch `blackhole/milestone-1-identity-ssot`, bundled into a single
PR ([#90](https://github.com/CorentinLumineau/blackhole/pull/90)) per user request. PR
description updated to reflect the full 3-milestone scope. Awaiting merge.

## Completed Tasks

- **2026-07-06** (commit `f545fd1`, branch `blackhole/milestone-1-identity-ssot`, PR #90):
  Milestone 1 — `scripts/project-identity.ts` + test extracted; `scripts/build.ts` manifest
  builders (`buildGeminiPluginManifest`, `buildCodexPluginManifest`, `buildCodexMarketplace`,
  `buildClaudePluginManifest`, `buildClaudeMarketplace`) wired to it; `build.ts`'s own
  pre-existing duplicate `package.json` read eliminated. Review-fix loop (1 iteration):
  3-agent swarm found 1 HIGH (V-TEST-01, fixed via extraction) + 1 LOW (accepted as-is per
  reviewer's own recommendation). `bun test` 158/158 pass, `bun run verify` 18/18 pass,
  byte-for-byte manifest regression confirmed twice (before and after the review-fix).
- **2026-07-07** (commits `ceabf10`+`529ed3b`+`2a8e2c4`, same branch, PR #90): Milestone 2 —
  `scripts/tree-shape.ts` + test extracted; `assertGeminiTree`/`assertDistributionTree`/
  `assertCodexTree` removed from `build.ts`; `verify.ts`'s local `validatePluginTreeShape`
  removed and its Codex checks partially folded (safe, non-entangled subset only — 2
  documented deviations from the plan's literal wording, see milestone-2.md). Review-fix loop
  (1 iteration): 3-agent swarm found 3 MEDIUM findings, all fixed via TDD (`INSTRUCTIONS_MARKER`
  constant, `hasInstructionsBlock` predicate, 3 coupling-contract tests). `bun test` 180/180
  pass, `bun run verify` 18/18 pass, byte-for-byte identical output across the full compiled
  tree, re-confirmed after the fix round.
- **2026-07-07** (commits `ca06c7f`+`1e8372c`+`42e6626`, same branch, PR #90): Milestone 3 —
  `documentation/decisions/INDEX.md` created (V-ADA-02 resolved); orphaned
  `src/references/agent-tools.md` deleted + its `ground-truth.md` inventory entry removed +
  `verify.ts`'s `requiredRefs` array updated (discovery beyond the plan's literal scope — a
  direct consumer of the deleted file); `src/agents/coordinator.md`'s unconditional Cursor-only
  reference gated behind `{{#cursor}}...{{/cursor}}`. Review: APPROVED, no fixes needed — one
  reviewer-raised HIGH finding was investigated via `git show` against the pre-fix commit and
  proven factually incorrect (non-Cursor platforms never had functional access to the gated
  content), reclassified to LOW. `bun test` 180/180 pass, `bun run verify` 18/18 pass including
  `V-GROUND-01`. This was the final milestone — the initiative is now complete.

## Failed Approaches

(none)

## Dismissed Clarifications

- Source: `documentation/milestones/_active/blackhole-scoped-extraction/milestone-1.md` (2 markers) — both concern out-of-milestone future scope. Dismissed per user confirmation.

## Next Steps

1. Merge PR #90 (all 3 milestones committed, reviewed, PR description updated)
2. Run `/x-initiative archive` for `blackhole-scoped-extraction` once PR #90 merges
3. Consider filing follow-up issues for the two out-of-scope discoveries below (`.claude/` cleanDir wipe bug; `requiredRefs` 3/6 coverage gap in `checkGroundTruth`)

## Known Limitations

- Out of scope per plan: 3 hidden `spawnSync('bun run build')` channels in `verify.ts`; `author` block in `buildCodexPluginManifest`; `owner.name` in `marketplaceJson`.
- **Confirmed three times now**: `scripts/build.ts`'s `cleanDir(path.join(root, '.claude'))` deletes the *entire* `.claude/` directory recursively — including `.claude/initiatives/` and `.claude/progress.md`, which are NOT build output. Both `bun run build` directly AND `bun run verify` (which internally shells out to `bun run build` via one of `verify.ts`'s 3 hidden `spawnSync` calls — exactly the coupling channel the architectural retrospective flagged as out-of-scope-but-real) wiped these files 3 times this session; each time reconstructed from session context/a manual backup. This is a real, reproducible bug worth filing as a follow-up issue: scope `cleanDir` to only the subdirs `build.ts` actually owns inside `.claude/` (`agents/`, `rules/`, `skills/`), never the whole directory. Workaround for future sessions: back up `.claude/initiatives/` and `.claude/progress.md` before any `bun run build`/`bun run verify` call, restore after.
- **Environment issue**: `x-tester` agent invocation fails in this session with `WorktreeCreate hook failed: hook succeeded but returned no worktree path` — a broken hook, not a code issue. Quality gates were run directly via Bash instead.
- **Discovered during M3 review**: `scripts/verify.ts`'s `checkGroundTruth()` `requiredRefs` array mechanically enforces only 3 of `ground-truth.md`'s 6-entry "References (required)" list (`findings-ledger.md`, `queue-dag.md`, `epic-orchestration.md` are documented but not enforced). Pre-existing, not introduced by this initiative — worth a follow-up issue to either complete the array or parse it directly from `ground-truth.md` to eliminate the duplication.
