---
type: analysis
status: current
review_trigger: on protocol change
created: 2026-07-10
last_updated: 2026-07-10
related:
  - documentation/decisions/INDEX.md
  - src/references/blackhole-vcodes.md
---

# Mercure → Blackhole Companion-File & Documentation-Governance Gap Analysis

Deep comparison of the mercure plugin's companion-file lifecycle (V-ADA) and
documentation-governance (V-DOC-GOV) machinery against blackhole's five-phase
campaign, with an adoption backlog that preserves blackhole's autonomous
philosophy (advisory-by-default, findings-ledger-driven, AskQuestion only for
genuine product/design decisions).

## Headline finding

**Blackhole dogfoods companion-file discipline on itself but grants none of it
to the consumer repos it runs campaigns on.** The repo root carries
`ARCHITECTURE.md`, `AGENTS.md`, `CLAUDE.md`, and a governed `documentation/`
tree with frontmatter and a `decisions/INDEX.md` in the canonical row format —
yet the campaign lifecycle never creates, audits, or maintains any of those
artifacts in a target repo. The single clearest defect: **`V-DOC-02/04` is
listed as BLOCK in `src/references/blackhole-vcodes.md` but is audited
nowhere** — no phase playbook, planner section, or reviewer checklist ever
checks it.

## Gap matrix

| # | Mercure mechanism | Blackhole today | Gap | Adoption cost |
|---|-------------------|-----------------|-----|---------------|
| 1 | V-DOC-02/04 enforcement (API/design docs updated in same PR) | Table row only — zero enforcement | **Stub V-code** | Low — reviewer checklist §9 + phase-review extension |
| 2 | V-ADA-01..08 companion-file lifecycle (ARCHITECTURE.md, DESIGN.md, AGENTS.md, decisions/INDEX.md currency) | Nothing for consumer repos | **Absent family** | Medium — new V-code family + reviewer audit section |
| 3 | Frontend/monorepo detection scripts (<500ms, read-only, exit-0 contract) | None | Absent | Low — port two bash scripts |
| 4 | Plan-time docs awareness (x-plan reads `## Active Constraints`; plans declare doc impact) | Plan template has no docs section | **Docs never planned** | Low — `## Documentation Impact` section in planner template |
| 5 | Route-level classification (`needs_docs` analog: mercure fires V-ADA per diff heuristics) | Router `route{}` has no docs flag | Absent | Medium — new flag + orchestrator dispatch (exact precedent: `security_review_required`) |
| 6 | Doc governance: search-before-write, canonical slug filenames, frontmatter, supersede-on-overwrite (V-DOC-GOV-01..04) | Campaign writes `plans/<issue>.md` (fits convention) but discovery issues/reports have no dedup or lifecycle rules | Partial | Medium — behavioral rule + reviewer audit |
| 7 | INDEX.md as skill-maintained ledger (upsert-on-write) | Repo has `decisions/INDEX.md` for itself; campaign maintains none for consumers | Partial | Low-Medium |
| 8 | Companion-file templates + idempotent create-from-template (x-setup) | No templates dir for consumer artifacts | Absent | Medium |
| 9 | `migrate` bootstrap (dry-run-first, per-phase gated, never-delete) | No adoption path for messy consumer repos | Absent | High — defer |
| 10 | Static verify check + read-only audit surface | `verify.ts` V-DESIGN-01 pattern + `campaign-audit` F-codes exist as ready templates | Wiring only | Low |

## Design principles for adoption (autonomy-preserving)

1. **Config-gated, advisory-by-default.** New behavior behind a
   `docs_governance` config block following the `adaptive_routing` kill-switch
   pattern; absent field = current behavior (zero regression).
2. **Findings-ledger-driven, non-interactive.** Docs drift → WARN finding or
   auto-filed follow-up issue via the existing Pareto ≥ 30 discovery path —
   never a mid-loop AskQuestion. Reserve AskQuestion for genuine product
   decisions (e.g. "adopt DESIGN.md token governance for this repo?" at
   bootstrap).
3. **One awareness rule + one anchor (ADR-074 "Approach W").** A single
   behavioral rule restated to workers; procedural gates live in exactly one
   place (reviewer audit), not duplicated per phase.
4. **Reuse the route-flag machinery.** `docs_impact` flag with confidence
   score, consumed by orchestrator dispatch exactly like
   `security_review_required` → security-mode review.
5. **Read/write split preserved.** Reviewer (read-only) reports V-ADA/V-DOC
   findings; implementer/planner (write-capable) perform remedies inside
   touch-paths.
6. **UNTRUSTED guard.** Consumer AGENTS.md/ARCHITECTURE.md bodies ingested
   into prompts are display-only data (same treatment as
   `<UNTRUSTED-FORGE-DATA>`).

## Proposed adoption backlog

Pareto scoring per V-PARETO-02: `Priority = Gain × (11 − Effort)`, threshold ≥ 30.

| ID | Title | Gain | Effort | Priority | Size | Depends on |
|----|-------|------|--------|----------|------|-----------|
| B1 | Add `docs_governance` config block (kill switch, advisory default) | 6 | 2 | 54 | xs | — |
| B2 | Wire V-DOC-02/04 into reviewer audit + phase-review checklist | 8 | 3 | 64 | s | — |
| B3 | Implementer standard-mode companion-file sync (update affected docs within touch-paths) | 7 | 3 | 56 | s | B2 |
| B4 | Planner `## Documentation Impact` plan section | 6 | 2 | 54 | s | B1 |
| B5 | V-ADA companion-file V-code family + reviewer §9 audit (ARCHITECTURE.md presence, decisions/INDEX.md currency, AGENTS.md, conditional DESIGN.md) | 7 | 4 | 49 | m | B1, B2 |
| B6 | Router `docs_impact` route flag + orchestrator dispatch + queue-dag schema | 7 | 4 | 49 | m | B1 |
| B7 | Doc-governance rules for campaign writes on consumer repos (search-before-write, canonical slugs, frontmatter, supersede-on-overwrite) | 7 | 5 | 42 | m | B1 |
| B8 | Companion-file templates + idempotent bootstrap scaffold (create-from-template at Phase 0 / docs-init execution mode) | 6 | 5 | 36 | m | B5 |
| B9 | Port detect-frontend.sh / detect-monorepo.sh (exit-0 contract) | 4 | 2 | 36 | xs | — |
| B10 | verify.ts static check + `campaign-audit` F-DOCS-01 | 4 | 2 | 36 | xs | B5 |

Deferred (below threshold or premature): full `migrate` normalization mode
(high effort; revisit after B7 ships), `x-docs`-style compact/cleanup modes,
DESIGN.md token staleness tracking (V-ADA-04 analog — needs frontend consumer
repos to justify).

## Extension points (from source mapping)

Wiring sites identified in blackhole `src/` (file references verified
2026-07-10): `src/references/blackhole-vcodes.md` (V-code table),
`src/agents/reviewer.md` §8/§9, `src/agents/planner.md` plan output template,
`src/references/phase-review.md` audit checklist extensions,
`src/agents/router.md` route{} + `src/references/queue-dag.md` schema,
`src/agents/orchestrator.md` route-derived dispatch,
`src/references/config-template.md`, `src/references/phase-implement.md`
execution modes, `scripts/verify.ts` (V-DESIGN-01 pattern),
`src/SKILL.md` campaign-audit F-codes.

## Campaign outcome (2026-07-10)

All ten backlog items were implemented, reviewed, and merged the same day by
the blackhole campaign itself, plus two review-discovery follow-ups. Every PR
was approved by an independent reviewer with quoted verification evidence;
V-code findings across all twelve reviews: one MEDIUM (V-DOC-01, became
issue #193, resolved), two ledgered non-blocking items (F-00001..F-00003, all
resolved or closed). Main after the campaign: 276 tests pass, `bun run verify`
20/20 (up from 267 tests / 19 checks — the campaign added its own 20th check).

| Backlog | Issue | PR | Outcome |
|---------|-------|-----|---------|
| B1 config kill switch | #171 | #182 | `docs_governance` block, advisory defaults |
| B2 V-DOC-02/04 wiring | #172 | #183 | Reviewer §9 audit; pipeline proven vcode-agnostic |
| B3 implementer doc sync | #174 | #184 | Step-6 companion-doc-sync bullet, touch-path bounded |
| B4 plan template section | #175 | #185 | `## Documentation Impact`, config-gated |
| B5 V-ADA family | #176 | #186 | V-ADA-01/02/03/05-06-07 rows (all WARN) + reviewer §10 |
| B6 docs_impact route flag | #177 | #187 | Full security_review_required-precedent mirror |
| B7 write governance | #178 | #189 | `doc-governance.md` rule + V-DOC-GOV-01..04 (WARN) |
| B8 templates + scaffold | #179 | #192 | 5 templates + idempotent Phase 0 scaffold step |
| B9 detection scripts | #173 | #181 | detect-frontend/monorepo, exit-0 contract, 4–8ms |
| B10 verify + F-DOCS-01 | #180 | #188 | 20th verify check + campaign-audit F-code |
| Discovery (R4, F-00001) | #190 | #191 | Stale config phrasing → live-consumer citations |
| Review finding (F-00003) | #193 | #194 | companion_files row cites both consumers |

Deferred by design (below Pareto ≥30 or premature): `migrate` normalization
mode, compact/cleanup modes, DESIGN.md token staleness (V-ADA-04 analog), and
a templates tree-shape verify check (F-00002, Pareto 27 — ledgered, no issue).

## Sources

- Exploration reports: mercure companion-file inventory (V-ADA/V-DOC-GOV/ADR
  055/068/074/095) and blackhole architecture map, 2026-07-10, this session.
- Mercure SSOT files: `mercure-plugin/rules/mercure-companion-awareness.md`,
  `mercure-plugin/rules/mercure-doc-governance.md`,
  `mercure-plugin/rules/references/v-codes-ada.md`,
  `mercure-plugin/skills/x-implement/references/companion-file-sync.md`,
  `mercure-plugin/templates/companion-files/*`.
