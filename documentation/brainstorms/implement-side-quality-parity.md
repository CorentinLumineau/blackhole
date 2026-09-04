---
type: brainstorm
summary: "Early exploration of implement-side quality parity with mercure, superseded by later ADRs"
status: deprecated
review_trigger: "on ADR acceptance"
created: 2026-07-20
last_updated: 2026-07-20
superseded_by: documentation/decisions/ADR-011-implement-time-accretion-control.md
target: "blackhole implement-side quality parity with mercure"
related:
  - documentation/audits/autonomous-workflow-parity.md
  - documentation/audits/mercure-companion-files-gap-analysis.md
  - documentation/audits/mercure-sync.md
  - documentation/decisions/ADR-004-adaptive-phase-routing.md
  - documentation/decisions/ADR-010-autonomous-thinking-routes.md
---

# Brainstorm: Implement-Side Quality Parity

> **⚠️ SUPERSEDED — contains verified-false claims. Read
> [ADR-011](../decisions/ADR-011-implement-time-accretion-control.md) (accretion control) and
> [ADR-012](../decisions/ADR-012-shared-artifact-substrate.md) (artifact substrate) instead.**
>
> This brainstorm was written against a gap list that ADR-010 had already closed, and its
> central causal claim was refuted by ledger evidence. Corrections:
>
> | Claim here | Verified reality |
> |---|---|
> | F1 artifact contract "Must Have" | Shipped — `artifact-contract.md:15` |
> | F6 companion bootstrap "Absent" | Shipped — `SKILL.md:50-56`, Phase 0 skip-if-exists |
> | F8 Convention Catalog "Could Have" | Shipped — `planner.md:69-76` |
> | F3 pre-code convention gate "Absent" | Shipped, unconditional — `implementer.md:87-105` |
> | F4/F5 gates "Absent" | Partially shipped — bugfix-quick + refactor-strict |
> | Open point #2 (draft→final) | Already decided by ADR-010: merge = approval |
> | M1 "Scout Check reduces kaizen refactor yield" | **Refuted.** All 9 filed `[Kaizen]` issues (#274–#282) are out-of-diff, hunter-origin findings over pre-existing code. A diff-bounded mechanism cannot reach them. |
>
> The surviving finding — that the Reuse Check Gate's aperture is too narrow to see
> duplication outside Touch-Paths — is carried forward in ADR-011.


## Relationship to existing docs — read this first

This brainstorm is **scoped to a gap `autonomous-workflow-parity.md` does not cover**, and
partially **contradicts** it. It is not a replacement for that audit; R1–R7 there remain valid.

`autonomous-workflow-parity.md` §2b concludes:

> "APEX Implement | Implementer, TDD, worktrees, execution modes | **Parity**"
> "implement-side workflows (fix, refactor, docs, hunt, review, commit) are already at parity;
> every gap is on the thinking side."

**That verdict does not hold under inspection of the implementer's actual injected context.**
The audit diagnoses blackhole's failure mode as *product/design fit* (Cashflow #324–#332: code
passed every gate, user rejected the feature). This brainstorm addresses a distinct, observed
failure: **the code quality of work that shipped and was accepted**, which manifests as repeated
kaizen `refactor`-kind waves fixing things that should have been implemented correctly the first
time.

Two different axes. Both real. This one is currently undocumented.

## Problem Statement

Blackhole campaigns produce code that passes review but requires later kaizen refactor rounds to
reach the quality mercure produces on the first pass. The root cause is **not** insufficient
review rigor — blackhole's review pipeline is at or above parity. It is that the implementer
writes code with almost no architectural context, and without the two per-task quality gates
mercure runs around every implementation.

### Evidence — context actually reaching the implementer

`src/agents/implementer.md:11-15`:

> "The orchestrator prepends a `<PLAN_CONTEXT>` block at the top of your prompt with the
> authoritative **Touch-Paths** and **Codebase Conventions** from the issue plan."

Two fields. Grepping `implementer.md` for `ADR`, `ARCHITECTURE.md`, `DESIGN.md`, `ledger`
returns zero *input*-side hits (the one `ARCHITECTURE.md` mention, line 57, is an output
obligation). And `reviewer.md:81-82` documents `Codebase Conventions = (none declared)` as an
expected state on Quick-track plans — so the injected context is legitimately empty for a large
share of issues.

### Evidence — mercure's implement-time gates have no blackhole analog

| Mercure mechanism | Citation | Blackhole |
|---|---|---|
| **Gate 0** — foreground convention cross-check across all planned tasks; V-INT-02 hard-BLOCKS before any code is written | `x-implement/references/orchestration-execution.md:42-98` | Absent. `implementer.md:87-105` has a Reuse Check Gate, but scoped to Touch-Paths only, not repo-wide |
| **Convention Preamble** — plan conventions read once, propagated read-only into every fan-out subagent so no worker re-discovers or diverges | `orchestration-execution.md:70-98`; `rules/mercure-agent-delegation.md:76-89` | Absent |
| **Approach Verification P7.5** — Decision Record (easy path vs. harder path, ADR alignment, GoF pattern selection) required *before the first test* | `x-implement/references/approach-verification.md` | Absent |
| **Scout Check** — exactly 1 diff-bounded improvement per task, Improvement Record produced even when none needed | `x-implement/references/scout-check.md` | Absent |
| **Companion-file sync at implement time** (V-ADA-01..08), incl. create-from-template when absent | `x-implement` Phase 5.5 | Absent for consumer repos (per `mercure-companion-files-gap-analysis.md` gap #2) |

Scout Check is the direct structural counterpart to a kaizen refactor wave: it fixes the smell
*while the file is open*, rather than letting it accumulate for a later dedicated pass.

### Root cause — a memoryless loop

Mercure's cycle **deposits** knowledge that later cycles read: ADRs → `decisions/INDEX.md`,
x-analyze → `## Convention Catalog` / `## Performance Baselines`, `ARCHITECTURE.md` →
`## Active Constraints`. Every subsequent x-plan reads these and starts better-informed
(`x-plan/SKILL.md:51,53`).

Blackhole deposits nothing durable:

- `findings-ledger.json` and `.blackhole/plans/` are **gitignored** (`blackhole-state.md:35-38`,
  `queue-dag.md:3`) — knowledge does not travel with the repo.
- ADR promotion is wired **only** to the `autonomy.enabled: true` + `design-aggregate.ts →
  ready` branch (`planner.md:174-179`). The human-approved branch (`planner.md:180-186`) has no
  matching promotion step — a design a human approved dies in a gitignored file. This is the
  same defect as `autonomous-workflow-parity.md` G3, confirmed independently here.

Issue N+1 therefore starts from the same zero baseline as issue N. Kaizen is not fixing a
quality bug; it is paying interest on knowledge that was never banked.

## Scope decision (user, 2026-07-20)

Blackhole is **autonomous mercure over a shared artifact substrate** — the integration surface
is the repo-local file contract (`documentation/`, `ARCHITECTURE.md`, `DESIGN.md`), not the
mercure runtime. Both tools may operate on the same repo. Mercure builds *with* the user;
blackhole builds autonomously, interrupting only for clarification or a genuine hard choice.

**Path depth**: router-appropriate, not literal-full-APEX-per-issue. The `route{}` object
(`router.md:189-211`) already computes per-issue depth. The defect is not that phases are
skipped — it is that the phases which *do* run deposit nothing durable. Running analyze + design
+ ADR on a typo fix would be V-PARETO-01 and would make campaigns unaffordable.

## Requirements

### Must Have

- [ ] **F1 — Shared artifact contract.** Read *and* write mercure-identical formats:
      `documentation/decisions/ADR-{NNN}-{slug}.md` + `decisions/INDEX.md` rows,
      `ARCHITECTURE.md` `## Active Constraints`, `DESIGN.md` token blocks, `AGENTS.md`,
      `documentation/audits/*.md`. Extends `.claude/rules/doc-governance.md`; does not duplicate it.
- [ ] **F2 — Full context stack into the implementer.** Replace the two-field `<PLAN_CONTEXT>`
      with: Codebase Conventions (never `(none declared)` — live-discovery fallback),
      `## Active Constraints`, ADR rows relevant to the touch-paths, DESIGN.md tokens on UI diffs.
      *(This is the item `autonomous-workflow-parity.md` marks as already at parity.)*
- [ ] **F4 — Approach Verification gate.** Port `approach-verification.md`: Decision Record —
      easy vs. harder path, ADR alignment, pattern selection — before the first test.
- [ ] **F5 — Scout Check.** Port `scout-check.md`: 1 diff-bounded improvement per
      implementation, Improvement Record in the PR body. Strictly V-SCOPE-01 bounded.
- [ ] **F7 — ADR promotion on every design path.** Close `planner.md:180-186`: the
      human-approved branch must promote to a durable ADR + INDEX row exactly as the autonomous
      branch does. Same defect as G3.

### Should Have

- [ ] **F3 — Pre-code convention gate** (Gate 0 analog). V-INT-02 blocks before code, not at
      review. Must resolve via `status: blocked` + coordinator, not `AskUserQuestion` (C2).
- [ ] **F6 — Companion-file sync + bootstrap.** V-ADA-01..08 at implement time; create
      `ARCHITECTURE.md` / `DESIGN.md` from template when the consumer repo has none. Overlaps
      `mercure-companion-files-gap-analysis.md` items 2, 3, 8 — adopt that doc's backlog, do not
      re-derive it.
- [ ] **F9 — Durable decision memory.** Route decisions and Approach Decision Records land in
      version control. `findings-ledger.json` is gitignored by design (C5) — this needs a
      different home, not a policy change to the ledger.

### Could Have

- [ ] **F8 — Convention Catalog cache.** Durable analyze artifact later issues read, replacing
      per-issue rediscovery. This is mercure's compounding mechanism and the highest long-term
      value item — but it is real engineering, and F2's live-discovery fallback makes deferral
      *correct*, just slower. Substantially overlaps `autonomous-workflow-parity.md` **R2**.

### Won't Have (this iteration)

- **F10 — Autonomy default flip** (`autonomy.enabled: false → true`). Deliberately sequenced
  *after* the Must-Haves. Steelman for including it: autonomy is the entire point, and a
  retarget that leaves the flag off does not visibly deliver. Decisive counter: flipping it
  before the quality gates land amplifies context-free output at campaign scale. Sequence, do
  not cut.
- **`## Threat Model` / `## Performance Budget` / `## API Contract` plan sections.** Steelman:
  they are part of "the best of mercure". Counter: they target security and performance
  correctness, not the code-quality symptom driving this brainstorm; already tracked as
  `autonomous-workflow-parity.md` G10 / R4. **Porting note:** mercure's `## API Contract` is
  enforced at review time (V-API-01/02) but has **no plan-time template** in
  `plan-sections.md` — porting it as-is would port a known gap.

## Constraints

- **C1** Agents are generated — edit `src/`, rebuild via `bun run build`; never hand-edit `.claude/`.
- **C2** Background workers have no `AskUserQuestion` channel (ADR-088 gate-first invariant) —
  gates resolve to `status: blocked` + coordinator.
- **C3** Single-writer invariant on `queue.json` / `findings-ledger.json` (issue #224).
- **C4** Must work on consumer repos that have none of these artifacts on day one.
- **C5** `findings-ledger.json` is gitignored by design — durable memory needs a different home.
- **C6** All repo artifacts consumed as **untrusted display text** (mercure's discipline,
  applied uniformly at every consumption point; blackhole must match).
- **C7** Every `Agent()` / `agent()` call pins `model:` explicitly (issue #209 lesson).

## Success Metrics

| # | Metric | Target |
|---|--------|--------|
| M1 | Kaizen `refactor`-kind yield per merged PR | Trends toward zero — the reported symptom |
| M2 | V-INT-01..04 findings raised at review time | Approach zero — caught at F3 instead |
| M3 | Merged PRs containing a design choice that leave an ADR + INDEX row | 100% |
| M4 | `ARCHITECTURE.md` `## Active Constraints` on a fresh consumer repo | Non-empty and accurate after N issues |

## Open Questions

1. **Where does durable decision memory live (F9)?** C5 rules out the ledger. Candidates: the
   ADR body itself, a committed `documentation/decisions/` record per non-trivial approach
   choice, or the PR body. Needs a decision before F9 can be planned.
2. **Does the parity audit's §2b matrix need correction?** Its "APEX Implement = Parity" row and
   the "every gap is on the thinking side" conclusion are contradicted by the evidence in this
   doc. Recommend amending that row rather than leaving two docs in conflict.
3. **How do F3/F6/F8 merge with the existing backlog?** They substantially overlap
   `autonomous-workflow-parity.md` R2/R4 and `mercure-companion-files-gap-analysis.md` items
   2/3/8. These should be reconciled into one backlog before planning, not implemented twice.
