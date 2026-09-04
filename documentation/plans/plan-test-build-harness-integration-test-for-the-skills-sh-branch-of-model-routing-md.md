---
type: plan
summary: "skills.sh-target integration test for model-routing.md's per-role tier resolution, closing the self-declared Unverified note"
status: current
review_trigger: "on ADR acceptance"
created: 2026-09-02
last_updated: 2026-09-02
related:
  - documentation/plans/plan-retrospective-v0.21.0-remediation.md
---

# Plan - Issue #713

## Objective
Add a build-harness integration test that compiles `src/references/model-routing.md` for the
`skills` platform target and asserts the `{{#skills}}` block resolves correctly alongside the
host-agnostic per-role tier tables, then replace the "Unverified" note at
`model-routing.md:171-173` with a citation to that test — closing R-20 of
`documentation/plans/plan-retrospective-v0.21.0-remediation.md`.

## Touch-Paths
- `scripts/build.test.ts`
- `src/references/model-routing.md`, plus all generated dist trees per
  `scripts/lib/build/targets.ts`

## Documentation Impact
`src/references/model-routing.md`'s `{{#skills}}` block prose changes (the "Unverified" sentence
is replaced by a test citation) — this is the Touch-Paths file itself. No other companion doc is
affected.

## Task Breakdown
- [ ] Write a test in `scripts/build.test.ts` (inside the existing
  `describe('applyPlatformConditionals', ...)` block) that reads `src/references/model-routing.md`
  from disk, calls `applyPlatformConditionals(source, 'skills')`, and asserts: the `{{#skills}}`
  block resolved (`### skills.sh / generic`, `No fixed slug list`); the other four `{{#host}}`
  blocks were stripped; the host-agnostic `Base tier by role and track` table's per-role rows
  (`router`, `planner` + `track: design`, `implementer`, `reviewer`) survive unchanged.
- [ ] Replace the "Unverified until a harness integration test exists" sentence in
  `model-routing.md`'s `{{#skills}}` block with a citation to the new test.
- [ ] `bun run build` — verify only `model-routing.md`'s generated mirrors change.
- [ ] `bun test scripts/build.test.ts` and `bun run verify` green.
