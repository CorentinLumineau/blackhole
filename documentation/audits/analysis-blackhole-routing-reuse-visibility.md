---
type: analysis
summary: "Routing visibility and Reuse Check gate analysis feeding ADR-008"
skill: x-analyze
created: 2026-07-13
target: "blackhole plugin — V-INT reuse enforcement, routing status visibility, wave monitoring"
status: draft
review_trigger: "on ADR acceptance"
---

# Analysis — Blackhole routing, reuse enforcement & wave visibility

## Scope & method

Focused analysis of three user concerns against the blackhole plugin source
(`src/agents/*.md`, `src/references/*.md`, `scripts/campaign-status.ts`):

1. **Enforce leveraging existing code** (V-INT / integration coherence)
2. **Routing status visibility** — surface which issues need research / design / plan
3. **Wave monitoring & "best path" assurance** — prove every issue traversed its intended chain

The generic 4-domain swarm (security / performance / SOLID / arch) was **not** run:
the target is a Markdown-agent plugin where those domains are low-signal. Integration
coherence and status-surface analysis carry all the value here and are covered in depth.

> Reminder for any follow-up fix: `.claude/**` files are **build outputs** of `src/**`
> (`bun run build`). Edit `src/` and rebuild — never hand-edit `.claude/`. This is itself
> a codebase convention the fix must respect (V-INT-01).

## Findings

| ID | Concern | Severity | Summary |
|----|---------|----------|---------|
| A1 | Reuse | HIGH | Reuse enforced only reactively — no proactive "search-before-write" or reuse catalog for Quick-track issues |
| A2 | Reuse | MEDIUM | Reviewer's V-INT-02 audit has no plan-provided baseline of existing utilities; must rediscover by live grep every time |
| A3 | Reuse | MEDIUM | V-INT-01/03/04 silently no-op when `Codebase Conventions` = `(none declared)`; no live-search fallback mandate |
| B1 | Visibility | HIGH | `route{}` is persisted but invisible — `campaign-status.ts` omits `route`; dashboard has no routing section |
| B2 | Visibility | MEDIUM | Per-issue view shows only phase+status — not the route path or confidence scores |
| C1 | Wave | HIGH | Wave computation logs `WAVE <N>` to orchestrator logs only; never surfaced in the dashboard |
| C2 | Wave | MEDIUM | No planned-vs-actual "best path" traversal record; can't verify e.g. a security issue got security-mode review |
| C3 | Wave | MEDIUM | Routing is latent — every live-queue issue still falls through the "void route" fallback (never re-triaged) |

### Concern A — Enforce leveraging existing code (V-INT)

**A1 (HIGH) — Reuse is reactive, not proactive.**
The `implementer` agent is never told to search the codebase for existing utilities before
writing. `grep` of `src/agents/implementer.md` finds only "run the project's test suite"
(implementer.md:36) — no reuse scan. It relies entirely on the `Codebase Conventions`
injected via `<PLAN_CONTEXT>`, but that section is produced **only by the Standard track**
(planner.md:53–57). The Quick track's sections (planner.md:40–51) contain no
`## Codebase Conventions`, so the orchestrator injects `(none declared)`
(orchestrator.md:133–134). Result: for the majority of small issues, reuse is enforced
*after* the code is written, when the `reviewer` catches V-INT-02 (reviewer.md:45). There is
no equivalent of mercure `x-analyze`'s Integration-Coherence agent that catalogs reuse
candidates up front.

**A2 (MEDIUM) — Reviewer has no reuse baseline.**
`reviewer.md:45` audits V-INT-02 ("no utility re-implementation") but the injected
PLAN_CONTEXT only carries `Touch-Paths` + `Codebase Conventions` — never a list of the
existing utilities the issue *should* be calling. The reviewer must rediscover them by live
grep on every PR: expensive, non-deterministic, and easy to miss.

**A3 (MEDIUM) — Convention checks silently no-op.**
V-INT-02 is BLOCK, but V-INT-01/03/04 are WARN and gated on the `Codebase Conventions`
section being present (reviewer.md:44–46). When it is `(none declared)` (every Quick-track
issue — see A1), the reviewer's §5 conventions check has nothing to compare against and
silently passes. mercure `x-review` handles this with a mandated live Grep/Glob fallback;
blackhole has no such fallback, so convention drift on small issues is structurally invisible.

### Concern B — Routing status visibility

**B1 (HIGH) — The route object is persisted but undisplayable.**
`router` computes and persists a full `route{}` per issue (router.md, queue-dag.md §route),
but `scripts/campaign-status.ts` cannot show it: the `QueueIssue` type (lines 8–17) omits
`route`, and `formatDashboard` (lines 107–224) never reads any route flag. The
coordinator dashboard's 9 sections (coordinator-dashboard.md:31–43) contain no routing view.
The user's literal ask — *"know which one needs more research, design, plan"* — is
unsupported today. All routing intelligence exists in state but is invisible in chat.

**B2 (MEDIUM) — No path or confidence surface.**
Even where surfaced, per-issue rows show only `phase` + `status`. They do not show the
computed path (`needs_research`, `needs_investigation`, `needs_design`, `plan_mode`,
`security_review_required`) nor the `confidence.{split,design,plan_mode,security}` scores.
A user cannot tell a confident classification from a low-confidence cautious default.

### Concern C — Wave monitoring & "best path" assurance

**C1 (HIGH) — Waves are log-only.**
`queue-dag.md` Step 4 computes execution waves and logs `WAVE <N>: issues [...]` to the
orchestrator's turn log — never to the dashboard. The user wants to monitor *"during wave
implementation … that we are properly passing on all steps for all issues."* There is no
wave section, no per-wave progress, and no per-issue chain-step view in the status surface.

**C2 (MEDIUM) — No planned-vs-actual "best path" audit.**
Route flags drive dispatch (orchestrator.md:55–101), but nothing records or displays the
actual path an issue took versus the path its route computed — e.g. did a
`security_review_required: true` issue actually receive a security-mode review? The
`route.revision` and `route.computed_at_phase` fields exist to support exactly this
traceability but no status surface consumes them. *"Ensure every issue is implemented by the
best path"* has no verification artifact.

**C3 (MEDIUM) — Routing is currently latent.**
queue-dag.md:86–94 admits every issue in today's live queue still falls through the
"void route" fallback (`plan_mode: full`), because no issue has re-entered Handle since the
`router` agent landed (PR #118). So the "best path" logic exists but is not exercised on the
current backlog — a rollout/wiring gap, not just a display gap. Any monitoring work should
also confirm the router actually re-triages the standing queue.

## Convention Catalog (existing patterns the fix must reuse — V-INT-02)

| Touchpoint | Convention | Pattern | Source file:line |
|------------|------------|---------|------------------|
| Dashboard rendering | Single formatter, pure function, markdown lines[] | `formatDashboard()` | scripts/campaign-status.ts:107 |
| Queue row typing | `QueueIssue` type mirrors queue.json fields | type decl | scripts/campaign-status.ts:8 |
| Route schema (SSOT) | `route{}` field names/enums frozen | queue-dag.md § `route` object | src/references/queue-dag.md:52 |
| Route thresholds | `router_confidence_thresholds` per flag | config | src/references/config-template.md:21 |
| Reuse baseline (Standard only) | `## Codebase Conventions` in plan → PLAN_CONTEXT | planner→orchestrator | planner.md:57 / orchestrator.md:133 |
| Dashboard print policy | When/what to print (SSOT) | coordinator-dashboard.md | src/references/coordinator-dashboard.md:17 |

Any fix must extend these existing surfaces (the formatter, the `QueueIssue` type, the route
SSOT), not build parallel ones (V-INT-02 / V-DRY-01).

## Top 3 recommendations (Pareto)

1. **Surface routing + waves in the dashboard.** Add `route` to `QueueIssue`, and add a
   **Routing** section (path + confidence per issue) and a **Waves** section to
   `formatDashboard()`; document both in coordinator-dashboard.md. *Directly answers B1, B2,
   C1.* — effort: low–medium (one script + one reference), highest value.
2. **Make reuse proactive.** Require the planner to emit a lightweight reuse section
   (`## Codebase Conventions` or `## Reuse Candidates`) for **all** tracks incl. Quick; add an
   implementer "search-before-write" step; add a reviewer live-grep fallback when Conventions
   = `(none declared)`. *Addresses A1, A2, A3.* — effort: medium.
3. **Best-path traversal record.** Persist planned-vs-actual chain steps per issue (reuse
   `route.revision` / `computed_at_phase`) and show a per-issue path-completion column;
   confirm the router re-triages the standing queue. *Addresses C2, C3.* — effort: medium.

## Next step

These are directions, not a design. Recommend `/x-design` to weigh the dashboard-schema and
planner-reuse-gate trade-offs (an ADR is warranted for the reuse-gate change since it touches
the planner→implementer→reviewer contract), then `/x-plan`.
