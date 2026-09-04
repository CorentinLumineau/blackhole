---
type: retrospective
summary: "Architectural retrospective of blackhole (v0.21.0) — governance measured in lines while the system accretes in concerns; 14-metric dashboard, verified findings, remediation blueprint"
skill: x-rearchitect
status: draft
created: 2026-07-06
last_updated: 2026-09-01
supersedes: "prior revision of this file (2026-07-24, v0.16.0 / ADR-001..014 — preserved in git history)"
target: blackhole
related:
  - documentation/plans/plan-retrospective-v0.21.0-remediation.md
  - documentation/decisions/ADR-007-drift-proof-toolchain-reseating.md
  - documentation/decisions/ADR-021-durable-artifact-staging.md
  - documentation/decisions/ADR-023-merge-conflict-preflight.md
  - documentation/decisions/ADR-025-agent-plugins-skills-only-shell.md
  - documentation/audits/build-tree-install-resolution.md
review_trigger: "on major version release"
---

# Architectural Retrospective — blackhole (v0.21.0)

Full 8-phase retrospective (`x-rearchitect`, default mode) at `9274fbc`, v0.21.0. Refreshes the
2026-07-24 revision (v0.16.0, ADR-001..014). Since then: 227 commits, ADR-015..027, six minor
releases. Method: 8 parallel subsystem auditors, every HIGH/MEDIUM finding re-derived by two
independent refuters (one re-measuring by a different path, one steelmanning the current design
against the ADRs), a completeness critic, then a 3-critic adversarial pass on the redesign.
57 + 6 agents; 24 findings tested, 17 confirmed as stated, 7 narrowed or downgraded, 0 fully
refuted. Remediation is tracked in `documentation/plans/plan-retrospective-v0.21.0-remediation.md`.

**Fresh verification evidence (this session).** Clean checkout of `origin/main` @ `9274fbc`:
`bun run verify` → **74/74 checks passed**; `bun test` → **1521 pass / 2 fail** (the two
`validate-file-changes.js` #510/#512 tests, which assume `os.tmpdir()` is not under a broad root
— they fail on macOS where it resolves to `/private/var/folders/...`; pre-existing on main). In
the maintainer working tree the same commands read 69/74 and 1517/6 — every extra failure is an
untracked or gitignored local file (a stray duplicate `ADR-021-agent-plugins-skills-only-shell.md`
identical to ADR-025, an unindexed `reference/journeys.md` template, and
`.blackhole/config.json`'s `router_confidence_thresholds.*` sub-keys).

---

## Executive Summary

Every remedy the v0.16.0 retrospective proposed has shipped: `V-VOCAB-01` guards the value
vocabularies, `core.check.ts` is gone (39 domain files now), the content gate is a budget map,
`PLATFORM_TARGETS` lives in `§ facts`, `plan-template.md` was extracted. They worked at the
address they were pointed at. The architecture then kept growing at a different address.

| | |
|---|---|
| **Biggest insight** | Governance here is measured in *lines*, but the system accretes in *concerns*. The content gate cannot see a concern, so 14 governance ADRs landed as 27 new `###` sections in one reviewer prompt (2 → 29 sections, 354 → 778 LOC), 11 gates in one implementer prompt (338 → 645 LOC), and the gate re-seeded itself at ×1.2 of each already-grown file. The repo's one working plugin seam — `hunt/<kind>.md` selected by a `kind` directive, zero edits to `hunter.md` per kind — was never reused for reviewer or implementer concerns. |
| **Biggest improvement available** | Give the two accreting agents a compile-time module seam (one file per audit/gate, inlined into one compiled prompt by a generic `{{INCLUDE}}` primitive), and replace the LOC gate with a module-count gate cross-checked against the V-code table. Extension becomes "add one file + one table row". Sequenced behind two cheap fixes the critics required: no mode-variant agent files, and named (not positional) section citations. |
| **Biggest honest trade-off** | 645 of 1,173 tracked files (55.0%) and 90.0% of tracked bytes are build output (8.97× byte duplication, 8.13× change amplification, up from 7.60× / 6.39×). This remains load-bearing for zero-build-step installs and is now mitigated by ADR-023's conflict preflight. It is not proposed for change; only its plumbing (3 signature breaks per new target) and its stale map (`documentation/architecture.md` tree table, wrong since before v0.16.0) are. |

---

## Phase 1 — Current Architecture Audit

### Component inventory (v0.16.0 → v0.21.0)

| Area | Files | LOC | Δ since v0.16.0 |
|---|---:|---:|---|
| `src/agents/*.md` | 8 | 3,082 | reviewer 354→778, implementer 338→645, orchestrator 508→180 (split, #408), planner 593→467 |
| `src/references/**.md` | 55 | 9,053 | worker-schemas 765→940, merge-gate 265→363, phase-loop 249→309; 14 hunt kinds |
| `src/` total | 64 | 12,299 | +55% LOC; backtick cross-references 621 → **1,293** (150 distinct targets) |
| `scripts/*.ts` prod / test | — | 13,522 / 18,071 | checks 8 files/30 → **39 files/74**; `facts.ts` 42 commits (#1 hotspot) |
| `documentation/` | 69 | — | 28 ADRs (+13); 8 docs over the 400-line ceiling; 11 missing lifecycle frontmatter |
| Tracked total | **1,173** | — | build output **645 (55.0%)**, 9 committed trees, 7,315,430 bytes vs 815,160 in `src/` |

### Coupling map (fan-in by backtick citation across `src/**.md`)

| Target | Ca | Reading |
|---|---:|---|
| `worker-schemas.md` | 102 | The contract surface; 940/950 of its budget; ADR-007's own ">700 LOC" watch item tripped |
| `implementer.md` | 61 | An agent file cited as a reference — its gates are protocol, not persona |
| `phase-loop.md` | 49 | Loop playbook, 309 LOC |
| `blackhole-state.md` | 42 | Write protocol — healthy hub |
| `config-template.md` | 38 | Every config-gated feature reads it (81 key rows) |
| `reviewer.md` | 35 | 62 of 89 V-codes name it as primary enforcement site |

Per-spawn read closure (depth-1 citations from the agent file, plus rules): orchestrator
**17 files / 4,752 LOC / ~82k tokens**; reviewer **17 files / 5,492 LOC / ~95k tokens**. ADR-007
R3′ rejected splitting `orchestrator.md` to avoid "×3–4 context fetches per turn"; #408 split it
anyway and the closure is now 17 files.

### Change amplification

Last 40 non-merge commits touching `src/`: **142 `src/` file-changes → 1,155 build-output
file-changes = 8.13×** (v0.16.0: 6.39×). `blackhole-vcodes.md` exists in 14 tracked copies,
`doc-governance.md` in 14, `SKILL.md` in 12. Nine `chore: sync build outputs` commits since
v0.16.0; ADR-023 documents four PRs needing manual rebase in one session.

### SOLID compliance (evidence-scored, 1–5; threshold is the repo's own `V-PAT-01`: >300 LOC or 7+ responsibilities)

| Component | SRP | OCP | LSP | ISP | DIP | Evidence |
|---|:-:|:-:|:-:|:-:|:-:|---|
| `reviewer.md` | **1** | **2** | 4 | **2** | 4 | 778 LOC, 29 `###` audits under one `##`; extension = edit the shared file; §24 verification mode is handed the full 89-row checklist it is told to ignore |
| `implementer.md` | **2** | 3 | 5 | 4 | 3 | 645 LOC, 14 responsibility blocks; 3 unrelated `###` nested under `## Companion-file Sync` |
| orchestrator + `orchestrator-*.md` | 3 | 4 | 4 | 3 | 4 | 12/21 sections are pure pointers; the 3 split-off files (714 LOC) have no content-gate entry; 1 genuine A↔B citation cycle (HITL ↔ escalation dispatch) |
| `facts.ts` + `scripts/checks/` | 3 | 3 | 5 | 4 | 4 | `verify.ts` is a true glob runner; `EXPECTED_CHECK_COUNT` is a derived rollup declared as a fact (2-line bump in ~30 of 42 commits, WARN-only); 21/39 check files hold one check |
| `worker-schemas.md` ↔ validators | **2** | 4 | 5 | **2** | 3 | No field-parity check; Router example JSON omits 4 fields `router.ts` requires; `campaign-status/types.ts` `Route` omits `ui`, `needs_brainstorm`, `needs_analysis`, `docs_impact` |
| build targets / trees | 4 | **2** | 4 | 4 | 3 | New target = 14 files + 3 breaking signatures (positional booleans, `clean.ts:81`); tree table stale since before v0.16.0; 3 trees still "Unknown" |
| config gating | **2** | **2** | 3 | 3 | **2** | 81 key rows; `docs_governance.` at 101 sites/23 files; the resolution clause copy-pasted 8×, one copy already drifted (`reviewer.md:566`) |
| documentation governance | 3 | 3 | **2** | 4 | 4 | 3 ADR shapes coexist (`adr-template.md` 5 headings unenforced vs `design-track.check.ts` 8 headings enforced); `decision-log.md` appended once (4 rows) then silent for 152 commits, `last_updated` never bumped |

**Strengths confirmed by the auditors (steelman).** Single-writer invariant; 5-Field Delegation
Contract uniformly applied; `verify.ts` registry-free; `check-utils.ts` (Ca 38) is a stable
10-LOC primitive, not a hub; error taxonomy defined once; hunt kinds are a genuine OCP seam;
`V-CONTENTGATE-02`'s 0.85 ratio derived from measured PR deltas; ADR-009/025 ran adversarial
evaluation before adding targets; hook JS is byte-identical across all 5 trees (a critic's
suspicion, refuted by md5).

---

## Phase 2 — Root Cause Analysis

The v0.16.0 root cause was *remediation at instance, not class, granularity*. That was fixed. The
v0.21.0 root causes are one level up: the **class of thing governed** is wrong.

| # | Symptom (measured) | Root design decision | Classification | SOLID |
|---|---|---|---|---|
| RC-A | Content gate warns on **18** targets at 86–100% of budget; `reviewer.md` budget seeded at 804/902 *after* it doubled; 21/39 check files hold one check (`gate-content-contract.check.ts` split "to create headroom", by its own header); #408 hollowed `orchestrator.md` to satisfy a 185-LOC ceiling | The only anti-accretion mechanism measures LOC per `##`/file. It is blind to `###` units, ratchets upward at re-seed, and reshapes module boundaries as a side effect | Wrong granularity | SRP |
| RC-B | 14 ADRs → 27 new reviewer sections + 11 implementer gates + 32 V-code rows; adding a governance concern touches 2–5 files; `hunt/<kind>.md` seam (1 file + 1 config entry, zero `hunter.md` edits) never reused | No module seam at the two hubs where concerns land; "fits the reviewer's existing per-PR contract" (ADR-021:172) was locally true every time and cumulatively false | Missing interface | OCP |
| RC-C | Carry Staged Artifacts = 81 LOC of prose-executed heredoc + `mv`; its two siblings in the same file are `bun run` one-liners; `plan-quality-gate.check.ts` has tested functions reachable from neither `verify` nor the planner; decision-log append never bumps `last_updated` | ADR-003's precedent (LLM step → deterministic script) has no rule stating when it applies, so it is applied per issue, not per class | Missing validation (process) | SRP / DIP |
| RC-D | `EXPECTED_CHECK_COUNT` bumped in ~30 of 42 `facts.ts` commits; route field set in 4 representations with no shape check; tree table stale; 3 ADR shapes | ADR-007 R1′ (declared once, verified two-sidedly) was applied to *enums and rosters*, never to *shapes* (field sets, heading sets, tree sets); a derived rollup was declared as a fact | Missing validation | DIP |
| RC-E | #408 reversed ADR-007 R3′ knowingly — recorded only in gitignored `.blackhole/plans/issue-366.md` with "do not amend ADR-007"; ADR-007's worker-schemas watch item tripped on both axes, no revisit; #328's 3 "Unknown" trees unresolved for 227 commits; `decision-log.md` silent | Decisions and revisits have no trigger wired to the metrics the ADRs themselves name; the durable decision path is write-only | Missing validation (process) | — |
| RC-F | 8.97× byte duplication, 8.13× amplification, 9 trees | **Deliberate** (ADR-007 R5′, ADR-009, ADR-025), mitigated by ADR-023. Not a root cause. Only the positional-boolean plumbing and the stale map are accidental | Deliberate trade-off | — |

**Materialized cost.** RC-D already ships defects: `worker-schemas.md`'s Router example omits
`needs_brainstorm`, `route.ui`, `confidence.brainstorm`, `confidence.ui` that `router.ts:21-51`
requires unconditionally; the same drift class produced ADR-012 F3b at v0.16.0. RC-E already
shipped an undocumented reversal of an accepted ADR decision.

**Refuter corrections applied** (7 findings narrowed): the "2–5 file extension cost" is governed
reactively by the content gate, so it is a design gap, not neglect; only 1 of 3 claimed citation
cycles is genuine; `VCODE_TABLE_ROW_COUNT` is legitimately two-sided — only
`EXPECTED_CHECK_COUNT` is a derived rollup; ADR-007's watch item *is* budgeted (940/950) — what
is missing is the revisit the ADR promised, not a ceiling; the config-gate clause repetition
follows a documented SSOT-plus-local-delta convention and is a MEDIUM enforcement gap; ADR-014's
residual per-site gating is that same convention, not relocated coupling; the decision log was
exercised once, not never.

---

## Phase 3 — Redesign Blueprint

Same runtime, same distribution contract, 100% parity. ADR-007's binding rejections stay binding:
no generation-in-place of hand-authored files, no single-source derivation for both sides of a
drift check, no central check registry, no build cache.

### Assumption audit — current architecture

| Assumption | Marker | Evidence |
|---|---|---|
| One `src/` tree serves all hosts through one 1:1 compile path | ✓ Validated | `compileFolder` is uniform across 7 target functions; 9 trees ship |
| A LOC budget per file controls accretion | ✗ Incorrect | 18 targets at ceiling; the gate re-seeds; concerns, not lines, are what accrete |
| Splitting an agent file costs context fetches per turn (ADR-007 R3′) | ~ Contestable | True for runtime pointers (orchestrator: 17-file closure); false for compile-time inlining, which ADR-007 never evaluated |
| Facts that drift are enums and rosters | ⚡ Oversimplified | The live defects are *shapes*: route field sets, ADR heading sets, tree sets |
| "Fits the reviewer's per-PR contract" is a sufficient placement test | ◐ Blind spot | Locally true 14 times; produced a 29-section God object by the repo's own V-PAT-01 |
| Committed build output is required for zero-build-step install | ✓ Validated (marketplace trees) / ~ Contestable (Gemini: README still says `bun run build` before `ln -s`; 3 trees "Unknown") | `build-tree-install-resolution.md` |

### Proposals (post-critic revision)

| # | Proposal | Closes | Critic-driven change |
|---|---|---|---|
| P1 | **Audit-module seam for the reviewer.** `src/references/audits/<NN>-<slug>.md`, one per audit (29 today), frontmatter `vcodes: [...]`. `reviewer.md` becomes a ~150-LOC shell with one `{{INCLUDE:audits/*}}` marker. A **generic** include primitive in `content.ts`'s `processFile` (alongside the existing `{{AGENT_DIR}}`/`{{VCODES_PATH}}`/`{{#host}}` markers) inlines modules into **one** compiled `reviewer.md` on every target — the LLM still reads one file. Citations switch to `reviewer.md § <Name>`, which `vcode-citation.check.ts` already parses; numbering is append-only. `V-AUDIT-01`: every V-code naming the reviewer maps to exactly one module and vice versa. Modules are build inputs, declared in a `BUILD_INPUT_ONLY_DIRS` fact and two-sidedly checked absent from every tree | RC-A, RC-B | Dropped mode-variant files (`reviewer-verify.md`) — they collide with `AGENT_NAMES` tree-shape counts and reproduce the shape issue #439 rejected; ISP fix is a per-mode branch in `review-core.md`'s prompt requirements instead. Dropped `trigger:` frontmatter (YAGNI once variants are gone). Token cost per default spawn is **unchanged**; the win is source modularity and extension cost |
| P2 | **Same seam for implementer gates** (`src/references/gates/`), *after* P3 reduces Carry Staged Artifacts to its judgment residual | RC-A, RC-B | Sequenced behind P3 (critics: P2 and P3 restructured the same 81 lines with no reconciliation) |
| P3 | **Mechanical-vs-judgment rule** (one sentence in `blackhole-protocol.md`) + scripts for the three prose procedures: `carry-staged-artifacts.ts`, a `plan-quality-gate` CLI the planner invokes, `decision-log-append.ts`; `V-PROSE-01` WARN on heredocs writing under `documentation/` inside agent prose | RC-C | — |
| P4 | **Shape-level two-sided checks.** `V-SHAPE-01` route fields across `router.ts`, `worker-schemas.md` example, `queue-dag.md` table; narrow projections (`campaign-status/types.ts`) carry a declared `omits:` allowlist. `V-TREE-01` trees vs `architecture.md` table vs README stanzas. `ADR_SHAPES` (classic-5 / design-track-8) checked by `adr-status.check.ts`. Retire `EXPECTED_CHECK_COUNT` including its string-literal consumer `TOUCH_PATH_SSOT_PAIRS[1]` | RC-D | Allowlist added (critic: raw symmetric difference false-positives on an intentionally narrow type); second consumer found by critic |
| P5 | **Content gate v3**: glob-class budgets for all agent/reference files with a grandfather allowlist carrying a sunset ADR; `V-CONTENTGATE-03` — raising a budget requires an INDEX row | RC-A | Interim: add the three `orchestrator-*.md` files to the map now |
| P6 | **Config-gate resolution SSOT**: one `resolution:` line per block in `config-template.md`; `V-GATE-02` fails the clause anywhere else; parent-key coverage in `config-registration.check.ts` | RC-B | — |
| P7 | **Named-flags build plumbing** (`{gemini, codex, agentPlugins}` object) + one ADR resolving the 3 "Unknown" trees | RC-F (accidental part) | — |
| P8 | **Revisit triggers**: `ADR_WATCH_ITEMS` in `§ facts` → `V-WATCH-01`; supersession recorded via the ADR-021 D2 carry-step, with **two** detection legs — a declared `supersedes_adr:` field *and* a phrase scan of `src/`/`documentation/` diffs for "supersedes/reverses ADR-N" | RC-E | Second leg added (critic: a self-disclosure gate reproduces exactly the #408 non-detection) |

### Adversarial evaluation — what the redesign introduces

| Finding (critic) | Severity | Resolution |
|---|---|---|
| Fan-in assembly has no primitive; per-target special-casing would break the uniform compile path | CRITICAL | Generic marker in `processFile`, applied to any agent on every target; `hunt/`-style module dir |
| Mode-variant files collide with `AGENT_NAMES` roster checks and #439's rejected shape | CRITICAL | Dropped; one compiled reviewer per target |
| Positional `§N` citations (62 rows, 80+ in-body refs) break on insertion | NOTABLE | Named-section citations (parser already supports them) + append-only numbering |
| P1 does not reduce default-dispatch token cost | NOTABLE | Claim withdrawn; scoped to source modularity |
| `V-SHAPE-01` false-positives on `campaign-status/types.ts` | NOTABLE | Declared `omits:` allowlist |
| `EXPECTED_CHECK_COUNT` has a second string-literal consumer | NOTABLE | In scope of the retirement |
| `V-ADR-06` self-disclosure gate mirrors the #408 failure — #408 never declared anything | NOTABLE | Phrase-scan second leg over diffs, plus a `docs` hunt band over local plan files for "do not amend / reversal" near an `ADR-NNN` |
| P2/P3 overlap on one section | NOTABLE | Sequenced P3 → P2 |
| Assembled shells are a new `src/`-level provenance category ADR-007's panel never ruled on | NOTABLE | Not asserted in-bounds here; ADR-028 (design track, `design-aggregate.ts` verdict) must rule on many-authored → one-generated explicitly |
| `V-SHAPE-01` needs a fourth ad hoc parser over prose sources | NOTABLE | Staged: TS ↔ TS first (`router.ts` vs `types.ts` + allowlist), prose example and `queue-dag.md` table second |
| Absolute line-number citations (`reviewer.md:133`, `:51`, `:130`) break on any edit | MINOR | Rewritten to named sections in the migration |

Overall critic assessment: root causes confirmed against the code; P4–P8 are low-risk hardening
of the existing two-sided discipline; P1/P2 carry real build-pipeline risk and are gated behind a
design-track ADR.

---

## Phase 4 — SOLID Comparison

| Principle | Current | Redesigned | Delta | Marker |
|---|---|---|---|---|
| **SRP** | 10 `src/**.md` files >300 LOC; 2 agent files trip both V-PAT-01 limbs (reviewer 29 resp., implementer 14) | Reviewer/implementer shells ~150/200 LOC; catalogs (`worker-schemas.md`) and playbooks unchanged | **−2** God objects | ✓ |
| **OCP** | New audit concern: 2–5 files; new target: 14 files + 3 breaks; new config feature: template row + N hand-written sites | 2 files / ~8 files + 0 breaks / template row + 1-line cites | **−3 / −6 / same count, cheaper sites** | ✓ |
| **LSP** | All 39 check files satisfy `runChecks()`; all agent files compile 1:1 | Unchanged — the include marker is applied inside the same 1:1 path | 0 | ✓ |
| **ISP** | Verification mode receives the full 89-row checklist | Per-mode prompt requirements in `review-core.md` | fixed | ✓ |
| **DIP** | Consumers depend on `§ facts` (correct) but 4 route representations depend on nothing shared | `V-SHAPE-01` binds them; `EXPECTED_CHECK_COUNT` gone | **4 → 1 unguarded** | ~ (allowlist calibration) |

Redesign blind spot by construction: P7's tree decision is scoped as an ADR because the answer
is unknown (◐).

---

## Phase 5 — DRY Analysis

| Layer | Current | Redesigned | Note |
|---|---|---|---|
| Build output vs source | 8.97× (90.0% derived) | 8.97× | Deliberate; ADR-023 mitigates the rebase cost |
| Within `src/**.md` (>45-char lines in ≥3 files) | 32 / 12,299 = **0.26%** (v0.16.0: 0.13%) | ~0.15% | P6 removes 8 gate-clause copies; P3 removes prose/TS duplicate checks |
| Route vocabulary representations | 4, unchecked | 3 exhaustive + 1 declared projection, checked | P4 |
| Behavioral truth restated | CI-diagnosis in 3 files; HITL/escalation split across 2 with mutual pointers | 1 owner each | P5 budgets + P8 |

Single-source proposals: route fields → `router.ts` `requireField` set (scan) vs prose (scan);
tree set → `paths.ts` vs docs (scan); ADR shape → `ADR_SHAPES` fact vs headings (scan); gate
resolution → `config-template.md` `resolution:` line vs prose (scan). None is generated from the
other — each pair keeps two separately fallible derivations, per ADR-007.

---

## Phase 6 — Scalability Assessment

| Scenario | Current | Bottleneck | Redesigned | Complexity |
|---|---|---|---|---|
| Governance concerns ×3 (29 → ~90 audits) | Reviewer prompt ~2,300 LOC in one file; gate re-seeds | Human authoring of one file | 90 module files, one assembled prompt; prompt volume is the inherent cost | O(n) source, O(n) prompt — inherent |
| Targets 9 → 27 trees | 14 files + 3 breaks each; amplification grows linearly | Plumbing signatures | ~8 files, 0 breaks | O(n) content (deliberate), O(1) coordination |
| Team 1 → 5 | Entry chain 955 LOC; reviewer closure ~95k tokens; 8.13× diffs to review | Reviewing generated hunks | Unchanged; ADR-023 protocol absorbs conflicts | O(8n) review cost — deliberate |
| Checks 74 → 220 | Glob runner scales; `EXPECTED_CHECK_COUNT` bumps 3× as often | Counter churn | Counter retired | O(1) |

The single-writer invariant remains the best scalability decision in the system and is untouched.

---

## Phase 7 — Future-Proofing

| Scenario | Breaking surface (current) | Redesigned | Feasibility |
|---|---:|---:|---|
| New governance concern | 2–5 files (reviewer, vcodes, worker-schemas, review-core, facts) | 2 | Poor → Good |
| New platform target | 14 files, 3 signature breaks | ~8, 0 | Fair → Good |
| Host API break (frontmatter schema) | 1 compile fn + 1 manifest builder | Same | Already good |
| New agent | 23–51 `src` files mention an existing agent by name | Same | Fair (inherent to prose agents) |
| New verify check | 1 file (+1 counter bump) | 1 file | Excellent → Excellent |
| ADR decision reversal | Undetectable (RC-E) | 2 detection legs + watch items | None → Fair |

Extension points: **13 `§ facts` declarations + 3 seams** (glob checks, hunt kinds, `V-LINK-01`)
today → **15 declarations + 5 seams** (audits/, gates/). Portability: 0% of `src/` is
host-specific (harness conditionals are build-time, 31 sites in 6 files; the `skills.sh` branch of
`model-routing.md` is self-declared "Unverified" — a completeness-critic gap filed as R-20).

### Phase 7.5 — V-ADA-02 exit gate

All 28 tracked ADRs have a matching `documentation/decisions/INDEX.md` row. The only mismatch is
the **untracked** `ADR-021-agent-plugins-skills-only-shell.md` (a duplicate of ADR-025 under the
wrong number, caught by `V-ADR-05`) — a working-tree stray to delete, not an index gap. **V-ADA-02:
pass.** Note: `ARCHITECTURE.md` §3.2 still says "Five markdown-defined agents" (there are eight).

---

## Phase 8 — Quantitative Dashboard

| # | Metric | Current (v0.21.0) | Redesigned | Delta | Principle |
|---|---|---|---|---|---|
| 1 | Total tracked files | 1,173 | ~1,215 (+~42 source modules, build output ±0) | +42 | Simplicity |
| 2 | Total LOC (`src` md / `scripts` prod) | 12,299 / 13,522 | ~12,250 / ~14,000 | −50 / +480 | Simplicity |
| 3 | Cross-references (`src`) | 1,293 citations, 150 targets | ~1,250 | −40 | DRY |
| 4 | Duplication ratio — build output | 8.97× (90.0% derived) | 8.97× | 0 *(deliberate)* | DRY |
| 5 | Duplication ratio — within `src` | 0.26% | ~0.15% | −0.11 pp | DRY |
| 6 | SRP violations (>300 LOC **and** 7+ resp.) | 5 (reviewer, implementer, planner, worker-schemas, orchestrator-dispatch) | 2 (catalog + dispatch) | **−3** | SRP |
| 7 | OCP violations (edit surface: concern / target / config feature) | 2–5 / 14 / ~23 | 2 / ~8 / ~23 (1-line cites) | **−3 / −6** | OCP |
| 8 | Change amplification | 8.13× | 8.13× | 0 *(deliberate)* | Coupling |
| 9 | Cognitive load (entry chain / reviewer closure) | 955 LOC / ~95k tokens | 955 / ~95k | 0 | Accessibility |
| 10 | Breaking-change surface (new target) | 14 files, 3 breaks | ~8, 0 | **−6 / −3** | Future-proof |
| 11 | Extension points | 13 decls + 3 seams | 15 decls + 5 seams | **+4** | OCP |
| 12 | Platform coupling | 645/1,173 = 55.0% *(0% of `src`)* | 55.0% | 0 | Portability |
| 13 | Time-to-add-audit / -target | 2–5 files / 14 | 2 / ~8 | **−3 / −6** | Developer XP |
| 14 | Audit drift risk | 4 unguarded shapes, 1 derived counter, 2 unwired watch items, 18 gate targets ≥85%, 1 undetectable reversal class | 0 shapes, 0 counters, watch items wired, allowlisted grandfathers, 2 detection legs | **−4 / −1 / −2** | Integrity |

---

## Appendix — Top 5 by effort-to-impact

`Priority = Gain × (11 − Effort)`, filed at ≥ 30 (`V-PARETO-03`). Full list, dependencies and
issue numbers: `documentation/plans/plan-retrospective-v0.21.0-remediation.md`.

| Rank | Change | Gain | Effort | Priority |
|---:|---|---:|---:|---:|
| 1 | R-05 `V-SHAPE-01` route field parity + fix the Router example JSON and `types.ts` | 8 | 3 | **64** |
| 2 | R-02 Budget the three `orchestrator-*.md` files (interim, before content gate v3) | 6 | 1 | **60** |
| 3 | R-03 Fix the stale tree table and "five agents" in the architecture docs | 6 | 1 | **60** |
| 4 | R-07 `ADR_WATCH_ITEMS` + `V-WATCH-01` (ADR-007's worker-schemas item first) | 6 | 2 | **54** |
| 5 | R-09 Record #408's reversal as an ADR-007 amendment; supersession rule with two legs | 6 | 2 | **54** |

Also filed (≥ 30): R-01 retire `EXPECTED_CHECK_COUNT` (50), R-06 per-mode reviewer prompt
requirements (50), R-10 `carry-staged-artifacts.ts` (49), R-16 gate-resolution SSOT (48),
R-13 audit-module seam ADR + include primitive (45), R-14 implementer gates (42), R-15 content gate
v3 (42), R-18 tree-registry ADR (42), R-08 ADR shapes (40), R-11 plan-quality CLI (40), R-12
decision-log script (40), R-17 named-flags plumbing + `V-TREE-01` (40), R-19 worker-schemas
orchestrator-side relocation (36), R-20 `skills.sh` harness-branch test (32).

Below threshold, retained open, never dropped: `worker-schemas.md` per-role split (ADR-007 rejected
it; the watch-item revisit R-19 supersedes the question), the `Priority` formula restated in 8
files (24, unchanged from v0.16.0), and the two macOS-tmpdir hook tests (filed as a bug, not a
remediation item).
