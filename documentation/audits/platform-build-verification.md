---
type: audit
status: current
review_trigger: "on release"
created: 2026-07-06
last_updated: 2026-07-08
---

# Platform Build Verification — Post-Rename End-to-End Pass

Verification-only audit for issue #74. Exercises all 5 platform build
targets (Cursor, Claude Code, Gemini/Antigravity, Codex CLI, skills.sh)
headlessly since the Blackhole rename (#64) and the Antigravity bundle
work (#27), going beyond `bun run verify`'s existing shape/staleness
assertions. No source files were modified as part of this pass.

## 1. Cursor

Commands run: `bun run build`, `bun run verify`, `ls .cursor/agents
.cursor/rules .cursor/skills/blackhole`.

| Assertion | Result |
|---|---|
| `bun run build` | PASS — completes cleanly |
| `bun run verify` (18 checks) | PASS — 18/18 |
| `.cursor/agents/*.md` — exactly 5 files (`coordinator`, `orchestrator`, `planner`, `implementer`, `reviewer`), each with `---` frontmatter + `name:`/`description:` | PASS |
| `.cursor/rules/*.mdc` frontmatter has `description:`, `globs:`, `alwaysApply:` | PASS — all 4 files have `---` delimiters and a `description:` field |
| `.cursor/skills/blackhole/SKILL.md` + `references/` non-empty, no leftover `{{#platform}}` conditional markers | PASS — `grep` for `{{#cursor}}\|{{#claude}}\|{{#gemini}}\|{{#codex}}\|{{#skills}}` under `.cursor/` returns clean |

**Observation (not a defect)**: 2 of the 4 `.cursor/rules/*.mdc` files
deviate from the "globs array + `alwaysApply: false`" pattern the plan
expected as universal:
- `blackhole-protocol.mdc` — `globs:` empty, `alwaysApply: true`. This is
  intentional: it is the top-level protocol rule and is meant to always
  apply, not auto-attach on a glob match.
- `release-milestone-governance.mdc` — no `globs:` line at all,
  `alwaysApply: true`. This file is explicitly a **project maintainer
  policy, not part of the Blackhole plugin protocol** (see its own body:
  "Project maintainer policy (not part of the blackhole plugin
  protocol)"). It lives in `.github/rules/` (SSOT) and is copied
  verbatim into `.cursor/rules/` by `copyMaintainerCursorRules` in
  `scripts/build.ts` — it deliberately bypasses the plugin's
  `writeCursorRules` glob-enrichment path since it isn't a plugin rule.

Both are valid Cursor MDC frontmatter (Cursor accepts `alwaysApply: true`
with no/empty `globs`); this is a design choice, not a template-drift
bug. No issue filed.

**Requires manual confirmation in a real client** (see checklist below):
opening this repo in an actual Cursor install and confirming the 5
agents/rules surface in Cursor's picker UI, and that a rule with
`alwaysApply: false` and enriched `globs` (e.g. `blackhole-vcodes.mdc`)
actually auto-attaches on a matching file open.

## 2. Claude Code

Commands run: `bun run build`, `bun run verify`, `cat
.claude-plugin/plugin.json | jq .`, `cat .claude-plugin/marketplace.json
| jq .`, `ls .claude/agents .claude/skills/blackhole`.

| Assertion | Result |
|---|---|
| `.claude-plugin/plugin.json` has `name`, `description`, `version`, `license`, `keywords` | PASS |
| `plugin.json` `version` equals `package.json` `version` | PASS — both `0.5.0` |
| `.claude-plugin/marketplace.json` `plugins[0].source` is `"."` | PASS |
| `marketplace.json` `plugins[0]` mirrors `plugin.json` fields exactly | PASS — `name`, `description`, `version`, `author`, `license`, `keywords` all identical (diffed as JSON, no divergence) |
| `.claude/agents/*.md` — 5 files, same set as Cursor | PASS |

**Requires manual confirmation in a real client** (cannot be dry-run
headlessly): `/plugin marketplace add <this-repo>`, `/plugin install
blackhole@blackhole-marketplace`, confirm install succeeds and the 5
agents + `blackhole` skill are visible/invocable in a real Claude Code
session.

## 3. Gemini / Antigravity

Commands run: `bun run build --gemini`, tree listings, `agents/` absence
check, plugin.json diff.

| Assertion | Result |
|---|---|
| Workspace tree `.agents/build/` has `agents/` (5 files), `rules/` (3 files), `skills/blackhole/` | PASS |
| Distribution tree `plugins/blackhole/` has **no** `agents/` directory | PASS — `test -d plugins/blackhole/agents` confirms absent |
| Distribution tree has `rules/` + `skills/blackhole/` + `plugin.json` | PASS |
| `.gemini-plugin/plugin.json` and `plugins/blackhole/plugin.json` both parse as JSON and share identical shape | PASS — `diff` of the two (through `jq .`) is empty, no divergence between the two write sites |

**Requires manual confirmation in a real client**: installing
`plugins/blackhole/` in an actual Antigravity/Gemini workspace and
confirming Multitask Mode's `@coordinator` reaches the 5 agents from
`.agents/build/agents/` correctly.

## 4. Codex CLI

Commands run: `bun run build`, `bun run verify`, `cat
.codex-plugin/plugin.json | jq .`, `cat codex-marketplace.json | jq .`,
`ls codex-agents codex-skills/blackhole`.

| Assertion | Result |
|---|---|
| `.codex-plugin/plugin.json` `version` equals `package.json` version | PASS — both `0.5.0` |
| `codex-agents/*.yaml` — 7 files, each has `instructions: \|` block, `permissionMode:`, no `model:` scalar (agent-agnostic: subagents inherit the primary session's model natively, per the reversal of #109/#117) | PASS — verified all 7 files (`coordinator`, `implementer`, `investigator`, `orchestrator`, `planner`, `reviewer`, `router`) have exactly 1 `instructions: \|` line, 1 `permissionMode:` line, no `model:` scalar |
| `.codex-plugin/plugin.json` `homepage`/`repository` and `codex-marketplace.json` `plugins[0].source.url` — stale-URL check (Known Discrepancy #2) | **FAIL (confirmed) — see Findings** |

**Requires manual confirmation in a real client**: installing via a real
Codex CLI against `codex-marketplace.json`'s declared git source and
confirming the 5 agents + `blackhole` skill invoke correctly.

## 5. skills.sh

Commands run: `bun run build`, root-flat layout listing, leftover
conditional/placeholder grep.

| Assertion | Result |
|---|---|
| Root-flat layout: `agents/*.md` (5), `rules/*.mdc` (3), `skills/blackhole/SKILL.md` + `references/`, root `SKILL.md` | PASS |
| No `{{#platform}}` conditional markers leaked into root-flat files | PASS — clean |
| No `{{AGENT_DIR}}`/`{{VCODES_PATH}}` placeholders leaked unsubstituted | PASS — clean |

**Observation**: root `rules/` uses the `.mdc` extension (same as
Cursor), not `.md` — confirmed by reading `scripts/build.ts`:
`writeCursorRules` is called for **both** `path.join(root, 'rules')`
(root-flat) and `.cursor/rules` (line 463–464), so the root-flat rules
tree deliberately keeps full Cursor MDC frontmatter rather than having
it stripped. This resolves the plan's open question ("confirm the
actual extension produced") — it is `.mdc` by design, not a bug.

**Requires manual confirmation in a real client**: running the
documented `npx skills add <this-repo>` (or equivalent) command — check
README.md/AGENTS.md first for the exact invocation — against this repo
and confirming the root-flat layout installs and `SKILL.md` is
discoverable per skills.sh's own convention.

## 6. Cross-cutting: `install:verify` and `doctor`

Commands run: `bun run install:verify`, `bun run doctor`, `CAMPAIGN_CONFIG=<main-repo>/.blackhole/config.json bun run doctor`.

### `bun run install:verify`

All 7 rows PASS, 0 PARTIAL, 0 FAIL:

```
✓ Cursor               PASS
✓ Claude               PASS — repo-local build-artifact proxy — not a true workstation-wide Claude install check
✓ Gemini               PASS — not installed
✓ Codex                PASS
✓ skills.sh (global)   PASS — not installed
✓ ~/.agents/skills/    PASS
✓ Broken symlinks      PASS
```

### `bun run doctor`

Without override, in the isolated worktree used for this verification
pass:

```
✓ D-VERIFY-01
✗ D-CONFIG-01 — <worktree>/.blackhole/config.json not found
✓ D-AGENTS-01
✓ D-SKILL-01
✓ D-GEMINI-01..04
2 BLOCK passed, 0 WARN (exit 1)
```

This reproduces the shape of Known Discrepancy #1 from the plan, but
**the root cause is different from what the plan recorded, and it is
now resolved at the source**:

- The plan's snapshot (pre-migration) said `doctor.ts`'s
  `DEFAULT_CONFIG_PATH` (`.blackhole/config.json`) wouldn't match this
  repo's live runtime directory, which at plan time was `.bc-campaign/`.
- **Since the plan was written, the orchestrator migrated this repo's
  own live runtime directory from `.bc-campaign/` to `.blackhole/`**
  (the exact migration documented in the README). Confirmed by
  inspecting the main clone directly: `.blackhole/config.json` exists
  and is populated there; `.bc-campaign/` no longer exists.
  `scripts/doctor.ts:7`'s `DEFAULT_CONFIG_PATH` already reads
  `.blackhole/config.json` — **this now matches the main clone's actual
  runtime state**.
- The `D-CONFIG-01` failure observed above is a worktree artifact, not a
  reproduction of the original discrepancy: `.blackhole/` is gitignored
  campaign state that lives only in the main clone's working directory
  and is never checked out into an isolated `git worktree` (by design —
  worktrees are ephemeral, per-issue checkouts). Running `doctor`
  from a bare worktree with no campaign state is expected to fail
  `D-CONFIG-01` regardless of the default path's correctness.
- Re-running with an explicit override against the main clone's real
  config confirms the default path itself is correct:

```
CAMPAIGN_CONFIG=<main-repo>/.blackhole/config.json bun run doctor
✓ D-VERIFY-01
✓ D-CONFIG-01
✓ D-CONFIG-02
✓ D-GH-01
✓ D-AGENTS-01
✓ D-SKILL-01
✓ D-GEMINI-01..04
5 BLOCK passed, 0 WARN
```

**Conclusion: Known Discrepancy #1 is RESOLVED.** No issue filed for it
— `doctor.ts`'s default path and this repo's live runtime directory are
now aligned. No source change was made or needed.

## Findings

| # | Description | Status | Reference |
|---|---|---|---|
| 1 | Known Discrepancy #1 (`doctor.ts` default config path vs. live runtime dir) | **Resolved** — repo's runtime dir was migrated to `.blackhole/` since the plan was written; default path already matches. No issue filed. | N/A |
| 2 | Known Discrepancy #2 — stale GitHub URLs in `scripts/build.ts` (`buildCodexPluginManifest` `homepage`/`repository`, `buildCodexMarketplace` `url`) still read `https://github.com/CorentinLumineau/backlog-campaign` instead of the renamed `CorentinLumineau/blackhole`. Confirmed reproducing in `.codex-plugin/plugin.json` (`homepage`, `repository`, `interface.websiteURL`) and `codex-marketplace.json` (`plugins[0].source.url`). | Confirmed, real defect | **Not filed here — being fixed concurrently by sibling issue #73** in a parallel worktree; filing a duplicate here would be redundant. |

No other real defects were found across the 5 platforms. All headless
checks pass; the two `.cursor/rules/*.mdc` frontmatter deviations (§1)
and the `.mdc` extension in root-flat `rules/` (§5) are intentional
design, not defects.

## Manual-verification checklist (for the user — not automatable from this session)

- [ ] Cursor: open this repo in a real Cursor install; confirm the 5
      agents and rules surface correctly, and a rule with
      `alwaysApply: false` (e.g. `blackhole-vcodes.mdc`) auto-attaches
      on a matching glob.
- [ ] Claude Code: run `/plugin marketplace add` +
      `/plugin install blackhole@blackhole-marketplace` against this
      repo in a real Claude Code session; confirm install succeeds and
      agents + skill are invocable.
- [ ] Antigravity: install `plugins/blackhole/` in a real Antigravity
      workspace; confirm Multitask Mode's `@coordinator` reaches the 5
      agents in `.agents/build/agents/`.
- [ ] Codex CLI: install via `codex-marketplace.json`'s git source in a
      real Codex CLI; confirm the 5 agents + skill invoke correctly.
- [ ] skills.sh: run the documented `npx skills add ...` command (check
      README.md/AGENTS.md for the exact invocation first) against this
      repo; confirm the root-flat layout installs as expected.

## Verification commands log

```bash
bun test                       # 141 pass, 0 fail (baseline, before and after)
bun run build                  # PASS
bun run verify                 # 18/18 PASS
bun run build --gemini         # PASS
bun run install:verify         # 7 PASS, 0 PARTIAL, 0 FAIL
bun run doctor                 # 2 BLOCK passed (worktree, expected D-CONFIG-01 fail — no runtime state in worktree)
CAMPAIGN_CONFIG=... bun run doctor   # 5 BLOCK passed (against main clone's real config)
```
