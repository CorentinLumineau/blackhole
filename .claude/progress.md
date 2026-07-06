## Current Status

Milestone 1 (Identity SSOT) of the `blackhole-scoped-extraction` initiative is complete and
reviewed (APPROVED, 1 review-fix iteration) on branch `blackhole/milestone-1-identity-ssot`.
Plan: `documentation/milestones/_active/blackhole-scoped-extraction/milestone-1.md`.
Ready to commit.

## Completed Tasks

- **2026-07-06** (uncommitted, branch `blackhole/milestone-1-identity-ssot`): Milestone 1 —
  `scripts/project-identity.ts` + test extracted; `scripts/build.ts` manifest builders
  (`buildGeminiPluginManifest`, `buildCodexPluginManifest`, `buildCodexMarketplace`,
  `buildClaudePluginManifest`, `buildClaudeMarketplace`) wired to it; `build.ts`'s own
  pre-existing duplicate `package.json` read eliminated. Review-fix loop (1 iteration):
  3-agent swarm found 1 HIGH (V-TEST-01, fixed via extraction) + 1 LOW (accepted as-is per
  reviewer's own recommendation). `bun test` 158/158 pass, `bun run verify` 18/18 pass,
  byte-for-byte manifest regression confirmed twice (before and after the review-fix).

## Failed Approaches

(none)

## Dismissed Clarifications

- Source: `documentation/milestones/_active/blackhole-scoped-extraction/milestone-1.md` (2 markers) — both concern out-of-milestone future scope. Dismissed per user confirmation.

## Next Steps

1. Commit Milestone 1 on `blackhole/milestone-1-identity-ssot`
2. Milestone 2 — `scripts/tree-shape.ts`, per `documentation/milestones/_active/blackhole-scoped-extraction/milestone-2.md`
3. Milestone 3 — Governance & Cleanup, per `documentation/milestones/_active/blackhole-scoped-extraction/milestone-3.md`

## Known Limitations

- Out of scope per plan: 3 hidden `spawnSync('bun run build')` channels in `verify.ts`; `author` block in `buildCodexPluginManifest`; `owner.name` in `marketplaceJson`.
- **Confirmed three times now**: `scripts/build.ts`'s `cleanDir(path.join(root, '.claude'))` deletes the *entire* `.claude/` directory recursively — including `.claude/initiatives/` and `.claude/progress.md`, which are NOT build output. Both `bun run build` directly AND `bun run verify` (which internally shells out to `bun run build` via one of `verify.ts`'s 3 hidden `spawnSync` calls — exactly the coupling channel the architectural retrospective flagged as out-of-scope-but-real) wiped these files 3 times this session; each time reconstructed from session context/a manual backup. This is a real, reproducible bug worth filing as a follow-up issue: scope `cleanDir` to only the subdirs `build.ts` actually owns inside `.claude/` (`agents/`, `rules/`, `skills/`), never the whole directory. Workaround for future sessions: back up `.claude/initiatives/` and `.claude/progress.md` before any `bun run build`/`bun run verify` call, restore after.
- **Environment issue**: `x-tester` agent invocation fails in this session with `WorktreeCreate hook failed: hook succeeded but returned no worktree path` — a broken hook, not a code issue. Quality gates were run directly via Bash instead.
