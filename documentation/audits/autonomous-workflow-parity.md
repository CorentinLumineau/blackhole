---
type: analysis
skill: x-analyze
status: draft
review_trigger: "on ADR acceptance"
created: 2026-07-15
last_updated: 2026-07-15
target: "blackhole autonomous APEX parity vs mercure"
related:
  - documentation/decisions/ADR-004-adaptive-phase-routing.md
  - documentation/audits/analysis-blackhole-adaptive-phase-routing.md
  - documentation/decisions/ADR-006-kaizen-hunt.md
---

# Autonomous Workflow Parity — Gap Analysis: blackhole vs mercure

## Intent (user requirement, 2026-07-15)

> Blackhole should be a backlog cleaner that processes each issue with mercure-quality work
> and workflows, autonomously, with human-in-the-loop **only when the model is not confident
> enough to proceed**. Where mercure implements 1 issue in pair with the user, blackhole
> implements the whole backlog (or a scoped amount) with all of mercure's power. The scope is
> **all workflows the mercure plugin makes possible** (APEX, ONESHOT, DEBUG, BRAINSTORM, and
> the campaign-level skills), so blackhole can handle every type of issue — not only the APEX
> chain. The `documentation/` artifact discipline that mercure enforces must carry over.
> Integration model: **port mercure workflows into blackhole** (no runtime dependency on
> mercure).

## Evidence sources

1. **Blackhole skill source** (`src/` — canonical; `.claude/skills/` is build output)
2. **Mercure APEX skills** (`~/Documents/Git/ai/mercure/mercure-plugin/skills/`, v9.6)
3. **Campaign state** (`.blackhole/` in this repo — 55/55 done — and in `../invest` — 30 merged, 13 blocked, held)
4. **Session transcripts** (~14 sessions across both project dirs and worker worktrees)

---

## 1. What already works — preserve as-is

Transcript- and ledger-backed: the **plan → implement → review loop is solid on
well-specified work** and must not be weakened by the port.

| Evidence | Detail |
|----------|--------|
| Merge rates | invest campaign: 26/30 → 28/30 backlog merged in one session; blackhole repo campaign: 55/55 done, main green (429 tests, +30 vs baseline) |
| Review discipline | Deterministic `review-aggregate.ts`, iteration budget 1–3 auto / 4+ escalate, security mode (V-SEC-06/07/08), recheck fast-path (`review-core.md`) |
| Ledger never-drop | blackhole repo: 12 deferrals all filed (`deferred_to_issue` → #274–282) or documented below-Pareto-floor; open rows preserved for future kaizen waves |
| Plan quality | Sampled plans (issue-91: 248 lines, issue-1033: 257 lines) carry AC tables, Touch-Paths, Codebase Conventions, Documentation Impact, doc-governance frontmatter |
| Escalation signal/noise | ~80–90% of in-campaign escalations were substantive (destructive DB drop #332, Powens KYC credentials #971, product choices #444/#622/#624). The "click Recommended" noise the user experiences comes from **mercure's per-phase chaining gates**, not blackhole's blocker gates |
| Investigation track | `issue-620-investigation.md` refuted the issue's own diagnosis (confidence 86) and found the real root cause — the deeper-work machinery works where it exists |

## 2. Gap findings

### G1 — No per-issue analyze phase exists at all (severity: HIGH)

ADR-004's coverage map (`documentation/decisions/ADR-004-adaptive-phase-routing.md:253`)
explicitly scopes x-analyze as "campaign-level" and out of the per-issue lifecycle. The only
descendant is the router's local-analyze security grep of an issue's own `touch_paths`
(`src/agents/router.md:69-135`) — security-only, additive-only. Nothing assesses
architectural health, conventions, or performance baselines before planning a complex issue.

**Consequence (transcript-proven)**: the Cashflow v3 epic (#324–#332) passed every plan/
implement/review gate and was rejected by the user at the product level ("I dont like the
cashflow feature, let's stop it here", invest session `1253ed59`, 2026-07-07). The redesign
then ran through **mercure** (`/mercure:x-initiative implement-all cashflow-evolution`), not
blackhole. Blackhole fails on product/design fit, not code quality — the missing phase is
upstream.

### G2 — Design track always hard-blocks on a human; no confidence tier (severity: HIGH)

The Design Track is real and good (`src/agents/planner.md:88-149`: options + trade-off
matrix, 2 adversarial critique sub-invocations, component decomposition, assumption audit) —
but "there is no code path in this track that returns `status: ready`" (planner.md:95-98) and
phase-plan.md:42 mandates "ALWAYS AskQuestion — no confidence bypass, regardless of AC
clarity". Every `needs_design` issue halts autonomy unconditionally.

**Counter-evidence that autonomy is achievable**: invest #1036 produced a full 228-line
decision record (invest repo ADR numbering: 014) with options and trade-off matrix "autonomously" per the queue checkpoint — the
capability exists; the gate policy forbids it.

### G3 — Design artifacts are ephemeral, violating the documentation/ requirement (severity: HIGH)

`plans/issue-N-design.md` lives under `.blackhole/plans/`, which is **gitignored**
(`src/references/queue-dag.md:3`). Design decisions leave no durable trace in the consumer
repo: no `documentation/decisions/ADR-*.md`, no INDEX.md row. Blackhole's reviewer even
audits V-ADA-02 (ADR index currency) against an index its own pipeline never feeds
(`src/agents/reviewer.md:108-113`). Mercure, by contrast, writes ADRs with sequential
numbering + INDEX upsert (`x-design/SKILL.md:94-98`), audits to `documentation/audits/`,
reviews to `documentation/reviews/`, diagnoses to `documentation/investigations/` — each
enforced by Stop hooks or skill steps, with lifecycle frontmatter (ADR-068).

Ad-hoc leakage confirms demand: campaigns produced ADR-008 (in-campaign "adr-dashboard"
worker, session `30ee9f51`) and an autonomous decision record (invest #1036) — but only because orchestrators improvised.

### G4 — No confidence-based escalation model; gates are categorical (severity: MEDIUM)

Blackhole's clarify gate (`src/references/clarify-gates.md`) is a checklist of categorical
triggers (missing AC, product choice, destructive op, …) with a 5-condition auto-proceed.
The user's requirement — "escalate whenever the model is not confident enough" — needs a
*quantitative* model. Mercure already has one to port: the `interview` skill's 5-dimension
weighted confidence composite with numeric thresholds (<50% ask, 80–94% reformulate, 100%
proceed), risk-tier bypass rules, and `[NEEDS CLARIFICATION: …]` markers as a **deferred
question channel** that flows through plans and is caught at implement time
(`skills/interview/references/confidence-model.md`) — ideal for async campaigns: file the
marker, continue other issues, block only the affected one.

### G5 — No cross-issue architectural synthesis (severity: MEDIUM)

Discoveries file one issue at a time via the Pareto ≥ 30 gate; kaizen hunts (ADR-006) are
per-kind scans. There is no x-rearchitect/retrospective analog correlating recurring findings
into coherent redesigns. Transcript evidence: the 90%-coverage epic "spiraled" (orchestrator's
own words) and the user compensated with a **manual mercure retrospective → redesign blueprint
→ x-initiative** (session `1253ed59` second half).

### G6 — Review-at-merge missed implement-vs-spec drift (severity: MEDIUM)

A dedicated rework wave (#113–115) corrected three already-merged issues after a fidelity
audit found spec gaps the original reviews passed; #121 was a P0 hotfix for a merged change
leaving main red (16/18). Plus invest F-920-01 (HIGH): an implementer fix "worse than
pre-fix" (permanent deadlock), caught only at review iteration 1. Mercure's spec-compliance
subagent (x-review Wave 2, agent 6) enforces diff-vs-plan; blackhole's equivalent exists but
demonstrably let drift through — the port should tighten spec-compliance rather than assume
parity.

### G7 — Delivery-boundary and state fragility (severity: MEDIUM, operational)

Independent of routing: implementer workers "reliably implement but stall at the delivery
boundary" (3+ cases in session `30ee9f51`: #810/#817/#825 — built but never committed/pushed);
workers going idle on ambiguous push failures (`wt-970`); queue.json triplication from a jq
stream idiom (turn 12 checkpoint). The orchestrator's adopted doctrine — "never trust a
worker's 'done' claim" — should be codified (verify branch pushed + PR open + worktree clean).

### G8 — Ledger never-drop not upheld across invest campaign generations (severity: MEDIUM)

invest's ledger holds 6 findings while 16 review-aggregate JSONs (issues 646–702) full of
WARN findings were never persisted; no `archive/` dir exists there. The never-drop guarantee
is real in this repo but doesn't demonstrably survive campaign turnover in consumer repos.

### G9 — Reference-doc drift on exactly the deeper-work paths (severity: LOW)

`src/agents/router.md:48-51` claims the investigator "has not landed" while
`src/references/phase-handle.md:64-77` and `queue-dag.md:88-98` wire it as live (#96,
PR #125); queue-dag's route table still marks live flags "not yet implemented". The machinery
complex issues depend on is the least coherently documented.

### G10 — Plan sections thinner than mercure on security/perf (severity: LOW)

Blackhole plans lack STRIDE Threat Model, Performance Budget, and formal API Contract
sections (mercure x-plan carries all three, feeding x-review's V-THREAT/V-PERF/V-API audits).
Blackhole covers security only via routing (`security_review_required`) and review tier.

### G11 — No BRAINSTORM entry path; vague issues can only clarify-block (severity: MEDIUM)

Mercure's fourth workflow (brainstorm ↔ research → design) has no blackhole analog:
ADR-004's coverage map scoped x-brainstorm out as "campaign-level" alongside x-analyze. The
investigator's `research` sub-mode covers the research half (cited multi-source evidence,
re-route on landing), but an issue arriving as a vague idea has exactly one path today —
`needs_clarification` → `status: blocked` → wait for the user. An autonomous backlog cleaner
needs a bounded idea-development route: expand the idea into requirements + options
(brainstorm artifact), research feasibility, then enter the design track — escalating only
the final product choice when confidence stays low, instead of blocking on first contact.

## 2b. Full workflow coverage matrix

Beyond the APEX-phase gaps above, mapping **every** mercure workflow and major skill to
blackhole's current machinery:

| Mercure workflow / skill | Blackhole today | Verdict |
|--------------------------|-----------------|---------|
| APEX Analyze | Nothing per-issue (router security grep only) | **Missing** (G1) |
| APEX Design | Design track — human-blocked, ephemeral artifact | **Gated + ephemeral** (G2, G3) |
| APEX Plan | Planner quick/full/skip tracks, Pareto gate | Parity (minus STRIDE/Perf/API sections — G10) |
| APEX Implement | Implementer, TDD, worktrees, execution modes | Parity (delivery-boundary hardening — G7) |
| APEX Review | Reviewer + deterministic aggregate + iteration budget | Parity+ (spec-drift tightening — G6) |
| APEX Commit | Merge gate (`mergeEligible()`, V-GIT-01) | Parity |
| ONESHOT (x-fix → commit) | `plan_mode: skip` + Bugfix Gate (V-FIX-01 root-cause record) | Parity |
| DEBUG (x-troubleshoot → fix/implement) | Investigator `investigate` sub-mode (ranked-hypothesis loop) + re-route checkpoint | Near parity — diagnosis artifact is ephemeral in `.blackhole/plans/` instead of `documentation/investigations/` (G3 applies) |
| BRAINSTORM (brainstorm ↔ research → design) | `research` sub-mode only; no brainstorm route | **Half missing** (G11) |
| x-refactor | `task_type: refactor` + refactor-strict execution mode | Parity |
| x-rearchitect / retrospective | Nothing — discoveries file as fragmented issues | **Missing** (G5) |
| x-improve-hunt | Kaizen hunt (ADR-006), per-kind waves, verification gate | Parity |
| x-security-audit | Per-issue security review mode (V-SEC-06/07/08); no campaign-level audit | Partial |
| x-docs | `docs-only` execution mode + doc-governance rules | Partial — write-governance exists, artifact routing doesn't (G3) |
| x-initiative (multi-milestone) | Epics + DAG + splits + PO sign-off | Rough parity — sign-off gate becomes confidence-gated (G4) |

Reading of the matrix: **implement-side workflows (fix, refactor, docs, hunt, review, commit)
are already at parity; every gap is on the thinking side** (analyze, design, brainstorm,
rearchitect) plus the shared artifact-durability and gate-policy defects. The port is
therefore not "add 74 skills" — it is four thinking routes, one artifact contract, and one
confidence-based gate policy applied uniformly.

## 3. What mercure already provides for the port

The port is **not** a from-scratch autonomy design. Mercure v9.6 contains nearly all needed
machinery; the port's job is wiring it to blackhole's queue/ledger with an autonomous gate
policy.

### 3.1 Gate taxonomy (28 gates inventoried across the APEX chain)

| Class | Count (approx.) | Autonomous disposition |
|-------|-----------------|------------------------|
| (a) Pure chaining ("What's next? — Recommended") | ~10 | Auto-resolve to the Recommended option — these are exactly the gates the user rubber-stamps today |
| (b) Boundary approvals (Design→Plan, Plan→Implement, Fix→Commit) | ~6 | Map onto queue phase transitions; auto-pass when confidence composite ≥ threshold |
| (c) Substantive (Gate 2 approach choice, V-INT-02 conflict, `## Stop Conditions`, Critical findings, interview) | ~12 | Confidence-gated: proceed when decidable, else `status: blocked` + issue comment — **never silent auto-proceed** |

Mercure's own severity ladder is the template: "Critical = ALWAYS ASK … Low = PROCEED"
(x-review/SKILL.md:212).

### 3.2 Machine-decidable design selection

x-design's adversarial evaluation already outputs machine-decidable data
(`x-design/references/adversarial-evaluation.md`): weighted trade-off totals; **>30% weighted
score delta → dominant approach, skip adversarial testing**; N sonnet critics whose findings
are classified discriminating vs domain-inherent. Autonomous rule: pick dominant on >30%
delta; otherwise pick highest weighted total after penalizing discriminating CRITICALs;
**escalate only when scores are within noise or critics flag a discriminating CRITICAL on the
front-runner**. Blackhole's Design Track already runs 2 adversarial critique passes
(planner.md:112-127) — the gap is only the decision rule and the unconditional block.

### 3.3 Quantitative confidence model (see G4)

Interview skill: 5 weighted dimensions, numeric thresholds, per-workflow weight profiles,
+30%/answer cap, risk-tier bypass conditions (production/data-deletion never bypassable),
`[NEEDS CLARIFICATION]` deferred markers, `.claude/interview-state.json` persistence. Maps
directly onto `status: blocked` + `notes: awaiting-user-clarification`.

### 3.4 Headless precedent

`skills/headless-runner/SKILL.md` "bypasses all interactive gates" via the
`HEADLESS_COMPLETE:` prefix contract (prefix-position `--auto` as anti-prompt-injection).
Currently only x-implement honors it, and it routes straight to implement, skipping the four
other phases. The port must honor the same contract across all phases while keeping
**enforcement gates** (CRITICAL/HIGH → BLOCKED, V-INT-02, V-FIX-01) intact — those are
severity gates, not interaction gates.

### 3.5 Artifact contract per phase (the documentation/ requirement)

| Phase | Mercure artifact | Enforcement |
|-------|------------------|-------------|
| Analyze | `documentation/audits/analysis-{slug}.md` (+ Performance Baselines, Convention Catalog feeding plan) | Skill step |
| Design | `documentation/decisions/ADR-{NNN}-{slug}.md` + INDEX.md row | Step 14b, V-ADA-02 |
| Plan | `documentation/plans/plan-{slug}.md` with `plan_base_commit` | 8-check quality gate |
| Implement | Code + enforcement summary + companion sync | **Stop hook** |
| Review | `documentation/reviews/review-{slug}.md` | **Stop hook** |
| Troubleshoot | `documentation/investigations/diagnosis-{slug}.md` | Skill step |

All with ADR-068 governance (canonical slugs, frontmatter, search-before-write, INDEX
upsert). Blackhole already ships a lighter mirror (`.claude/rules/doc-governance.md`, gated by
`docs_governance.write_governance`) — extend it, don't duplicate. Open design point: mercure
flips `status: draft → final` on *user approval*; autonomous mode needs a different final
trigger (e.g., phase-gate pass or merge).

### 3.6 Cost model to respect

Analyze (7 agents) and Review (8 agents) are the heavy swarms; Design runs on opus. Both
heavy swarms already have deterministic cheap paths (≤5 files, no security paths → haiku
quick scan). In autonomous mode these user gates become routing rules keyed off the router's
existing `route{}` flags (`size`, `security_review_required`, `needs_design`). Every ported
`agent()`/Agent call must pin `model:` explicitly (issue #209 lesson).

## 4. Recommendations (Pareto-ranked)

1. **R1 — Autonomous design tier (unlocks G2+G3, effort: M).** Add a decision rule to the
   Design Track: >30% weighted dominance or clean adversarial pass → auto-select, promote the
   design note to `documentation/decisions/ADR-{NNN}-{slug}.md` + INDEX row, proceed to plan;
   within-noise scores or discriminating CRITICAL on winner or BREAKING blast radius →
   `status: blocked` (current behavior). This is the single highest-leverage change: it is the
   exact point where campaigns stall today, and both the critics and the ADR capability
   already exist.
2. **R2 — Per-issue analyze route (fixes G1, effort: M).** Add `needs_analysis` to `route{}`
   (or fold into design-track preamble): a scoped, cheap-path-aware analyze pass over the
   issue's blast-radius (conventions catalog + architecture coherence + perf baselines)
   writing `documentation/audits/analysis-issue-N.md` and feeding the plan's conventions
   section. Cheap tier by default; full swarm only for `size:l+` or security-touching.
3. **R3 — Confidence-based escalation contract (fixes G4, effort: M).** Port the interview
   confidence model as the single escalation trigger across all gates: composite ≥ threshold
   → proceed; below → `[NEEDS CLARIFICATION]` marker if deferrable (issue continues to plan,
   blocks before implement) or `status: blocked` if blocking; destructive/irreversible ops
   and credentials remain never-bypassable. Replaces the categorical clarify checklist as the
   *mechanism* while keeping its triggers as confidence-dimension inputs.
4. **R4 — Durable artifact contract (fixes G3+G10, effort: S).** Route every phase artifact
   to the consumer repo's `documentation/` per §3.5 under the existing `docs_governance`
   kill-switch; add STRIDE/Perf-Budget/API-Contract plan sections for `security_review_required`
   or `size:l+` issues; define autonomous `draft→final` transition (on merge).
4b. **R4b — Brainstorm route (fixes G11, effort: S).** Add a `needs_brainstorm`-style route
   (or fold into `needs_design` preamble) that develops vague issues into requirements +
   options via a bounded idea-expansion pass writing
   `documentation/brainstorms/{slug}.md`, chains into research/design, and escalates only
   the final product choice when confidence stays below threshold.
5. **R5 — Campaign retrospective wave (fixes G5, effort: S).** A per-campaign (or N-issue)
   synthesis pass over the ledger + merged PRs that correlates recurring findings into
   redesign candidate issues — the formalization of what the user did manually via mercure
   retrospective. Reuses kaizen hunt plumbing (caps, dedup, Pareto gate).
6. **R6 — Operational hardening (fixes G7+G8+G6, effort: S each).** Codify worker-done
   verification (branch pushed + PR open + worktree clean); persist review-aggregate WARNs to
   the ledger in consumer repos (close the invest gap); add a post-merge fidelity spot-check
   to the loop phase (sampled diff-vs-plan audit).
7. **R7 — Doc-drift cleanup (fixes G9, effort: XS).** Reconcile router.md / queue-dag.md /
   phase-handle.md on investigator + re-route checkpoint status.

## Could Not Verify

- Exact per-question counts in the escalation noise ratio (§1) are the transcript explorer's
  sampled estimates (~14 sessions), not exhaustive counts.
- The claim that the invest decision record (#1036) was produced "autonomously" comes from the queue
  checkpoint's own wording; the session containing that decision was not independently
  re-read.
