---
type: plan
summary: "Derive release MANIFEST_PATHS from a single registry of all 7 version-carrying manifests and fix the stale AGENTS.md rules path"
status: current
review_trigger: "on file change"
created: 2026-11-18
last_updated: 2026-11-18
---

# Plan: single SSOT for version-carrying manifests (issue #1298)

## Objective
`scripts/release.ts` `MANIFEST_PATHS` lists 5 of the 7 manifests that carry the plugin version, so a release bump can leave 2 stale. Make the list a registry beside the manifest builders, covered by a test, and fix the stale `AGENTS.md` path.

## Touch-Paths
- `scripts/lib/build/manifests.ts` (add `VERSIONED_MANIFESTS` registry)
- `scripts/release.ts` (derive `MANIFEST_PATHS` from the registry; keep the export name)
- `scripts/release.test.ts` (coverage tests)
- `AGENTS.md` (line 61 path fix)
No `src/**` touched: no build, no dist regeneration, no version bump. Do not edit `.claude/skills/prj-create-release/SKILL.md` or `verify.yml` (PR #1299).

## Documentation Impact
`AGENTS.md:61` cites the generated `.cursor/rules/release-milestone-governance.mdc` copy (still tracked, written by `targets.ts` writeCursorRules). Point it at the source `.github/rules/release-milestone-governance.mdc`, which exists on origin/main. No other doc changes.

## Verified facts (plan_base_commit)
The 7 version-carrying manifests (write sites in `scripts/lib/build/targets.ts`):
1. `.claude-plugin/plugin.json` (213)
2. `.claude-plugin/marketplace.json` (227; version at `plugins[0].version`)
3. `.codex-plugin/plugin.json` (248)
4. `.gemini-plugin/plugin.json` (185)
5. `plugins/blackhole/plugin.json` (193)
6. `plugins/blackhole-claude/.claude-plugin/plugin.json` (217) — missing from `MANIFEST_PATHS`
7. `plugins/blackhole-agent-plugins/plugin.json` (284) — missing from `MANIFEST_PATHS`
`codex-marketplace.json` has no version field and is not a versioned manifest.

## Task Steps
1. (Red first) In `release.test.ts` add tests; see Test strategy.
2. In `manifests.ts` export `VERSIONED_MANIFESTS: Array<{path; versionOf}>` with the 7 entries (default reader `json.version`; marketplace reads `plugins[0].version`). Derive path strings from `paths.ts` constants (`DISTRIBUTION_ROOT`, `CLAUDE_DISTRIBUTION_ROOT`, `AGENT_PLUGINS_DISTRIBUTION_ROOT`) with forward slashes for the first two-level ones where already exported, literals otherwise.
3. In `release.ts` replace the hand list with `export const MANIFEST_PATHS = VERSIONED_MANIFESTS` (import from `./lib/build/manifests.ts`).
4. Fix `AGENTS.md:61` path.
5. `targets.ts`: unchanged. Its write sites use differing roots (`claudeDistRoot` param, etc.); rewiring them to the registry is a refactor outside 80/20. Coverage is enforced by test instead (Step 1).

## Acceptance Criteria
- **AC1**: `MANIFEST_PATHS` has exactly the 7 paths above (test `toEqual` on sorted paths).
- **AC2**: every tracked `plugin.json`/`marketplace.json` outside `fixtures/` whose JSON carries a `version` (top-level or `plugins[0]`) is in the registry; every registry path exists and its version equals `package.json` version. Test fails if a new versioned manifest is added without registering it.
- **AC3**: `findManifestVersionMismatches` flags a stale `plugins/blackhole-claude/.claude-plugin/plugin.json` and a stale `plugins/blackhole-agent-plugins/plugin.json`.
- **AC4**: `grep -c '\.cursor/rules/release-milestone' AGENTS.md` is 0 and `.github/rules/release-milestone-governance.mdc` appears in `AGENTS.md`.
- **AC5**: existing `release.test.ts` tests pass.

## Test strategy
Offline, scoped: `bun test scripts/release.test.ts` once through `with-test-lock`, plus typecheck of touched files. Full suite runs in CI only. AC2 uses `git ls-files` (tests already shell out to git elsewhere; else read `fs` list of the 10 known paths).

## Pareto
Gain 6, Effort 2 => Priority 54 (>= 30).

## Quality notes
Quick track; no UI, no security flag, `task_type: chore`. Scout check: none beyond diff.
