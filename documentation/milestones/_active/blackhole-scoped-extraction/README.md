---
type: milestone
status: current
created: 2026-07-06
last_updated: 2026-07-06
related:
  - documentation/architecture/retrospective-blackhole.md
  - documentation/audits/architecture-coherence.md
review_trigger: "on milestone completion"
---

# Initiative: blackhole-scoped-extraction

**Type**: Refactor
**Priority**: 1
**Depends on**: none
**Related to**: none
**Source**: `documentation/architecture/retrospective-blackhole.md` (x-rearchitect retrospective, 2026-07-06)

## Goal

Implement the "Scoped Extraction" redesign adopted in the architectural retrospective: extract
two small, single-purpose modules out of `scripts/build.ts` and `scripts/verify.ts` to close
two confirmed anti-patterns (a 6-site hardcoded project-identity string, and duplicated
tree-shape validation logic) — without adopting the full `PlatformTarget` interface redesign,
which two independent adversarial critics rated as introducing disproportionate new risk
(ISP violation, premature abstraction over inverted invariants, import fan-out) for a
single-maintainer, zero-incident codebase.

## Why This Initiative Exists

The retrospective found `scripts/build.ts` had a CRITICAL SRP violation (598 LOC, 22 functions,
10 responsibility clusters) — but git history showed the codebase has had **zero drift
incidents in 50 commits** and a healthy 53% test-LOC ratio. So the "obvious" fix (a full
`PlatformTarget` interface, one module per platform) was adversarially critiqued by two
independent reviewers before being adopted. Both, independently, found it introduced *new* risks
that don't exist today: an ISP violation (an interface member only some implementers use), a
premature abstraction (only 2 data points — Gemini workspace vs. distribution bundle — and they
already have *inverted* invariants: 5 agents required vs. 0), and a 0→5 import fan-out into
`verify.ts`. Both critics converged on the same narrower fix instead — this initiative.

Each milestone below traces to a specific, historically-costly problem, not a hypothetical one:

| Milestone | Problem it fixes | Evidence it's real (not theoretical) |
|-----------|-------------------|----------------------------------------|
| **M1** — Identity SSOT | The project's name/description is hardcoded as a literal string in ~6 places in `build.ts`, despite `package.json`'s `name` field already being available and unused for this purpose. | The project has been renamed **twice** in its git history (`bc-campaign` → `backlog-campaign` → `blackhole`), costing ≥6 dedicated cleanup commits *each time* because there was no single source of truth to edit. |
| **M2** — Tree-Shape SSOT | `build.ts` and `verify.ts` each independently implement "what does a valid compiled tree look like" for the same 3 platform trees (`assertGeminiTree`/`assertDistributionTree`/`assertCodexTree` vs. `validatePluginTreeShape`/`checkGeminiBuild`/`checkCodexBuild`) — duplicated logic that can silently drift out of sync. | Confirmed via direct code read (Phase 1 audit) — not a hypothetical DRY nitpick; the two implementations already differ in return style (throw vs. `string[]`/`CheckResult`). |
| **M3** — Governance & Cleanup | Three small, independently-confirmed loose ends: no `documentation/decisions/INDEX.md` (V-ADA-02), an orphaned reference doc (`agent-tools.md`, cited nowhere except a stale inventory line), and an unconditional cross-platform reference in `coordinator.md` that will 404 on 4 of 5 compiled targets. | All three confirmed by direct grep/read during milestone planning (not carried over unverified from the retrospective) — the `agent-tools.md` "zero citations" claim was even refined mid-planning (it turned out to have one cosmetic listing, now folded into the task). |

**What this initiative deliberately does NOT do**: fix the platform-add extensibility problem
(adding a 6th platform still costs the same ~150–200 LOC bolted into `build.ts` either way). That
was the actual justification for the original, more ambitious redesign — it remains open,
on purpose, until a 6th platform is actually proposed (see Key Constraints below).

## Milestone Summary

| # | Name | Value | Effort | Status | Deployable |
|---|------|-------|--------|--------|------------|
| M1 | Identity SSOT (`project-identity.ts`) | 45% | 25% | **Completed** (2026-07-06) | Yes |
| M2 | Tree-Shape SSOT (`tree-shape.ts`) | 35% | 45% | Planned | Yes |
| M3 | Governance & Cleanup | 20% | 15% | Planned | Yes |

## Dependency Graph

All three milestones are independent — no ordering constraint. M1 is the highest-ROI single
change (ratio 3.5 in the retrospective's Top-5 table) and is the recommended starting point,
but M2 and M3 can proceed in parallel or in any order.

```mermaid
graph LR
    M1[M1: project-identity.ts] -.->|independent| M2[M2: tree-shape.ts]
    M2 -.->|independent| M3[M3: Governance & Cleanup]
```

## Current Focus

**M1 completed 2026-07-06.** Next: **M2: Tree-Shape SSOT** — no dependency on M1, can start
immediately.

## Key Constraints Carried From the Retrospective

- Preserve the intentional 5-agents-required vs. 0-agents-required inversion between the Gemini
  workspace tree and the distribution bundle tree (`M2`) — do not generalize into one function.
- Do not touch the 3 hidden `spawnSync('bun run build')` runtime-coupling channels in
  `verify.ts` — explicitly out of scope for this initiative.
- Do not adopt a formal `PlatformTarget` interface or a `platforms/` module split — deferred per
  the retrospective's revisit condition (a 6th platform target proposed, or `build.ts` growing
  past ~750 LOC / a new responsibility cluster).
- `bun run build && bun run verify && bun test` must pass identically after every milestone —
  these are structural extractions, not behavior changes.
