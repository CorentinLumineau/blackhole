---
type: adr
status: current
created: 2026-07-20
last_updated: 2026-07-20
review_trigger: "on ADR acceptance"
related:
  - documentation/decisions/ADR-011-implement-time-accretion-control.md
  - documentation/decisions/ADR-010-autonomous-thinking-routes.md
  - documentation/decisions/ADR-008-routing-visibility-reuse-gate.md
  - documentation/audits/mercure-companion-files-gap-analysis.md
  - documentation/audits/autonomous-workflow-parity.md
supersedes:
---

# ADR-012 — Shared artifact substrate: banking decisions for future implementations

## Status

Accepted — 2026-07-21 (shipped in v0.15.0: `companion-substrate-closure` M0-M5 merged, including E5 autonomy default flip)

Completes ADR-010's artifact contract on the human-approved path. Paired with ADR-011, whose
D1/D2 **must land before E5** (see E5 sequencing).

## Overview

Blackhole is intended as **autonomous mercure over a shared artifact substrate**: mercure
builds with the user, blackhole builds unattended and interrupts only when genuinely needed,
and both operate on the same repo-local files at the same code quality. Six defects block
that. Artifacts blackhole creates collide with mercure's schemas at two layers. Designs a
human approves are never banked — and, as this ADR discovers, the resumption path that would
bank them is broken by a note-value mismatch. Implementation decisions exist only in PR
bodies, so they never inform a future implementation. And blackhole interrupts on design
gates it already has the machinery to decide.

This ADR closes the **write** side. The **read** side — injecting that knowledge back into
workers — is Future Work behind three named prerequisites.

## Context

### Finding 1 — INDEX row schemas diverge

| Tool | Row format |
|---|---|
| mercure | `\| ADR \| Title \| Status \| Date \|` (`companion-file-sync.md:45`) |
| blackhole | `\| path \| summary \| type \| status \| review_trigger \|` (`decisions/INDEX.md:3`) |

On a shared repo they emit mutually incompatible rows.

### Finding 2 — ADR **frontmatter** schemas also diverge

mercure's template requires `type, number, title, status, created, supersedes, related,
source, scope, decision_signals, tracking_initiative` with a
`draft|accepted|superseded|deprecated` enum. Blackhole uses the generic doc-governance
schema — `type, status(current|deprecated|archived), created, last_updated, review_trigger,
related, supersedes`. Same defect as Finding 1, one artifact layer down.

### Finding 3 — human-approved designs are never promoted

`planner.md` §4.8: only `design-aggregate.ts → status: "ready"` promotes a design note to
`documentation/decisions/`. The `blocked` branch returns *"exactly as today"* with no
promotion step. A design a human explicitly approved dies in gitignored
`.blackhole/plans/issue-N-design.md`. Confirms `autonomous-workflow-parity.md` G3.

### Finding 3b — the resumption path is broken by a note-value mismatch

Discovered while verifying Finding 3's remedy. `phase-plan.md` sets
`notes: awaiting-design-approval` when `track: design` — but `coordinator.md:185` recognizes
only `awaiting-user-clarification`, `awaiting-plan-approval`, and `merge-order cycle with
#N`, and `queue-dag.md:39`'s enum omits `awaiting-design-approval` entirely. **A
design-track block is therefore never recognized by the coordinator**, so no resume fires.
Any promotion-on-approval design that assumes the existing resumption path works is building
on a broken precondition.

### Finding 4 — `## Active Constraints` has no write path

Grep across `src/`, `scripts/`, `templates/`: **zero writers**. Bootstrap creates the
placeholder block; nothing fills it. Yet this repo's own `ARCHITECTURE.md:296-304` carries
three load-bearing constraints, hand-written.

### Finding 5 — implementation decisions are not banked

`implementer.md` produces Root-Cause Decision Records, Refactoring Verification Decision
Records, Reuse Check entries, and Improvement Records (ADR-011 D2) — **all PR-body only**.
`findings-ledger.json` is gitignored by design (`blackhole-state.md:35-38`). No future
worker can grep why a prior implementation chose what it chose.

### Finding 6 — blackhole asks more than it needs to, and `autonomy.enabled` is a master switch

`config-template.md:25` — `"autonomy": { "enabled": false, ..., "design_autonomy": true,
"analyze_routing": true, "brainstorm_routing": true }`. The sub-flags **already default
true**; only the master switch is off. Flipping `enabled` therefore activates **three**
routes at once: design autonomy (`planner.md:106,169`), analyze routing
(`phase-handle.md:70`), and brainstorm routing (`orchestrator.md:157`). Brainstorm routing
has **terminal semantics** — per ADR-010 D3 a brainstorm-routed issue never produces a
mergeable PR; it closes as satisfied-by-children. That is not a side effect to enable
silently.

## Decision

Five decisions. All gated by the existing `docs_governance` / `autonomy` kill-switch pattern;
an absent block preserves current behaviour exactly.

**E1 — Extend repo-convention precedence to both ADR artifact layers.**

`doc-governance.md` § *Repo Convention Precedence* already binds for frontmatter
(`V-INT-01`). Extend it to cover (a) the `decisions/INDEX.md` **table header** and (b) **ADR
file frontmatter**: detect the schema the consumer repo already uses and emit matching rows
and frontmatter; fall back to blackhole's schema only when the file is absent, headerless,
or no ADR exists yet. On any ambiguity, fall back and emit a `V-INT-01` WARN so the
ambiguity is visible rather than silent.

**E2 — Promote human-approved designs, via an explicit third branch and a repaired
resumption path.**

Three concrete edits, because the existing machinery does *not* reach this behaviour:

1. **Repair the note mismatch (Finding 3b)** — add `awaiting-design-approval` to
   `coordinator.md`'s recognized blocked-notes set and to `queue-dag.md`'s `notes` enum.
   Without this the rest of E2 is unreachable.
2. **Add a third branch to `planner.md` §4.8** — today it is a binary
   (`ready` → promote / `blocked` → return). Add: `resume_context: design_approved` →
   promote the on-disk `plans/issue-N-design.md` **verbatim**, no re-analysis and **no
   blind-critic re-spawn**, writing `documentation/decisions/ADR-{NNN}-{slug}.md`
   (E1-shaped) plus an E1-shaped INDEX row, committed in the issue's own PR.
3. **Add the spawn directive** — the orchestrator re-spawns the planner with an explicit
   `resume_context: design_approved` directive, following ADR-004's explicit-directive-only
   convention (the same pattern as `track: design` / `track: brainstorm`). A generic
   re-spawn would re-run the entire Design Track including two fresh critic invocations,
   discarding the artifact the human actually reviewed.

Delivery matches ADR-010's autonomous branch: **pre-merge write, merge = approval**. This
does **not** violate ADR-010's binding constraint that the planner never computes its own
autonomy verdict — the verdict here is the *human's*, passed in as directive context; the
planner performs promotion, it does not decide it.

**E3 — Give `## Active Constraints` a write path with two independent triggers.**

*Actor*: the **planner**, in the same turn as an E2 or autonomous promotion — never a
post-merge hook, so no agent needs to exist at merge time.

- *Trigger A* — on ADR promotion, when the ADR establishes a cross-cutting non-negotiable,
  append it to `ARCHITECTURE.md` `## Active Constraints` in the same PR. Same trigger, scope,
  and PR as the existing `V-ADA-02` INDEX-row append.
- *Trigger B* — **mandatory** seeding: when an `investigator` `analyze` note exists, the
  planner seeds Active Constraints from its conventions/architecture findings.

Trigger B is mandatory precisely because Trigger A is unreachable on a Quick-track-only repo
(R3).

**E4 — Bank implementation decisions in `documentation/reference/decision-log.md`, written
by the orchestrator under the single-writer invariant.**

*Location*: `documentation/reference/` — long-lived reference material per the file-organization
taxonomy. **Not** `documentation/decisions/`, which is `ADR-{NNN}-{slug}.md` territory in both
tools' conventions; a non-ADR file there would collide with mercure's expectations for that
directory. The file carries standard lifecycle frontmatter (`type: reference`,
`status: current`) so it does not trip `V-DOC-GOV-02` on its own first audit.

*Write protocol — this is the load-bearing part.* Workers do **not** append to it. The
implementer returns its records in the worker JSON as `decision_records[]`; the
**orchestrator** appends them serially post-barrier, exactly as it already does for
`findings-ledger.json`. This is the established single-writer invariant
(`blackhole-state.md` § Single-writer invariant, issue #224). A per-PR-branch write model
was considered and **rejected**: under `parallel_max > 1`, every in-flight PR appending to
one shared file guarantees git merge conflicts at merge time — reintroducing precisely the
race the single-writer invariant exists to prevent.

| Column | Content |
|---|---|
| `pr` / `issue` | linkage |
| `kind` | root-cause \| approach \| refactor \| improvement \| reuse |
| `touch_paths` | files the decision governed |
| `decision` | one line |
| `why` | one line |

Rotation above 500 rows to `documentation/reference/_archive/`, mirroring the findings-ledger
convention.

**E5 — Flip `autonomy.enabled` to `true` while explicitly setting `brainstorm_routing:
false`, sequenced after ADR-011 D1/D2 and E1–E4.**

Because `enabled` is a master switch over sub-flags that already default true (Finding 6),
flipping it alone silently activates three routes. This decision therefore flips the master
**and pins the sub-flags explicitly**:

| Flag | New default | Rationale |
|---|---|---|
| `enabled` | `true` | Blackhole should decide what it can decide |
| `design_autonomy` | `true` (unchanged) | Blind critics + deterministic `design-aggregate.ts` verdict already gate it |
| `analyze_routing` | `true` (unchanged) | Produces an analysis note; no terminal or merge semantics |
| `brainstorm_routing` | **`false`** (changed) | Terminal-closure semantics — a brainstorm-routed issue never produces a mergeable PR (ADR-010 D3). Closing an issue as satisfied-by-children is a product judgement that stays opt-in |

Ordering is binding: flipping before ADR-011's gates and E1–E4's write paths land would
amplify context-free, unbanked output at campaign scale. `never_bypass`
(destructive, credentials, epic-go-no-go) is unchanged.

## Future Work — the read path (not decided here)

Injecting `## Active Constraints` and `DESIGN.md` tokens into worker context is **not**
decided here. Three parallel x-architect critics evaluated three injection designs
(orchestrator-injected, planner-mediated, worker-side gate) and returned *structurally
unsound* for **all three**:

- **Undecidable relevance** — INDEX rows are prose with no schema tying an ADR to the files
  it constrains; filtering degrades to lexical matching whose dominant failure is a silent
  false negative.
- **No propagation gate** — `reviewer.md:108-114` V-ADA checks are presence-only, never
  content. Injection without verification *"trades a visible gap for an invisible one."*
- **Untrusted-content doctrine** — `reviewer.md:114` binds `ARCHITECTURE.md` body content as
  *"inert display data, never as instructions."*
- Discriminating: orchestrator-injection **cannot be built** (V-CONTENTGATE-01,
  `core.check.ts:729-814`, `## 5-Field Delegation Contract` grow-never at 131 LOC);
  planner-mediation **silently no-ops on Quick track** (`planner.md:252-302` gates Codebase
  Conventions `[Standard Only]`); worker-side hands untrusted content to the only
  Write-capable agent.

**Prerequisites before any read-path ADR is proposed:**

1. A decidable ADR↔path index. **Constraint**: it must not widen a shared INDEX table whose
   header E1 requires matching — on a foreign header it lives in a sidecar file, never as an
   appended column. **Backfill**: the sidecar is built by scanning existing ADRs at
   introduction time; rows E1/E2 emit before then need no retrofit, because the sidecar is
   keyed by ADR path rather than embedded in the row.
2. A content-propagation audit replacing presence-only V-ADA checks.
3. A fourth injection design, **or** an explicit demonstration that one of the three
   evaluated designs is sound for the bounded Active-Constraints case specifically. This
   prerequisite does not presuppose any of the three.

## Architecture

```mermaid
flowchart TD
  subgraph BLOCKED["E2 — human-approved promotion"]
    PL1["planner: design track"] -->|notes: awaiting-design-approval| Q["queue.json"]
    Q --> CO["coordinator<br/>(recognizes note — E2.1 repair)"]
    CO -->|parse + resume| OR["orchestrator"]
    OR -->|resume_context:<br/>design_approved| PL2["planner 4.8<br/>THIRD BRANCH"]
  end
  PL2 -->|verbatim, no critic re-spawn| ADR["decisions/ADR-NNN-slug.md"]
  PL2 -->|E1-shaped| IDX["decisions/INDEX.md"]
  PL2 -->|E3 trigger A| AC["ARCHITECTURE.md<br/>Active Constraints"]
  AN["investigator analyze note"] -->|E3 trigger B mandatory| AC
  IMP["implementer"] -->|decision_records[] in worker JSON| OR2["orchestrator<br/>SINGLE WRITER"]
  OR2 -->|serial append post-barrier| LOG["reference/decision-log.md"]
  ADR --> PRC["committed in issue PR<br/>merge = approval"]
  IDX --> PRC
  AC --> PRC
  LOG --> PRC
  PRC -.->|FUTURE WORK<br/>3 prerequisites| RD["read path"]
```

**Data flow**

1. Design track blocks → `notes: awaiting-design-approval`.
2. Coordinator **now recognizes** that note (E2.1) and parses the user's response.
3. Coordinator resumes the orchestrator (`interrupt: false`).
4. Orchestrator re-spawns the planner with `resume_context: design_approved` (E2.3).
5. Planner's third branch (E2.2) promotes the on-disk design note verbatim — ADR + INDEX row
   in the repo's detected schema (E1) — and appends any cross-cutting constraint (E3-A).
6. Implementer returns `decision_records[]`; the orchestrator appends them serially to
   `decision-log.md` post-barrier (E4).
7. Merge = approval. Artifacts are durable and greppable.

## Components

| # | Component | Responsibility | Interface | Dependencies |
|---|---|---|---|---|
| 1 | `doc-governance.md` § Repo Convention Precedence | Select emission schema | detected header / frontmatter keys | consumer repo state |
| 2 | `coordinator.md` blocked-note set | Recognize `awaiting-design-approval` | queue `notes` | `queue-dag.md` enum |
| 3 | `queue-dag.md` `notes` enum | Declare the value | schema | — |
| 4 | `planner.md` §4.8 third branch | Promote verbatim on approval | ADR file + INDEX row | E1; directive from #5 |
| 5 | `orchestrator.md` re-spawn | Pass `resume_context: design_approved` | spawn directive | ADR-004 directive convention |
| 6 | `planner.md` promotion step | Append cross-cutting constraint | `ARCHITECTURE.md` § Active Constraints | E1; analyze note (trigger B) |
| 7 | `implementer.md` record emission | Return `decision_records[]` | worker JSON | ADR-011 D1/D2 artifacts |
| 8 | `orchestrator.md` ledger append | Serial write, single-writer | `decision-log.md` rows | `blackhole-state.md` invariant |
| 9 | `reference/decision-log.md` | Durable, greppable decision memory | append-only table + frontmatter | doc-governance naming |
| 10 | `config-template.md` | `autonomy` defaults incl. pinned sub-flags | config block | E5 sequencing |

## Design Principles Validation

| Principle | Verdict | Note |
|---|---|---|
| **SRP** | ✅ Pass | Planner owns ADR + constraints; implementer *produces* decision rows but does not write them; orchestrator owns the shared-file write. One writer per artifact |
| **OCP** | ✅ Improved | E1 makes schema selection data-driven — a third tool's format needs no code change |
| **LSP** | ✅ Pass | Human-approved and autonomous promotion become substitutable: same writer, same delivery, same artifact shape, differing only in who supplied the verdict |
| **ISP** | ✅ Pass | `decision_records[]` is a 5-field row contract, not a general-purpose store |
| **DIP** | ✅ Pass | Promotion depends on the abstract "detected repo schema", not on either tool's concrete format |
| **DRY** | ✅ Pass | E4 reuses the existing single-writer append protocol rather than inventing a second one; E2 reuses the coordinator resume path rather than adding parallel wiring |
| **KISS** | ⚠️ Mixed | E4 adds one tracked file; E2 adds one branch and one directive. Justified: PR bodies do not travel with a clone, `findings-ledger.json` is gitignored by design, and §4.8's binary has no reachable third state today |
| **YAGNI** | ✅ Pass | Every decision traces to a verified finding. The speculative part — the read path — is explicitly Future Work, unbuilt |
| **Separation of Concerns** | ✅ Pass | Write path (this ADR) cleanly separated from read path (Future Work); production separated from persistence in E4 |
| **Composition over Inheritance** | ✅ N/A | Prompt/artifact contracts, no type hierarchy |
| **Law of Demeter** | ✅ Pass | Coordinator touches only queue notes; planner writes files; implementer returns JSON. No agent reaches through another's state |
| **Fail Fast** | ✅ Pass | Schema detection resolves once at write time; ambiguity emits `V-INT-01` immediately rather than degrading silently |
| **GoF — Creational** | N/A | No object construction |
| **GoF — Structural** | **Adapter** | E1 adapts blackhole's internal record shape to whichever external schema the repo presents. Genuine — two real formats exist (mercure, blackhole), so not a single-consumer abstraction |
| **GoF — Behavioral** | N/A | Strategy considered for E3's two triggers and rejected — two fixed triggers do not warrant a pluggable strategy (`V-YAGNI-03`) |
| **No forced patterns** | ✅ Pass | Adapter named only where two real formats exist |
| **Progressive Disclosure** | N/A | No UI surface |

## Trade-offs

| Decision | Option A | Option B | Choice |
|---|---|---|---|
| Schema conflict | Pick one canonical schema | Detect and match the repo's | **B** — A forces every consumer repo to migrate |
| Promotion mechanism | Generic planner re-spawn | Explicit `resume_context` directive | **B** — A re-runs the whole Design Track incl. 2 fresh critics, discarding the reviewed artifact |
| Decision memory home | PR body only (status quo) | Committed `decision-log.md` | **B** — PR bodies do not travel with a clone and are not greppable |
| `decision-log.md` writer | Implementer appends per-PR | Orchestrator appends post-barrier | **B** — A guarantees merge conflicts under `parallel_max > 1` (issue #224 class) |
| `decision-log.md` location | `documentation/decisions/` | `documentation/reference/` | **B** — `decisions/` is ADR-only in both tools' conventions |
| Active Constraints trigger | ADR acceptance only | ADR acceptance **+ mandatory** analyze seeding | **Both** — A alone is unreachable on Quick-track-only repos |
| Autonomy scope | Flip master switch only | Flip master **+ pin sub-flags** | **B** — A silently enables brainstorm terminal-closure semantics |
| Read path | Design it here | Future Work, 3 prerequisites | **Future Work** — 3 critics found all evaluated designs unsound |

## Refactoring Impact

### Changed Interfaces

| Component | Change type | Consumers (grep-identified) | Impact |
|---|---|---|---|
| `doc-governance.md` precedence rule | Scope extension | `planner.md:176`; `reviewer.md:111`; `SKILL.md:126`; `artifact-contract.md:15` | **DEPRECATION** — consumers assuming a fixed 5-column schema must consult detection |
| `coordinator.md` blocked-note set + `queue-dag.md` enum | Additive value | `coordinator.md:185`; `phase-plan.md` | **TRANSPARENT** — repairs an existing mismatch; no consumer loses a value |
| `planner.md` §4.8 | New third branch | `phase-plan.md:43`; `orchestrator.md` Design Autonomy Dispatch | **TRANSPARENT** — `ready`/`blocked` contracts unchanged; the branch is additive |
| `orchestrator.md` re-spawn | New directive | `planner.md` track-directive handling | **TRANSPARENT** — follows the existing explicit-directive convention |
| `implementer.md` worker JSON | New `decision_records[]` field | `worker-schemas.md`; `scripts/validate-worker-json.ts` | **DEPRECATION** — schema gains an optional field; validator must accept it |
| `ARCHITECTURE.md` § Active Constraints | First-ever writer | `reviewer.md:110` (V-ADA-01, presence-only) | **TRANSPARENT** — presence check unaffected by content |
| `autonomy.enabled` default | Value change | `planner.md:106,169` (design) | **BREAKING (behavioural)** — design gate stops blocking |
| `autonomy.enabled` default | Value change | `phase-handle.md:70`, `router.md:68`, `queue-dag.md:82` (analyze) | **BREAKING (behavioural)** — `needs_analysis` dispatch activates |
| `autonomy.brainstorm_routing` default | Value change `true → false` | `orchestrator.md:157` (brainstorm) | **BREAKING (behavioural)** — pinned off; prevents terminal-closure activation that flipping the master alone would have caused |

**3 BREAKING (behavioural, all E5). 2 DEPRECATION. 4 TRANSPARENT.**

### Migration Plan

1. **`doc-governance.md` precedence → 3 surfaces** — Consumers: `planner.md:176`,
   `reviewer.md:111`, `SKILL.md:126`, `artifact-contract.md:15`. Order: rule, then emitters,
   then auditor — so the auditor never rejects a correctly-adapted row. Rollback: detection
   defaults to blackhole's schema, which is today's behaviour.
2. **E2's three edits** — Order: note repair (coordinator + queue-dag enum) **first**, since
   §4.8's third branch is unreachable without it; then the directive; then the branch.
   Rollback: the branch is additive — removing it restores today's binary.
3. **E4** — `worker-schemas.md` + `validate-worker-json.ts` accept `decision_records[]`
   before the implementer emits it. Rollback: field is optional; orchestrator skips when absent.
4. **E5 (all 3 BREAKING)** — lands **alone, last**, after ADR-011 and E1–E4 merge and one
   green campaign. Rollback: `autonomy.enabled: false` restores current behaviour exactly.
   Announce in release notes: campaigns will stop pausing at design gates and will begin
   dispatching `needs_analysis` routes.

### Migration Strategy

- **Phased migration needed**: **Yes** — 9 changed interfaces across 4 phases (E1 / E2 / E4 /
  E5-alone) exceeds the >5 threshold.
- **Backward compatibility period**: E1's detection defaults to blackhole's schema
  indefinitely; `decision_records[]` is optional; `decision-log.md` is additive. No sunset.
- **Feature flag recommended**: **Yes for E5** — `autonomy.enabled` already *is* that flag;
  this is a default change, not a new flag.

## Risk Assessment

| ID | Risk | Impact | Mitigation |
|---|---|---|---|
| R1 | "Cross-cutting non-negotiable" (E3) is a judgement call with no mechanical test | Medium | Reviewer flags obviously-local constraints as `V-INT-01`; section is small and human-prunable |
| R2 | A polluted Active Constraints section would degrade every future read-path consumer | High | Read path is Future Work — no consumer exists until the section is observed in practice. Prune before injecting |
| R3 | On a Quick-track-only repo, Trigger A never fires | Medium | Trigger B (analyze seeding) is **mandatory**, not optional |
| R4 | `decision-log.md` grows unbounded | Low | Rotation above 500 rows to `_archive/` |
| R5 | E5 enables three routes at once, incl. brainstorm terminal-closure | High | `brainstorm_routing` pinned **`false`**; the other two disclosed as BREAKING; E5 lands alone with single-value rollback |
| R6 | Schema detection misfires on a malformed INDEX header | Low | Fall back to blackhole's schema; emit `V-INT-01` WARN so it is visible |
| R7 | E2 promotes an ADR the user did not intend as an ADR | Low | Promotion fires only on the explicit design-track path and is reviewable in the PR before merge |
| R8 | `decision-log.md` write contention under `parallel_max > 1` | High → mitigated | Orchestrator is sole writer, serial post-barrier append (E4) — the per-PR-branch model that would cause this was explicitly rejected |
| R9 | E2's note repair misses another consumer of the notes enum | Medium | `phase-plan.md`, `coordinator.md`, `queue-dag.md` are the three known consumers; grep the enum before landing |

## Key assumptions

| Marker | Assumption |
|---|---|
| ✓ Validated | INDEX schemas diverge — `companion-file-sync.md:45` vs `decisions/INDEX.md:3` |
| ✓ Validated | ADR frontmatter schemas diverge — mercure `templates/adr-template.md` vs blackhole ADR-008 |
| ✓ Validated | Human-approved designs are not promoted — `planner.md` §4.8 `blocked` branch |
| ✓ Validated | Nothing populates `## Active Constraints` — zero writers in `src/`, `scripts/`, `templates/` |
| ✓ Validated | `autonomy.enabled` is a master switch over sub-flags already defaulting true — `config-template.md:25,66,69,70,71` |
| ✓ Validated | Brainstorm routing is terminal — ADR-010 D3, `orchestrator.md:157` |
| ✓ Validated | `findings-ledger.json` is gitignored by design — `blackhole-state.md:35-38` |
| ✗ → corrected | *Previously assumed*: the coordinator resumption path already works for design-track blocks. **False** — `phase-plan.md` sets `awaiting-design-approval`, which `coordinator.md:185` and `queue-dag.md:39` do not recognize. E2.1 repairs it; this ADR no longer depends on the unverified claim |
| ✗ → corrected | *Previously assumed*: flipping `autonomy.enabled` affects only the design track. **False** — it gates three routes (Finding 6). E5 now pins sub-flags explicitly |
| ~ Contestable | ADR acceptance is the right primary trigger for E3. Alternative: a periodic synthesis pass |
| ~ Contestable | One append-only log beats per-decision files. Chosen for `V-DOC-GOV-01`; revisit if rows outpace rotation |
| ⚡ Oversimplified | E5 assumes "quality gates landed" is binary. ADR-011's grep-cost risk may need a campaign of tuning before autonomy is safe to flip |

## Implementation Order

1. **E1** — `doc-governance.md` precedence, then its 4 consumers *(foundation)*
2. **E2.1** — note repair: `coordinator.md` + `queue-dag.md` enum *(unblocks E2.2/E2.3)*
3. **E2.3 → E2.2** — orchestrator directive, then `planner.md` §4.8 third branch *(depends on E1, E2.1)*
4. **E3** — Active Constraints triggers A and B *(depends on E2)*
5. **E4** — `decision_records[]` schema + validator, implementer emission, orchestrator append,
   `reference/decision-log.md` + frontmatter, `reviewer.md` §10 audit *(independent of E1–E3)*
6. **E5** — `autonomy` defaults, **alone, last** *(depends on ADR-011 D1/D2 + E1–E4 merged +
   one green campaign — R5)*

## Consequences

**Positive**

- Design decisions stop dying in gitignored files, on a path that now actually reaches them.
- Implementation decisions become greppable by future workers — the memory the goal requires.
- Co-existence with mercure becomes real at both artifact layers.
- Blackhole stops interrupting on design gates it can decide, without silently acquiring
  terminal-closure behaviour.
- A latent bug (Finding 3b) is fixed as a side effect of designing on verified ground.

**Negative**

- One new tracked file and its rotation policy.
- E3's judgement call needs human pruning early (R1); a polluted section would degrade the
  future read path (R2).
- E5 is behaviourally breaking on three routes; two are enabled deliberately, one is pinned off.
- The ADR corpus and Active Constraints remain **unreachable to workers** until the read
  path's prerequisites are met. This ADR makes knowledge durable, not yet consumed.

**Metric qualification**

*"`## Active Constraints` non-empty and accurate after N issues"* holds **only** where
Trigger A or B has fired — at least one promoted ADR or one `analyze` note. On a repo whose
issues all route to Quick track with no analysis pass, the section legitimately stays empty
and the metric does not apply.
