---
type: analysis
status: current
created: 2026-07-24
last_updated: 2026-07-24
review_trigger: "on release"
related:
  - documentation/decisions/ADR-009-claude-marketplace-bundle-isolation.md
  - documentation/architecture/retrospective-blackhole.md
  - documentation/architecture.md
---

# Build Tree → Install-Path Resolution Audit

**Scope**: for every committed build tree in this repo (issue #328), which documented install
path actually resolves it, and what evidence supports that. **This is a measurement task, not a
code change** — no tree is removed, untracked, or has its build step altered here. Any removal
is deferred to an explicit follow-up ADR; this audit exists to give that ADR ground truth instead
of guesswork.

**Base ref**: `git rev-parse HEAD` = `7bc0eb6d5d0b0ce173e472c5316cfaa0af066357` (tag `v0.16.0`,
current `main`) — identical to the plan's `plan_base_commit`; no drift since plan time, so every
row below was re-derived directly against this ref rather than transcribed from the plan.

**Uniform ref answer**: every install path in the table resolves the tracked working tree at
whatever ref the install mechanism itself checks out — `main` HEAD via `/plugin marketplace add`,
`codex plugin marketplace add`, `npx skills add`, `git submodule add`, or the Gemini symlink
target; or a pinned release tag if the consumer pins one. No tree has a separately-generated or
separately-pinned ref at install time — there is no per-tree build step at install (that is the
entire "zero build-step install" premise `documentation/architecture/retrospective-blackhole.md`
steelmans). This column is therefore stated once here, not repeated per row.

**Known staleness this audit surfaces (not fixed here, out of Touch-Paths)**:
`documentation/architecture.md`'s "Committed target trees" table (line 66) still lists
`.claude/` + `.claude-plugin/` (`plugin.json`, `marketplace.json`) as one combined row mapped to
"Claude Code plugin + marketplace manifest". That predates ADR-009 (issue #262), which repointed
`.claude-plugin/marketplace.json`'s `source` from `"."` to `"./plugins/blackhole-claude"` —
`.claude/` is no longer a consumer-facing install path (see row 1c below). The same table also
has no row at all for `plugins/blackhole-claude/`, the bundle `source` actually resolves to
(row 3) — a second, larger staleness gap than the plan anticipated. Both are flagged for a
future `documentation/architecture.md` edit; neither is fixed under this issue.

## Measured baseline (independently derived, this session, at `7bc0eb6`)

Issue #328 asks for the "committed-output model" duplication baseline to be reproduced, not
quoted. The figures below are **this session's own commands against `origin/main` @ `7bc0eb6`**
— not copied from any document. A caveat up front: `documentation/architecture/retrospective-blackhole.md`
on `main` (the currently-merged revision, dated 2026-07-11 / v0.10.0) reports different, older
numbers (519 tracked / 198 hand-authored / 321 generated, 1.62×). A v0.16.0 refresh with figures
matching this audit's own measurement exists on branch `docs/retrospective-v0.16.0` (PR #329),
which has not merged as of this writing — so the two documents disagree until that PR lands; this
audit's numbers stand on their own regardless of that merge order.

| Metric | Command | Result |
|---|---|---|
| Total tracked files | `git ls-tree -r --name-only origin/main \| wc -l` | **672** |
| `src/` bytes (47 files, the hand-authored SSOT: `src/agents/`, `src/references/`, `src/SKILL.md`) | `git ls-tree -r -l origin/main -- src \| awk '{s+=$4} END {print s}'` | **460,937** |
| Build-output tree files (repo-wide: every path under `.cursor/`, `.claude/` minus its 5 non-generated maintainer files — `progress.md`, `initiatives/_registry.json`, and the two unrelated `prj-*` skills — `skills/`, `codex-agents/`, `codex-skills/`, `.codex-plugin/`, `codex-marketplace.json`, `.agents/build/`, `plugins/`, root `agents/`, `references/`, `rules/`, `SKILL.md`, `.claude-plugin/`, `.gemini-plugin/`) | grep-classified against the same tree list used to build the Evidence table above | **410 / 672 = 61.0%** |
| Generated-mirror bytes (copies of the 47 `src/` files across all platform trees, manifest/marketplace `*.json` excluded — those aren't mirrors of any `src/` file) | sum of `git ls-tree -r -l` over each mirror subtree | **3,522,961** |
| Duplication ratio | `3,522,961 / 460,937` | **7.64×** |
| Share of tracked (`src` + mirror) content that is derived | `3,522,961 / (460,937 + 3,522,961)` | **88.4%** |
| Change amplification (last 40 non-merge commits on `main`, restricted to the 15 that touched `src/`) | `git log --no-merges -40 --name-only`, counted per-commit `src/` vs. build-output path hits, summed | **44 `src/` file-changes, 279 build-output file-changes, ratio 6.34×** |

These numbers are consistent with the unmerged v0.16.0 retrospective's cited figures (414/672
61.6%, 7.64× duplication, 88.4% derived, 6.39× amplification) to within the classification
judgment calls noted above — the byte-based duplication and derived-share figures match exactly
at reported precision; the two file-count-based shares (61.0% vs. 61.6%, and 279 vs. 281
build-output file-changes) differ by a handful of files, which traces to how the 5 hand-authored,
non-generated files living inside the otherwise-generated `.claude/` tree (see row 1c below) are
classified — this audit excludes them from "build output" for consistency with row 1c's own
finding that `.claude/` is not purely generated content.

## Evidence table

| # | Tree | Resolving install path(s) | Evidence (file:line / command) | Classification |
|---|------|---------------------------|--------------------------------|-----------------|
| 1a | `.claude-plugin/marketplace.json` | Claude Code marketplace: `/plugin marketplace add <repo>` reads this file at repo root | `.claude-plugin/marketplace.json`: `plugins[0].source == "./plugins/blackhole-claude"` (re-read at HEAD); `README.md:112-113` install block; ADR-009 "Decision" (L82-91) | **Load-bearing** |
| 1b | `.claude-plugin/plugin.json` (repo root) | None confirmed — `marketplace.json`'s single plugin entry carries its metadata inline via `source`; it does not path-reference root `plugin.json` | `scripts/build.ts:685-701` (`generateClaudePluginManifests`) writes the identical `pluginMeta` payload to both `root/.claude-plugin/plugin.json` (detached, L690) and `claudeDistRoot/.claude-plugin/plugin.json` (co-located, L694, "Claude plugin schema requires the manifest co-located with the plugin"); structurally the same detached/co-located split as the confirmed-detached `.gemini-plugin/plugin.json` (row 8), but build.ts's comment there ("deletable without breaking the other", `scripts/build.ts:661`) is Gemini-specific — no equivalent comment or README reference confirms anything reads root `.claude-plugin/plugin.json` directly | **Unknown** — structurally resembles a redundant detached twin, but no install path or comment confirms it; needs maintainer confirmation before downgrading to `redundant` |
| 1c | `.claude/` (root: `agents/`, `rules/`, `skills/blackhole/`) | **None** — no consumer install path reads this since ADR-009 (issue #262) repointed `marketplace.json`'s `source` away from `"."` | `README.md:176`: "Maintainer-only Claude content \| `.claude/` (repo root) \| Auto-discovered locally, never redistributed — freed up by the bundle split (ADR-009, issue #262)"; ADR-009 Decision, `documentation/decisions/ADR-009-claude-marketplace-bundle-isolation.md:88-91`: "Repo-root `.claude/` is thereby freed to hold maintainer-only, auto-discovered content that never reaches consumers" | **Redundant for install** — deliberately repurposed as maintainer-only local content (this repo's own dogfooded Claude Code session), not a distribution path |
| 2 | `plugins/blackhole/` (Gemini/Antigravity distribution bundle) | `ln -s /path/to/blackhole/plugins/blackhole ~/.gemini/config/plugins/blackhole` (global symlink install) | `README.md:134` install block; `scripts/build.ts:663-673` ("Target D2 ... redistributable plugin co-located with skills/ and rules/, no agents/ (AC4)"); `scripts/install-verify.ts:51` `checkGeminiRow()` checks the `~/.gemini/config/plugins/blackhole` symlink target | **Load-bearing** |
| 3 | `plugins/blackhole-claude/` | Claude Code marketplace bundle — the directory `.claude-plugin/marketplace.json`'s `source` resolves to (row 1a) | `.claude-plugin/marketplace.json` `plugins[0].source`; `scripts/build.ts:627-638` `compileClaudeMarketplaceTarget()`; ADR-009 Decision + Trade-off Matrix (Approach A, adopted, total score 19 vs. 13/17); `README.md:150-156` "Development & Compilation" table row "Claude marketplace bundle" | **Load-bearing** |
| 4a | `.cursor/` (root, tracked: `agents/`, `rules/*.mdc`, `skills/blackhole/`) | Cursor's own native project-config auto-discovery (`.cursor/{agents,rules,skills}`) when this repo is opened directly in Cursor, or checked out as a plain clone | `scripts/doctor.ts:43-68` `checkCursorAgents()` — checks `.cursor/agents/` presence, `D-AGENTS-01` gate ("`.cursor/agents/` missing — run `bun run build`"); `scripts/install-verify.ts:26-35` `checkCursorRow()` reuses the same check as the install-resolution proxy | **Load-bearing** |
| 4b | Root flat `agents/`, `rules/*.mdc`, `skills/blackhole/` (Cursor submodule twin, distinct from `.claude/`'s maintainer-only role) | `git submodule add https://github.com/CorentinLumineau/blackhole .cursor` in a **consumer** repo — Cursor then auto-discovers `<consumer-repo>/.cursor/{agents,rules,skills}`, which (because the submodule root is this repo) resolves to blackhole's own root-level `agents/`, `rules/`, `skills/blackhole/` | `README.md:104-108` "Cursor (git submodule)" block: `git submodule add ... .cursor` then "Cursor auto-discovers `agents/`, `rules/`, `skills/` from the submodule" | **Load-bearing** |
| 5 | Root `SKILL.md` + root `references/` (flat, not `skills/blackhole/`) | `skills.sh` registry: `npx skills add CorentinLumineau/blackhole --skill blackhole -y` | `README.md:95,116-118` "skills.sh registry" install block; root `SKILL.md:4` relative link `references/blackhole-protocol.md` resolves against repo root — confirmed present at `references/blackhole-protocol.md`; `diff` of `SKILL.md` head vs. `skills/blackhole/SKILL.md` head confirms they differ (the latter carries a YAML frontmatter block for Cursor's skill-loader, the former does not) | **Load-bearing**. Genuinely a third, distinct resolution target from both `.cursor/skills/blackhole/` and root `skills/blackhole/` (item 4b/10) — not an accidental duplicate |
| 6 | `codex-agents/` | **Unconfirmed** — no manifest field references it | `.codex-plugin/plugin.json` (re-read at HEAD) has a `"skills": "./codex-skills/"` key but **no `agents` key at all**; presence is asserted only by build-time/verify-time checks — `scripts/install-verify.ts:17-21` `CODEX_ARTIFACTS` includes `'codex-agents'` in its existence list, and `scripts/build.ts` `codexTreeErrors()` — neither confirms the Codex CLI itself *reads* the directory at install/run time, only that the build+verify toolchain expects it to exist | **Unknown** — the one Codex sub-tree lacking manifest-level confirmation among its three siblings; needs a real `codex plugin add` install trace or Codex CLI documentation before calling it load-bearing or redundant |
| 7 | `codex-skills/` + `.codex-plugin/` + `codex-marketplace.json` | Codex CLI marketplace: `codex plugin marketplace add https://github.com/CorentinLumineau/blackhole` then `codex plugin add blackhole@blackhole-codex` | `README.md:139-141` install block; `codex-marketplace.json` (re-read at HEAD): `name == "blackhole-codex"`, `plugins[0].name == "blackhole"`, `plugins[0].source == {source: "git", url: ".../blackhole"}` — matches the `blackhole@blackhole-codex` install command exactly; `.codex-plugin/plugin.json` `"skills": "./codex-skills/"` — explicit manifest-level path reference, the strongest evidence class in this table | **Load-bearing** |
| 8 | `.gemini-plugin/` (root, `plugin.json` only) | None confirmed — no README install command references this path directly | `scripts/build.ts:661-662` comment, verbatim: "Detached manifest for marketplace metadata (same payload as co-located plugin.json)"; `scripts/build.ts:665-667`: "Independent write site from the detached manifest above — each block is deletable without breaking the other"; contrast with `plugins/blackhole/plugin.json` (row 2), which the symlink install path *does* reach | **Unknown / likely redundant** — same shape as row 1b (detached root-level twin of a load-bearing bundle-co-located manifest); build.ts's own comment says it is deletable without breaking the real distribution bundle, but no install path is documented as reading it, so this stays `unknown` rather than being asserted `redundant` outright |
| 9 | `.agents/build/` | Multitask Mode: `@coordinator run the campaign` — local workspace customization for running the campaign against **this repo itself**, never redistributed to consumers | `README.md:124,128`: "Antigravity / Gemini" section, "Compiles `.agents/build/` (workspace customization — 8 agent prompts, rules, skills..."; `documentation/architecture.md:68`: "Workspace customization (`@coordinator` / Multitask Mode)"; `scripts/build.ts:644-646` "Target D (Gemini/Antigravity workspace — `.agents/build/`)" | **Load-bearing** — for local/maintainer Multitask Mode use in *this* repo; distinct in kind (not redundant) from `plugins/blackhole`'s external-consumer redistribution (row 2) — both are genuinely resolved, by different consumers |
| 10 | Root flat `skills/`/`agents/`/`references/`/`rules/` (as one grouped phrase in issue #328's body) | See rows 4b and 5 — **the issue's grouped phrasing bundles two different install paths (Cursor submodule and skills.sh) with two different consumers into one tree name; they are evidenced separately above and split into two rows here rather than merged**, per the plan's instruction not to collapse a mixed tree into one classification | Rows 4b and 5 above | **Load-bearing** (both halves, via two distinct install paths) |

## Classification summary

- **Load-bearing** (8): `.claude-plugin/marketplace.json` (1a); `plugins/blackhole/` (2);
  `plugins/blackhole-claude/` (3); `.cursor/` root (4a); root `agents/`+`rules/`+`skills/blackhole/`
  Cursor-submodule twin (4b); root `SKILL.md`+`references/` skills.sh target (5);
  `codex-skills/`+`.codex-plugin/`+`codex-marketplace.json` (7); `.agents/build/` (9).
- **Redundant for install** (1): `.claude/` root (1c) — retained for a documented non-install
  purpose (maintainer-only, ADR-009), not a candidate for blind removal.
- **Unknown** (3): `.claude-plugin/plugin.json` root detached twin (1b); `codex-agents/` (6);
  `.gemini-plugin/plugin.json` root detached twin (8) — each needs maintainer confirmation or a
  live install trace before being called `redundant`; none is asserted redundant here.

No tree in this table is recommended for removal. The three `unknown` rows are unknown precisely
because the evidence available in-repo is insufficient to call them redundant with confidence —
resolving that determination, and any consequent removal, is explicit follow-up-ADR work per
issue #328's acceptance criteria, not something to guess at in this audit.
