---
type: adr
status: Accepted
created: 2026-07-14
last_updated: 2026-07-14
review_trigger: "on ADR acceptance"
related:
  - documentation/decisions/ADR-007-drift-proof-toolchain-reseating.md
  - .claude-plugin/marketplace.json
  - scripts/build.ts
---

# ADR-009: Claude Marketplace Bundle Isolation

Accepted at the campaign design-gate sign-off (design→plan approval), 2026-07-14. Approach A
is implemented by issue #262.

## Context

`.claude-plugin/marketplace.json`'s single plugin entry declares `"source": "."`
(`build.ts::buildClaudeMarketplace`, ~L349–354: `plugins: [{ ...pluginMeta, source: '.' }]`).
For a Claude Code marketplace install (`/plugin marketplace add <repo>` →
`/plugin install blackhole@blackhole-marketplace`), the plugin's source root is therefore the
**entire repository root**. Claude Code auto-discovers everything under `.claude/skills/`,
`.claude/agents/`, `.claude/rules/` from that root, so the shipped plugin surface is whatever
those directories happen to contain.

This conflates two concerns that ought to be separate:

1. **The intentionally-shipped plugin surface** — the `blackhole` skill, its 8 campaign agents,
   and the 4 protocol rules.
2. **Maintainer-only local content** — anything a maintainer wants auto-discovered *in this
   repo* but never redistributed. The concrete trigger (issue #262): a self-development skill
   like `.github/skills/mercure-sync/` cannot become a repo-root `.claude/skills/` entry without
   leaking into every consumer's installed plugin, despite being irrelevant to their campaign.

There is a second, larger cost hiding behind the same root cause. `source: "."` ships the whole
monorepo root — `src/`, `scripts/`, `documentation/`, `tests/`, and every *other* platform's
build tree (`.cursor/`, `codex-*`, `plugins/`, `.gemini-plugin/`, root-level `agents/`/`rules/`/
`skills/`) — to every Claude consumer. The reported leak is one symptom of a distribution root
that was never scoped to the plugin.

### Precedent already in this repo (the crux of the trade-off)

The Gemini/Antigravity target already solved the *same* isolation problem via two genuinely
separate build outputs emitted by `scripts/build.ts`:

- **`.agents/build/`** (`AGENTS_BUILD_ROOT`) — the local workspace compile used by
  `@coordinator` / Multitask Mode. Never redistributed.
- **`plugins/blackhole/`** (`DISTRIBUTION_ROOT`, `DISTRIBUTION_AGENT_DIR`) — an isolated
  redistributable bundle: a co-located `plugin.json` + `skills/` + `rules/` + `templates/`,
  and **deliberately no `agents/`**. That no-agents rule is enforced at build time and in verify
  by `distributionTreeErrors()` (`scripts/tree-shape.ts`), which *errors if `agents/` is present*
  — labelled **AC4** and traced to ADR-007's issue #27 work. The reason is schema-specific: the
  Antigravity plugin schema does not carry agents in a distributed plugin.

Claude never received the same split. Its Target C writes straight into repo-root `.claude/`
(`build.ts` §5, ~L546–578), and repo-root `.claude/` doubles as **both** the workspace-local
surface **and** the marketplace-distributed bundle. The `source: "."` choice was not an
oversight — the `copyTemplatesDir` comment (`build.ts` ~L356–359) records the original rationale:
*"Claude Code, Cursor, and Codex all install via full-repo-source mechanisms and already have
`templates/` at its natural repo-relative path with zero build-pipeline change."* Full-repo-source
was cheaper: no bundle to assemble, no `templates/` to copy, no second manifest. That cheapness is
real and must be weighed honestly — isolating Claude forfeits it.

### Constraints this decision must not violate

- **ADR-007 is Accepted and binding.** Its rejections (generation-in-place, single-source
  drift derivation, central registry, file splits, build cache) are constraints. The relevant
  standing doctrine is *"detection over generation, governance over fragmentation"* and
  *facts declared once* in `build.ts` § facts (`AGENT_NAMES`, `RULES_LIST`, target dirs).
- **AC4 is platform-scoped, not universal.** It says the *Gemini/Antigravity* bundle omits
  `agents/` because that platform's schema cannot carry them. A Claude marketplace plugin, by
  contrast, *does* ship agents (the 8 campaign agents are core to the product). Any option must
  not silently break AC4 for the Gemini consumer.
- **Manifest shape and location already diverge per platform.** The Gemini bundle carries a flat
  `plugin.json` at bundle root (`buildGeminiPluginManifest`, `$schema: antigravity.google/…`,
  keyword `gemini`). A Claude plugin requires `.claude-plugin/plugin.json` *inside* the plugin
  dir (`buildClaudePluginManifest`, keyword `claude-code`, no `$schema`). These are different
  files in different locations with different content.

## Decision

**Adopt Approach A — a dedicated, isolated Claude marketplace bundle** emitted by `build.ts`,
mirroring the established Gemini `plugins/blackhole/` isolation pattern. `build.ts` gains a
distribution arm for Target C that compiles the blackhole skill + agents + rules + templates
into a self-contained bundle directory (proposed: `plugins/blackhole-claude/`) carrying its own
`.claude-plugin/plugin.json`. Repo-root `.claude-plugin/marketplace.json` keeps its fixed
location but repoints `source` from `"."` to that bundle (`"./plugins/blackhole-claude"`).
Repo-root `.claude/` is thereby freed to hold maintainer-only, auto-discovered content that
never reaches consumers.

The choice, its rejected alternatives, and the enforcement/verify implications are recorded below
so the decision is auditable against V-ARCH-01 at implementation review.

## Trade-off Matrix

Scored 1–5, higher is better. Dimensions per the design brief.

| Dimension | A — dedicated Claude bundle | B — reuse/extend `plugins/blackhole/` for both | C — keep `source:"."` + exclusion mechanism |
|---|---|---|---|
| **Build complexity** (simpler = higher) | 3 — reuses `compileGeminiTree`-shaped logic with `includeAgents: true`; adds one manifest write at `.claude-plugin/plugin.json` inside the bundle | 2 — must reconcile two divergent manifests (flat `plugin.json` vs `.claude-plugin/plugin.json`) and two opposite agents policies into one directory | 4 *if the feature exists* — add an ignore/exclusion file; **but feasibility is unverified** (see Rejected Alternatives), so the low apparent cost is not bankable |
| **Consumer install surface** (smaller/cleaner = higher) | 5 — only the blackhole skill/agents/rules/templates ship; monorepo noise gone | 2 — surface is clean **but broken**: the shared bundle omits `agents/` (AC4), so a Claude consumer installs a campaign with no agents | 3 — removes only the one explicitly-excluded path; `src/`, `scripts/`, other platform trees still ship unless each is separately excluded |
| **Duplication vs shared bundle** (less duplication = higher) | 3 — a second generated bundle dir duplicates skill/rule/template content on disk; this is *generated, checked* duplication, explicitly sanctioned by ADR-007 | 5 — single shared bundle, zero on-disk duplication (its one genuine advantage) | 5 — no bundle at all, nothing duplicated |
| **verify.ts / tree-shape sync burden** (less burden = higher) | 3 — one new tree check (Claude bundle: agents **required** — the inverse of `distributionTreeErrors`) + one `BUILD_OUTPUT_PATTERNS` entry | 2 — must make `distributionTreeErrors()`'s no-agents rule conditional, coupling two invariants `tree-shape.ts` deliberately keeps separate ("Do not generalize these two into one parameterized function") | 2 — verify would have to assert an exclusion manifest is correct against a mechanism that may not exist; effectively untestable |
| **Alignment with ADR-007 doctrine** (better = higher) | 5 — parallels the existing per-platform bundle targets; facts stay declared once; respects AC4 by keeping it platform-scoped; adds a *check*, not generation machinery | 2 — collides with the AC4 no-agents invariant and forces generalizing the deliberately-separated tree checks | 3 — leaves SSOT untouched, but relies on an unverifiable capability, at odds with ADR-007's "detection" ethos (you cannot verify what you cannot express) |
| **Total** | **19** | **13** | **17*** |

\* Approach C's 17 is contingent on Claude Code actually supporting source-root exclusion. That
support is **not confirmed** (see Rejected Alternatives); discount the total accordingly.

## Recommended Approach — A, with rationale

**Approach A is recommended.**

- **It is the proven structural analog.** The repo already runs five distinct per-platform build
  targets (skills.sh, Cursor, Claude, Gemini workspace, Gemini distribution, Codex). A dedicated
  Claude bundle is one more instance of a pattern that is already load-bearing and tested — not a
  new architectural concept. The Gemini distribution bundle demonstrates the exact isolation
  Claude needs.
- **It respects, rather than contradicts, ADR-007.** Facts remain declared once in `build.ts`
  § facts; the new bundle is compiled from the same `AGENT_NAMES`/`RULES_LIST` SSOT. The addition
  is a *verify check* (detection), never generation-in-place, a registry, or a cache — none of
  ADR-007's binding rejections are touched. AC4 stays true for the Gemini consumer because the
  Claude bundle's agents policy is a separate, platform-scoped invariant.
- **It fixes both symptoms at once.** The reported maintainer-content leak disappears, and the
  consumer install surface shrinks from "the whole monorepo root" to "just the plugin" — the
  deeper problem the `source:"."` choice always carried.
- **Its cost is honest and bounded.** The forfeited "zero build-pipeline change" benefit becomes:
  compile agents+skills+rules into the bundle and copy `templates/companion-files/` into it (the
  Gemini bundle already does exactly this via `copyTemplatesDir`). The on-disk duplication is
  generated and CI-checked — the category ADR-007 explicitly sanctions as "detection beats
  deletion."

**Strongest reason for A (single):** it is the identical isolation the Gemini target already
proved in this repo, so it fixes the leak *and* the whole-monorepo install bloat while staying
inside ADR-007's doctrine and leaving AC4 intact.

**Strongest reason against A / runner-up's best case (C):** if Claude Code's marketplace *does*
support a source-root ignore/exclusion, Approach C would solve the reported leak with near-zero
build machinery and zero on-disk duplication — the smallest change that addresses the issue. It
is dismissed only because that support is unverified (and, even if present, would leave the
whole-repo install-surface bloat unaddressed).

## Rejected Alternatives

Language below is deliberately "was rejected because…" so a future reviewer can enforce V-ARCH-01
against any implementation that reintroduces a rejected pattern.

| Alternative | Was rejected because |
|---|---|
| **B — one shared `plugins/blackhole/` bundle for both Gemini and Claude** | It **was rejected because** the two platforms have structurally incompatible plugin contracts that cannot co-exist in one directory: Gemini requires a flat `plugin.json` at bundle root with `$schema: antigravity.google/…` and **no `agents/`** (AC4, enforced by `distributionTreeErrors()`), whereas Claude requires `.claude-plugin/plugin.json` *inside* the bundle **with** the 8 agents. Making the shared bundle satisfy Claude would add `agents/`, which trips the AC4 build/verify error for the Gemini consumer; making the no-agents check conditional would force generalizing two tree validators that `tree-shape.ts` explicitly instructs *not* to merge ("Do not generalize these two into one parameterized 'expected agent count' function"). The "single bundle, zero duplication" appeal is real but is bought by coupling two deliberately-separated invariants — a higher long-term cost than the generated, checked duplication of a second bundle. |
| **C — keep `source: "."` and add a `.claudeignore`-style / manifest exclusion** | It **was rejected because** Claude Code's plugin marketplace is **not confirmed to support any source-root exclusion mechanism** — there is no documented `.claudeignore`, ignore glob, or per-plugin exclude manifest for marketplace `source` roots (unlike, e.g., `.gitignore` or npm's `files`). Building the fix on an unverified capability risks a no-op or a silent full-repo ship; ADR-007's "detection over generation" ethos cannot be honored for a mechanism verify cannot express. Even in the best case where such support exists, it addresses only the *named leaked path* and leaves the far larger whole-monorepo install surface (`src/`, `scripts/`, `documentation/`, sibling platform trees) shipping to every Claude consumer. If a future maintainer confirms first-class exclusion support, this ADR should be revisited — but it must not be assumed at implementation time. |
| **Rename the existing `plugins/blackhole/` to a per-platform pair (`plugins/gemini/`, `plugins/claude/`)** | It **was rejected because** renaming the tracked `plugins/blackhole/` directory is a breaking change to the documented Gemini global-install path (`ln -s …/plugins/blackhole ~/.gemini/config/plugins/blackhole`, `README.md`), inflicting churn on an unrelated platform for a cosmetic symmetry gain. Adding `plugins/blackhole-claude/` alongside the existing bundle achieves isolation with zero disruption to the Gemini install contract. |

## Affected files / implementation sketch

Touch-paths for the eventual plan (this ADR does **not** implement any of them):

- **`scripts/build.ts`** — Target C gains a distribution arm parallel to the Gemini
  `Target D2` block (~L601–610): compile the blackhole skill + agents + rules + templates into a
  new `plugins/blackhole-claude/` bundle (a `compileGeminiTree`-shaped pass with agents
  **included**, plus `copyTemplatesDir`), write `.claude-plugin/plugin.json` inside the bundle
  from `buildClaudePluginManifest`, and add a `CLAUDE_DISTRIBUTION_ROOT` const to `build.ts`
  § facts. Change `buildClaudeMarketplace` so `source` is `"./plugins/blackhole-claude"` instead
  of `"."`. Register the new dir in `GEMINI_TARGET_DIRS`/tracked-target logic as appropriate so
  tracked⇒built-by-default (ADR-007 R5′) holds.
- **`.claude-plugin/marketplace.json`** — regenerated output: `source` points at the bundle.
  (Not hand-edited — it is a build artifact.)
- **`scripts/tree-shape.ts`** — add a Claude-bundle tree validator that requires `agents/`
  (the inverse of `distributionTreeErrors`'s AC4 no-agents rule) plus the standard
  rules/skills/manifest shape; keep it a *separate* function per the existing "do not generalize"
  note.
- **`scripts/checks/build.check.ts`** — add a `V-CLAUDE-DIST-01`-style check calling the new
  validator; add `plugins/blackhole-claude/` to `BUILD_OUTPUT_PATTERNS`; bump
  `EXPECTED_CHECK_COUNT` in `build.ts` accordingly.
- **`README.md`** — the Claude Code install block is unchanged for consumers (`/plugin marketplace
  add … && /plugin install …` still works), but the "Development & Compilation" layer table and
  the source-vs-generated notes should mention the new bundle so maintainers know repo-root
  `.claude/` is now free for maintainer-only content.
- **Verification note for the plan:** confirm empirically that Claude Code resolves a marketplace
  `source` given as a relative subdirectory path (`"./plugins/blackhole-claude"`) and loads
  `.claude-plugin/plugin.json` from there — this is the single external assumption Approach A
  rests on, and it should be smoke-tested before merge.

## References

- Issue #262 — "[Upstream] Split Claude Code marketplace bundle from maintainer-local .claude/"
- ADR-007 — Drift-Proof Toolchain Re-Seating (Blueprint v2); binding doctrine "detection over
  generation, governance over fragmentation"; AC4 (Gemini bundle no-agents invariant)
- `scripts/build.ts` — `buildClaudeMarketplace` (source:'.'), Target C (~L546–578), Target D2
  Gemini distribution bundle (~L601–610), `copyTemplatesDir` rationale (~L356–359)
- `scripts/tree-shape.ts` — `distributionTreeErrors` (AC4 enforcement), "do not generalize" note
- `documentation/audits/mercure-sync.md` — the maintainer-only skill whose scaffolding surfaced #262
