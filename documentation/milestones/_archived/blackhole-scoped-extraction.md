---
type: milestone
status: archived
created: 2026-07-06
last_updated: 2026-07-15
archivedAt: 2026-07-15
related:
  - documentation/architecture/retrospective-blackhole.md
  - documentation/audits/architecture-coherence.md
review_trigger: "on file change"
---

# Archived Initiative: blackhole-scoped-extraction

**Status**: Complete — all 3 milestones shipped in [PR #90](https://github.com/CorentinLumineau/blackhole/pull/90) (awaiting merge at archival time)
**Type**: Refactor | **Duration**: 2026-07-06 → 2026-07-07 | **Track**: quick ×3
**Source**: x-rearchitect retrospective (`documentation/architecture/retrospective-blackhole.md`, 2026-07-06)

## Goal

Implement the "Scoped Extraction" redesign from the architectural retrospective: extract two
small single-purpose modules out of `scripts/build.ts` and `scripts/verify.ts` to close two
confirmed anti-patterns — a 6-site hardcoded project-identity string, and duplicated
tree-shape logic.

## Milestones

| # | Name | Status | Completed | Delivery |
|---|------|--------|-----------|----------|
| M1 | Identity SSOT (`project-identity.ts`) | completed | 2026-07-06 | PR #90 |
| M2 | Tree-Shape SSOT (`tree-shape.ts`) | completed | 2026-07-07 | PR #90 |
| M3 | Governance & Cleanup | completed | 2026-07-07 | PR #90 |

## Key Decisions

- **Scoped extraction over full modularization** — the retrospective explicitly rejected a
  broader restructure; only the two confirmed anti-patterns were extracted (Pareto).
- **Single bundled PR** — all 3 quick-track milestones were bundled into PR #90 at the user's
  request rather than one PR per milestone; the PR description was updated to reflect full scope.
- **Base commit `015e7cc`** stamped on all three plans for drift detection.

## Lessons Learned

- **Quick-track ×3 + bundled PR worked well** for tightly-coupled refactor milestones — review
  ran once over the coherent whole (final x-review verdict: APPROVED, no fixes needed).
- **SSOT extractions pay off immediately**: the shared `readJsonFile`/walker helpers extracted
  in this lineage were later reused by 7+ scripts (see ADR-007 R6), validating the
  one-helper-no-duplicates rule that this initiative pioneered for identity/tree-shape.
- **Registry hygiene lagged reality**: the initiative sat `in_progress` in
  `_registry.json` for a week after completion because archival wasn't run at PR-open time —
  archive (or at least mark completed) as soon as the PR is opened, not at merge.

## Key Deliverables

- `scripts/lib/project-identity.ts` — single source for project identity (was 6 hardcoded sites)
- `scripts/lib/tree-shape.ts` — shared tree-shape logic for build/verify
- Governance cleanup wiring both modules into `bun run verify`
