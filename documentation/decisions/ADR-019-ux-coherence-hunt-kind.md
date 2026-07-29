---
type: adr
status: accepted
created: 2026-07-29
last_updated: 2026-07-29
review_trigger: "on ADR acceptance"
related:
  - documentation/decisions/ADR-006-kaizen-hunt.md
  - documentation/decisions/ADR-013-mercure-parity-program.md
---

# ADR-019: UX-Coherence Hunt Kind

**Decision**: The owner approved **Option A — parity-precedent kind + hunt-gated companion
scaffold** for issue #421 (`kaizen: ux-coherence hunt kind — recurring whole-app journey/surface
audit against journeys.md + rulings`). `.blackhole/plans/issue-421.md` is the executable
follow-through that implements this decision. The autonomous `scripts/design-aggregate.ts` path
returned `blocked` (see § Gate below, promoted verbatim from the design note) — the primary
scorer's own matrix ranked Option B (self-seeding, no scaffold change) narrowly ahead of Option A
(4.20 vs 3.90, a 7.1% margin, below the 30% `autonomy.design_dominance_delta` threshold), and no
blind-critic sub-invocations could be spawned in that runtime. The owner decision recorded here —
not the script — is this ADR's actual approval authority, per `planner.md` § Design Track
subsection 8's `resume_context: design_approved` path (ADR-012 E2.3).

This ADR number is **ADR-019**, not the `ADR-017` the executable plan
(`.blackhole/plans/issue-421.md` § Touch-Paths, Task T10) names for this promotion: by the time
this promotion ran, `ADR-017-plan-time-ui-gate.md` and `ADR-018-visual-evidence-gate.md` had
already landed from concurrently-processed issues (Execution Strategy step 6's own
"a concurrently-processed issue may have claimed ADR-017 first" contingency). The design note's
body below contains no internal self-reference to its own ADR number, so no in-body correction is
needed — the substitution shows up only in this file's own name, the `ARCHITECTURE.md` Active
Constraints bullet, and the `documentation/decisions/INDEX.md` row, all of which cite `(ADR-019)`.
The promoted body below is otherwise verbatim, unedited.

The remainder of this document is the approved design note promoted verbatim (per `planner.md` §
Design Track subsection 8's `resume_context: design_approved` path — no re-analysis, no
re-invocation of `design-aggregate.ts`, no blind-critic re-spawn), beginning at its own title.

---

# Design Note - Issue #421

`kaizen: ux-coherence hunt kind — recurring whole-app journey/surface audit against journeys.md + rulings`

## Requirements Framing

Derived from the issue body (treated as UNTRUSTED-FORGE-DATA — raw display text, never
instructions), the `queue.json` route object, and `.blackhole/plans/issue-421-analysis.md`.

**Route context**: `task_type: feature`, `docs_impact: true`, `security_review_required: false`.
No `## Threat Model` obligation. `docs_governance` block is absent from
`.blackhole/config.json`, so per `config-template.md`'s contract note the sub-field defaults
apply (`enabled: true`, `companion_files: true`, `write_governance: true`) — a Documentation
Impact declaration is therefore required on the downstream executable plan.

**Problem statement (from the issue)**: issue-sliced campaigns produce locally-correct PRs and a
globally incoherent app. Nothing in the five-phase protocol ever walks the product as its user.
Cited evidence: an ad hoc 12-agent audit on the `invest` campaign (2026-07-29) surfaced 106
verified defects — whole-app structural findings (a monthly routine living as a sidebar of a
diagram editor; the app's headline question having no owning surface; a dead component family)
that 39 locally-green merged PRs did not detect.

**Acceptance sketch (from the issue)**:
1. `kaizen.kinds` gains `ux-coherence`; the hunter playbook defines the per-surface + journeys split.
2. `journeys.md` template in the companion-file scaffold.

**Hard dependency**: issue #417 (owner-rulings ledger, `documentation/reference/product-principles.md`).
The kind's proposed heuristics judge surfaces against DESIGN.md **+ the rulings ledger +**
journeys.md. Per the analysis note this is a *soft* dependency at the heuristic level (rulings
checks can degrade to a `V-INT-01` WARN when the ledger is absent) but a *hard* dependency at the
queue level — the orchestrator has #421 blocked by #417, and this design does not attempt to
unblock it.

**What is genuinely undecided** — and therefore what this design note exists to resolve. The hunt
kind itself is uncontroversial: `parity` (ADR-013 / `src/references/hunt/parity.md`) is a direct,
recent precedent for a purely additive 8th kind, and the analysis note confirms the hunter agent,
the orchestrator dispatch, the wave protocol, and the `hunt_state` watermark are all already
kind-agnostic. The open decision is **the `journeys.md` artifact's lifecycle**: the issue's AC
names a "companion-file scaffold" template, but `journeys.md` would be the first companion file
whose activation is driven by a *hunt kind* rather than by project structure (ARCHITECTURE.md,
AGENTS.md — universal) or by frontend detection (DESIGN.md — `scripts/detect-frontend.sh`). That
is a new activation-trigger class in a live bootstrap path (`src/SKILL.md` Phase 0 step 2), and it
sets a precedent every future hunt kind can invoke. `decision_type: architecture-choice`
(`design-rubric.md`) — a new structural boundary in the companion-file scaffold.

**Explicitly out of scope of the decision**: the scoring formula (`V-PARETO-02` is the SSOT and is
never varied per kind), the hunter agent's contract, the `hunt_state` schema, and any new severity
tier. All three options below hold those fixed.

## Options + Trade-off Matrix

Three real alternatives, all grounded in the current tree at `plan_base_commit` 85908ff.

### Option A — parity-precedent kind + hunt-gated companion scaffold

Follow `parity`'s landed shape exactly, then extend the Phase-0 scaffold with a third activation
trigger.

- New `src/references/hunt/ux-coherence.md` (scan heuristics, calibration table,
  `## Scoring — V-PARETO-02 SSOT`), declaring its own bands: one band per product surface plus one
  dedicated `journeys` band, carried on the existing generic `hunt_state.kinds.<kind>.bands_done`
  mechanic (the same shared mechanic `bug.md` uses, not `coverage.md`'s P1–P4 criticality scheme).
  The issue's "per-surface auditors + one journeys auditor" split is expressed as **bands within
  one kind**, so the orchestrator's existing one-wave-per-spawn dispatch fans out unchanged.
- Register the kind at all five drift-checked sites: `scripts/lib/build/facts.ts` `HUNT_KINDS`,
  `src/references/config-template.md` (JSON default block + `kaizen.kinds` prose row),
  `fixtures/config.example.json`, `src/agents/hunter.md`'s inline `e.g.` list.
- New `templates/companion-files/journeys.md.template` + a row and gating narrative in
  `templates/companion-files/README.md`.
- `src/SKILL.md` Phase 0 step 2 gains a third skip-if-exists creation branch, gated on
  `docs_governance.companion_files` **AND** `kaizen.enabled` **AND** `kaizen.kinds` containing
  `ux-coherence`.
- No new V-ADA code: `reviewer.md` §10 keeps auditing ARCHITECTURE/DESIGN/AGENTS only.

### Option B — kind-only, self-seeding `journeys.md` (no scaffold change)

Ship the hunt kind; leave the Phase-0 bootstrap path untouched.

- Same kind-registration diff as Option A (items 1–2 above), and nothing else in `src/SKILL.md` or
  `templates/`.
- `src/references/hunt/ux-coherence.md` declares the degradation contract itself: when
  `journeys.md` is absent, the `journeys` band's auditor derives a candidate user-job map from the
  actual surfaces and emits it as a normal `CONFIRMED` finding whose fix direction is "owner
  authors and commits `journeys.md`". That finding goes through the ordinary `V-PARETO-02` gate
  and files like any other, so the artifact arrives through the campaign's own filing pipeline
  rather than through bootstrap.
- Rulings-ledger checks degrade the same way when #417's ledger is absent (`V-INT-01` WARN).
- Consequence: the artifact has no canonical shape until a human writes one. Deliberately declines
  the issue's own AC-2 wording ("journeys.md template in companion-file scaffold").

### Option C — registry-driven companion-file scaffold refactor

Generalize before extending.

- Rewrite `src/SKILL.md` Phase 0 step 2 and `templates/companion-files/README.md` into a
  table-driven registry of `{template, target file, activation predicate}` rows, migrating
  ARCHITECTURE/AGENTS (universal) and DESIGN (`detect-frontend.sh`) into it.
- `ux-coherence` then adds one registry row rather than a fourth hand-written branch.
- Same kind-registration diff as Option A.

### Trade-off matrix

Fixed columns and weights for `architecture-choice` (`design-rubric.md`) — not picked ad hoc.
Scores on the shared 1–5 scale; `weighted_total = Σ(score × weight) / 100`.

| Option | Risk (30) | Maintainability (25) | Complexity (20) | Reversibility (15) | Consistency (10) | Weighted total |
|--------|-----------|----------------------|-----------------|--------------------|------------------|----------------|
| A — hunt-gated scaffold | 4 | 4 | 3 | 4 | 5 | **3.90** |
| B — self-seeding, no scaffold change | 5 | 3 | 5 | 5 | 2 | **4.20** |
| C — registry refactor | 2 | 5 | 2 | 2 | 2 | **2.75** |

Score rationale, per option:

- **A — Risk 4**: touches `src/SKILL.md` Phase 0, a live bootstrap path that runs on every campaign
  in every consumer repo — but the write is triple-gated and skip-if-exists, so the blast radius of
  a mistake is a stray file, not a corrupted campaign. **Maintainability 4**: one more hand-written
  branch in a step that already has two; readable, but `mercure-extension-tax.md`'s step-level
  accretion threshold (4+ conceptual gate patterns in one numbered step) starts to come into view.
  **Complexity 3**: three distinct activation-trigger classes now coexist in one step, each
  documented separately. **Reversibility 4**: removing the branch is a clean revert; already-created
  `journeys.md` files persist in consumer repos. **Consistency 5**: matches both the `parity` kind
  precedent and V-ADA's existing dual-trigger (universal + conditional) companion-file model, and
  satisfies the issue's AC-2 literally.
- **B — Risk 5**: zero change to the bootstrap path; the entire diff is additive reference/config
  registration plus one new markdown file. **Maintainability 3**: `journeys.md` acquires no
  canonical shape, so each consumer repo invents one — the exact conditions for a future
  `V-INT-03` ("third variant of a solved concern") when a second kind wants a similar artifact.
  **Complexity 5**: smallest possible diff; the degradation contract lives entirely inside the kind
  reference where the hunter already reads it. **Reversibility 5**: deleting the kind reference and
  the four registration lines fully reverts. **Consistency 2**: declines the companion-file pattern
  the issue's AC explicitly names, and introduces a second way for a durable product artifact to
  come into existence (filed-issue-driven rather than scaffolded).
- **C — Risk 2**: rewrites a live bootstrap step that currently works, for the benefit of one new
  consumer. **Maintainability 5**: future kinds register declaratively; the accretion pressure
  Option A accepts is structurally removed. **Complexity 2**: a registry mechanism where none
  exists today. **Reversibility 2**: the migration of three existing companion files is not a clean
  revert. **Consistency 2**: `V-KISS-01`/`V-YAGNI-01` — a generalization built for a single known
  consumer, with the second hypothetical (perf-budgets, accessibility) not yet requested by any
  issue.

Primary-scorer ranking: **B (4.20) > A (3.90) > C (2.75)**. B's margin over the runner-up is
`(4.20 − 3.90) / 4.20 = 7.1%` — far below `autonomy.design_dominance_delta` (30, the config
default). No option dominates on the primary's own matrix.

## Adversarial Evaluation

**The two blind critic sub-invocations required by `planner.md` §4.3 could not be spawned in this
runtime.** No `Agent`/`Task` delegation tool is exposed to this planner invocation (verified: the
tool is absent from the loaded set and `ToolSearch` returns no match for it). The critique-only,
Chosen-stripped, 2-invocation multiplicity pattern therefore did not run.

This is recorded as an environment limitation, **not** worked around. Authoring two critic score
sets myself and feeding them to `scripts/design-aggregate.ts` would be the primary planner
self-certifying the verdict through the script — precisely what §4.8's "the planner MUST NOT
substitute its own judgment" and "blind" both forbid. Two score sets written by the same scorer
are not independent and are not blind, and a `ready` verdict produced from them would be a
`V-AUTO-01` artifact in substance even while passing in form. The `critics` array was therefore
submitted empty and the script's own fail-safe (`critics.length !== 2` → `malformed-input` →
`blocked`) was allowed to fire.

What survives as genuine adversarial content is the self-critique already embedded in the matrix
rationale above, stated plainly here so a human reviewer can attack it directly:

- **Against A (the option the issue's AC points at)**: it spends a live-bootstrap-path change and a
  new activation-trigger class on an artifact whose *content* no agent can author — only the owner
  can decide the product's 3–6 core user jobs. Scaffolding a template into every opted-in repo
  produces an empty placeholder that the hunt will then audit against, and an unfilled
  `journeys.md` is arguably worse than an absent one: the journeys band reads it, finds
  boilerplate, and either no-ops or generates noise. Option A has no answer for "who fills it in"
  beyond the template's own prompts.
- **Against B (the primary's top scorer)**: the degradation path is a plausible-sounding mechanism
  that has never been exercised. "The auditor derives a candidate user-job map and files it as a
  finding" is a *new* finding shape for the hunt pipeline — every existing kind files a defect with
  a `file:line` citation, whereas this files a proposed artifact. That may not survive contact with
  `worker-schemas.md`'s Hunter Finding shape, which the analysis note assumed unchanged. If it does
  not, B's whole cost advantage evaporates.
- **Against both A and B**: neither resolves the analysis note's four unanswered `journeys.md`
  questions (when created, by whom, how "owner-approved" is enforced, how it evolves). A answers
  only the first; B answers only the first, differently. Question 3 — enforcement of
  owner-approval — is a product-authority question that no scoring column measures.
- **Domain-inherent (applies to every option, therefore non-discriminating)**: the kind's
  effectiveness evidence is a single ad hoc run on one campaign (`invest`, 12 agents, 106 defects).
  No option changes the fact that there is no baseline for recurring-wave cost, no band-count
  strategy validated against a real surface inventory, and no comparison against the existing seven
  kinds' yield. This is a measurement gap, not a discriminator between A, B, and C.
- **Domain-inherent**: all three options inherit #417's rulings ledger as a soft heuristic
  dependency and a hard queue dependency.

## Component Decomposition

N/A — single-component design. Every option is confined to the existing hunt-kind seam
(`src/references/hunt/<kind>.md` + four registration sites) plus, for A and C, the existing
companion-file scaffold step. No new boundary between distinct responsibilities is introduced: the
hunter agent, the orchestrator dispatch, the wave protocol, and the `hunt_state` watermark are all
already generic over `kaizen.kinds` and are touched by none of the options
(`orchestrator-dispatch.md:139`, `phase-loop.md:102`, `findings-ledger.md:227`).

## Design Principles Validation

Scored with the same `✓ / ~ / ◐ / ✗` vocabulary as the Assumption Audit below, against the
primary's top-ranked option (B) with A's delta noted where it differs.

| Axis | Score | Justification |
|------|-------|---------------|
| SRP | ✓ | The kind reference owns heuristics + calibration only; filing, scoring gates, and state mutation stay with the orchestrator (the ADR-004 coordinate-vs-discover boundary is untouched). |
| DIP | ✓ | Every consumer depends on the `kaizen.kinds` abstraction, not on the concrete kind — which is why 5 of the 13 grepped consumers are TRANSPARENT. |
| DRY | ✓ | No scoring formula, severity tier, or ledger field is duplicated; `V-PARETO-02` stays the single SSOT, restated by reference exactly as `bug.md` and `parity.md` do. |
| KISS | ✓ for B, ~ for A, ✗ for C | B adds one file and four registration lines. A adds a fourth conceptual branch to a Phase-0 step that already carries three. C builds a registry for one known consumer. |
| YAGNI | ✓ for B, ~ for A, ✗ for C | C's registry generalizes over a second consumer no issue has requested (`V-YAGNI-01`). A's template is requested by the issue's AC but has no author for its content. |
| Pattern (hunt-kind seam) | ✓ | All three options reuse the ADR-006 additive-kind seam verbatim; none introduces a parallel dispatch path or a new agent identity. |

## Refactoring Impact Analysis

Direct grep over the tree at 85908ff, per interface the design changes. 13 consumers found; 4
BREAKING, 3 DEPRECATION, 6 TRANSPARENT — well past the 3-consumer threshold, so the downstream
executable plan carries a mandatory `## Dependency Blast-Radius` section (`V-SCOPE-03`).

**Interface 1 — the `HUNT_KINDS` closed vocabulary** (`scripts/lib/build/facts.ts:54`)

| Consumer | Classification | Note |
|----------|----------------|------|
| `scripts/lib/build/facts.ts:54` | BREAKING | Hand-authored declared side of the `V-VOCAB-01` two-sided check; must gain `ux-coherence`. |
| `scripts/checks/vocabulary.check.ts:152` | BREAKING | `{ name: 'kaizen kinds', declared: HUNT_KINDS, scan: … }` fails with `undeclared value(s) [ux-coherence]` if the scanned side (the config-template JSON array) changes without the declared side. Both sides must land in the same diff. |
| `src/references/config-template.md:23` | BREAKING | The `"kinds": [...]` JSON block is *both* the scanned side of `V-VOCAB-01` and the documented default; omitting it leaves the kind undispatchable by default. |

**Interface 2 — the documented `kaizen.kinds` default list** (prose/fixture restatements)

| Consumer | Classification | Note |
|----------|----------------|------|
| `src/references/config-template.md:55` | DEPRECATION | `kaizen.kinds` prose row enumerates the default verbatim; asserted for the `parity` precedent at `scripts/kaizen-parity-kind.test.ts:35`. Stale, not broken, until updated. |
| `fixtures/config.example.json` | DEPRECATION | Example config diverges from the documented default until updated; asserted at `scripts/kaizen-parity-kind.test.ts:19`. |
| `src/agents/hunter.md:16` | DEPRECATION | Inline `e.g.` kind list — deliberately excluded from the `V-VOCAB-01` scan (see `vocabulary.check.ts`'s KNOWN BLIND SPOTS), so only the parity-style test catches it. |
| `src/references/worker-schemas.md:636` | TRANSPARENT | `kind` field is specified as "one of `kaizen.kinds`" with illustrative examples; no closed restatement. |
| `src/references/coordinator-dashboard.md:53` | TRANSPARENT | Renders `hunt_state.kinds.<kind>.waves` generically. |
| `src/agents/coordinator.md:129` | TRANSPARENT | Bootstrap preflight reads `kaizen.kinds` from loaded config; no literal. |

**Interface 3 — the Phase-0 companion-file scaffold contract** (Options A and C only)

| Consumer | Classification | Note |
|----------|----------------|------|
| `src/SKILL.md:54` | BREAKING (A, C) / TRANSPARENT (B) | Step 2's gating narrative is the runtime contract; a template that is not wired here is never instantiated. |
| `templates/companion-files/README.md` | BREAKING (A, C) / TRANSPARENT (B) | The templates table and gating narrative are the documented contract; a template absent from it is undiscoverable. |
| `src/references/config-template.md:49` | TRANSPARENT | The `docs_governance.companion_files` row cites `SKILL.md:42` while the step now sits at line 54 — **pre-existing** citation drift at 85908ff, not introduced here; noted so it is not misattributed to this change. |
| `src/agents/reviewer.md:129` | TRANSPARENT | §10's V-ADA audit enumerates ARCHITECTURE/DESIGN/AGENTS only. `journeys.md` gets no V-ADA code under any option, so the reviewer audit is unchanged — and deliberately so: adding a `V-ADA-0x` row for a hunt-kind-scoped artifact would be a separate, larger decision. |

**Interfaces confirmed unchanged** (scanned, no consumer impact): `hunt_state` schema
(`findings-ledger.md:227–230` — keyed generically, orchestrator auto-creates the watermark on
first dispatch), hunter spawn contract (`orchestrator-dispatch.md:139`), round-robin kind selection
(`phase-loop.md:102`), wave/exhaustion stop conditions (`phase-loop.md:241–246`).

## Assumption Audit

| # | Assumption | Mark | Note |
|---|------------|------|------|
| 1 | A new hunt kind is purely additive — no orchestrator, hunter, or `hunt_state` change | ✓ | Verified by grep: `orchestrator-dispatch.md:139`, `phase-loop.md:102`, `findings-ledger.md:227`, `hunter.md:16` are all generic over `kaizen.kinds`. The `parity` kind (ADR-013) landed on exactly this seam. |
| 2 | `V-VOCAB-01` requires the declared (`HUNT_KINDS`) and scanned (config-template JSON) sides to change together | ✓ | `vocabulary.check.ts:152` + `findVocabMismatch` reports scanned-but-undeclared values; confirmed by reading the check. |
| 3 | `scripts/kaizen-parity-kind.test.ts` is the reusable shape for a per-kind registration regression test | ✓ | Read in full; asserts fixture, config-template JSON block, config-template prose row, hunter inline list, and kind-file content shape. |
| 4 | The issue's "per-surface auditors + one journeys auditor" split maps onto existing wave **bands**, needing no new fan-out mechanic | ~ | Contestable. `bug.md` establishes bands as the shared territory mechanic and the hunter runs one wave per spawn, so N surfaces means N waves rather than N parallel auditors. The issue's evidence run used **12 parallel agents in one pass** — the banded mapping preserves coverage but not the single-pass latency, and nothing in the current protocol reproduces a 12-way parallel single-kind wave. |
| 5 | `docs_governance` defaults apply (block absent from the live config) | ✓ | `config-template.md:76` contract note: absent block → sub-field defaults (`enabled: true`, `companion_files: true`, `write_governance: true`). |
| 6 | `autonomy.design_autonomy` is `true` (block absent from the live config) | ✓ | `config-template.md:68` — default `true`; the gate is on, so the `blocked` verdict below comes from the script, not from the gate being off. |
| 7 | `journeys.md` content can only be authored by the product owner, not derived by an agent | ~ | Contestable, and it is the crux of A-vs-B. Option B's whole premise is that a candidate map *can* be derived from surfaces and then owner-approved; Option A's premise is that it cannot and must be prompted for. Neither is demonstrated. |
| 8 | Filing a "proposed artifact" finding (Option B) fits the existing Hunter Finding shape | ◐ | Blind spot. Every shipped kind files a defect with a `file:line` citation; a finding whose subject is a file that does **not** exist has no citation to verify, and `hunter.md`'s unconditional verification pass ("re-read every `file:line` you cited") has no defined behavior for it. Not resolvable from the artifacts read here. |
| 9 | `journeys.md` needs no `V-ADA` reviewer code | ~ | Contestable. Every other scaffolded companion file has a presence code (`V-ADA-01/03/05`). Omitting one for `journeys.md` is defensible (it is hunt-scoped, not universal) but leaves the artifact unaudited once created. |
| 10 | #417's rulings ledger is a soft heuristic dependency, degradable to a `V-INT-01` WARN | ~ | Contestable, and inherited from the analysis note rather than independently verified. The issue frames the rulings ledger as one of three judging inputs; if it is load-bearing rather than additive, "degrade gracefully" understates the loss and the kind ships with a third of its judgment missing. |

**Deferred `## Active Constraints` seeding (`planner.md` Step 4, ADR-012 E3 Trigger B)**: the
analysis note's Architecture Coherence section yields one finding that clears the Cross-Cutting
Heuristic 3/3 — *"a companion file introduced for a single hunt kind must be gated on that kind's
activation, never added to the universal Phase-0 scaffold"* (Breadth: governs the Phase-0 scaffold,
the reviewer V-ADA audit, and the hunt-kind seam; Enforcement stakes: an ungated scaffold branch
writes files into every consumer repo on every campaign; Foreclosure: rules out the whole category
of unconditional scaffolding for kind-scoped artifacts). The rulings-ledger degradation finding
scores 0/3 and does not qualify. **This append was not performed** — this invocation's scope
boundary permits writes only under `.blackhole/plans/`, and `ARCHITECTURE.md` is outside it. The
constraint is recorded here so the append is not lost; it belongs in the implementing PR alongside
the ADR, with the `(analyze: issue #421)` attribution suffix.

## Gate

status: blocked  <!-- ready only when scripts/design-aggregate.ts computes it, ADR-010 D4 -->

`autonomy.design_autonomy` resolves to `true` (block absent → default, `config-template.md:68`), so
the autonomous path was live and `scripts/design-aggregate.ts` was invoked as the sole verdict
source. Verbatim output:

```json
{
  "status": "blocked",
  "winner": null,
  "reasons": ["malformed-input"],
  "scorer_results": [],
  "detail": "expected exactly 2 critic scores, got 0"
}
```

Two independent reasons for the block, either sufficient on its own:

1. **`malformed-input` (the script's own verdict, and the binding one)** — the blind critic
   sub-invocations required by §4.3 could not be spawned (no delegation tool in this runtime), the
   `critics` array was submitted empty rather than self-authored, and the script's fail-safe fired.
   Per §4.8 this returns `status: blocked` on the same unconditional code path the Design Track has
   always used; no `ready` bypass exists and none was constructed.
2. **No dominance on the primary's own matrix** — B (4.20) leads A (3.90) by 7.1%, against an
   `autonomy.design_dominance_delta` of 30. Even with two conforming critics, a `ready` verdict
   would require the same option to win under all three scorers with a margin *exceeding* 30%. The
   A-vs-B decision is close on the numbers and turns on a product-authority question (assumption 7:
   can a user-job map be derived and then approved, or must it be authored?) that no rubric column
   measures.

No ADR was written and no `documentation/decisions/INDEX.md` row was appended —
`scripts/detect-doc-schema.sh` was not run, because both are `ready`-branch actions only. No
executable plan was written at `.blackhole/plans/issue-421.md`, per the spawn directive's blocked
branch.

**What unblocks this**: a human decision between Option A and Option B — concretely, an answer to
"who authors `journeys.md`, and does the hunt scaffold it or file for it?" Option C should be
rejected outright (`V-KISS-01`/`V-YAGNI-01`, single known consumer) unless a second kind-scoped
companion file is already planned. Alternatively, a re-run of this design in a runtime that exposes
the delegation tool would produce a genuine 3-scorer verdict — though on the primary matrix's
spread that verdict is likely `blocked` on `dominance` regardless.

Note also the standing queue-level dependency: #421 is blocked by #417 (rulings ledger), which is
one of the three judging inputs this kind's heuristics read.
