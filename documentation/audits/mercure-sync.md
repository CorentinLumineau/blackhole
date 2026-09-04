---
type: analysis
summary: "Mercure sync audit tracking upstream skill/agent drift"
status: current
review_trigger: "on mercure release"
created: 2026-07-14
last_updated: 2026-07-26
last_reviewed_mercure_version: v9.7.0
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

> **Superseded by `documentation/audits/mercure-parity-matrix.md`** (ADR-013 D1, seeded
> M2 of the mercure-parity-program initiative). This table is preserved for historical
> reference only — do not add new rows here. Coverage status for every mercure mechanism now
> lives in the matrix as `PM-NNN` rows; file gaps there, not here.

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

## Run 3 — 2026-07-21 (backlog-mode sweep, mercure-parity-program M6)

### Scope

First `prj-mercure-sync` v2 **backlog-mode** run (ADR-013 D3) — matrix-driven, not release-triggered
(no watermark bump). Swept the top-priority `gap`/unswept row per the live
`documentation/audits/mercure-parity-matrix.md` Gap Priority Scoring table.

### Target selection

GAP-6 (x-security-audit exploitability depth) was **not** the target: it is folded into PM-004
(`covered`), not a scoreable `gap` row. Of the literal priority-48 tie (PM-010, PM-028, PM-045),
**PM-010 and PM-045 were found stale** — already resolved by M3 (`bf875a4`: V-THREAT-02/03 +
V-PERF-01/02, reviewer §16, planner Standard-track `## Threat Model`) — and were corrected in the
matrix this run (`gap → covered`). **PM-028** (Coverage Regression Check, `V-TEST-09`) was the only
genuinely unswept priority-48 row and is the sweep target.

### Adoption Lens v2 verdict — PM-028: **ADOPT**

Tier-1 enforcement/quality mechanism (ADR-013 D2). No autonomous-safety obstacle: a coverage-delta
comparison is a deterministic tool invocation (before/after diff on touched files) with no sync-HITL
dependency, and can reuse `hunt/coverage.md`'s runner-detection heuristic. Neither hard-rejection
category applies.

### Outcome

| Row | Issue | Notes |
|-----|-------|-------|
| PM-028 | [#306](https://github.com/CorentinLumineau/blackhole/issues/306) | Filed via `gh issue create`; matrix row PM-028 → `in-flight(#306)`. Within cap (`max_issues_per_run` default 5) and above floor (`min_priority` 30; Priority 48). |

Also corrected this run (matrix-accuracy, no issue filed): PM-010, PM-045 `gap → covered` (stale
since M3 landed). No REJECT/N/A items (single-target sweep). Zero items withheld by the cap.

## Run 4 — 2026-07-22 (backlog-mode sweep)

### Scope

Second v2 **backlog-mode** run (ADR-013 D3) — matrix-driven, no watermark bump. Triggered by a
synergy assessment (`documentation/audits/analysis-blackhole-mercure-synergy.md` F4: close the
autonomous-quality guardrail gap before enabling autonomy). Swept the top-priority `gap` cluster
(priority 40–42) per the live parity matrix. Note: mercure `v9.6.2` landed 2026-07-21 above the
`v9.6.0` watermark — a **release-mode** concern deferred to a future run; this run stays
matrix-driven against the pinned `v9.6.1` cache.

### Target selection

Swept 5 candidate mechanisms (each deep-compared against the pinned `~/.claude/plugins/cache/mercure/mercure/9.6.1/`,
each verify-before-file per `V-HUNT-01`):

- **PM-047 + PM-014 (Performance Budget, priority 42)** — **GAP-REFUTED**. Fully wired end-to-end:
  investigator analyze sub-mode → planner conditional `## Performance Budget` (`planner.md:108-118`,
  Plan Output Template `:379`) → reviewer §17 audit (`reviewer.md:270-280`). Corrected `gap → covered`,
  no issue filed (false-positive the vcodes-listed-but-unwired hypothesis; caught by V-HUNT-01).

### Adoption Lens v2 verdicts — 4 ADOPT/ADAPT items filed

All four land on existing seams (V-INT-02 reuse) — no new agents/subsystems:

| Row(s) | Mechanism | Verdict | Pareto | Issue |
|--------|-----------|---------|--------|-------|
| PM-003 | Design Pattern Review (V-PAT) | ADOPT (circular-dep + singleton net-new; fixes dangling `reviewer.md:24` V-PAT-01 cite) | Gain 6 × (11−3) = **48** | [#308](https://github.com/CorentinLumineau/blackhole/issues/308) |
| PM-052 | Sprint Contract per-AC completion gate | ADOPT (completion half) / ADAPT (plan half ~90% present) | Gain 6 × (11−4) = **42** | [#309](https://github.com/CorentinLumineau/blackhole/issues/309) |
| PM-011 + PM-046 | Dependency Blast-Radius (V-SCOPE-03) | ADAPT (reuse Design Track grep scan for Standard Track) + ADOPT (WARN audit) | Gain 5 × (11−3) = **40** | [#310](https://github.com/CorentinLumineau/blackhole/issues/310) |
| PM-050 | Quick Threat Check | ADAPT-into-existing-seam (reuse `route.security_review_required`) | Gain 4 × (11−3) = **32** | [#311](https://github.com/CorentinLumineau/blackhole/issues/311) |

### Outcome

4 issues filed (#308–#311), within cap (`max_issues_per_run` 5) and above floor (`min_priority` 30).
Matrix transitions this run: PM-003/PM-052/PM-011/PM-046/PM-050 `gap → in-flight(#308–#311)`;
PM-014/PM-047 `gap → covered` (refuted). Zero items withheld by the cap. No REJECT/N/A verdicts.

## Run 5 — 2026-07-26 (release-mode sweep, `v9.6.0` → `v9.7.0`)

### Scope

First v2 **release-mode** run (ADR-013 D3) since the matrix was seeded — three tags above the
`v9.6.0` watermark: `v9.6.1` (2026-07-20), `v9.6.2` (2026-07-21), `v9.7.0` (2026-07-23). Run 4
explicitly deferred `v9.6.2` as "a release-mode concern deferred to a future run"; this run
discharges that deferral and covers `v9.7.0` as well.

Release notes were read for all three tags, then the delta was deep-compared at mechanism level
against the local plugin cache (`~/.claude/plugins/cache/mercure/mercure/9.6.0` vs `9.7.0`, both
present locally — 73 differing paths). `v9.6.1` is a workclaude-integration bump only, with no
mechanism content.

### Mechanism inventory (4 mechanisms + 1 ergonomics cluster)

| # | Mechanism | Source | Touched row(s) |
|---|-----------|--------|----------------|
| M1 | Efficient-output executive-summary doctrine — 6 formatting rules (ADR-102) | `rules/references/efficient-output.md` (new); `verify.sh` Check 22 link-marker | PM-083 (folded) |
| M2 | Skill-level `disallowed-tools` leaks across `Skill()` chaining — removed from 6 analysis skills, restriction relocated to agents (ADR-090), `verify.sh` Check 34 **inverted** into a regression guard | `scripts/verify.sh:1413-1432`; `skills/x-troubleshoot/SKILL.md` frontmatter | PM-074 |
| M3 | Summary-before-gate — 14 skills reached `AskUserQuestion` with no findings printed first | v9.7.0 release notes; per-skill SKILL.md diffs | PM-083 |
| M4 | Campaign-activation trust boundary — trigger from the human's own message before any forge fetch; campaign state from session state only; `<UNTRUSTED-FORGE-DATA>` can never activate/claim/extend a campaign | `skills/git-pr/references/pr-fix-batch-orchestration.md` (new) | PM-084 |
| M5 | `git-pr fix` consolidation, 3-queue discovery, auto-selected issue labels, `/goal` ergonomics | v9.6.2 + v9.7.0 release notes; `skills/git-pr/` | PM-085 |

Mapping was unambiguous for M2 (existing row) and M5 (no existing row, ergonomics cluster). M1
and M3 target the same blackhole seam and were merged onto one new row rather than two — see the
M1 verdict below. No cross-cutting `rules/` change required widening the re-check to a whole
`kind` tier.

### Adoption Lens v2 verdicts

**M2 — convergent validation, no gap. PM-074 stays `covered`.** mercure's v9.7.0 fix moves hard
capability restriction *off* skills and *onto* agents (ADR-090) — the model blackhole already
had. Verified this run: `grep -rn "disallowed-tools" src/` = **0** (no skill-level restriction
exists to leak), and `scripts/checks/agents.check.ts:14-52` (`V-TOOLS-01`) already enforces the
same guard in **both** directions — implementer MUST NOT declare `disallowedTools`, read-only
agents MUST declare all three — which mercure's inverted `verify.sh` Check 34 only added in
v9.7.0. Recorded as a re-verification (`2026-07-20, v9.6.1` → `2026-07-26, v9.7.0`) with an
enriched citation, not a transition. Nothing to file.

**M1 — ADAPT, folded into M3's row (PM-083), not filed separately.** Tier-2 workflow/interaction
mechanism, so the default is ADAPT rather than reject. But blackhole has no
executive-summary-before-chaining-gate surface to host the doctrine: its human-facing output is
the `CHECKPOINT` line (schema-structured already) and the async blocked-question payload. A
standalone `efficient-output.md` port would land a rule file with a single consumer
(`V-YAGNI-03`) and a second formatting authority over the same seam (`V-INT-02`). The
transferable subset — action-first, precise counts, explicit "+N more" truncation, no
preamble/closers — is adopted **inside** PM-083's payload contract. This is a fold, not a
rejection: the mechanism lands, on one seam instead of two.

**M3 — ADAPT to the async seam. PM-083 `gap → in-flight(#346)`, Pareto 40.** `clarify-gates.md`
fully specifies *when* to `AskQuestion` and never *what the question must carry*; the same holds
at every call site, with `epic-orchestration.md:53` the sole self-contained precedent. The
failure mode is **worse in blackhole than upstream**: mercure's gate is synchronous, so even an
unprinted summary leaves the user with session scrollback; blackhole's is deliberately async
(`orchestrator.md:366-371`), answered possibly in a different session with no scrollback at all,
and a stall burns the Blocked-Iteration Counter to escalation at 3. Hard rejection #1 does **not**
fire — this is explicitly not an import of mercure's `AskUserQuestion` primitive; the sync/async
split is untouched and only the payload's self-containedness changes.

**M4 — ADOPT. PM-084 `gap → in-flight(#345)`, Pareto 42.** Tier-1 enforcement mechanism.
Blackhole's untrusted-data rule is one line (`forge-sync.md:252-262`) with partial call-site
coverage, and it misses the highest-leverage surface: `src/agents/router.md` has **zero**
UNTRUSTED mentions while deriving the entire `route{}` object from issue title/body/labels
(`router.md:15,82-88`), feeding the confidence kernel and `autonomy.*` — with autonomy
unconditionally active (ADR-014). The only escalate-only guard today is `V-SEC-09`, scoped to a
single flag from a single source. Lands on existing seams (`V-INT-02`): router prompt wrapping,
a generalized invariant in `forge-sync.md`, and a `V-SEC`-family row — no new agent or subsystem.

**M5 — N/A. PM-085 recorded as `N/A(...)`.** mercure-only git ergonomics for a user-facing
command blackhole has no analog of (its PR-fix flow is orchestrator-internal). Same verdict class
as Run 2's item 3. Tier-3 default N/A stands — no rebuttal clears the burden of proof. The one
transferable sub-mechanism inside the `/goal` work, the campaign-activation trust boundary, was
split out as M4/PM-084 and adopted on its own merits rather than smuggled in with the ergonomics.

### Outcome

| Row | Verdict | Issue |
|-----|---------|-------|
| PM-084 | ADOPT (Gain 6 × (11−4) = **42**) | [#345](https://github.com/CorentinLumineau/blackhole/issues/345) |
| PM-083 | ADAPT (Gain 5 × (11−3) = **40**), M1 folded in | [#346](https://github.com/CorentinLumineau/blackhole/issues/346) |
| PM-074 | covered — convergent validation, re-verified v9.7.0 | none |
| PM-085 | N/A — mercure-only git ergonomics | none |

2 issues filed, both above the `min_priority` floor (30) and within `max_issues_per_run` (5;
`.blackhole/config.json` is absent in this maintainer worktree, so the skill's defaults apply).
**Zero items withheld by the cap.** Both verified immediately before filing (`V-HUNT-01`) by
re-reading the v9.7.0 cache and the cited `src/` lines. Deduped against the 4 open issues
(#335–#337, #341 — all unrelated) and against every matrix `in-flight` ref. Watermark bumped
`v9.6.0` → `v9.7.0`.

**Observation for the next backlog-mode run** (not acted on here — release mode re-verifies only
touched rows): the five `in-flight` refs from Runs 3–4 (#306, #308, #309, #310, #311) are all
**CLOSED** on the forge. Those rows are candidates for an `in-flight → covered` transition once
re-verified against `src/`.

## Design note for future runs

- Run 2 reviewed a genuine version delta (`v9.4.0` → `v9.6.0`), both tags landing 2026-07-14.
  As in Run 1, it filed **one** Pareto-qualifying item and explicitly recorded the REJECT
  (browser-automation UX swarm) so a future run doesn't re-surface it as a "new" gap.
- The watermark is now `v9.7.0` (the latest tag, Run 5). With no version delta outstanding, the
  next run should be **backlog mode** against the live parity matrix. Two candidate targets:
  (a) re-verify the five closed `in-flight` refs from Runs 3–4 (#306, #308–#311) for an
  `in-flight → covered` transition, which is cheap matrix-accuracy work; (b) the top remaining
  `gap` cluster at priority 36 (PM-039, PM-048, PM-055, PM-063).
- Run 5 is the first run where a mercure change landed as **convergent validation** rather than a
  gap — mercure's ADR-090 `disallowed-tools` fix moved upstream *toward* a model blackhole
  already had, guard included. Worth recording explicitly: the matrix's value is not only finding
  what blackhole lacks but confirming where it was already right, so a later run does not
  re-open a settled row as a "new" upstream mechanism.
