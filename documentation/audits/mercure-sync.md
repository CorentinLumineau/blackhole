---
type: analysis
status: current
review_trigger: "on mercure release"
created: 2026-07-14
last_updated: 2026-07-14
last_reviewed_mercure_version: v9.4.0
related:
  - .claude/skills/prj-mercure-sync/SKILL.md
  - documentation/audits/analysis-blackhole-adaptive-phase-routing.md
  - documentation/audits/mercure-companion-files-gap-analysis.md
  - documentation/decisions/ADR-006-kaizen-hunt.md
---

# Mercure Sync — Living Tracking Doc

Canonical, single tracking doc for `.claude/skills/prj-mercure-sync/SKILL.md` runs. Every mercure
mechanism considered here is filtered through the skill's Adoption Lens before it can become a
backlog item — mercure is a source of ideas, never a template blackhole copies wholesale. Do not
create a dated variant of this file; update it in place on every run.

## Coverage table

Which mercure domains have been swept, and by what — including the two deep-dives that predate
this skill and are folded in as Run 0.

| Domain | Status | Source doc | Date |
|--------|--------|-------------|------|
| Adaptive phase routing (`x-auto`) | Reviewed — recommendation pending `/x-design` (amends ADR-001) | [analysis-blackhole-adaptive-phase-routing.md](analysis-blackhole-adaptive-phase-routing.md) | 2026-07-07 |
| Companion files / doc governance (V-ADA, V-DOC-GOV) | Reviewed — full 10-item backlog shipped same day | [mercure-companion-files-gap-analysis.md](mercure-companion-files-gap-analysis.md) | 2026-07-10 |
| Enforcement psychology / anti-rationalization (`meta-persuasion-principles`) | Reviewed this run — 1 item filed | This doc, Run 1 | 2026-07-14 |
| Everything else — `security-*`, `delivery-*`, `data-*`, `quality-testing`, `quality-observability`, `operations-*`, `code-*`, `compliance-*`, `vcs-*`, `diagram-mermaid`, `x-security-audit`, `x-review-loop`, `x-prompt`, and ~65 more mercure skills | Not yet swept | — | — |

**No silent caps**: the "everything else" row is intentionally wide. Each future run should pick
one bounded domain from it (or a new version delta, if one has landed) rather than attempt an
exhaustive sweep in one pass — see the skill's step 2.

## Run 1 — 2026-07-14

### Scope

`gh release list --repo CorentinLumineau/mercure` showed `v9.4.0` as the latest tag, released
2026-07-10 — the same day as the companion-files sync (Run 0), so no new version delta exists to
review yet. Per the skill's step-2 fallback, this run swept one uncharted *domain* instead: the
Iron Law / Anti-Rationalization Table methodology behind mercure's own hard-gate enforcement,
since it's a small, self-contained mechanism with an unusually clean fit test (either blackhole's
reviewer has this defense or it doesn't).

### Gap matrix

| # | mercure mechanism | Citation | Blackhole today | Gap |
|---|---|---|---|---|
| 1 | Iron Law ("NO X WITHOUT Y") + 2-column anti-rationalization table (excuse → reality) attached to every hard BLOCK gate, itself enforced by `V-PERSUASION-01/02/03` | `meta-persuasion-principles/SKILL.md:19-64` (pattern definition); concretely applied in `mercure-quality-audit-criteria.md`'s "STOP — Review Approval Hard Gate" and its Phase 1/Phase 3 "Common rationalizations" tables | `src/agents/reviewer.md` (206 lines) — `grep -n "rationaliz\|STOP\|excuse"` returns **zero matches** in `reviewer.md` or `review-core.md` | Absent |

### Adoption Lens verdict — Item 1: **ADOPT**

Checked against every REJECT filter in the skill, none fire:

- Not synchronous human gating — pure prompt content inside an existing read-only agent, no new
  interaction primitive.
- Not new skill surface — extends `src/agents/reviewer.md`, the file that already owns
  BLOCK-severity judgment; no new mode, skill, or file.
- Agent-agnostic — plain markdown prose, compiles to every platform target exactly like the rest
  of `reviewer.md`.
- No existing seam duplicated — nothing resembling a rationalization defense exists in blackhole
  today.
- Domain-applicable — review-gate integrity (not downgrading a CRITICAL/HIGH finding under time
  or "looks fine" pressure) is squarely inside blackhole's own control surface; the whole review
  phase exists to prevent exactly this class of judgment slip.

No config gate needed: this is prompt-language strengthening inside an already-mandatory phase,
the same treatment blackhole's own unconditional V-SEC-06 exploitability-gate wording already
gets in `reviewer.md` — not a new optional feature.

### Backlog (`V-PARETO-02`: `Priority = Gain × (11 − Effort)`, floor 30)

| ID | Title | Gain | Effort | Priority | Independently re-verified |
|----|-------|------|--------|----------|----------------------------|
| U1 | Add an Iron Law + anti-rationalization table to `src/agents/reviewer.md`'s BLOCK-severity section (SOLID CRITICAL, `V-SEC-01/02`, `V-TEST-01/02`, `V-PAT-01`), adapted to blackhole's own V-code language and severity table — not copied verbatim from mercure's wording | 6 | 2 | 54 | Yes — re-read `src/agents/reviewer.md` and `meta-persuasion-principles/SKILL.md` immediately before filing; both citations current, gap still real |

Priority 54 falls in the "moderate" band (40–59) per `ADR-006`'s named priority bands — comfortably
above the 30 floor, filed below.

### Outcome

| Backlog | Issue | Notes |
|---------|-------|-------|
| U1 | [#261](https://github.com/CorentinLumineau/blackhole/issues/261) | Filed via `gh issue create`, labeled `blackhole/backlog` + `size:xs`; will surface into `queue.json` on the campaign's next native forge sync, same as any human-authored issue |

## Design note for future runs

- This run deliberately scoped to **one** domain and **one** backlog item rather than attempting
  a first-pass sweep of all ~70 remaining mercure skills — false economy to rush breadth on a
  brand-new mechanism before its filing pipeline has been exercised once for real.
- The next run should either (a) pick up a genuine new mercure version delta if one has landed
  since `v9.4.0`, or (b) sweep one more domain from the Coverage table's "everything else" row —
  `x-security-audit`'s exploitability-gate methodology (`V-SEC-06/07`) is a natural next pick,
  since blackhole's own `V-SEC-06..10` already exist and a fresh comparison would confirm whether
  they're actually complete or only partially ported.
