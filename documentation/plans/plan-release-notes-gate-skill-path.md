---
type: plan
summary: "Plan for fixing the Release Notes Gate skill path and release skill manifest drift"
status: current
review_trigger: "on file change"
created: 2026-11-18
last_updated: 2026-11-18
---

# Plan: release skill path drift (issue #1274)

## Objective
Fix the Release Notes Gate hint and the release skill's stale references so a maintainer who hits the gate is pointed at files that exist, and the skill's commit step matches what `bun run release prepare` actually bumps.

## Findings (paths verified on origin/main)
| Item | Real state | Build output? |
|---|---|---|
| `.github/workflows/verify.yml:133` echoes `.github/skills/create-release/SKILL.md` | `.github/skills/` does not exist; skill is `.claude/skills/prj-create-release/SKILL.md` | No. Hand-authored workflow, tracked, no `src/` source |
| `.claude/skills/prj-create-release/SKILL.md` | Tracked, maintainer-only skill, relocated by #270; no `src/` counterpart (`src/` holds only `agents`, `references`, `SKILL.md`) | No. Edit directly |
| SKILL.md:74 cites `.cursor/rules/release-milestone-governance.mdc` | That file exists and is byte-identical to `.github/rules/release-milestone-governance.mdc`; the issue wants the `.github/rules` path read | No (both tracked, hand-authored) |
| SKILL.md:55-58 `git add` lists 5 manifests | Version-carrying files at 0.30.1: `.claude-plugin/{plugin,marketplace}.json`, `.codex-plugin/plugin.json`, `.gemini-plugin/plugin.json`, `plugins/blackhole/plugin.json`, `plugins/blackhole-agent-plugins/plugin.json`, `plugins/blackhole-claude/.claude-plugin/plugin.json` (7 manifests, plus `package.json` = 8 bumped files) | n/a |
| SKILL.md:37-41 says `prepare` runs `bun run build --all`, "5 version-carrying manifests" | `scripts/release.ts:66` runs plain `bun run build`; `release.test.ts:367` asserts `--all` is absent | n/a |

Neither file is a build output, so no `src/` edit and no `bun run build`. Neither path is under `templates/hooks/**`, so no plugin-cache version bump (`V-PLUGIN-01` not triggered).

## Touch-Paths
- `.github/workflows/verify.yml`
- `.claude/skills/prj-create-release/SKILL.md`

Out of scope, file separately if wanted: `scripts/release.ts` `MANIFEST_PATHS` (l.71-80) lists only 5 of the 7 manifests, and its l.189 log says "5"; `AGENTS.md:61` and `src/agents/coordinator.md:213` still cite the `.cursor/rules` copy (the latter is inside a `{{#cursor}}` block, intentionally).

## Task Steps
1. `verify.yml` l.133: replace `.github/skills/create-release/SKILL.md` with `.claude/skills/prj-create-release/SKILL.md`. No other workflow line changes.
2. SKILL.md step 2: say `prepare` bumps `package.json` then runs `bun run build` (no `--all`), regenerating the 7 version-carrying manifests (list all seven); delete the sentence claiming plain `bun run build` misses targets.
3. SKILL.md step 5: extend the `git add` list with `plugins/blackhole-agent-plugins/plugin.json` and `plugins/blackhole-claude/.claude-plugin/plugin.json`.
4. SKILL.md step 8: cite `.github/rules/release-milestone-governance.mdc`.
5. Check `.claude/skills/prj-create-release/references/checklist.md` for the same stale references; fix any it holds (grep found none).

## Acceptance Criteria (machine-verifiable)
- **AC1**: `grep -n "\.github/skills/create-release" .github/workflows/verify.yml` returns nothing, and `grep -n "prj-create-release/SKILL.md" .github/workflows/verify.yml` returns one hit on the failure branch (scope: that one file; exemption: none).
- **AC2**: the path in that echo resolves: `test -f .claude/skills/prj-create-release/SKILL.md` exits 0.
- **AC3**: SKILL.md `git add` block names all of: `package.json`, the 5 original manifests, `plugins/blackhole-agent-plugins/plugin.json`, `plugins/blackhole-claude/.claude-plugin/plugin.json`. Check: every `*.json` path that `git grep -l "\"version\": \"$(jq -r .version package.json)\"" -- '*.json'` returns appears in the block.
- **AC4**: `grep -n "build --all" .claude/skills/prj-create-release/SKILL.md` returns nothing (scope: that skill; exemption: none).
- **AC5**: SKILL.md has no `.cursor/rules/release-milestone-governance.mdc` reference and has a `.github/rules/release-milestone-governance.mdc` reference that resolves on disk.
- **AC6**: `bun run verify` passes (YAML still parses; no skill-registry or doc check regresses); `git diff --name-only` equals exactly the two Touch-Paths.

## Test Strategy
No code, so no unit test. Verification is the grep and `test -f` checks above plus `bun run verify` in CI. A workflow YAML parse check (`bun -e` with a YAML parse, or `actionlint` if installed) on `verify.yml` locally is allowed.

## Quality Notes
- Pareto: Gain 4, Effort 1, Priority 40 (above 30).
- `needs_build`: false. `collides_with_templates_hooks`: false.
