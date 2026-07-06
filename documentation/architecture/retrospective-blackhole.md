---
type: analysis
skill: x-rearchitect
status: draft
created: 2026-07-06
last_updated: 2026-07-06
related:
  - documentation/audits/architecture-coherence.md
  - documentation/audits/platform-build-verification.md
  - documentation/decisions/ADR-001-five-phase-lifecycle.md
  - documentation/decisions/ADR-002-synthesizer-extraction.md
  - documentation/decisions/ADR-003-synthesizer-removal.md
review_trigger: "on major version release"
---

# Architectural Retrospective — blackhole

**Target**: The whole `backlog-campaign` repository (project name: `blackhole`) — an
agent-agnostic backlog campaign orchestrator whose single `src/` markdown source tree is
compiled by `scripts/build.ts` into 5 platform targets (Claude Code, Cursor, Codex CLI,
Antigravity/Gemini, skills.sh flat registry).

**Mode**: default (full 8-phase retrospective).

**Relationship to existing audits**: `documentation/audits/architecture-coherence.md`
(2026-07-06, same day) already covers coupling/duplication in `build.ts`/`verify.ts` and
post-rename naming residue; most of its findings (F1–F3, F5–F8) are already resolved by
commits #82, #83, #87, #88, #89. This retrospective does not repeat that audit — it cites it
as baseline evidence and goes further: root-cause genealogy, a from-scratch redesign
alternative, and the 8-phase quantitative comparison that a coherence audit does not attempt.

---

## Phase 1: Current Architecture Audit

*Delegated to `mercure:x-architect` (sonnet). Full report below.*

### 1.1 Component Inventory

| Type | Count | Location | Approx LOC |
|------|-------|----------|-----------|
| Agent source (editable) | 5 | `src/agents/*.md` | 517 |
| Reference/protocol docs (editable) | 24 | `src/references/*.md` | 2,184 |
| Skill entry (editable) | 1 | `src/SKILL.md` | 124 |
| **Editable source total** | **30 files** | `src/` | **2,825** |
| Build/verify scripts (production) | 10 | `scripts/*.ts` | 3,420 |
| Build/verify scripts (tests) | 10 | `scripts/*.test.ts` | 1,823 |
| **Scripts total** | **20 files** | `scripts/` | **5,243** |
| Compiled targets | 5 platforms (skills.sh, Cursor, Claude Code, Codex CLI, Antigravity/Gemini) | root mirrors, `.cursor/`, `.claude/`, `codex-*`, `.agents/build/`+`.gemini-plugin/`+`plugins/blackhole/` | 1:1 mirrors of `src/` (Cursor and skills.sh each carry a duplicated namespaced copy) |
| Plugin manifests (generated) | 5 | `.claude-plugin/`, `.codex-plugin/`, `.gemini-plugin/`, `codex-marketplace.json`, `.claude-plugin/marketplace.json` | small JSON |

5 platform targets confirmed produced from the same 30 `src/` files by `scripts/build.ts`; file-count parity across mirrors holds (spot-checked).

### 1.2 Dependency Map

**Agents → references** (efferent):

| Agent | Ce | Targets |
|-------|-----|---------|
| orchestrator.md | 6 | campaign-prompt, worker-schemas, review-core, queue-dag, checkpoint-protocol, recovery-protocol |
| coordinator.md | 2 (+1 external) | multitask-mode, coordinator-dashboard, `.cursor/rules/release-milestone-governance.mdc` (maintainer-only, Cursor-only file) |
| implementer.md / reviewer.md / planner.md | 1 each | worker-schemas |

**Reference-doc afferent coupling (Ca) — hubs**:

| Reference doc | Ca | Role |
|---|---|---|
| `worker-schemas.md` | 9 | Highest-coupling hub — output-schema contract |
| `forge-sync.md` | 8 | Forge-sync protocol hub (also 240 LOC — 2.6× the 91-LOC mean; high-Ca + high-size = distance-from-main-sequence risk) |
| `checkpoint-protocol.md` | 7 | Checkpoint contract hub |
| `queue-dag.md` | 6 | Queue state contract |
| `review-core.md`, `issue-splitting.md` | 5 each | |
| `agent-tools.md` | **0** functional | Orphaned — no agent or reference doc actually cites it |

**`scripts/*.ts` import graph** — clean DAG rooted at `build.ts`/`doctor.ts`, **no circular dependencies**:

```
build.ts  (Ce=0, Ca=2 prod: verify.ts, install-verify.ts)
doctor.ts (Ce=0, Ca=1 prod: install-verify.ts)
forge-scope.ts (Ce=0, Ca=1: campaign-status.ts)
install-verify.ts (Ce=2: build.ts + doctor.ts, Ca=0)
review-aggregate.ts, forge-deps.ts, validate-worker-json.ts, release.ts — standalone, Ce=0/Ca=0
campaign-status.ts (Ce=1: forge-scope.ts)
```

### 1.3 Coupling Metrics (Ca/Ce)

| Script | Ce | Ca (prod) | Instability I=Ce/(Ca+Ce) | Rating |
|---|---|---|---|---|
| `build.ts` | 0 | 2 | 0.0 | Maximally stable — but stable because everything reaches into one file, not because it's small (see SRP finding below) |
| `verify.ts` | 1 (+ 3 hidden runtime `spawnSync('bun run build')` calls — a coupling channel invisible to static import analysis) | 0 | 1.0 | Expected for a leaf orchestrator, but true dependency surface on `build.ts` is larger than "1 import" suggests |
| `campaign-status.ts` | 1 | 0 | 1.0 | Fine — CLI entry point |
| `review-aggregate.ts` | 0 | 0 | — | Best-scoring script in the codebase for coupling discipline |

### 1.4 Change Amplification

*(Agent's tooling lacked Bash; figures below are cross-checked against the orchestrator's own `git log` mining — see Phase 2.)*

Structural amplification independent of history: a one-line edit to any `src/references/*.md` file mechanically produces **7–9 generated-file writes** across the 5 platforms by design (root mirror + namespaced skills.sh + Cursor submodule + Cursor nested mirror + Claude + Codex + optional Gemini ×2). This is the compiler's intended fan-out and is CI-gated (`verify.yml`'s "Verify build is in sync" step), not itself an architectural smell — but it means **every PR touching one `src/` line shows an 8–9 file diff**, all but one non-substantive, with no evidence of generated-file diff-collapse (`.gitattributes` or PR-comment folding) to mitigate reviewer fatigue.

Hotspot candidates (confirmed independently via `git log --name-only` in Phase 2, see below): `README.md` (29 changes), `package.json` (28), `scripts/build.ts` (27), `scripts/verify.ts` (20), `.claude-plugin/plugin.json` (16), `references/ground-truth.md` and its 4 mirrored copies (15+14+12+11+11 = 63 combined changes for one logical file).

### 1.5 SOLID Compliance Scores

**`scripts/build.ts` — SRP: FAIL (CRITICAL, V-SOLID-01)**

598 LOC, 22 top-level functions across **10 distinct responsibility clusters**: frontmatter parsing, Codex YAML serialization, template-conditional compilation, generated-marker stamping, generic file/tree walking, per-platform manifest construction, Gemini tree assembly, **post-build shape assertions for 3 trees** (duplicating `verify.ts`'s concern — two files independently encode "what does a valid compiled tree look like"), Codex tree compilation, and a 180-line imperative `main()`.

**Verdict**: strongest anti-pattern finding in the repository — CRITICAL SRP violation (>300 lines, multiple domains, mixed I/O+logic+validation).

**`scripts/verify.ts` — SRP: WARN (HIGH, borderline)**

833 LOC (largest file in repo) but 20 individually small, single-purpose, independently-testable check functions — size comes from breadth (20 orthogonal invariants), not entanglement. Commit `3ad5d5e` ("dedup rulesList + split checkCodexBuild") is direct evidence the team already refactors toward this shape when a check grows too large. Rated WARN, not BLOCK.

**5-agent split — SRP/ISP: PASS**, with one enforcement highlight: `verify.ts`'s `checkAgentToolPolicy` deny-matrix **mechanically enforces** (not just documents) each agent's tool boundary — e.g. `coordinator` is Write/Edit/Delete-denied, `implementer` is the sole agent with full tool access. No overlap found in reference-doc citation graphs beyond the shared `worker-schemas.md` contract (correct — a shared contract, not a responsibility leak).

**DIP**: no dependency injection anywhere in the 10 production scripts (direct `fs`/`path`/`child_process` calls) — not scored as a violation; appropriate for this toolchain's size and stable test coverage via pure-function extraction.

### 1.6 Anti-Pattern Inventory

| # | Anti-Pattern | Location | Severity |
|---|---|---|---|
| 1 | God Object | `scripts/build.ts` (598 LOC, 22 fns, 10 responsibility clusters) | HIGH |
| 2 | Duplicated validation logic across module boundary | `build.ts`'s `assertGeminiTree`/`assertDistributionTree`/`assertCodexTree` vs. `verify.ts`'s `validatePluginTreeShape`/`checkGeminiBuild`/`checkCodexBuild` | MEDIUM |
| 3 | Orphaned reference doc | `src/references/agent-tools.md` (61 LOC, Ca=0 functional) | MEDIUM |
| 4 | Cross-boundary reference to non-compiled file | `src/agents/coordinator.md` → `.cursor/rules/release-milestone-governance.mdc` (Cursor-only, 404s on 4/5 platforms unless conditionally guarded — unconfirmed) | MEDIUM (flag) |
| 5 | Synchronization-tax single point of failure | `src/references/ground-truth.md` (must be manually kept in sync with agent/phase/V-code/check counts) | LOW-MEDIUM |
| 6 | Disproportionate growth vs. neighbors | `src/references/forge-sync.md` (240 LOC vs. 91 mean, also Ca=8) | LOW-MEDIUM |
| 7 | Circular dependency | — none found (clean DAG) | N/A |
| 8 | Distributed Monolith / Big Ball of Mud | — not present; single SSOT + CI-enforced zero-diff gate is the correct mitigation | N/A |

### Structural Health Dashboard (Phase 1 summary)

| Metric | Value | Rating |
|--------|-------|--------|
| Editable source LOC | 2,825 (30 files) | — |
| Production script LOC | 3,420 (10 files) | — |
| Test LOC | 1,823 (~53% of prod LOC) | Healthy |
| Compiled mirror fan-out per src edit | 7–9 generated files | By-design, CI-gated |
| Largest file | `verify.ts` 833 LOC (breadth, healthy); `build.ts` 598 LOC (entangled, CRITICAL) | Concentrated risk in build.ts |
| Reference-doc coupling hub | `worker-schemas.md`, Ca=9 | Expected |
| Orphaned reference doc | `agent-tools.md`, Ca=0 | Flag for pruning |
| Circular dependencies | 0 | Clean |
| Drift-prevention mechanism | CI `verify.yml` build+diff gate | Present, correctly scoped |

---

## Phase 2: Root Cause Analysis

*Sequential-thinking trace of historical pain points against git history (50 commits total), 3 ADRs, and the Phase 1 audit.*

### 2.1 Pain Point Matrix

| # | Symptom | Root Design Decision | Classification | SOLID Mapping | Status |
|---|---------|----------------------|-----------------|----------------|--------|
| 1 | Project identity renamed twice (`bc-campaign` → `backlog-campaign` → `blackhole`); ≥6 dedicated cleanup commits (#58, #65, #77, #78, #82, plus the rename itself); `ground-truth.md` alone changed 63 times across its 5 mirrored copies | Project name/identity is hardcoded as literal strings across `src/`, `scripts/`, and every generated manifest instead of flowing from one named constant | Coupling violation — changes ripple across system | OCP (not closed for a rename — extension requires modifying N files, not 1 config source) | **Healed** — current state is clean (F3 resolved per #82) |
| 2 | 5-commit revert-then-reapply cycle (`b603b13`, `7a304a6`, `5206526`, `45f30a6`, `efae87e` reverted; `183b08d`, `72cc033`, `a62697e`, `e8292b3`, `79f3c6b`/`e6d962b` reapplied) — a batch of features + the `V-BUILD-01` drift check landed together, one broke, all had to roll back as a block | No per-feature isolation/staging before merge; a stricter build-drift gate was introduced in the same batch as unrelated features | Missing validation — no gate prevented the problem | SRP (process) | **Healed** — `V-BUILD-01` now stable in `verify.yml`, no repeat since |
| 3 | `bc-synthesizer` agent added ([ADR-002](../decisions/ADR-002-synthesizer-extraction.md)) then removed one cycle later ([ADR-003](../decisions/ADR-003-synthesizer-removal.md)); orphaned fixtures from it survived until today's cleanup (`0393b32`) | A dedicated LLM aggregation hop was designed for a future parallel multi-reviewer scenario that didn't exist yet in v1 | Premature abstraction — created before 3 consumers | ISP / YAGNI | **Healed**, but dead-code residue outlived the ADR by multiple release cycles — removal is slower than addition |
| 4 | `scripts/build.ts` is a 598-LOC, 22-function, 10-responsibility-cluster CRITICAL SRP violation; its own tree-shape assertions (`assertGeminiTree`, `assertDistributionTree`, `assertCodexTree`) duplicate `verify.ts`'s independent checks; the file *keeps growing* (commit `baac0be` bolted a new marker-stamping responsibility onto it as recently as PR #83) even after a sibling script (`verify.ts`) demonstrated the healthier decomposed pattern one commit later (`3ad5d5e`) | When each new platform target (Codex, then Gemini/Antigravity) was added, its compile+manifest+assert logic was added as more functions in the *same* file instead of extracting a per-platform module behind a shared interface | Wrong granularity (too coarse) + Missing interface (no `PlatformTarget` abstraction) | SRP + DIP | **Open — primary redesign target** |
| 5 | For most of the project's life, generated compiled-mirror files were textually indistinguishable from hand-written source in a diff (no "do not hand-edit" marker existed until `baac0be`, PR #83) | No governance gate against accidental hand-edits to compiled output existed at the time each new target was added | Missing validation — no gate prevented the problem | SRP (process) | **Healed** (very recently) |

### 2.2 Effort-Waste Estimation

- **Identity rename tax**: ≥6 commits of purely cosmetic cleanup across 2 rename cycles, recurring because the name isn't a single source of truth. A 3rd rename (not improbable given this is #2) would repeat the cost.
- **Revert/reapply batch**: 5 revert + 5 reapply/fix commits = 10 commits of pure process churn from one under-isolated merge batch.
- **Synthesizer add-then-remove**: 2 ADRs + agent-file add + agent-file removal + a fixture-cleanup commit dated the same day as this retrospective (`0393b32`) — the dead code survived from removal until today, i.e. across several `v0.4.x`/`v0.5.0` release cycles.
- **`build.ts` accretion**: ongoing, unresolved — the only pain point in this matrix still actively getting worse rather than healed. This is where Phase 3's redesign effort concentrates, per Pareto focus (don't re-litigate scars the team already healed on its own).

### 2.3 Phase 3 Workflow Trigger Check

Root-cause matrix contains **2 distinct SOLID violation categories with concrete evidence carrying into an open (unhealed) issue** (SRP+DIP from `build.ts`'s missing `PlatformTarget` abstraction; OCP from identity-string coupling, still a latent risk despite being currently healed). Per the skill's Phase 3 trigger (`≥2 SOLID violation categories OR ≥3 high-coupling hotspots`), the **N-critics adversarial workflow fires** with `N = min(2, 3) = 2`.

---

## Phase 3: Redesign Blueprint

### 3.1 Assumption Audit (current architecture)

| Marker | Assumption | Assessment |
|--------|-----------|------------|
| ✓ Validated | "5 platforms can be compiled from one common markdown source with template conditionals" | Proven over 50 commits of stable operation, CI-gated, zero drift incidents in the visible history |
| ✓ Validated | "Runtime campaign state (`.blackhole/`) must stay structurally separate from compiled targets" | Cleanly enforced; Phase 1 audit found zero leakage |
| ~ Contestable | "Each new platform's compile+assert logic belongs in `build.ts` as more functions" | Was reasonable at 2-3 targets; contestable now at 5, and this pattern is the direct cause of the CRITICAL SRP finding |
| ⚡ Oversimplified | "`verify.ts` needs its own independent tree-shape assertions" | Oversimplified — it duplicates `build.ts`'s own `assertGeminiTree`/`assertDistributionTree`/`assertCodexTree`, the exact anti-pattern #2 finding |
| ◐ Blind spot | "Project identity (name/description/keywords) is a safe fixed literal" | Blind spot, confirmed in code: `build.ts` already parses `package.json` (`pkg.version`) but the literal `'blackhole'` string still appears independently ~6+ times across `buildGeminiPluginManifest`, `buildCodexPluginManifest`, `buildCodexMarketplace`, and `main()`'s `pluginMeta` — `pkg.name` is available and unused. This is the still-live residue of Pain Point #1, not fully healed, just less painful post-rename. |
| ✗ Incorrect | — | None found — the overall compile-to-N-targets strategy itself is sound; no wholesale rewrite is warranted |

**Steelman of the current architecture** (per Design Challenge Protocol — don't treat the redesign as automatically superior): `build.ts` is a single 598-line imperative script a lone maintainer (this repo has one active committer per git history) can read top-to-bottom without navigating an abstraction layer. An interface-based plugin system trades that explicitness for genericity — and genericity has a real cost here: `assertDistributionTree` and `assertGeminiTree` already have *inverted* invariants (zero agents required vs. exactly 5 required) for what looks like "the same kind of target," so a generic `PlatformTarget[]` loop still needs per-target special-casing internally. For a single-maintainer project with only 5 targets and no near-term 6th platform in `documentation/decisions/`, the god-file's readability-for-one may currently outweigh the abstraction's extensibility benefit — this is a genuine YAGNI tension, not a one-sided case.

### 3.2 Redesign Proposal: `PlatformTarget` Interface

Extract a shared interface so each platform's compile + assert + manifest logic lives in its own module, and `build.ts` becomes a thin orchestrator instead of the 10-responsibility-cluster god-file:

```
scripts/
├── compiler-core.ts     # shared pure fns: parseMdFrontmatter, applyPlatformConditionals,
│                        #   compileContent, processFile, compileFolder, generatedMarkerLine
├── project-identity.ts  # SSOT: { name, description, keywords, homepage, repository } from package.json
├── platforms/
│   ├── skills.ts        # PlatformTarget: skills.sh flat mirror
│   ├── cursor.ts         # PlatformTarget: Cursor (2 co-located layouts)
│   ├── claude.ts          # PlatformTarget: Claude Code
│   ├── codex.ts            # PlatformTarget: Codex CLI (YAML serialization + manifest + assert)
│   └── gemini.ts             # PlatformTarget: Antigravity/Gemini (workspace + distribution bundle)
├── build.ts               # orchestrator: for (t of ALL_TARGETS) { t.clean(); t.compile(); t.assertShape() }
│                          #   + top-level Claude Code plugin.json/marketplace.json (repo-level, not per-target)
└── verify.ts                # imports t.assertShape() from each platforms/*.ts directly — no
                             #   independently re-implemented tree-shape checks
```

```ts
interface PlatformTarget {
  id: 'skills' | 'cursor' | 'claude' | 'codex' | 'gemini';
  outputRoots: string[];          // dirs cleaned before compile
  enabled(args: Set<string>): boolean;  // e.g. gemini gated behind --gemini
  compile(): void;                // uses compiler-core.ts primitives
  assertShape(): void;             // co-located with compile — the single owner of "valid tree" for this target
  manifest?(identity: ProjectIdentity): Record<string, unknown>;
}
```

This directly resolves 3 of the 6 Phase 1 anti-patterns: #1 (God Object — responsibility now spread across 5 small target modules + 1 shared core, each independently testable), #2 (duplicated validation — `verify.ts` calls the same `assertShape()` `build.ts` uses, one owner per target), and the Pain-Point-#1 residue (identity centralized in `project-identity.ts`, derived from `package.json`, used by every manifest builder — a 3rd rename touches one file instead of ~6 call sites).

**100% feature parity requirement**: every current behavior is preserved — same 5 compiled trees, same template-conditional stripping, same generated-marker stamping, same Codex YAML serialization, same distribution-bundle no-agents invariant. This is a structural extraction, not a behavior change.

**Honest new costs**: 6 new files instead of 1 (navigation cost for the lone maintainer); an `enabled()`/lifecycle contract to learn instead of reading `main()` top-to-bottom; and the two genuinely different assert invariants (`assertGeminiTree` vs `assertDistributionTree`) still need to live as different implementations of `assertShape()` — the interface doesn't eliminate that asymmetry, it just gives it a consistent home.

### 3.3 Adversarial Critics (N=2, per Phase 2.3 trigger)

*Two independent `x-architect` critics stress-tested §3.2 — structural-integrity lens and coupling/DIP lens. The native `Workflow` fan-out path failed silently (no transcript produced); fell back to the skill's documented single-`Agent`-per-critic path.*

**Structural-integrity critic — MEDIUM severity.** Key findings: (1) `compiler-core.ts` relocates rather than eliminates the SRP clustering — it's the same 6-function grab-bag with a friendlier name; (2) `PlatformTarget.manifest?()` being optional is an ISP violation (V-SOLID-04) baked into a brand-new interface that doesn't exist today; (3) unifying `assertGeminiTree` (5 agents required) and `assertDistributionTree` (0 agents required) under one `assertShape(): void` signature creates "gravitational pull" toward merging genuinely inverted invariants by accident — today's two textually separate functions can't be merged that way; (4) centralizing identity into one file also centralizes its blast radius — a bad `pkg.name` now breaks all 5 manifests in one build instead of being fault-isolated; (5) keeping Claude Code's manifest generation in `build.ts` while extracting everything else is an unexplained asymmetry — exactly the pattern the redesign claims to remove; (6) zero drift incidents in 50 commits means the CRITICAL SRP finding is a structural judgment, not an incident-driven one — the migration cost is being paid against a currently theoretical benefit.

**Coupling/DIP critic — MEDIUM severity.** Key findings: (1) `compiler-core.ts` becomes a high-Ca, concrete (low-abstractness) module — Martin's "zone of pain": stable + concrete = expensive to change, now touching 6+ files per signature edit; (2) `verify.ts` trades 0 cross-file edges (duplicated but self-contained) for 5 new import edges — fixes V-DRY-01 but adds real coupling: a compile error in any platform module now breaks `verify.ts` too; (3) two data points with inverted invariants is a weak basis for a shared interface (V-YAGNI-02/03 — premature abstraction, no proven 3rd variation point); (4) the Claude Code manifest split point is the one place an actual **import cycle** (not just fan-out) is plausible: `build.ts` needs `claude.ts`'s compiled shape, `claude.ts`'s `manifest()` may need `build.ts`'s repo-level context; (5) `project-identity.ts` is flagged as the one genuinely low-risk, high-value piece of the proposal, worth extracting independently of everything else; (6) recommends a narrower alternative: extract `project-identity.ts` + dedupe the assert/validate functions into a small shared module via plain function imports, **without** a formal `PlatformTarget` interface or full module-per-platform split, until a 6th platform or proven interface variance actually materializes.

**Convergence**: both critics, independently, reach the same narrower recommendation — the identity-centralization and assert/validate-dedup are low-risk, high-value, uncontested wins; the full interface-per-platform split is where the risk concentrates, and neither critic found it justified by measured (vs. structural) pain for a single-maintainer, zero-incident, well-tested codebase.

### 3.4 Revised Blueprint — Scoped Extraction (adopted per critic convergence)

Per the Hard Choice Protocol, the harder-but-better path here is not "build the full interface" — it's *resisting* the more elaborate design the CRITICAL SRP label makes tempting, in favor of the smaller change both critics converged on independently:

1. **`scripts/project-identity.ts`** — new, small: `{ name, description, keywords, homepage, repository }` derived from `package.json`. Every manifest-builder function in `build.ts` (`buildGeminiPluginManifest`, `buildCodexPluginManifest`, `buildCodexMarketplace`, the inline `pluginMeta`/`marketplaceJson` in `main()`) takes this as a parameter instead of a hardcoded `'blackhole'` literal. Resolves Pain Point #1's residue directly; a 3rd rename touches 1 file instead of ~6 call sites.
2. **Shared assert/validate module** (e.g. `scripts/tree-shape.ts`) — plain exported functions, not an interface: `assertGeminiTree`, `assertDistributionTree`, `assertCodexTree` move here verbatim (invariants preserved, including the intentional 5-vs-0-agents inversion), and `verify.ts` imports these same functions instead of independently re-implementing `validatePluginTreeShape`/`checkGeminiBuild`/`checkCodexBuild`. Resolves anti-pattern #2 (duplicated validation) without introducing a formal interface or the ISP/ cycle risks the critics identified.
3. **No `PlatformTarget` interface, no `platforms/` module split, no `compiler-core.ts` extraction** — deferred. `build.ts`'s remaining god-file shape (frontmatter parsing, template compilation, file walking, per-target compile calls in `main()`) stays as-is. This is a deliberate scope cut: the critics found the interface abstraction premature (2 data points, inverted invariants) and its main benefit (extensibility to a 6th platform) is not currently needed.
4. **Revisit condition** (mirroring ADR-003's own pattern for this exact kind of call): re-introduce the full `PlatformTarget` interface if a 6th platform target is actually proposed, or if `build.ts` grows past ~750 LOC / a new responsibility cluster is added without a clear extraction path.

This changes the redesign target for Phases 4–8 below: the "Redesigned" column now reflects the **Scoped Extraction** (items 1–2 above), not the full interface-per-platform architecture — a proportionate response consistent with the Pareto/YAGNI gates in this project's own quality rules.

---

## Phase 4: SOLID Comparison

*Current architecture vs. the critic-endorsed Scoped Extraction (§3.4) — user confirmed this comparison target via the Phase 3 review gate.*

| Principle | Current | Scoped Extraction | Delta | Concrete Example |
|-----------|---------|--------------------|-------|-------------------|
| **SRP** | FAIL (CRITICAL) — `build.ts` 598 LOC, 22 fns, 10 responsibility clusters | WARN (HIGH, reduced not resolved) — ~538 LOC (-10%), 8 clusters (-20%): identity-literal and tree-shape-assertion clusters extracted; frontmatter parsing, YAML serialization, template conditionals, marker stamping, file/tree walking, and per-platform compile orchestration remain in `build.ts` by deliberate scope cut | -10% LOC, -20% clusters | `assertGeminiTree`/`assertDistributionTree`/`assertCodexTree` move verbatim to `scripts/tree-shape.ts`; `build.ts`'s `main()` calls `treeShape.assertGeminiTree(...)` instead of a local function |
| **OCP** (platform-add axis) | FAIL — 6th platform requires editing `main()` + writing new one-off compile/assert functions | FAIL — **unchanged, explicitly deferred** per the revisit condition (§3.4.4) | 0 (deferred by design) | Adding a hypothetical 6th target still means a new block in `main()`, same as today |
| **OCP** (identity/rename axis) | FAIL — a rename touches ~6+ hardcoded literal call sites across manifest builders | PASS — a rename touches 1 file (`project-identity.ts`) | ~6 call sites → 1 | 3rd rename (if it happens) edits one `{ name, description, keywords, ... }` object instead of 6 separate literals |
| **LSP** | N/A — no class hierarchy in this codebase (plain functions + JSON manifests) | N/A — unchanged; the Scoped Extraction introduces no interface, so no substitutability question arises | N/A both | — |
| **ISP** | N/A — no formal interface exists, so none can be violated | N/A — **deliberately avoided**: the full `PlatformTarget.manifest?()` interface (which both critics flagged as a live ISP violation, V-SOLID-04) is not introduced in this scoped version | N/A both, but redesigned avoids a violation the fuller alternative would have introduced | Critics' finding directly prevented adopting an interface with an optional member |
| **DIP** | WARN — `verify.ts` imports 6 concrete symbols from `build.ts` (the orchestrator depending on the orchestrator) plus 3 hidden runtime `spawnSync('bun run build')` coupling channels | WARN, improved — `verify.ts` imports 3 assert functions from `tree-shape.ts` instead of from `build.ts`; both `build.ts` and `verify.ts` now depend on a smaller, more focused shared module rather than one depending on the other | Ce on `build.ts`-concrete-symbols: 6 → 0 (moved to a 3-symbol shared module) | `import { assertGeminiTree, assertDistributionTree, assertCodexTree } from './tree-shape'` replaces importing the same symbols from `./build` |

**Honest residuals** (not resolved by the Scoped Extraction, flagged rather than silently dropped): (1) the 3 hidden `spawnSync('bun run build')` runtime coupling channels in `verify.ts` are untouched — out of scope for this scoped fix; (2) today `build.ts` and `verify.ts` have zero import coupling on tree-shape logic (duplicated but independent); the Scoped Extraction turns that into **shared-module coupling** — a smaller-scale version of the same tradeoff the critics flagged for the full interface (contained to 1 shared file instead of 5, but not zero); (3) the platform-add extensibility problem (OCP) is explicitly **not** fixed — this was the primary justification for the original full redesign, and it remains open, deferred to the documented revisit condition.

---

## Phase 5: DRY Analysis

| Duplication | Current | Single Source of Truth Proposal | Generation Method |
|---|---|---|---|
| Tree-shape validation (`assertGeminiTree`/`assertDistributionTree`/`assertCodexTree` in `build.ts` vs. `validatePluginTreeShape`/`checkGeminiBuild`/`checkCodexBuild` in `verify.ts`) — 3 conceptually-duplicated check pairs, ~90–120 LOC of duplicated logic out of ~1,430 combined `build.ts`+`verify.ts` LOC | Duplicated (independent implementations, same invariants) | `scripts/tree-shape.ts` — 3 plain exported functions, invariants preserved verbatim (including the intentional 5-vs-0-agents inversion) | Both `build.ts` and `verify.ts` import from `tree-shape.ts`; no codegen needed, direct import |
| Project identity literal (`'blackhole'`, description, keywords) — ~6+ independent occurrences across `buildGeminiPluginManifest`, `buildCodexPluginManifest`, `buildCodexMarketplace`, `main()`'s `pluginMeta`/`marketplaceJson` | Duplicated (6 literal sites) | `scripts/project-identity.ts` — one object derived from `package.json` | Direct import + parameter passing into each manifest builder |
| `RULES_LIST` 3-item array (already fixed) | **Resolved** — `verify.ts` previously re-derived its own inline copy; deduped in commit `3ad5d5e` (audit F1) | `build.ts`'s `RULES_LIST` export, imported by `verify.ts` | Already implemented — cited here as a positive precedent for the Scoped Extraction pattern |
| Compiled mirror fan-out (7–9 generated files per `src/` edit across 5 platforms + Cursor's own internal double-compile: root `.cursor/` submodule layout **and** a second nested mirror under `skills/`/`agents/`, per `build.ts` lines 474–492) | Duplicated **by design** — this is the intentional compile-to-N-targets architecture, not an accidental DRY violation | No SSOT change proposed — `src/` already is the SSOT; the duplication is the generated *output*, correctly CI-gated (`verify.yml`'s build-is-in-sync check) | N/A — already correctly generated, not hand-maintained |
| `ground-truth.md` synchronization tax — a meta-inventory doc manually kept in sync with agent/phase/V-code/verify-check counts, enforced only by `checkGroundTruth()`'s `requiredRefs` list (which doesn't cover every reference doc, e.g. `agent-tools.md`) | Duplicated in spirit — counts asserted in prose must match counts computed from `src/` | **Not in scope for this retrospective's redesign** — flagged as a future opportunity (e.g., generate `ground-truth.md`'s count fields from `src/` directly rather than hand-asserting them), consistent with Phase 3's Pareto-scoped decision not to invent new redesign work beyond the two critic-endorsed fixes | Deferred |

### Duplication Ratio

| Scope | Current | Scoped Extraction | Delta |
|---|---|---|---|
| Tree-shape validation logic (within `build.ts` + `verify.ts`) | ~6–8% of combined 1,430 LOC is duplicated validation logic (3 pairs) | 0% — single implementation, both files import it | -6 to -8 pts |
| Identity literal occurrence count | 6 independent occurrences | 1 (derived value, imported everywhere) | -5 occurrences |
| Compiled-mirror fan-out (structural, not counted as a "violation") | 7–9 generated files per `src/` edit | 7–9 (unchanged — correctly out of scope) | 0 |

The Scoped Extraction closes the two duplication findings that were actually cited as anti-patterns in Phase 1 (#2 validation duplication, and the identity residue behind Pain Point #1); it does not touch the by-design compiled-mirror duplication or the `ground-truth.md` sync tax, both correctly deferred rather than folded into scope creep.

---

## Phase 6: Scalability Assessment

| Growth Scenario | Current | Scoped Extraction | Bottleneck |
|---|---|---|---|
| Reference-doc/agent count ×3 (30 → ~90 `src/` files) | Both scale identically for authoring (markdown, O(n) either way) | Same | **`ground-truth.md`'s manual sync tax** (unaddressed by either — deferred in Phase 5) becomes the actual bottleneck at 3× scale, not `build.ts`'s structure — more counts to hand-sync, only partially covered by `checkGroundTruth()`'s `requiredRefs` list |
| Platform targets +1 (a realistic 6th target, since the generic "×3" scenario doesn't fit an already-5-platform system) | New target = ~150–200 new LOC bolted into `build.ts`'s already-CRITICAL god-file, plus a new duplicate assert function in `verify.ts` | **Identical** — this growth axis was explicitly deferred in §3.4 (OCP platform-add axis: FAIL → FAIL) | **Unchanged, still the single largest live scalability risk** — the Scoped Extraction does not protect against this; adopting it is a deliberate trade-off, not an oversight |
| Team size 1 → 5 | New contributor must read one dense 598-LOC, 10-cluster file to understand any platform's compile logic — highest onboarding cost in the repo | Marginal improvement: 2 clusters (identity, tree-shape) now live in small, purposefully-named satellite files discoverable by name; the remaining 8 clusters still require the same top-to-bottom read of `build.ts` to understand compilation itself | **Partially reduced**, not solved — "where is the identity string" and "where are shape rules" become answerable by filename; "how does compilation work" does not |

### O(n) Complexity Analysis

| Dimension | Current | Scoped Extraction | Delta |
|---|---|---|---|
| Build time | O(`src/` files × 5 enabled platforms) | Same — compile loop structure unchanged | 0 |
| Validation time | O(20 `verify.ts` checks + 3 tree-shape asserts + 3 `spawnSync` rebuilds) | Same — check count and rebuild-shelling unchanged | 0 |
| Change amplification — identity change | O(6) hardcoded call sites | O(1) file (`project-identity.ts`) | -5 |
| Change amplification — tree-shape invariant change | O(2), hand-synced across `build.ts` + `verify.ts`, can silently drift | O(1) file (`tree-shape.ts`), both consumers import it — cannot drift | -1, and removes drift risk |
| Change amplification — new platform added | O(~150–200 new LOC in `build.ts` + 1 new duplicate assert in `verify.ts`) | **Unchanged** | 0 |

**Headline, stated plainly rather than buried in the executive summary**: the Scoped Extraction measurably de-risks 2 of 3 growth axes (identity changes, tree-shape changes) but does **not** de-risk platform-count growth — the single biggest scalability bottleneck in this codebase remains open by deliberate choice, deferred to the revisit condition in §3.4.4.

---

## Phase 7: Future-Proofing

| Scenario | Current | Scoped Extraction | Breaking-Change Surface | Migration Cost |
|---|---|---|---|---|
| Platform API/manifest field change (e.g. Claude Code changes its `plugin.json` schema) | Edit the specific manifest-builder function in `build.ts` (~1–2 files) | Same, or 1 file (`project-identity.ts`) if the changed field is identity-shaped | 1–2 files | LOW — manifest builders are already isolated functions in both versions |
| New platform target (6th) | ~150–200 new LOC in `build.ts`'s `main()` + a new duplicate assert function in `verify.ts` | Same LOC/location cost, **but** the new target's shape-assert function has one unambiguous home (`tree-shape.ts`) instead of an ambiguous choice between `build.ts` and `verify.ts` — a clarity improvement not counted in Phase 6's volume-based verdict | 2 files (current) vs. 2–3 files, more clearly separated (Scoped Extraction) | MEDIUM either way — additive, but must not regress other targets sharing `processFile`/`compileFolder` |
| New component type (e.g. a `src/hooks/` or `src/workflows/` folder) | Touches every platform's compile block in `main()` — high surface | **Identical** — this axis is untouched by either redesign option | 5 compile-call sites in `build.ts` | HIGH — this is the platform-add-style risk applied per-component-type, unaddressed either way |
| New governance/compliance rule (e.g. new V-code, new required frontmatter field) | Content change in `src/references/blackhole-vcodes.md` + a new check function in `verify.ts` — does not touch `build.ts`'s compile logic | Identical | 1–2 files | LOW — this axis lives in content/checks, not compile structure, in both versions |

**Extension points**: current = 0 platform-related extension points (every new platform requires modifying `main()` and adding a new `verify.ts` check) and 0 identity extension points (must edit each hardcoded literal individually). Scoped Extraction = still 0 platform-related extension points (unchanged, as established in Phase 6), but 1 clear additive extension point for tree-shape rules (a new assert function can be added to `tree-shape.ts` without modifying the existing 3), and identity moves from "6 edits" to "1 edit" (not a true OCP extension point, but a real reduction in edit-site count).

**Portability score**: identical for both — no host-SDK dependency in either version; the codebase is pure markdown + `fs` compilation, which is what gives it genuine agent-host portability today. Neither redesign option changes this.

### Phase 7.5: V-ADA-02 Exit Gate (WARN)

`documentation/decisions/INDEX.md` does not exist in this repository. `documentation/decisions/` contains 3 ADRs: **ADR-001** (status: accepted), **ADR-002** (status: superseded by ADR-003), **ADR-003** (status: accepted). Since no INDEX.md exists, both Accepted ADRs (001, 003) are unindexed.

**V-ADA-02 (MEDIUM, WARN — not blocking)**: create `documentation/decisions/INDEX.md` with rows for ADR-001 and ADR-003 (ADR-002 optionally included with a "Superseded" status per its own frontmatter). This was already surfaced as a Future Consideration in the newly-created `ARCHITECTURE.md` (§9); recorded here formally per the skill's exit gate. Per the enforcement contract, MEDIUM = WARN, not BLOCK — proceeding to Phase 8 regardless.

---

## Phase 8: Quantitative Dashboard

*Current architecture vs. the adopted **Scoped Extraction** (§3.4). 14 metrics — 13 from the skill's standard template plus a 14th (Test-LOC ratio) added because Phase 1 already produced concrete evidence for it and the template's own row count (13) undercounts its stated "14-metric" claim; adding a well-evidenced metric is preferable to leaving the discrepancy unexplained or padding with an unevidenced filler row.*

| # | Metric | Current | Redesigned (Scoped Extraction) | Delta | Principle | How Measured |
|---|--------|---------|-------------------------------|-------|-----------|--------------|
| 1 | Total files (`src/`+`scripts/`, excl. generated mirrors) | 50 (30 src + 20 scripts) | 54 (30 src + 24 scripts: +2 prod, +2 test) | +4 (+8%) | Simplicity | File count in `src/`+`scripts/` |
| 2 | Total LOC (`src/`+`scripts/`) | 8,068 (2,825 src + 5,243 scripts) | ≈8,155 (2,825 src + ≈5,330 scripts) | +87 (+1%) | Simplicity | `wc -l` on `src/`+`scripts/` |
| 3 | Cross-reference count (agent→ref edges + script import edges) | 16 (12 agent→reference edges + 4 script import edges) | 19 (+3: `build.ts`→`tree-shape.ts`, `verify.ts`→`tree-shape.ts`, `build.ts`→`project-identity.ts` — none of these edges existed before, since both files held independent local implementations) | +3 (+19%) | DRY vs. Coupling | Count cross-file import/citation edges |
| 4 | Duplication ratio (tree-shape logic within `build.ts`+`verify.ts`) | ~7% of 1,430 combined LOC | ~0% (residual near-zero) | -7pts | DRY | Duplicated LOC / total relevant LOC |
| 5 | SRP violations (severity-weighted: CRITICAL=3, WARN=2) | 5 (`build.ts` CRITICAL=3, `verify.ts` WARN=2) | 4 (`build.ts` downgraded to WARN=2, `verify.ts` unchanged WARN=2) | -1 (-20%) | SRP | Components >1 reason to change, severity-weighted |
| 6 | OCP violations (axes: platform-add, identity-rename) | 2 (both FAIL) | 1 (identity-rename → PASS; platform-add unchanged FAIL) | -1 (-50%) | OCP | Count of axes requiring modification vs. extension |
| 7 | Change amplification (identity-change file count, headline proxy) | 6 hardcoded call sites | 1 file | -5 (-83%) | Coupling | Files touched for a representative logical change |
| 8 | Cognitive load (files to read to understand full compile pipeline) | 1 file (598 LOC) | 3 files (~648 LOC total) | +2 files (+200%), LOC flat (+8%) | Accessibility | Files/LOC a new contributor must read |
| 9 | Breaking change surface (new-platform scenario, headline proxy) | 2 files (`build.ts` + `verify.ts`) | 2–3 files, more clearly separated (`build.ts` + `tree-shape.ts` + optional `verify.ts` wiring) | ~flat, slightly more files but unambiguous ownership | Future-proof | Files requiring update per scenario |
| 10 | Extension points (additive-without-modifying-existing-code) | 0 | 1 (new tree-shape rule addable in `tree-shape.ts` without touching the existing 3 functions) | +1 | OCP | Count of purely-additive extension points |
| 11 | Platform coupling (target-conditional branch points / total functions) | ~23% (5 branch points / 22 functions) | ~21% (5 branch points / ~24 functions) | -2pts (~flat — this logic is untouched by the Scoped Extraction) | Portability | Platform-specific branches / total constructs |
| 12 | Time-to-add-skill (files touched adding a minimal new `src/references/*.md` doc) | ~2–3 files (new doc + `ground-truth.md` + optional citing agent) | Unchanged — this workflow lives in `src/` authoring, untouched by the scripts-layer redesign | 0 | Developer XP | Steps/files to add a minimal reference doc |
| 13 | Audit drift risk (manually-synced / total sync-risk-bearing value classes) | 100% (2/2: identity literals, `ground-truth.md` counts — both manually synced) | 50% (1/2: identity now derived from `package.json`; `ground-truth.md` remains manual, correctly deferred) | -50pts | Integrity | Manually-synced / total derived values |
| 14 | Test-LOC ratio | 53% (1,823/3,420) | ≈55% (≈1,893/≈3,437, assuming TDD on the 2 new modules per this project's own quality gates) | +2pts | Quality | Test LOC / production LOC |

**No empty cells** — every row carries either a measured value or a stated estimation method (Phase 1's audit data, Phase 4–7's structural analysis, or an explicitly-labeled estimate where exact figures aren't derivable without implementing the change).

### Executive Summary

**Biggest insight**: The CRITICAL SRP finding in `build.ts` is real but is a structural/aesthetic judgment, not an incident-driven one — this codebase has zero drift incidents across 50 commits and a healthy 53% test-LOC ratio. The adversarial critic process (§3.3) caught that the architecturally "obvious" fix (a full `PlatformTarget` interface) would trade a currently-working design for new, concrete risks (an ISP violation via an optional interface member, a premature abstraction over only 2 data points with inverted invariants, a `verify.ts` fan-out from 0 to 5 import edges, a plausible `build.ts`⇄`claude.ts` cycle) that don't exist today. The right-sized fix is much smaller than the initial Phase 1 diagnosis implied.

**Biggest improvement**: eliminating the 6-hardcoded-identity-literal pattern (metric #7, #13) and the `build.ts`/`verify.ts` tree-shape duplication (metric #4, #6) — both are concrete, low-risk, unambiguous wins with a clear single source of truth, independently endorsed by both critics.

**Biggest honest trade-off**: cross-reference count (#3) and cognitive-load file count (#8) both increase — coupling and navigation cost go up in exchange for reduced duplication and a smaller identity-change blast radius. And the single biggest scalability risk in the codebase — adding a 6th platform target (Phase 6, Phase 7) — is **explicitly not solved** by the adopted scope; it's deferred to the documented revisit condition (§3.4.4), not silently ignored.

### Top 5 by Effort-to-Impact Ratio (impact/effort, both 1–10)

| Rank | Change | Effort | Impact | Ratio |
|------|--------|--------|--------|-------|
| 1 | Extract `scripts/project-identity.ts` | 2 | 7 | 3.5 |
| 2 | Create `documentation/decisions/INDEX.md` (V-ADA-02 fix, §7.5) | 1 | 3 | 3.0 |
| 3 | Extract `scripts/tree-shape.ts` (dedupe asserts) | 3 | 6 | 2.0 |
| 4 | Prune orphaned `src/references/agent-tools.md` (Phase 1 anti-pattern #3) | 1 | 2 | 2.0 |
| 5 | Confirm/fix `coordinator.md`'s cross-boundary reference to a Cursor-only file (Phase 1 anti-pattern #4) | 1 | 2 | 2.0 |

**For contrast, ranked last**: the full `PlatformTarget` interface (§3.2, not adopted) — effort 8, impact 4 (given no proven current need), ratio 0.5. Included to show it was seriously considered, adversarially tested, and deliberately deprioritized rather than overlooked.

---

## Conclusion

This retrospective confirms `documentation/audits/architecture-coherence.md`'s same-day finding that this codebase is fundamentally healthy (no CRITICAL findings there; one CRITICAL SRP finding here, in `build.ts`, that pre-dated and motivated a deeper look). The recommended path is the narrow, adversarially-tested **Scoped Extraction** (§3.4): two small new files (`project-identity.ts`, `tree-shape.ts`) that close the two anti-patterns with real historical cost (identity-rename tax, tree-shape duplication) — not the more ambitious full interface redesign, which both independent critics rated as introducing new risk disproportionate to its currently-unproven benefit for a single-maintainer, zero-incident codebase.
