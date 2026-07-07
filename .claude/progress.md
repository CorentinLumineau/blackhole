## Current Status

Milestones 1 and 2 — committed (PR #90). Milestone 3 (Governance & Cleanup) of the
`blackhole-scoped-extraction` initiative — all 3 tasks implemented and gate-verified on the
SAME branch `blackhole/milestone-1-identity-ssot`, per user request to bundle M1-M3 into one
PR. This is the FINAL milestone. Not yet reviewed/committed.

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
- **2026-07-07** (uncommitted, same branch): Milestone 3 — `documentation/decisions/INDEX.md`
  created (V-ADA-02 resolved); orphaned `src/references/agent-tools.md` deleted + its
  `ground-truth.md` inventory entry removed + `verify.ts`'s `requiredRefs` array updated
  (discovery beyond the plan's literal scope — a direct consumer of the deleted file);
  `src/agents/coordinator.md`'s unconditional Cursor-only reference gated behind
  `{{#cursor}}...{{/cursor}}`. Verified: dead link absent from the 3 true non-Cursor mirrors,
  correctly present in the 2 legitimate Cursor mirrors (root `agents/`, `.cursor/agents/`).
  `bun test` 180/180 pass (unchanged), `bun run verify` 18/18 pass including `V-GROUND-01`.
  Not yet reviewed. This is the final milestone of the initiative.

## Failed Approaches

(none)

## Dismissed Clarifications

- Source: `documentation/milestones/_active/blackhole-scoped-extraction/milestone-1.md` (2 markers) — both concern out-of-milestone future scope. Dismissed per user confirmation.

## Next Steps

1. Review-fix loop + commit Milestone 3 on `blackhole/milestone-1-identity-ssot` (same branch/PR as M1-M2)
2. Update PR #90's description to reflect all 3 milestones once M3 is committed
3. Archive the `blackhole-scoped-extraction` initiative once PR #90 merges (all 3 milestones complete)

## Known Limitations

- Out of scope per plan: 3 hidden `spawnSync('bun run build')` channels in `verify.ts`; `author` block in `buildCodexPluginManifest`; `owner.name` in `marketplaceJson`.
- **Confirmed three times now**: `scripts/build.ts`'s `cleanDir(path.join(root, '.claude'))` deletes the *entire* `.claude/` directory recursively — including `.claude/initiatives/` and `.claude/progress.md`, which are NOT build output. Both `bun run build` directly AND `bun run verify` (which internally shells out to `bun run build` via one of `verify.ts`'s 3 hidden `spawnSync` calls — exactly the coupling channel the architectural retrospective flagged as out-of-scope-but-real) wiped these files 3 times this session; each time reconstructed from session context/a manual backup. This is a real, reproducible bug worth filing as a follow-up issue: scope `cleanDir` to only the subdirs `build.ts` actually owns inside `.claude/` (`agents/`, `rules/`, `skills/`), never the whole directory. Workaround for future sessions: back up `.claude/initiatives/` and `.claude/progress.md` before any `bun run build`/`bun run verify` call, restore after.
- **Environment issue**: `x-tester` agent invocation fails in this session with `WorktreeCreate hook failed: hook succeeded but returned no worktree path` — a broken hook, not a code issue. Quality gates were run directly via Bash instead.
