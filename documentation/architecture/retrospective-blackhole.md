---
type: retrospective
skill: x-rearchitect
status: draft
created: 2026-07-06
last_updated: 2026-07-24
supersedes: "prior revision of this file (2026-07-11, v0.10.0 / ADR-001..006 — preserved in git history)"
target: blackhole
related:
  - documentation/decisions/ADR-007-drift-proof-toolchain-reseating.md
  - documentation/decisions/ADR-009-claude-marketplace-bundle-isolation.md
  - documentation/decisions/ADR-011-implement-time-accretion-control.md
  - documentation/decisions/ADR-012-shared-artifact-substrate.md
  - documentation/decisions/ADR-013-mercure-parity-program.md
  - documentation/decisions/ADR-014-autonomy-default-only-mode.md
review_trigger: "on major version release"
---

# Architectural Retrospective — blackhole (v0.16.0)

Full 8-phase retrospective (`x-rearchitect`, default mode) at `7bc0eb6`, v0.16.0. Refreshes the
2026-07-11 revision, which covered v0.10.0 / ADR-001..006 and predates ADR-007..014.

**Fresh verification evidence (this session):** `bun run verify` → 30/30 checks passed;
`bun test` → 550 pass / 0 fail, 1064 assertions, 29 files, 3.11s.

**Baseline inputs:** `ARCHITECTURE.md` § Active Constraints; ADR-001..014;
`documentation/decisions/INDEX.md`; full git history (289 commits, 2026-07-04 → 2026-07-22).

---

## Executive Summary

The architecture's load-bearing assumptions still hold, and ADR-007 — which this document's
predecessor motivated — worked. `verify.ts` went from 979 LOC / 24 heterogeneous checks to a
**48-LOC glob runner**; `ground-truth.md` went from a drift-prone literal counter to a 19-line
prose pointer; the agent roster now has a two-sided declaration/scan check (`V-GROUND-01`) and has
not drifted since.

The dominant remaining finding is not a new defect class — it is that **ADR-007's remedies were
applied at instance granularity, not class granularity**. Four independent symptoms measured in
this retrospective trace to that single root cause, and one of them has already shipped as a real
defect (ADR-012 Finding 3b: `awaiting-design-approval` recognized by `phase-plan.md`, absent from
`queue-dag.md`'s enum, unrecognized by `coordinator.md` — a broken resumption path).

| | |
|---|---|
| **Biggest insight** | The `§ facts` + two-sided-verification mechanism is excellent and under-applied. It guards 7 declarations (roster, phases, playbooks, rules, required refs, 2 counters). It guards **zero** of the 5 protocol *value vocabularies* that agent prose actually restates 8–12 times each. |
| **Biggest improvement available** | Extend `§ facts` + `V-GROUND-01` from "structural facts" to "closed vocabularies". ~60 LOC of declarations, one generalized check. Closes the defect class that produced ADR-012 F3b. |
| **Biggest honest trade-off** | 88.3% of tracked repo content is build output (7.58× byte duplication, 6.39× change amplification). This is **load-bearing, not accidental** — it is what makes `/plugin marketplace add <repo>` a zero-build-step install. It should be measured before it is touched, not "fixed". |

---

## Phase 1 — Current Architecture Audit

### Component inventory

| Area | Files | LOC | Note |
|---|---:|---:|---|
| `src/agents/*.md` | 8 | 2,506 | coordinator, orchestrator, planner, implementer, reviewer, router, investigator, hunter |
| `src/references/*.md` | 30 | 4,594 | protocol rulebook + phase playbooks |
| `src/references/hunt/*.md` | 8 | 701 | ADR-006 kaizen kind playbooks |
| `src/SKILL.md` | 1 | 141 | skill entry |
| `scripts/*.ts` (prod) | 24 | 6,133 | build, verify runner, 8 check domains, validators, status, release |
| `scripts/*.test.ts` | 29 | 6,709 | 1.09 : 1 test-to-prod LOC ratio |
| **Tracked total** | **672** | — | of which **409 (60.9%) is build output** |

### Coupling map (Ca = fan-in, Ce = fan-out, by basename reference across `src/**.md`)

| Component | Ca | Ce | Reading |
|---|---:|---:|---|
| `references/worker-schemas.md` | 23 | 14 | Highest fan-in — the schema catalog is the protocol's true contract surface |
| `agents/orchestrator.md` | 20 | 21 | The hub. Highest combined coupling; deliberate (ADR-007 R3′) |
| `references/config-template.md` | 17 | 12 | Every config-gated feature reads it |
| `references/blackhole-vcodes.md` | 15 | 3 | Healthy: high fan-in, near-zero fan-out (a leaf vocabulary) |
| `references/queue-dag.md` | 14 | 10 | State schema |
| `references/blackhole-state.md` | 13 | 7 | Write protocol |
| `references/hunt/parity.md` | 0 | 14 | Not an orphan — reached via `kaizen.kinds`, not a file link (see Phase 2) |

Total cross-references in `src/**.md`: **506 backtick path citations**, ΣCa = **321**.
`V-LINK-01` verifies every one of them resolves — a genuinely strong seam.

### Change amplification

Measured over the last 40 non-merge commits, restricted to the 15 that touched `src/`:

```
src files changed = 44        build-output files changed = 281        ratio = 6.39×
avg files per commit (last 20 non-merge) = 17.8
```

The transform producing that 6.39× is a **single token substitution**.
`diff src/agents/orchestrator.md .claude/agents/orchestrator.md` differs only in `{{AGENT_DIR}}` →
`.claude` on 6 lines, plus an appended `<!-- GENERATED -->` banner. Six near-identical ~32 KB
copies of `orchestrator.md` are tracked.

```
src bytes = 460,937        build-output bytes = 3,495,265        duplication = 7.58×
88.3% of tracked content is derived
```

### Hotspots (commit count, all history)

| File | Commits | Status |
|---|---:|---|
| `scripts/build.ts` | 48 | Expected — the compiler and the `§ facts` SSOT |
| `scripts/verify.ts` | 39 | **Resolved.** Now 48 LOC; churn predates ADR-007 R2′ |
| `src/references/ground-truth.md` | 32 | **Resolved.** Now a 19-line prose pointer (ADR-007 R1′) |
| `src/references/worker-schemas.md` | 31 | Live — tracks every worker contract change |
| `src/references/config-template.md` | 24 | Live — grows one block per config-gated ADR |

Zero `TODO`/`FIXME`/`HACK` markers across `src/` and `scripts/`.

### SOLID compliance (evidence-scored)

Threshold applied is blackhole's own `V-PAT-01`: **>300 LOC or 7+ responsibilities**.

| Component | LOC | Responsibilities | Verdict |
|---|---:|---:|---|
| `scripts/checks/core.check.ts` | 837 | 15 checks | **SRP violation.** 55% of all checks, 62% of all check LOC, in one file |
| `src/agents/planner.md` | 593 | ~10 logic sections + a 130-line inline output template | **SRP violation** |
| `src/agents/orchestrator.md` | 508 | 18 `##` sections | **SRP violation — deliberately retained** (ADR-007 R3′) |
| `src/references/worker-schemas.md` | 765 | 12 schemas | Borderline: cohesive *as a catalog*; 12 reasons to change |
| `scripts/validate-worker-json.ts` | 822 | 12 validators | Borderline: matched pair with the above |
| `scripts/build.ts` | 747 | 5 compile fns + facts + 3 manifests | Cohesive as "the compiler"; acceptable |
| `src/agents/reviewer.md` | 354 | 2 sections | Clean — LOC-only trip |

**6 modules exceed both limbs of `V-PAT-01`; 6 more trip the LOC limb alone.**

Note the asymmetry worth naming: the module that *enforces* `V-PAT-01` (`core.check.ts`) exceeds
it by 2.8× on LOC and 2.1× on responsibilities.

---

## Phase 2 — Root Cause Analysis

### The single root cause

> **Remediation was applied to the instance that hurt, not to the class it belonged to.**

ADR-007 correctly diagnosed two accidental patterns — *facts restated at consumption sites* and
*accretion surfaces without extension seams* — and built excellent machinery for both. It then
scoped each remedy to the specific artifact that had drifted.

### Pain point matrix

| # | Symptom (measured) | Root design decision | Classification | SOLID |
|---|---|---|---|---|
| 1 | 5 protocol vocabularies restated 8–12× each with **zero** verify coverage | `§ facts` was populated with the *structural* facts that had drifted (roster, phases, files, counts) — value enums were never added | Missing validation | SRP (process) |
| 2 | `core.check.ts` = 837 LOC / 15 checks; other 7 domains average 118 LOC / 2.1 checks | ADR-007 R2′ decomposed by *test taxonomy*, and named one domain `core` — a catch-all name always becomes the sink | Wrong granularity | SRP |
| 3 | `V-CONTENTGATE-01` budgets new sections in exactly **one file** (`orchestrator.md`), and only *new* ones — the grandfathered 130-LOC "5-Field Delegation Contract" is exempt | ADR-007 R3′ built the gate for the file that was accreting at the time | Missing validation | OCP |
| 4 | Platform target names hardcoded across **8 production script files** (`build.ts`, `checks/build.check.ts`, `checks/core.check.ts`, `release.ts`, `tree-shape.ts`, `doctor.ts`, `install-verify.ts`, `verify.ts`) + ~8 test files | `Target` is a TS union local to `build.ts`; `§ facts` declares the roster and the phases but not the targets | Coupling violation | OCP |

### Vocabulary exposure — the measured detail behind row 1

| Vocabulary | Values | `src/**.md` restatement sites | `§ facts` decl | Verify check |
|---|---:|---:|:---:|:---:|
| Agent roster | 8 | — | ✅ `AGENT_NAMES` | ✅ `V-GROUND-01` |
| Phase names | 5 | — | ✅ `PHASE_NAMES` | ✅ `V-PHASE-01` |
| V-code row count | 57 | — | ✅ `VCODE_TABLE_ROW_COUNT` | ✅ `V-GROUND-01` |
| **Queue `status`** | 4 | **12** | ❌ | ❌ |
| **Queue `notes`** | 4+ | **10** | ❌ | ❌ |
| **`kaizen.kinds`** | 7 | **5** | ❌ | ❌ |
| **Platform targets** | 5 | 8 (scripts) | ❌ | ❌ |
| **ADR `status`** | declared 3, observed 5 | 14 ADRs + INDEX | ❌ | ❌ |

### Materialized cost — this is not hypothetical

**ADR-012 Finding 3b** documents a shipped defect caused precisely by row 1: `phase-plan.md` sets
`notes: awaiting-design-approval`; `coordinator.md:185` recognized only three other values;
`queue-dag.md:39`'s enum omitted it entirely. Result: a human-approved design could not resume.
Three files, one vocabulary, no check — and the campaign silently lost work.

**ADR status drift**, measured this session, is the same defect one layer up:

| ADR | Frontmatter | INDEX.md | Reality |
|---|---|---|---|
| ADR-008 | `current` | `Accepted` | Vocabulary mismatch only |
| **ADR-011** | `current` | **`Proposed`** | **Shipped** — accretion gates live in `implementer.md` |
| **ADR-012** | `current` | **`Proposed`** | **Shipped** — `V-WRITE-01`, `V-DESIGN-01/02` pass in CI |
| **ADR-013** | `current` | **`Proposed`** | **Shipped** — `parity-matrix.check.ts` / `V-PMATRIX-01` passes in CI |

Observed status values across 14 ADR files: `Accepted` (6), `accepted` (3), `current` (4),
`superseded` (1); INDEX.md adds a fifth, `Proposed`. The repo's own
`.claude/rules/doc-governance.md` declares the enum as `current | deprecated | archived`.
Nothing enforces it, so all three spellings coexist and three shipped ADRs read as unbuilt.

### What is *not* a root cause (steelmanned)

- **The 6.39× amplification is not accretion.** It is the cost of a zero-build-step install
  contract. `/plugin marketplace add <repo>` resolves a git ref directly; there is no release
  pipeline the consumer must run. Committed output + a CI "build is in sync" gate makes the
  duplication *verified*, which is categorically different from hand-maintained duplication.
- **`orchestrator.md`'s 18 sections are a considered choice, not neglect.** ADR-007 R3′ rejected
  the split on the grounds that it converts intra-file cohesion into cross-file references
  without reducing total concepts. That reasoning still holds at 508 LOC.
- **Within-`src` DRY is genuinely strong.** Only 10 distinct >45-char lines recur across 3+ files
  out of 7,942 total — a **0.13%** duplicated-line ratio.

---

## Phase 3 — Redesign Blueprint

Same language, same runtime, same feature set, same distribution contract (per Critical Rules 1
and 4). The blueprint is deliberately *small*: the architecture is sound, so the proposal
generalizes existing seams rather than replacing them.

### Assumption audit — current architecture

| Assumption | Marker | Evidence |
|---|---|---|
| One `src/` tree can serve 5 heterogeneous agent hosts | ✓ Validated | 5 targets shipping; the only body transform is a `{{AGENT_DIR}}` substitution |
| Committed build output is required for zero-step install | ~ Contestable | True for the Claude marketplace path; **unmeasured** for the flat registry and `.agents/build/` |
| Two-sided verification beats single-source generation | ✓ Validated | ADR-007's critic panel rejected generation with repo-grounded evidence; roster has not drifted since |
| Facts that drift are structural (rosters, counts, filenames) | ⚡ Oversimplified | The defect that actually shipped (ADR-012 F3b) was a **value enum**, not a structural fact |
| A per-file content gate controls accretion | ◐ Blind spot | It controls accretion *in the gated file*. `core.check.ts` grew to 837 LOC ungated |
| Decomposing by test taxonomy yields balanced domains | ✗ Incorrect | It yielded 1 × 837 LOC and 7 × ~118 LOC |

### Proposed changes

**R1 — Protocol Vocabulary registry (highest ROI).** Extend `build.ts § facts` with the closed
vocabularies: `QUEUE_STATUSES`, `QUEUE_NOTES`, `HUNT_KINDS`, `BUILD_TARGETS`, `ADR_STATUSES`.
Generalize `V-GROUND-01`'s two-sided pattern into one check that, per vocabulary, scans `src/**.md`
for members of the declared set and fails when a consumption site uses a value absent from the
declaration. **Preserves** the two separately-fallible derivations the ADR-007 critics required —
this extends the accepted mechanism, it does not re-propose the rejected single-source generation.

**R2 — Split `core.check.ts` along its actual concerns.** The glob-discovery seam from ADR-007 R2′
already makes new domain files free (no registry, no registration). Split 15 checks into
`agents.check.ts`, `schema.check.ts`, `links.check.ts`, `content-gates.check.ts`, retiring the
catch-all name. Mechanical; tests are already per-domain.

**R3 — Generalize the content gate to a budget map.** Replace `V-CONTENTGATE-01`'s hardcoded
`orchestrator.md` scope with a declared `{file → {maxSectionLoc, maxFileLoc}}` table covering
`orchestrator.md`, `planner.md`, `worker-schemas.md`, and `scripts/checks/*.check.ts`. Seed each
threshold at *current + 20%* so it ratchets rather than blocking on day one.

**R4 — Export `BUILD_TARGETS` from `§ facts`** and have `doctor.ts`, `install-verify.ts`,
`release.ts`, `tree-shape.ts`, and the two check domains import it instead of hardcoding names.

**R5 — Extract `planner.md`'s 130-line inline output template** to
`src/references/plan-template.md`, following the pointer-section pattern `orchestrator.md`'s newer
sections already use.

**R6 — Measure before touching the build-output model.** Determine, per committed tree, which
install path actually resolves it. Only then decide whether any tree can stop being tracked.

### Adversarial self-critique

Applied to the blueprint above, before comparison.

| Proposal | Strongest objection | Resolution |
|---|---|---|
| **A generic `TargetDescriptor` abstraction** (considered, **rejected**) | The 5 targets are genuinely heterogeneous — codex emits YAML on a different agent schema, claude emits two manifests, cursor strips frontmatter, skills is a flat mirror. A descriptor with 6 policy knobs covering 5 targets, each needing an escape hatch, is **V-KISS-01 / V-YAGNI-01** — worse than 5 explicit functions | **Dropped.** Narrowed to R4: share the *name list*, keep the 5 compile functions explicit. `build.ts` is cohesive; the pain is in the 8 files that hardcode names, not in the compiler |
| R1 vocabulary registry | Grows `§ facts` and adds a maintenance obligation at 5 more sites | Accepted. The obligation is already being paid — in silent defects instead of CI failures. A failing check is strictly cheaper than ADR-012 F3b |
| R3 budget map | A badly-calibrated budget becomes a nag that trains contributors to raise the number | Mitigated by ratchet seeding (current + 20%), not absolute thresholds |
| R6 (build-output model) | Dropping any tracked tree could silently break an install path | Which is exactly why R6 is scoped as **measurement only**. Proposing the change without the per-tree evidence would be guessing |
| Blueprint overall | "This is maintenance, not a redesign" | Correct, and that is the finding. A retrospective whose honest output is *"the architecture is sound; generalize four seams"* should say so rather than manufacture a rewrite |

---

## Phase 4 — SOLID Comparison

| Principle | Current | Redesigned | Delta |
|---|---|---|---|
| **SRP** | 6 modules with >300 LOC **and** 7+ responsibilities | 4 (`orchestrator.md` deliberate; `worker-schemas.md` + `validate-worker-json.ts` cohesive catalog pair; `build.ts` compiler) | **−2**, both mechanical (R2, R5) |
| **OCP** | New platform target ⇒ edit 8 production + ~8 test files | 1 facts entry + 1 compile fn + 1 manifest builder | **−6 production files** |
| **LSP** | N/A — no inheritance hierarchies. All 8 check domains already satisfy a uniform `runChecks(): CheckResult[]` contract | Unchanged | 0 |
| **ISP** | Strong. `verify.ts` (48 LOC) depends only on the glob contract, not on any check's internals | Unchanged | 0 |
| **DIP** | Mixed. Checks depend on the concrete `§ facts` module — correct (it *is* the abstraction). But 8 scripts depend on hardcoded target string literals | R4 routes all target knowledge through `§ facts` | **8 → 1** literal dependency site |

Assumption markers on the redesign itself: R1 ✓ Validated (extends a mechanism with a proven
track record); R2 ✓ Validated (seam exists, cost is near zero); R3 ~ Contestable (threshold
calibration is a judgement call); R4 ✓ Validated; R6 ◐ Blind spot **by construction** — it is
scoped as measurement precisely because the answer is unknown.

---

## Phase 5 — DRY Analysis

| Layer | Current | Redesigned | Note |
|---|---|---|---|
| Build output vs source | 7.58× (88.3% derived) | 7.58× — **unchanged** | Load-bearing; R6 measures, does not change |
| Within `src/**.md` | 10 recurring lines / 7,942 = **0.13%** | ~0.08% | Pareto formula (8 files) + hunt scoring bands (4 files) |
| Protocol vocabularies | 5 undeclared, restated 8–12× each | 0 undeclared | R1 — the material DRY win |
| Target name literals | 8 production files | 1 | R4 |

Single-source-of-truth proposals, with generation method:

| Duplicated value | Proposed SSOT | Enforcement |
|---|---|---|
| Queue `status` / `notes` enums | `build.ts § facts` | Generalized two-sided `V-GROUND-01` scan |
| `kaizen.kinds` | `build.ts § facts` | Same |
| Platform target names | `build.ts § facts` | Import, not restatement |
| ADR `status` enum | `.claude/rules/doc-governance.md` (already declares it) | New check: frontmatter ∈ enum **and** INDEX row == frontmatter |
| `Priority = Gain * (11 - Effort)` (8 files) | `blackhole-vcodes.md` `V-PARETO-02` row | Pointer sections — **below Pareto threshold, deferred** (see appendix) |

---

## Phase 6 — Scalability Assessment

| Scenario | Current behaviour | Bottleneck | Redesigned | Complexity |
|---|---|---|---|---|
| **Agents ×3** (8 → 24) | `AGENT_NAMES` + `V-GROUND-01` absorb the roster; but ~18 `src` files and 7 scripts mention each agent by name | Per-agent prose references | Unchanged — inherent to prose-defined agents | O(n) files, O(n) prose sites |
| **References ×3** (38 → 114) | `V-LINK-01` scales freely; `cleanDir` full regeneration, no cache | Build wall-clock, currently trivial | Unchanged | O(n) |
| **Platform targets 5 → 15** | 8 production files edited per target; tracked output grows 7.58× per target | **OCP violation compounds linearly** | R4 collapses to ~3 sites/target | O(n) → O(1) *coordination*, O(n) content |
| **Team 1 → 5** | Cognitive load is genuinely low: entry chain `CLAUDE.md`(19) → `AGENTS.md`(45) → `SKILL.md`(141) → protocol(134) + state(92) + vcodes(75) = **506 lines** | Reviewing 6.39× amplified diffs — a reviewer must skip generated hunks by hand | R6 measures; no change proposed without evidence | Review cost O(6.39n) |

The single-writer invariant (`blackhole-state.md`, `V-WRITE-01`) is the architecture's best
scalability decision: parallel workers, serial orchestrator-applied mutations. It closes the
lost-update race without `flock` or CAS, and it holds at any worker count.

---

## Phase 7 — Future-Proofing

| Scenario | Breaking-change surface (current) | Redesigned | Extension feasibility |
|---|---:|---:|---|
| New platform target | 8 prod + ~8 test files | 3 prod files | Poor → Good |
| Agent-host API break (e.g. frontmatter schema) | 1 compile fn + 1 manifest builder | Same | **Already good** — the transform is isolated in `build.ts` |
| New agent | ~25 files mention an existing agent name (18 `src`, 7 `scripts`) | ~18 (`scripts` side resolves via `§ facts`) | Fair |
| New verify check | **1 file** — glob auto-discovery, no registry | Same | **Excellent** (ADR-007 R2′) |
| New governance rule / V-code | 1 vocabulary row + reviewer section; `V-VCODE-01` verifies referencing | Same | Good |
| New config-gated feature | 1 `config-template.md` block + gate sites | Same, + declared block names | Fair |

**Extension points today: 7** (`§ facts` declarations) **+ glob check discovery + `V-LINK-01`.**
**Redesigned: 12** declarations, same seams.

**Portability**: 409 / 672 tracked files (60.9%) are platform-specific — but **zero** of the 47
`src/` files are. Platform coupling is entirely confined to generated output and to the 8 scripts
R4 addresses. The agent-agnostic constraint in `ARCHITECTURE.md` § Active Constraints holds.

### Phase 7.5 — V-ADA-02 exit gate

`documentation/decisions/INDEX.md` has a row for **all 14 ADRs** — no missing entries.
**However**, 4 rows carry a status contradicting the ADR's own frontmatter, and 3 of those
(ADR-011, ADR-012, ADR-013) read `Proposed` for decisions that are shipped and CI-enforced.
Flagged **V-ADA-02 (MEDIUM / WARN)** — filed as an issue rather than silently corrected here, per
the never-drop-findings protocol.

---

## Phase 8 — Quantitative Dashboard

| # | Metric | Current | Redesigned | Delta | Principle |
|---|---|---|---|---|---|
| 1 | Total tracked files | 672 | 672 | 0 | Simplicity |
| 2 | Total LOC (`src` md / `scripts` prod) | 7,942 / 6,133 | ~8,000 / ~6,100 | +58 / −33 | Simplicity |
| 3 | Cross-reference count (`src`) | 506 citations, ΣCa 321 | ~506 | 0 | DRY |
| 4 | Duplication ratio — build output | 7.58× (88.3% derived) | 7.58× | 0 *(deliberate)* | DRY |
| 5 | Duplication ratio — within `src` | 0.13% | 0.08% | −0.05pp | DRY |
| 6 | SRP violations (>300 LOC **and** 7+ resp.) | 6 | 4 | **−2** | SRP |
| 7 | OCP violations (new-target edit surface) | 8 prod files | 1 | **−7** | OCP |
| 8 | Change amplification | 6.39× | 6.39× | 0 *(deliberate)* | Coupling |
| 9 | Cognitive load (entry chain) | 506 lines | 506 lines | 0 | Accessibility |
| 10 | Breaking-change surface (new platform) | 16 files (8 prod + 8 test) | 3 prod + ~3 test | **−10** | Future-proof |
| 11 | Extension points | 7 decls + 2 seams | 12 decls + 2 seams | **+5** | OCP |
| 12 | Platform coupling | 409/672 = 60.9% *(0% of `src`)* | 60.9% *(0% of `src`)* | 0 | Portability |
| 13 | Time-to-add-agent | 25 files | 18 files | **−7** | Developer XP |
| 14 | Audit drift risk | **5 unguarded vocabularies**, 4 live ADR-status mismatches, 2 manual counters (two-sided ✓) | 0 unguarded, 0 mismatches, 2 counters | **−5 / −4** | Integrity |

---

## Appendix — Top 5 by effort-to-impact

Scored with the repo's own `V-PARETO-02` formula, `Priority = Gain × (11 − Effort)`, filed at ≥ 30.

| Rank | Change | Gain | Effort | Priority | Why |
|---:|---|---:|---:|---:|---|
| 1 | **R1** — Protocol Vocabulary registry + generalized two-sided check | 9 | 4 | **63** | Closes the class that shipped ADR-012 F3b; 5 vocabularies, ~44 restatement sites |
| 2 | Fix `INDEX.md` status rows (ADR-011/012/013 read `Proposed`, are shipped) | 6 | 1 | **60** | V-ADA-02; ~10 minutes; three ADRs currently read as unbuilt |
| 3 | **R2** — Split `core.check.ts` (837 LOC / 15 checks) | 7 | 3 | **56** | The glob seam already makes this free; retires the catch-all sink |
| 4 | **R3** — Generalize `V-CONTENTGATE-01` to a budget map | 7 | 4 | **49** | The gate that exists for one file is why the *other* files accreted |
| 5 | ADR `status` enum enforcement (5 observed values, 3 declared) | 6 | 3 | **48** | Same root cause, one governance layer up |

Also above threshold and filed: **R5** plan-template extraction (Gain 5, Effort 3, **40**);
`ARCHITECTURE.md` § 9 staleness (Gain 4, Effort 1, **40**); **R4** target-name centralization
(Gain 6, Effort 5, **36**); **R6** build-output tree measurement (Gain 7, Effort 6, **35**).

Below threshold, retained `open`, never dropped: `Priority = Gain × (11 − Effort)` restated in
8 files + hunt scoring bands in 4 — Gain 3, Effort 3, **Priority 24**. Drift risk is low
(ADR-006 fixed the formula); revisit if it changes.

---

## Correction (2026-07-24, post-review)

The build-output file count originally published in this document was **wrong**, and the error was
caught by the campaign this retrospective produced — specifically by `impl-328`, which was told to
derive the baseline independently rather than copy it, and returned a different number.

| Metric | Originally published | Corrected |
|---|---|---|
| Build-output files | 414 (61.6%) | **409 (60.9%)** |
| Build-output bytes | 3,522,601 | **3,495,265** |
| Byte duplication | 7.64× | **7.58×** |
| Derived share of tracked content | 88.4% | **88.3%** |

**Cause**: the original classifier matched everything under `.claude/`, sweeping in five
maintainer-only files that are not build output at all —
`.claude/progress.md`, `.claude/initiatives/_registry.json`,
`.claude/skills/prj-create-release/` (2 files), and `.claude/skills/prj-mercure-sync/SKILL.md`.

Those five are precisely the *maintainer-only local content* class that **ADR-009** exists to
separate from the shipped plugin surface — an ADR cited elsewhere in this very document. The
measurement conflated the two categories the decision was written to keep apart.

None of the document's conclusions change: the argument rests on the order of magnitude
(≈61% of files, ≈88% of bytes, ~7.6× duplication), not on the third significant figure. The
correction is recorded rather than silently applied because a retrospective that asserts measured
figures should show when its own measurements were revised.
