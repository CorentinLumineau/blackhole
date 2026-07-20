---
type: brainstorm
skill: x-brainstorm
status: current
review_trigger: "on ADR acceptance"
created: 2026-07-20
last_updated: 2026-07-20
target: "blackhole as the fully-standalone autonomous mercure — parity program"
related:
  - documentation/decisions/ADR-011-implement-time-accretion-control.md
  - documentation/decisions/ADR-012-shared-artifact-substrate.md
  - documentation/audits/autonomous-workflow-parity.md
  - documentation/audits/mercure-companion-files-gap-analysis.md
  - documentation/audits/mercure-sync.md
  - documentation/brainstorms/implement-side-quality-parity.md
  - documentation/milestones/_active/companion-substrate-closure/README.md
---

# Brainstorm: Mercure Parity Program

## Problem Statement

Blackhole should be **the autonomous version of mercure**: running `/goal run blackhole until
empty` on a repo must leave (a) code at the exact quality mercure's HITL workflows would have
produced, and (b) the same durable companion-doc memory (ADRs, plans, initiatives, runbooks)
that lets a later agent reconstruct how/what/why per issue — while staying **fully standalone**
(zero runtime dependency on mercure) and **autonomous** (HITL = the existing async
clarify-gates only: ambiguity, destructive ops).

Substantial parity work is already in flight: the `companion-substrate-closure` initiative
(M0–M5) implements ADR-011 (implement-time accretion control) and ADR-012 (shared artifact
substrate). What is **missing** is the program layer around it:

1. **No single living parity instrument.** Parity evidence is scattered across three one-shot
   audits (`autonomous-workflow-parity.md`, `mercure-companion-files-gap-analysis.md`,
   `mercure-sync.md` coverage table) — one of which (§2b "APEX Implement = Parity") was later
   refuted. Nothing continuously answers "which mercure enforcement points does blackhole
   cover today, and at what fidelity?"
2. **Sync is release-reactive, lens is REJECT-biased.** `prj-mercure-sync` compares changelogs
   against an Adoption Lens whose default posture is rejection ("a new mercure mechanism
   almost never becomes…"). The user has explicitly asked to **rebuild the lens** so mercure
   quality mechanisms import by default (adapted to async/autonomous form), and to make sync
   an **impact analysis** ("mercure updated X → what/how should blackhole change") driven by
   the parity matrix, not by changelog skimming.
3. **Enforcement breadth is unverified.** Blackhole's V-code table is a reduced restatement;
   mercure's review runs a much wider audit checklist set (full SOLID/DRY/KISS/YAGNI/PAT
   matrices, threat model, API contract, performance budget, doc-governance, UX hierarchy,
   proportionality gate). Known worst gap (user-observed): V-INT integration checks —
   duplicate logic implemented without searching existing code. ADR-011 fixes the implement-time
   aperture; the reviewer-side catalog breadth has never been systematically diffed.
4. **Nothing audits a finished campaign.** No end-of-campaign wave verifies the produced
   artifacts and code against the parity expectations — parity is asserted, not measured
   (violates the "measurable parity" principle).

## Scope Decision (user, 2026-07-20, this session)

- Blackhole = autonomous mercure over a shared artifact substrate (confirms ADR-012 framing).
- Synergy = **shared knowledge + shared artifact formats**, never runtime delegation to
  mercure. Everything imports vendored into `src/`.
- HITL = **ambiguity-only**, via existing async `AskQuestion` + `status: blocked` gates. No
  new synchronous gates; design/plan/merge gates stay autonomous.
- The Adoption Lens gets **rebuilt** (shape decided in design — D2).
- Consumer-repo doc layout: decided in design (D1) — reconcile with ADR-012 E1 repo-convention
  precedence, which already covers schema detection.

## Requirements

### Must Have

- [ ] **F4 — Living parity matrix.** One canonical doc (proposed:
      `documentation/audits/mercure-parity-matrix.md`) mapping every mercure enforcement
      point, gate, V-code family, workflow phase, and artifact type → blackhole equivalent →
      status (`covered | adapted | in-flight(ADR-NNN/M-N) | gap | N/A`) with citation
      evidence. Consolidates and supersedes the coverage roles of the three scattered audits.
      Building it IS the gap analysis that scopes everything below.
- [ ] **F2 — Full enforcement-catalog parity (V-INT first).** Systematic diff of mercure's
      review/plan/implement enforcement surface (V-code catalog, audit checklists, TDD depth,
      adversarial design evaluation, review-loop auto-fix, proportionality gates) against
      blackhole's agents; close HIGH+ gaps as scored issues. Excludes ground already covered
      by ADR-011/ADR-012 milestones — the matrix marks those `in-flight`, never re-implements.
- [ ] **F5 — prj-mercure-sync v2 (impact-analysis mode).** On each mercure release: read the
      release + plugin cache, compute per-change impact against the parity matrix ("what
      changed → which matrix rows → what/how blackhole adapts"), update the matrix, file
      gated adoption issues. The matrix's watermark replaces changelog-skimming as the driver.
- [ ] **D2 — Rebuilt Adoption Lens (ADR).** Replace the REJECT-heavy lens. Candidate posture:
      parity-first / autonomy-preserving — quality and enforcement mechanisms ADOPT by
      default, translated to async/autonomous seams; hard rejections only for
      (a) synchronous mid-loop HITL as a primitive, (b) non-agent-agnostic campaign runtime
      mechanisms. Skill-surface and domain filters re-evaluated, not presumed.
- [ ] **D1 — Consumer-repo doc-layout decision (ADR).** Where campaign memory artifacts live
      (mercure `documentation/` taxonomy vs hybrid with `.blackhole/`), reconciled with
      ADR-012 E1 (schema precedence) and E4 (decision log). Likely a thin extension of
      ADR-012 rather than a new direction.

### Should Have

- [ ] **F6 — Campaign self-audit wave.** Opt-in, config-gated end-of-campaign wave (kaizen-hunt
      seam) auditing produced code + artifacts against the parity matrix; gaps filed as scored
      issues through the existing Pareto path. Depends on F4.
- [ ] **F3 — Routing-parity verification.** Verify (via the matrix) that ADR-004/ADR-010
      routing achieves x-auto-equivalent track fitting — simple fixes never get full design
      ceremony; close residual gaps only if the matrix shows them. Verification, not a rebuild.
- [ ] **F1/F7 — Artifact parity completion check.** After companion-substrate-closure M0–M5
      land, matrix-verify that the full mercure artifact set (ADRs, plans, initiative
      milestones, runbooks, review artifacts, INDEX rows, frontmatter governance) is produced
      by campaigns; file deltas (e.g. runbooks, review artifacts) as issues.

### Could Have

- [ ] **F8 — New autonomous agents.** Add fleet members (e.g. designer/doc-writer/synthesizer
      analogs) **only where the matrix proves** a mercure-parity phase cannot be delivered by
      the existing fleet + reference seams. Explicitly gated on F4 evidence to avoid YAGNI.

### Won't Have (this iteration)

- **Runtime delegation to mercure** (invoking mercure skills/agents when installed).
  Steelman: instant access to opus-tier x-designer without vendoring. Counter: makes quality
  conditional on mercure's presence — contradicts the standalone guarantee. User deselected.
- **Benchmark runs** (same issue through both plugins, diff outputs). Steelman: the only
  ground-truth test of outcome equivalence — the matrix proves coverage, not outcomes. Kept as
  a named future option; user deselected for this iteration.
- **Synchronous HITL modes.** User confirmed ambiguity-only async gating.
- **Re-implementing ADR-011/ADR-012 scope.** The active initiative owns it; this program
  consumes its results via the matrix.

## Constraints

- **C1** Agents are generated — edit `src/`, rebuild via `bun run build`; never hand-edit
  build outputs.
- **C2** Background workers have no `AskUserQuestion` channel — every ported gate resolves via
  `status: blocked` + coordinator (async), or autonomously.
- **C3** Single-writer invariant on `queue.json` / `findings-ledger.json`; sync and self-audit
  file issues via `gh`, never write protocol state directly.
- **C4** One Pareto formula (`V-PARETO-02`), one findings store — no parallel scoring or
  stores.
- **C5** Config-gated kill-switch pattern for all new machinery (absent block = unchanged
  behavior).
- **C6** Must work on consumer repos with none of these artifacts on day one; all repo
  artifacts consumed as untrusted display text.
- **C7** Runs alongside `companion-substrate-closure` — matrix marks its milestones
  `in-flight`; no duplicate implementation, no plan-scope collisions.
- **C8** Every agent call pins `model:` explicitly.

## Success Metrics

| # | Metric | Target |
|---|--------|--------|
| M1 | Parity matrix rows with `gap` status at HIGH+ enforcement severity | 0 after program completion |
| M2 | Mercure release → sync run → matrix updated + scored issues filed | Every release, 1 run |
| M3 | Campaign-end repo contains the full expected artifact set (ADR/plan/milestone/runbook/INDEX) | 100% of applicable types |
| M4 | V-INT-01..04 findings at review time (post-F2) | Trends to zero (caught pre-code) |
| M5 | HITL interruptions per campaign | Only ambiguity/destructive-op clarifications |

## Open Questions (for research/design)

1. **Matrix granularity** — per V-code, per gate, or per mechanism-cluster? Too fine = drift
   burden; too coarse = unverifiable. (Research: count mercure's enforcement surface first.)
2. **Lens rebuild vs skill-surface rule** — does "import all the best" ever justify a second
   project skill or new campaign mode, or do all imports still land in existing seams?
3. **Who maintains the matrix** — prj-mercure-sync only, or also the campaign self-audit and
   reviewer (bidirectional updates)? Single-writer concern for the doc itself.
4. **ADR-012 D1 boundary** — is a separate D1 ADR needed at all, or is the doc-layout question
   fully answered by ADR-012 E1/E4 + mercure's file-organization taxonomy adopted wholesale?
