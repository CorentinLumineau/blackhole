---
type: retrospective
skill: x-rearchitect
status: draft
created: 2026-07-06
last_updated: 2026-07-11
supersedes: "prior revision of this file (2026-07-06, pre-v0.9.0/v0.10.0 — preserved in git history)"
target: blackhole
related:
  - documentation/decisions/ADR-001-five-phase-lifecycle.md
  - documentation/decisions/ADR-003-synthesizer-removal.md
  - documentation/decisions/ADR-004-adaptive-phase-routing.md
  - documentation/decisions/ADR-005-pr-merge-gate-dependency-ordering.md
  - documentation/decisions/ADR-006-kaizen-hunt.md
review_trigger: "on major version release"
---

# Architectural Retrospective — blackhole (post-campaign, v0.10.0)

Full 8-phase retrospective (x-rearchitect, default mode) at HEAD of `main`, immediately after
the 2026-07-10/11 campaign (25 issues → 25 merged PRs; ADR-006 kaizen hunt + Pattern C +
hardening batch; v0.9.0 and v0.10.0 shipped). Refreshes the 2026-07-06 retrospective, which
predates ~40% of the current protocol surface.

Baseline inputs: `ARCHITECTURE.md` Active Constraints; ADR-001..006; live campaign telemetry
from the session that emptied the backlog.

## Phase 1 — Current Architecture Audit

### Component inventory

| Component | Type | Files | LOC | Role |
|---|---|---|---|---|
| `src/SKILL.md` | skill entry | 1 | 141 | Campaign skill front door — modes, phase table, hunt triggers |
| `src/agents/*.md` | agent definitions | 8 | 1,704 | coordinator, orchestrator, planner, implementer, reviewer, router, investigator, hunter |
| `src/references/*.md` (top) | protocol references | 27 | 4,167 | Protocol/state/schema/phase playbooks consumed by agents |
| `src/references/hunt/*.md` | kaizen sub-references | 6 | 450 | Hunt-kind playbooks + filing template |
| `scripts/*.ts` (non-test) | toolchain | 19 | ~5,000 | build, 24-check verify, JSON validation, forge scope/deps, release, status |
| `scripts/*.test.ts` | tests | 20 | ~3,500 | ~1:1 with source scripts |
| `scripts/*.sh` | shell probes | 3 | 129 | frontend/monorepo detection, install hook |
| `templates/` | scaffolding | 8 | 117 | Companion-file + hook templates |
| `fixtures/` | test fixtures | ~12 | — | Worker-JSON fixtures |
| `.github/` | CI + release | 21 | — | verify/release workflows, release notes |
| `documentation/` | ADRs/plans/audits | 21 | — | ADR-001..006, plans, audits, milestones |
| **Generated mirrors** (6 platform trees + agent/rule mirrors) | build output | 321 | — | from `src/` via `build.ts` — content not audited |

519 tracked files: 198 hand-authored / 321 generated → **1.62× multiplication** overall; the
skill/agent/rule surface fans out ~6× (one `src/references/X.md` edit → 6+ mirror hunks per commit).

### Coupling map (Ca afferent / Ce efferent; placeholder names excluded)

| File | Ca | Ce | Assessment |
|---|---|---|---|
| `worker-schemas.md` | 22 | 11 | Highest afferent hub — shared JSON contract; legitimate DIP target, but 550 LOC accreting 8 worker contracts → SRP erosion risk |
| `agents/orchestrator.md` | 20 | ~21 | **Bidirectional god-hub** — owns spawning, priority queues, blocker triage, incident routing, hunt dispatch |
| `queue-dag.md` | 13 | 7 | State-schema hub, second tier |
| `config-template.md` | 12 | 10 | Bidirectional hub |
| `blackhole-vcodes.md` | 11 | 0 | Pure sink — textbook SSOT leaf (never inlined anywhere; score 95) |
| `ground-truth.md` | 1 | 22 | **Inverse hub** — mirrors facts owned elsewhere; no natural edit trigger; guarded by exactly one check |
| `phase-loop.md`, `review-core.md`, `checkpoint-protocol.md`, `blackhole-state.md` | 10 | 6–12 | Mid-tier hubs, currently healthy |

- Agents → references: 3–21 refs consumed per agent; no agent inlines another (clean reference-only coupling).
- Scripts: `build.ts` is the single code SSOT (`AGENT_NAMES` occurs exactly once; `RULES_LIST`); `verify.ts` imports from `build.ts` + `tree-shape.ts`.
- **Agent roster on 4 manual-sync surfaces**: `build.ts` (code-enforced), `ground-truth.md` (one check), `AGENTS.md` + `README.md` (unguarded — drifted before, commit b643d6f).

### Change amplification (last 15 hand-edit commits, mirror noise stripped)

- **3.8 hand-edited files per logical change** (raw diff-stat 10–28 due to 5–6× mirroring).
- **Hotspot ≥33%**: `scripts/verify.ts` (5/15) — every new protocol invariant adds a check function here.
- Near-hotspots 27%: `ground-truth.md`, `agents/orchestrator.md` — matching their hub status.

### SOLID compliance scores (0–100, metric-backed)

| Component | Score | Evidence |
|---|---|---|
| `blackhole-vcodes.md` | 95 | Ce=0, Ca=11, 61 LOC — SSOT leaf |
| `references/hunt/*.md` | 80 | 52–86 LOC each, single-kind responsibility, sibling refs only |
| `scripts/build.ts` | 70 | 573 LOC but one responsibility; exports SSOT constants consumed cleanly |
| `agents/planner.md` | 65 | 337 LOC, Ca=11, single responsibility, no hotspot signal |
| mid-tier hubs (`queue-dag`, `config-template`, `review-core`, `phase-loop`) | 60–65 | Ca 10–13, 121–265 LOC, no hotspot — watch as Ca grows |
| `worker-schemas.md` | 60 | Ca=22 sound (DIP), but 550 LOC × 8 contracts in one file |
| `agents/orchestrator.md` | 45 | 399 LOC, Ca+Ce ≈ 41, 27% churn, 3 new duties added in 3 recent commits — SRP violation |
| `ground-truth.md` | 40 | Ce=22/Ca=1 inversion; manually-maintained mirror of facts owned elsewhere |
| `scripts/verify.ts` | 30 | 979 LOC, 24 heterogeneous checks, 33% churn, unbounded growth (every ADR adds a checkX, none removed) — SRP + OCP violation |

### Anti-pattern inventory

- **God files (src/)**: `worker-schemas.md` 550, `orchestrator.md` 399, `planner.md` 337 LOC.
- **God files (scripts/)**: `verify.ts` 979 (clearest god file in the repo), `validate-worker-json.ts` 661, plus 400+ LOC test files.
- **Duplicated concern**: agent roster ×4 surfaces (2 unguarded).
- **Drift-prone counter/table pairs**: `ground-truth.md` counts vs actual files (one guard); plugin-manifest versions vs `package.json` (release-time sync only).
- **Boundary violations**: none — state vs handoff dirs clean; scripts cleanly separated except `verify.ts` absorbing all verification domains.

**Audit bottom line: the structural risk is concentration, not sprawl.** Three files —
`verify.ts`, `orchestrator.md`, `ground-truth.md` — sit at the intersection of highest coupling,
highest churn, and least-separable responsibilities.

## Phase 2 — Root Cause Analysis

Historical evidence: 34/181 commits (19%) are fixes; `verify` is the most-fixed scope (6),
then `validate-worker-json` (3), `agents` (3). Add-then-remove waste: synthesizer agent
(ADR-002 → ADR-003, +2 ADRs +1 agent lifecycle for a feature deterministic code replaced),
`agent-tools.md`. The 2026-07-10/11 campaign supplies live defect telemetry.

### Pain-point → root-cause matrix

| # | Symptom (evidence) | Root design decision | Classification | SOLID lens |
|---|---|---|---|---|
| P1 | 3 independent flat-directory crashes from ONE new subdirectory (#216 verify EISDIR, #226 test cleanup, #228 fixture mkdir) | `src/references/` assumed flat forever; every tree-walker hand-rolled its own traversal instead of sharing one walker | Accidental — missing shared abstraction (V-INT-02 in own toolchain) | DRY / DIP |
| P2 | 3 hardcoded `!== 7` agent-count literals tripped by the 8th agent (#199); V-CODEX-04 dead `'5 agent'` substring filter (#234) | Counts embedded as literals at consumption sites instead of derived from the `AGENT_NAMES` SSOT that already existed | Accidental — magic values (V-DRY-03 in own toolchain) | DRY / OCP |
| P3 | `ground-truth.md` counter drift twice in one day (#219→#234 rider, #245→#224 reconciliation); roster drift in README/AGENTS.md (b643d6f) | Drift *detection* file that is itself manually maintained — a mirror guarding mirrors, Ce=22/Ca=1 | Accidental — inverted dependency (mirror should be derived, not authored) | DIP |
| P4 | `verify.ts` = most-fixed file (6 fixes) AND top hotspot (33%) AND lowest SOLID score (30) | Single flat file accretes one `checkX()` per ADR with no domain grouping or check registry | Accidental — god file by accretion | SRP / OCP |
| P5 | Default `bun run build` regenerates fewer trees than verify's full build → repeated dirty-tree V-BUILD-01 confusion (hit 3× in one session) | Two build entry points with different target sets; "full" set only reachable via flags (`--gemini`, `--all`) | Accidental — implicit modes | LSP (surprise substitutability) |
| P6 | `orchestrator.md` gained incident mode + hunt dispatch + CI-wait rules in 3 consecutive commits; 399 LOC; Ca+Ce≈41 | Orchestrator is the default landing zone for every new cross-cutting protocol concern | Inherent partially (it IS the coordinator) — but section boundaries are accidental | SRP |
| P7 | Synthesizer add→remove cycle (ADR-002→003) | LLM agent chosen for a deterministic aggregation job | Corrected — but pattern risk recurs (cheap to re-learn: prefer deterministic scripts for mechanical steps) | — |
| P8 | Agent roster ×4 surfaces, 2 unguarded (P3 sibling) | Human-facing docs (README/AGENTS.md) restate machine facts with no generation step | Accidental — docs not derived from SSOT | DRY |

### Effort-waste estimate

- Flat-tree cluster (P1): 3 discovery escalations + 3 micro-PRs (#220, #227, #229) + 2 re-dispatches of #198 — ~6 agent-chains of rework in one day.
- Count-literal cluster (P2): 1 blocked chain + touch-paths exception round (#199) + 1 follow-up PR (#241).
- Counter drift (P3): 2 rider ACs + 1 post-merge reconciliation across 3 PRs.
- Synthesizer cycle (P7): 2 ADRs + 1 agent added and removed (~4 PRs historical).

**Root-cause synthesis:** ~80% of observed defect effort traces to two meta-decisions:
(a) *facts stated at consumption sites instead of derived from their SSOT* (P2, P3, P8 — and P1
as its structural twin: logic restated at consumption sites instead of shared), and
(b) *flat accretion surfaces with no extension seam* (P4, P6 — new concerns land as appended
sections/functions in the same two files). Both are accidental complexity; neither is inherent
to the protocol's agent-agnostic, markdown-source design.

## Phase 3 — Redesign Blueprint

### Assumption audit — current architecture

| Assumption | Marker | Evidence |
|---|---|---|
| `src/`-only editing; mirrors generated and CI-guarded | ✓ Validated | V-BUILD-01 caught every drift attempt this campaign; zero hand-edited-mirror incidents |
| Markdown-source, agent-agnostic core | ✓ Validated | 6 platform targets served from one tree; Pattern C shipped harness-neutral (V-HARNESS-01) |
| Deterministic scripts over LLM agents for mechanical steps | ✓ Validated | ADR-003; review-aggregate.ts caught band/idempotency bugs an LLM would restate inconsistently |
| Reference-only coupling between agents | ✓ Validated | No agent inlines another; audit found zero boundary violations |
| V-code table as a pure sink SSOT | ✓ Validated | Score 95; the one pattern nothing drifted from |
| Hand-maintained `ground-truth.md` as drift guard | ~ Contestable | A mirror guarding mirrors: drifted twice in one day; guarded by one check in the most-fixed file |
| "All checks in one verify.ts is simpler" | ~ Contestable | Held to ~10 checks; broke by 24 (score 30, 33% churn, 6 fixes) |
| `src/references/` is flat | ⚡ Oversimplified | First subdirectory (hunt/) crashed three independent hand-rolled tree-walkers in one day |
| Agent count is stable | ⚡ Oversimplified | 8th agent tripped 3 hardcoded literals + 1 dead filter |
| README/AGENTS.md restating machine facts is harmless | ◐ Blind spot | Drifted (b643d6f) and re-drifted within 24h of being fixed |
| Two build target sets (default vs full) | ◐ Blind spot | Caused 3 dirty-tree confusions in one session (P5) |
| — | ✗ Incorrect | None found — the load-bearing assumptions all hold |

### Steelman — what the current architecture gets right

It **emptied a 25-issue backlog in one day with 2 fix rounds**. Concentration has real benefits
for its actual consumers: an agent reads ONE file to learn verify semantics, ONE orchestrator
prompt to coordinate; 6× mirroring is mechanical, CI-guarded, and costs diff noise — not
correctness. In a solo-maintainer repo, god files are cheaper than premature module trees
(V-YAGNI), and fragmentation into many small files raises *agent* navigation cost (finite
context windows, one fetch per file). Any redesign must split by **consumption pattern**, not
aesthetics — and keep every split indexed from its parent.

### Blueprint (R1–R6)

| # | Change | Kills | Mechanism |
|---|---|---|---|
| R1 | **Facts registry + generation** — `scripts/facts.ts` exports `AGENT_NAMES`, derived counts, check registry; `ground-truth.md` becomes **generated** build output; README/AGENTS.md roster blocks generated between `<!-- roster:begin/end -->` markers | P2, P3, P8 | No fact ever restated at a consumption site; verify compares live tree against the facts module, not against a hand-authored mirror |
| R2 | **Check registry** — `verify.ts` → ~50-LOC runner; checks live in `scripts/checks/{domain}.check.ts` (agents-policy, build-shape, docs-alignment, fixtures, manifests, content-gates) | P4 | New invariant = new file registered in facts.ts; zero modification of existing checks (OCP); domain grouping ends heterogeneous accretion |
| R3 | **Orchestrator modularization** — `orchestrator.md` keeps core loop + dispatch table; modal concerns → `src/references/orchestrator/{hunt-dispatch,incident-mode,ci-wait}.md` | P6 | Mirrors the hunt/ subdirectory precedent (audit score 80); each mode readable independently |
| R4 | **Per-role contracts** — `worker-schemas.md` → index + `src/references/contracts/{role}.md` + shared `finding-shape.md` | worker-schemas SRP erosion | Each worker spawn reads only its role's contract — smaller prompts, fewer context fetches |
| R5 | **Single build mode** — `bun run build` always builds ALL targets; mtime cache for speed | P5 | Implicit modes removed; verify and build see the same world by construction |
| R6 | **Shared FS lib** — one tree-walker + fixture helpers in `scripts/lib/fs.ts` | P1 | Three hand-rolled walkers become one tested implementation |

Constraints honored: same toolchain (bun + TS + markdown), solo maintainer, mirror/plugin paths
unchanged (consumer-compatible), splits follow consumption patterns, every split indexed from
its parent. 100% feature parity — this is a re-seating of the same capabilities.

### Adversarial evaluation (3 critics — structural, coupling/DIP, scalability)

Three parallel x-architect critics stress-tested R1–R6 against the live repo. Cross-critic
convergent findings (all evidence-cited):

| Finding | Verdict on blueprint v1 |
|---|---|
| **Two-sidedness loss (R1)** — today V-GROUND-01 compares a hand-authored file against an independent filesystem scan (two separately-fallible sources). Deriving everything from `facts.ts` collapses both sides onto one derivation path: a counting bug propagates everywhere with nothing left to disagree. | R1 as filed **weakens drift detection** |
| **Hybrid generation pattern (R1)** — every file today is wholly generated or wholly hand-authored; `<!-- roster:begin/end -->` markers introduce a third, partial-generation pattern that silently clobbers manual edits (README is the hand-edited front door) and erodes the "location ⇒ editability" boundary if generated files land in `src/references/`. | R1's generation half **rejected** |
| **facts.ts god-hub (R1+R2)** — a file that is both the fact SSOT and the check registration list is touched on every new invariant: it recreates P3's failure shape at a new address. | Central registry **rejected**; auto-discovery required |
| **Mirror multiplication (R3+R4)** — every `src/references/` file mirrors to 6–8 physical targets. R4's 10-file split = ~80 tracked files (vs 8 today); R3 adds ~24. File-count explosion in a repo already 62% generated. | Splits must justify ~8× tracked-file cost |
| **Hunt/ precedent misapplied (R3)** — hunt kinds are *exclusive* consumption (one kind per spawn ⇒ real token savings); orchestrator's incident/hunt/CI-wait sections are consulted *every turn* — and are **already thin pointer sections** (orchestrator.md:314–399). Splitting multiplies per-turn context fetches for zero gain. | **R3 dropped** |
| **R4 contradicts actual consumption** — worker-schemas.md's 22 consumers include every phase file and the orchestrator (which validates ALL roles); the file interleaves cross-cutting hook/validation content belonging to no single role. | **R4 dropped** (watch item) |
| **R5 misdiagnosed** — `--gemini` is a deliberate policy gate (`build.ts:21`, issue #13), not DX inconsistency; and an mtime cache would break the cleanDir full-regeneration invariant that makes V-BUILD-01 trustworthy. | R5 **reframed** (below) |
| **R2 optimizes the rarer operation** — verify.ts churn is dominated by *fixing existing checks*, not adding; and the proposed 6-domain taxonomy is non-isomorphic with the existing 6-file test taxonomy (dual-taxonomy ambiguity). | R2 **demoted + realigned** |
| **fs.ts is itself a hub** — but a tiny, testable one; three independent hand-rolled walkers all failed in one day. Hub-with-tests beats redundant-untested. | R6 **kept**, sequenced first |
| **Fragmentation has no metric in v1** — every R-item argued in compiled-code coupling terms, but the consumers are finite-context LLM agents paying per file fetch. | New dashboard metric added (context-fetches/turn) |

### Blueprint v2 (post-critics)

| # | Change | Fate vs v1 | Mechanism |
|---|---|---|---|
| R1′ | **Facts declared once, verified two-sidedly** — `AGENT_NAMES`/roster/counts live only in `build.ts` constants (existing SSOT); `ground-truth.md`'s counter role is **retired** (counts deleted from it, or file reduced to prose pointer); verify keeps an **independent filesystem scan** compared against the declaration (two derivations preserved). README/AGENTS.md stay fully hand-authored — a **check** (not generation) diffs their roster tables against the declaration and fails CI with the exact fix. | Revised — generation half removed | Kills P2/P3/P8 drift by detection-at-CI; no hybrid files, no clobber risk, no provenance erosion |
| R2′ | **Verify decomposition along the *existing* test taxonomy** (build, checkpoint, design-track, companion-docs, single-writer, core) with glob **auto-discovery** — no central registry file. | Demoted to MEDIUM; realigned | One taxonomy (checks ↔ tests 1:1); smaller blast radius per *fix* (the dominant operation); honest rationale — not OCP |
| R3′ | **Section budget on orchestrator.md** — extension-tax rule: new modal concerns must land as thin pointer sections (the pattern its newest sections already follow); a content-gate check enforces max section size. | Replaced (split dropped) | Governs accretion without multiplying per-turn context fetches |
| — | worker-schemas.md split | **Dropped** — watch item (revisit if >700 LOC or a role contract exceeds ~80 LOC) | Consumption pattern contradicts the split today |
| R5′ | **Tracked ⇒ built-by-default** — any build output tracked by git is produced by plain `bun run build`; opt-in flags remain only for genuinely untracked targets. cleanDir full-regeneration invariant untouched (no cache). | Reframed | Fixes the actual P5 policy drift (gemini outputs became tracked while the flag stayed opt-in) without touching V-BUILD-01's trust base |
| R6 | **Shared `scripts/lib/fs.ts` walker + fixture helpers** — lands FIRST (explicit sequencing: before any future `src/references/` subdirectory). | Kept + sequenced | Three independent walkers all failed on one subdirectory; one tested hub is the correct trade |
| R7 | **Link-integrity check** — cross-references between src files (and ADR links) verified; dead links already exist today (architecture-coherence audit F7). | New (from critics) | Makes every future index/pointer pattern safe, including R3′'s thin pointers |

Net shape of v2: **detection over generation, governance over fragmentation, one shared walker,
one taxonomy.** The only new files are `scripts/lib/fs.ts`, the check files (which replace —
not add to — verify.ts content), and zero new `src/references/` fan-out.

## Phase 4 — SOLID Comparison (current vs blueprint v2)

| Principle | Current | v2 | Delta / evidence | Assumption marker |
|---|---|---|---|---|
| **SRP** | 3 violations: `verify.ts` (24 heterogeneous checks, score 30), `orchestrator.md` (3 duties added in 3 commits, score 45), `worker-schemas.md` (8 contracts + cross-cutting, score 60) | 1 remaining (worker-schemas — deliberate watch item) | verify → 1 runner + ~6 domain files matching the existing test taxonomy; orchestrator governed by section budget (content unchanged) | v2's "domain files stay small" is ~ Contestable — needs the same budget rule verify.ts never had |
| **OCP** | New invariant ⇒ modify `verify.ts` (33% churn); new fact ⇒ edit N consumption sites (8th agent hit 7 sites) | New invariant ⇒ new auto-discovered check file; new fact ⇒ 1 declaration edit + CI-guided doc fixes | Historical worst case 7 sites → 1 authored + 2 guided | Critics: fixes (not adds) dominate churn — OCP gain is real but secondary to blast-radius reduction |
| **LSP** | Two build modes produce different worlds (default vs `--all`); dirty-tree surprises ×3 in one session | One rule: tracked ⇒ built by default; cleanDir full-regen invariant untouched | P5 class removed by policy alignment, not caching | ✓ Validated by the gate's own failure telemetry |
| **ISP** | 22 consumers read one 550-LOC contract file | **Unchanged by choice** — critics showed consumption is not per-role (orchestrator validates all roles; phase files cite cross-cutting sections) | Delta 0 — honest deferral (revisit >700 LOC) | ◐ v2 blind spot candidate: if role contracts diverge in growth rate, the watch threshold may trigger late |
| **DIP** | Consumers depend on a hand-maintained mirror (`ground-truth.md`, Ce=22/Ca=1) and on manual doc discipline | Consumers depend on one declaration (`build.ts` constants) + an independent filesystem scan; docs guarded by checks | The mirror middleman is retired; two-sided verification preserved (critics' key correction) | ✓ Two independent derivations retained |

## Phase 5 — DRY Analysis

Duplication inventory (fact surfaces, excluding generated mirrors — those are compilation, not duplication):

| Fact | Copies today | Guarded? | v2 |
|---|---|---|---|
| Agent roster (8 names) | 4 (`build.ts`, `ground-truth.md`, `AGENTS.md`, `README.md`) | 2 of 4 | 1 declaration + 2 *checked* doc copies (`ground-truth` counter role retired) |
| Tracked counts (agents/phases/checks) | 3 in `ground-truth.md` | 1 check | 0 copies — derived scan vs declaration |
| V-code table | 1 (`blackhole-vcodes.md`, Ca=11, never inlined) | ✓ SSOT | unchanged (the pattern to copy) |
| Tree-walking logic | 3 hand-rolled walkers (all failed 2026-07-10) | ✗ | 1 shared, tested (`lib/fs.ts`) |
| Manifest versions | 5 plugin manifests | release-scripted | unchanged (release.ts owns) |
| Pareto formula | SSOT + 6 hunt-kind verbatim restatements | reviewer-caught drift once (PR #225) | restatements retained, added to link/content check scope |

**Unguarded duplicated facts: 5 → 0.** Duplication *ratio* (unguarded copies / fact surfaces): 5/9 (56%) → 0/9 (0%). v2 deliberately keeps *checked* duplication where human readability wants a local copy — detection over deletion.

## Phase 6 — Scalability Assessment

| Scenario | Current | v2 | Bottleneck & mitigation |
|---|---|---|---|
| Agents ×3 (8→24) | 4 roster surfaces to sync; verify complexity superlinear (interleaved concerns in one file) | 1 declaration line per agent; checks derive; domain files grow linearly | Bottleneck becomes prompt quality, not bookkeeping |
| References ×3 (33→100 files) | Flat-tree assumptions already broke at the FIRST subdirectory; cross-refs unguarded | Shared walker handles nesting; R7 guards links | Mirror multiplication (×6–8) is the real cost at scale — both architectures pay; v2 adds zero fan-out |
| Platform targets ×3 (6→18) | Per-target build blocks + implicit mode flags drift from tracking policy | tracked⇒default rule scales mechanically; V-HARNESS-01 pattern guards neutral cores | Build time O(files×targets) — linear, acceptable; policy no longer drifts |
| Team 1→5 | `verify.ts`/`orchestrator.md` hotspots = merge-conflict magnets (33%/27% churn on single files) | Domain files shrink collision surface; section budget caps orchestrator conflicts | Onboarding: read ~1.3k LOC across 4 files vs ~2.1k today |

O(n) summary — build: O(files×targets) both; validation navigation: O(24-in-one-file) → O(1) file per concern; change amplification for fact changes: O(sites) → O(1) + CI-guided; onboarding: 979-LOC monolith → ~160-LOC domain file per concern.

## Phase 7 — Future-Proofing

| Scenario | Breaking-change surface (current → v2) | Notes |
|---|---|---|
| Platform API change (e.g. new agent frontmatter requirement) | 3 code sites → 3 (same files, but checks isolated per domain) | Surface equal; risk lower (independent diagnosis) |
| New platform target | build target block + tree-shape + build-shape checks → same + automatic inclusion policy | tracked⇒default removes the policy decision from every future target |
| New component type (9th agent — measured, not hypothetical) | 7 sites (2026-07-10 telemetry) → 1 authored + 2 CI-guided | The single biggest measured improvement |
| New governance rule | modify `verify.ts` → drop in new check file | Auto-discovery; extension without modification |

Extension points: 3 today (checkX-append, hunt-kind directory, inert-when-absent config blocks — the last validated 3× this campaign) → **6** in v2 (+ check auto-discovery seam, + facts declaration, + checked-pointer pattern made safe by R7). Portability: markdown core agent-agnostic, V-HARNESS-01-guarded — strong and unchanged.

## Phase 7.5 — V-ADA-02 Gate

**Staleness found (3× MEDIUM):** ADR-004 (adaptive routing), ADR-005 (merge gate), ADR-006
(kaizen hunt) are all marked **Proposed** in `documentation/decisions/INDEX.md` and their
frontmatter, yet all three are fully implemented and released (v0.8.0–v0.10.0, human-gated
during the campaign). Remedy applied with this retrospective: statuses updated to Accepted.

## Phase 8 — Quantitative Dashboard (14 metrics)

| # | Metric | Current | v2 | Delta | Principle |
|---|---|---|---|---|---|
| 1 | Total files (hand-authored) | 198 | ~205 (+lib, +check files, −0 fan-out) | +3.5% | Simplicity |
| 2 | Total LOC (src + scripts, non-test) | ~11.5k | ~11.6k (moved, not added) | +1% | Simplicity |
| 3 | Cross-reference count | ~150 links, unguarded | ~150, link-integrity checked | 0 / guarded | DRY |
| 4 | Duplication ratio (unguarded fact copies / fact surfaces) | 5/9 = 56% | 0/9 = 0% | **−56pp** | DRY |
| 5 | SRP violations | 3 | 1 (deliberate watch item) | −2 | SRP |
| 6 | OCP violations (modify-to-extend surfaces) | 2 | 0 | −2 | OCP |
| 7 | Change amplification (hand-files / logical change) | 3.8 | ~2.5 (est.) | −34% | Coupling |
| 8 | Cognitive load (files / LOC before first contribution) | 4 files / ~2.1k LOC | 4 files / ~1.3k LOC | −38% LOC | Accessibility |
| 9 | Breaking-change surface (per platform change) | 3 files | 3 files (isolated) | 0 / risk↓ | Future-proof |
| 10 | Extension points | 3 | 6 | +3 | OCP |
| 11 | Platform coupling (platform constructs outside appendix/build) | 0 (V-HARNESS-01) | 0 | 0 | Portability |
| 12 | Time-to-add-component (9th agent, measured class) | 7 sites | 1 authored + 2 CI-guided | **−71%** | Developer XP |
| 13 | Audit drift risk (unguarded manually-synced values) | 5 | 0 | **−100%** | Integrity |
| 14 | Agent context-fetches per orchestrator turn (new metric, from critics) | ~1 + on-demand refs | ~1 + on-demand (budget-enforced) | 0 — protected | Agent XP |

### Executive summary

- **Biggest insight:** the architecture's load-bearing assumptions all hold (zero ✗ in the audit) — the defect mass comes from exactly two accidental patterns: *facts restated at consumption sites* and *accretion surfaces without extension seams*. The redesign is a re-seating, not a rebuild.
- **Biggest improvement:** the drift class dies — unguarded fact copies 5→0, the measured 7-site component-add collapses to 1 authored site, and the most-fixed file (verify.ts, 6 fixes) gets domain isolation along its existing test taxonomy.
- **Biggest trade-off (owned honestly):** v2 *keeps* checked duplication and keeps concentration where consumers are finite-context agents — the adversarial panel killed the fragmenting variants (R3/R4 splits, generation-in-place, central registry) because their costs (context fetches ×3–4, ~80 mirrored files, clobber risk, new god-hub) exceeded their gains. Detection over generation; governance over fragmentation.

### Top 5 changes by effort-to-impact

| Rank | Change | Effort (1–10) | Impact | Kills |
|---|---|---|---|---|
| 1 | R5′ tracked⇒built-by-default | 1 | Removes the dirty-tree confusion class (3 hits/session) | P5 |
| 2 | R6 shared fs walker (sequenced first) | 2 | Ends the flat-tree crash class (3 walkers, 3 crashes, 1 day) | P1 |
| 3 | R1′ facts declaration + two-sided checks | 3 | Unguarded drift 5→0; component-add 7→1 sites | P2, P3, P8 |
| 4 | R7 link-integrity check | 2 | Makes every pointer/index pattern safe (dead links exist today) | enables R3′ |
| 5 | R2′ verify decomposition (existing taxonomy, auto-discovery) | 4 | Hotspot blast-radius isolation on the most-fixed file | P4 |

(R3′ section-budget governance: effort 1, honorable mention — pure prevention.)
