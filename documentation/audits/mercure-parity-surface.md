---
type: research
status: current
review_trigger: "on ADR acceptance"
created: 2026-07-20
last_updated: 2026-07-20
related:
  - documentation/brainstorms/mercure-parity-program.md
  - documentation/audits/autonomous-workflow-parity.md
  - documentation/audits/mercure-companion-files-gap-analysis.md
  - documentation/audits/mercure-sync.md
  - documentation/decisions/ADR-011-implement-time-accretion-control.md
  - documentation/decisions/ADR-012-shared-artifact-substrate.md
---

# Research: Mercure Parity Surface — Evidence Base

Evidence base for the Mercure Parity Program (`documentation/brainstorms/mercure-parity-program.md`).
Produced by three parallel read-only inventories: (A) mercure V-code/checklist surface, (B) mercure
workflow gates/artifacts/fleet, (C) blackhole coverage + in-flight scope. Mercure source:
`~/.claude/plugins/cache/mercure/mercure/9.6.1/`. Blackhole source: `src/` (canonical).

## Executive Summary

Mercure's enforcement surface is **96 distinct V-codes across 28 families**, wrapped in **21 named
audit checklists/gates**, **~18 implement-time gates**, an **8-check plan quality gate over 13 plan
sections**, a **3-wave 6-agent review pipeline**, a **13-folder artifact taxonomy** with lifecycle
frontmatter, and an **11-agent fleet**. Blackhole already restates ~47 of those V-code rows, adds 8
native codes (V-MERGE, V-HUNT, V-AUTO, V-SEC-08..10), and matches or exceeds mercure on several
implement/review mechanics; ADR-011/ADR-012 (in flight, M0–M5) close the implement-accretion and
artifact-substrate grounds. The **confirmed uncovered gaps** cluster in: threat/performance plan
machinery (no V-THREAT/V-PERF at all), spec-drift-at-merge, delivery-boundary hardening, ledger
durability across campaign generations, and **~65 mercure skill domains never swept** by any sync
run. Recommended matrix granularity: **mechanism-cluster rows (~70)**, not per-V-code (96, drift
burden) nor per-domain (too coarse to verify).

## 1. Mercure Enforcement Surface (inventory)

### 1a. V-codes: 96 codes / 28 families

Families and counts (source: `rules/references/v-codes-*.md`): V-SOLID 5, V-DRY 4, V-KISS 3,
V-YAGNI 3, V-PAT 4, V-PARETO 3, V-SEC 7, V-THREAT 3, V-TEST 9, V-INT 4, V-API 2, V-ARCH 2,
V-PERF 2, V-CONFIG 2, V-ASSET 3, V-BRANCH 4, V-WORKTREE 2, V-GIT 2, V-FIX 1, V-CHOICE 1,
V-SCOPE 3, V-EXT 2, V-CHAIN 1, V-DOC 4, V-DELEG 2, V-ADA 8, V-DOC-GOV 4, V-UX 6.
Non-V-code mechanisms layered around them: binding severity model (CRITICAL/HIGH→BLOCK,
MEDIUM→WARN, LOW→INFO), SSOT severity-override table (ADR-056: V-SOLID-04, V-TEST-05),
Suggestion Proportionality Gate + anti-rationalization tables, STOP Review Approval Hard Gate.

### 1b. Audit checklists (mercure-quality-audit-criteria.md): 21

Always-on (9): SOLID, DRY, Design Pattern, Security (V-SEC-01..07), Test Coverage, Pareto, KISS,
YAGNI, Spec Violation Severity. Plan-section-conditional (6): Threat Model (STRIDE), Blast-Radius,
API Contract, Architectural Coherence (rejected-ADR-approach), Performance Budget, Config
Convention. Diff-conditional (3): Integration Coherence (live-grep fallback when no plan),
Information Hierarchy (V-UX), Extension Tax, Doc Governance. Self-check hard gates (2):
Suggestion Proportionality, Review Approval STOP gate.

### 1c. Plan sections (x-plan/x-planner): 13 sections, 8-check quality gate

Always: Objective, Task Breakdown (acceptance criteria BLOCKING Std/Ent), Critical Files.
Conditional: Codebase Conventions (BLOCKING when touchpoints), Threat Model/STRIDE, Dependency
Blast-Radius, Performance Budget, Edge Cases, Agent-Asset Ripple, Quick Threat Check (Quick track),
Execution Strategy + Sprint Contract + Stop Conditions (Std/Ent). Plan production is centralized in
the x-planner agent (single producer for x-plan AND x-initiative — parity by construction), with
`plan_base_commit` drift stamping and `[NEEDS CLARIFICATION:]` markers (max 1/task, ≤3/plan).

### 1d. Implement-time gates (x-implement): ~18

Highlights: Plan Drift Check; Gate 0 foreground convention cross-check (V-INT-02 BLOCK before any
code); TDD Hard Gate; Approach Verification P7.5 (Decision Record before first test); Scout Check
(1 diff-bounded improvement, unconditional); Convention Verification step 8.5; quality gates
(lint/type/test/build + V-TEST-09 coverage regression); Enforcement Summary (any fail = stop);
Documentation Sync (BLOCK on doc drift); Companion File Sync Phase 5.5 (V-ADA/V-ASSET); Stop hook
requiring TDD evidence + enforcement table. Orchestration: parallel cap 4, retry-once-then-
sequential, Convention Preamble injected into every fan-out subagent.

### 1e. Review pipeline (x-review): 3 waves, 6 parallel dimensions

Wave 1 scope + diff boundary (pareto_score <40 suppressed); Wave 2 swarm: quality-gates (haiku),
tests/coverage/regression, code quality, security (OWASP + exploitability/adversarial gates), docs
audit (V-DOC + V-ADA), spec compliance (Sprint Contract + V-INT/THREAT/API/ARCH/PERF/SCOPE); Wave 3
x-synthesizer cross-correlation (dedup, severity promotion on multi-agent agreement, Pareto filter)
→ Spec Compliance Gate → Enforcement Hard Gate → readiness report to `documentation/reviews/`.

### 1f. Design/ADR machinery (x-design)

3 co-creation gates; trade-off matrix; **Adversarial Evaluation Protocol** (parallel x-architect
critics, one per approach, triggered when approaches score within 30%; findings classified
Discriminating vs Domain-inherent); design-principles validation; Refactoring Impact Analysis
(BREAKING/DEPRECATION/TRANSPARENT); Assumption Audit; ADR + INDEX row (V-ADA-02).

### 1g. Behavioral protocols

Verification Evidence 5-step gate; Hard Choice Protocol (Decision Records); Scout Protocol;
Task Tracking naming/cleanup; Workflow Protocol (named chains, approval gates).

### 1h. Artifact taxonomy: 13 folders + frontmatter governance

`documentation/{audits, investigations, plans, decisions, assessments, brainstorms, reviews,
reference, architecture, runbooks, milestones{_active,_archived}}` + `claudedocs/` (ephemeral,
exempt) + `_archive/`. Frontmatter: type/status/supersedes/review_trigger/created/last_updated/
related. Search-before-write, supersede-on-overwrite, INDEX.md upsert.

### 1i. Agent fleet: 11 agents

x-reviewer, x-tester, x-debugger, x-explorer, x-refactorer, x-doc-writer, x-deployer, x-designer
(opus), x-planner, x-architect, x-synthesizer — with mode/model matrix, escalation registry,
5-field delegation contract, read-only enforcement on reviewer/explorer/architect/synthesizer.

## 2. Blackhole Coverage (today + in-flight)

### 2a. Covered today (src/, canonical)

- **V-codes**: ~47 mercure-derived rows + 8 native (V-MERGE-01/02, V-HUNT-01/02, V-AUTO-01/02,
  V-SEC-08/09/10) — `src/references/blackhole-vcodes.md`.
- **Reviewer**: 14 audit sections incl. Iron Law anti-rationalization (§0, ported from mercure sync
  run 1), Reuse-Check verification + spot-check (§5), Pareto scoring (§6), confidence-based finding
  filtering (§11) — a mechanism mercure does not have — proportionality self-check (§12),
  V-UX information hierarchy (§14, ported sync run 2).
- **Implementer**: TDD workflow, Reuse Check Gate (widening in ADR-011), Bugfix Gate with
  Root-Cause Decision Records, execution modes (standard/refactor-strict/docs-only) each with
  unconditional gates, Verification Evidence 5-step gate (full mercure port).
- **Planner**: 5 tracks (Quick/Standard/Skip/Design/Brainstorm), Design track with 2 blind critics
  + fixed rubric + deterministic `design-aggregate.ts` verdict (V-AUTO-01) — an autonomous
  *replacement* for mercure's human Gate 2, not a copy. Accretion Guard (V-EXT analog).
- **Router**: complete `route{}` object (ADR-004/008/010) — blackhole's autonomous x-auto analog —
  with re-route checkpoints and monotonic security-flag raising (V-SEC-09/10).
- **Hunt kinds** (6): best-practices, bug, coverage, refactor, quickwins, retrospective — ported
  from x-analyze/x-troubleshoot/x-rearchitect/x-improve-hunt/x-architect respectively.
- **Confidence gates** (ADR-010 D6): quantitative model ported from mercure's interview skill,
  scoped to 5 autonomous routing surfaces.
- **Doc governance + artifact contract** (ADR-010 D5): per-route durable artifacts, config-gated.
- **Review-loop analog**: `review-core.md` iteration budget (1–3 auto-fix, 4+ escalate) mirrors
  x-review-loop.

### 2b. In-flight (mark `in-flight` in the matrix, never re-implement)

| Vehicle | Covers |
|---|---|
| ADR-011 D1–D4 (M0) | Repo-wide reuse aperture + rule-of-three; Scout/Continuous-Discovery unification; §2b audit correction |
| ADR-012 E1 (M1) | Repo-convention schema precedence (INDEX header + ADR frontmatter) |
| ADR-012 E2 (M2) | Human-approved design promotion + live resumption bug fix (Finding 3b) |
| ADR-012 E3 (M3) | `## Active Constraints` write path (2 triggers) |
| ADR-012 E4 (M4) | `documentation/reference/decision-log.md`, orchestrator single-writer |
| ADR-012 E5 (M5) | `autonomy.enabled: true` flip (brainstorm_routing pinned false), last, BREAKING |
| ADR-012 Future Work | Read path (context injection) explicitly deferred behind 3 prerequisites |

### 2c. Prior-audit status

- `autonomous-workflow-parity.md` G1–G11: R1–R7 largely addressed by ADR-010/011/012; §2b
  "every gap is on the thinking side" **retracted** by ADR-011 D3.
- `mercure-companion-files-gap-analysis.md`: all 10 items shipped (#182–#194) — closed.
- `mercure-sync.md`: watermark v9.6.0; 4 domains swept (adaptive routing, companion files,
  enforcement psychology, information hierarchy); **~65 skill domains explicitly unswept**.

## 3. Confirmed Gaps (no covering ADR/milestone)

| # | Gap | Evidence | Severity |
|---|---|---|---|
| GAP-1 | **Threat/Perf/API-contract plan machinery**: no `## Threat Model`/`## Performance Budget` plan sections; **no V-THREAT or V-PERF codes at all**; V-API-01 narrower than mercure's audit | parity audit G10; agent B §1; agent C §4.7. Porting note: mercure's API Contract has no plan-time template either (known upstream gap — don't port as-is) | HIGH |
| GAP-2 | **Spec-drift-at-merge** (G6): transcript-proven rework wave (#113–115); reviewer §13 recheck-mode targets prior findings, not spec drift | parity audit G6 | MEDIUM |
| GAP-3 | **Delivery-boundary hardening** (G7): Verification Evidence Gate covers test/build claims, not "branch pushed + PR open + worktree clean" | parity audit G7/R6 | MEDIUM |
| GAP-4 | **Ledger never-drop across campaign generations** (G8): consumer-repo failure mode (16 unpersisted review-aggregate JSONs) | parity audit G8 | MEDIUM |
| GAP-5 | **Cross-issue retrospective** (G5): `retrospective` hunt kind may be the remedy — unconfirmed; no ADR closes G5 | parity audit G5; hunt/retrospective.md | LOW-MEDIUM |
| GAP-6 | **x-security-audit exploitability-methodology depth** vs blackhole V-SEC-06..10 — unconfirmed equivalence | mercure-sync.md next-pick suggestion | UNKNOWN |
| GAP-7 | **~65 mercure skill domains never swept** — unknown-unknowns (security-*, delivery-*, data-*, quality-observability, operations-*, code-*, compliance-*, vcs-*) | mercure-sync.md coverage table | UNKNOWN |
| GAP-8 | **Sprint Contract / machine-verifiable acceptance criteria**: mercure Plan Check 1 BLOCKING + x-implement step 17 verification; blackhole Standard track has Sprint Contract but no BLOCKING acceptance-criteria gate documented at plan time | agent B §1 vs agent C planner summary | MEDIUM (verify first) |
| GAP-9 | **V-ASSET family** (agent-asset drift/ripple): blackhole relies on `verify.ts` checks + ground-truth SSOT; no per-diff V-ASSET audit | agent A table; agent C refs | LOW (partially N/A — evaluate) |
| GAP-10 | **Consumer-repo artifact breadth**: runbooks, investigations, assessments, reviews folders — blackhole's artifact-contract covers route-artifacts + decisions + reference; full 13-folder taxonomy not adopted | agent B §6 vs artifact-contract.md | MEDIUM (D1 input) |

Likely N/A (justify in matrix, don't force-fit): V-EXT (Accretion Guard analog exists), V-CHAIN
(no skill chaining), V-DELEG (5-field contract enforced in reviewer §1), x-prompt analog (workers
get fixed contract templates), synchronous AskUserQuestion gates (rejected by design — async).

## 4. Analysis — the three design questions

### 4a. Matrix granularity → mechanism-cluster (~70 rows)

- Per-V-code (96 rows): maximal traceability, but 96 rows × 4 status fields is a drift burden, and
  many codes are only meaningful as a checklist unit (e.g. V-SOLID-01..05 are one audit).
- Per-domain (~10 rows): unverifiable — "security: covered" hides V-SEC-08..10 vs exploitability-
  methodology depth questions.
- **Recommended: one row per enforcement mechanism** — each named checklist (21), workflow gate
  (~18), plan section (13), artifact type (13), behavioral protocol (5), fleet capability (11) —
  with the V-code family as row key where applicable and per-row status
  `covered | adapted | in-flight(ref) | gap | N/A(reason)`. ≈ 70 rows, each independently
  verifiable by citation, matching how the surface naturally chunks.

### 4b. Adoption Lens rebuild — evidence

The lens's REJECT-bias is **not** what limits parity — sweep throughput is. History: every swept
domain produced adopted-and-shipped items (companion files 10/10, Iron Law, V-UX); nothing swept
was wrongly rejected. But 4 domains swept vs ~65 unswept in 3 runs means full-surface parity at
current cadence takes years. The rebuilt lens should therefore: (1) flip the default to ADOPT/ADAPT
for quality-enforcement mechanisms (translate sync-HITL → async seams); (2) keep only two hard
rejections — synchronous mid-loop HITL as a primitive, non-agent-agnostic campaign runtime; (3)
replace changelog-driven sweeps with **matrix-driven** sweeps (work the `gap`/`unswept` rows by
Pareto priority, releases only trigger re-checks of touched rows).

### 4c. Doc layout — ADR-012 E1/E4 is necessary but not sufficient

E1/E4 + doc-governance.md settle decisions/, reference/, INDEX schema precedence, and frontmatter.
Not settled: whether campaigns emit the remaining taxonomy (runbooks, investigations, reviews,
assessments) on consumer repos, and where initiative/milestone tracking lives for epic-track
issues. This is a **thin extension decision** (D1), best folded into the lens/matrix ADR pair
rather than a standalone ADR.

## Recommendations

1. **Design phase produces two ADRs** (ADR-013, ADR-014): (a) *Parity matrix contract* — canonical
   file `documentation/audits/mercure-parity-matrix.md`, mechanism-cluster rows, status enum,
   single-maintainer rule (prj-mercure-sync writes; self-audit/reviewer file issues, never edit),
   seeded from this document; (b) *Adoption Lens v2 + sync v2* — parity-first lens, matrix-driven
   sweep order, per-release impact-analysis workflow, folding in the D1 doc-layout extension.
2. **Then a new initiative** (parallel to companion-substrate-closure) with milestones roughly:
   M-A seed matrix (all ~70 rows statused), M-B GAP-1 threat/perf plan machinery, M-C GAP-2/3/8
   merge-and-delivery hardening, M-D sync v2 rewrite, M-E self-audit wave (F6), M-F matrix-driven
   sweep of highest-Pareto unswept domains.
3. **Verify-before-build** on GAP-5/6/8/9 rows — each has a plausible existing remedy; confirm
   status before filing implementation issues (V-HUNT-01 discipline applies).

## Sources

- Agent A inventory: mercure `rules/references/v-codes-*.md`, `mercure-quality-audit-criteria.md`,
  `mercure-enforcement-contract.md` (9.6.1 cache).
- Agent B inventory: mercure `skills/x-plan|x-implement|x-review|x-design|x-initiative`,
  `agents/x-planner.md`, behavioral rules, `mercure-file-organization.md` (9.6.1 cache).
- Agent C inventory: blackhole `src/agents/*.md`, `src/references/**`, ADR-011/012, milestones
  M0–M5, three prior audits.
- Direct reads: `documentation/decisions/ADR-012-shared-artifact-substrate.md`,
  `.claude/skills/prj-mercure-sync/SKILL.md`.
