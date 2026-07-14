---
type: analysis
status: current
review_trigger: "on mercure release"
created: 2026-07-14
last_updated: 2026-07-14
last_reviewed_mercure_version: v9.6.0
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
| Enforcement psychology / anti-rationalization (`meta-persuasion-principles`) | Reviewed Run 1 — 1 item filed | This doc, Run 1 | 2026-07-14 |
| Information hierarchy / progressive disclosure (`V-UX-01`, v9.5.0/v9.6.0 delta) | Reviewed this run — 1 item filed | This doc, Run 2 | 2026-07-14 |
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

## Run 2 — 2026-07-14

### Scope

`gh release list --repo CorentinLumineau/mercure` now shows two tags newer than the Run 1
watermark (`v9.4.0`): **`v9.5.0`** and **`v9.6.0`**, both released 2026-07-14. Both center on a
single new mechanism, so this run reviewed the *version delta* (skill step 2, not the
domain-sweep fallback): mercure's **information-hierarchy / progressive-disclosure doctrine** and
its new `V-UX-01` review V-code. Both cache versions were present locally
(`~/.claude/plugins/cache/mercure/mercure/9.5.0`, `9.6.0`) and read at mechanism level.

Delta contents:

- **v9.5.0** — new stack-agnostic information-hierarchy doctrine (4-tier at-a-glance/summary/
  detail/raw model + anti-patterns), wired into `x-design` validation, `x-review` (`V-UX-01`),
  and `x-improve-hunt` UX hunt/fix modes.
- **v9.6.0** — `x-analyze` gains a `ux` mode + full-audit default; `git-fix-actionman-prs`
  current-branch default (a git-workflow ergonomics change, N/A to blackhole's domain).
- Both releases also carry trivial `argument-hint` frontmatter corrections (N/A).

### Gap matrix

| # | mercure mechanism | Citation | Blackhole today | Gap |
|---|---|---|---|---|
| 1 | `V-UX-01` (+ sub-codes `01a`–`01e`, MEDIUM) information-hierarchy / progressive-disclosure review check: on a diff touching a UI view, flag flat field dumps, >~7-column dumps, everything-expanded-by-default, buried primary info, deprecated-at-equal-prominence | `rules/references/v-codes-ux.md`; `rules/references/information-hierarchy-doctrine.md`; consumed by `mercure-quality-audit-criteria.md` Phase 2, `x-design`, `x-analyze` `ux` mode, `x-improve-hunt` UX modes | `src/references/blackhole-vcodes.md` — `grep -cF V-UX` = **0**; `reviewer.md` § 10 already detects frontend-touching diffs for `V-ADA-03` (`DESIGN.md` presence) but has **no** check on the UI's own information hierarchy | Absent |
| 2 | `x-improve-hunt` UX 5-domain swarm with Playwright + axe-core + Lighthouse browser enrichment | `skills/x-improve-hunt/references/ux/mode-hunt-ux.md` | No browser-automation hunt kind; hunt kinds are all static code-quality (`best-practices`, `bug`, `coverage`, `quickwins`, `refactor`, `filing`) | Absent — but see verdict |
| 3 | `git-fix-actionman-prs` current-branch default (v9.6.0) | v9.6.0 release notes (#246) | No equivalent; blackhole PR-fix flow is orchestrator-internal | N/A (mercure-only git ergonomics) |

### Adoption Lens verdicts

**Item 1 — `V-UX-01` review check: ADOPT / ADAPT.** No REJECT filter fires:

- Not synchronous human gating — a WARN review finding routed to the findings ledger, exactly
  like `V-ADA-03`; no new interaction primitive.
- Not new skill surface — a new V-code row + a compact doctrine block extending `reviewer.md`
  § 10, the section that *already* owns frontend-diff detection. No new skill/mode/route flag.
- Agent-agnostic — the doctrine is plain markdown (4-tier model + 5 anti-patterns), compiles to
  every target like the rest of `reviewer.md`.
- No existing seam duplicated — zero V-UX today, and it reuses (does **not** reimplement,
  `V-INT-02`) the `V-ADA-03` frontend keyword set already in `reviewer.md` § 10.
- Domain-applicable — blackhole already ported the entire `V-ADA` companion-file family for
  frontend consumer repos (Run 0); a UI-diff review V-code is the same accepted domain. WARN
  severity keeps it advisory, mirroring `V-ADA-03`.

**Item 2 — UX browser-automation hunt swarm: REJECT.** Two filters fire: **not agent-agnostic**
(Playwright/axe-core/Lighthouse is an MCP/tool-specific enrichment a headless backlog
orchestrator can't rely on), and it **grows surface speculatively** (`V-YAGNI` — a UX hunt kind
only pays off if UI-producing consumer repos are a frequent campaign target, which is unproven).
The reactive review-time check (Item 1) delivers the 80/20 without the browser dependency.

**Item 3 — `git-fix-actionman-prs` default: N/A.** mercure-only git-workflow ergonomics; blackhole
has no equivalent user-facing PR-fix command (the flow is orchestrator-internal).

### Backlog (`V-PARETO-02`: `Priority = Gain × (11 − Effort)`, floor 30)

| ID | Title | Gain | Effort | Priority | Independently re-verified |
|----|-------|------|--------|----------|----------------------------|
| U2 | Add `V-UX-01` (WARN) to `src/references/blackhole-vcodes.md` + a compact 4-tier / anti-pattern block as a new audit sub-section in `reviewer.md` § 10, fired on the frontend-touching diffs § 10 already detects (reuse the `V-ADA-03` keyword set — no re-detect). ADAPT wording to blackhole's V-codes; drop mercure's browser-automation swarm. | 5 | 3 | 40 | Yes — re-read `v-codes-ux.md` + `information-hierarchy-doctrine.md` (mercure 9.6.0 cache) and `src/references/blackhole-vcodes.md` + `reviewer.md` § 10 immediately before filing; both citations current, gap still real |

Priority 40 sits at the bottom of the "moderate" band (40–59) — above the 30 floor, filed below.

### Outcome

| Backlog | Issue | Notes |
|---------|-------|-------|
| U2 | [#271](https://github.com/CorentinLumineau/blackhole/issues/271) | Filed via `gh issue create`, labeled `blackhole/backlog` + `size:s`; will surface into `queue.json` on the campaign's next native forge sync, same as any human-authored issue. UX hunt-kind extension (Item 2) recorded as REJECT — not filed. |

## Design note for future runs

- Run 2 reviewed a genuine version delta (`v9.4.0` → `v9.6.0`), both tags landing 2026-07-14.
  As in Run 1, it filed **one** Pareto-qualifying item and explicitly recorded the REJECT
  (browser-automation UX swarm) so a future run doesn't re-surface it as a "new" gap.
- The watermark is now `v9.6.0` (the latest tag). The next run should either (a) pick up any
  newer mercure version delta, or (b) sweep one more domain from the Coverage table's
  "everything else" row — `x-security-audit`'s exploitability-gate methodology (`V-SEC-06/07`)
  remains the natural next pick, since blackhole's own `V-SEC-06..10` already exist and a fresh
  comparison would confirm whether they're complete or only partially ported.
