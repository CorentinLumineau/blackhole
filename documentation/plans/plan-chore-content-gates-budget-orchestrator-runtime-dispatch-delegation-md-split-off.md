---
type: plan
summary: "Content-gate budget rows for the three orchestrator split-off files, seeded at measured × 1.2"
status: current
review_trigger: "on ADR acceptance"
created: 2026-09-02
last_updated: 2026-09-02
related:
  - documentation/plans/plan-retrospective-v0.21.0-remediation.md
---

# Plan — Issue #705: budget the three orchestrator split-off files in CONTENT_GATE_BUDGETS

## Objective

`CONTENT_GATE_BUDGETS` in `scripts/lib/build/facts.ts` has no entry for
`src/references/orchestrator-dispatch.md`, `src/references/orchestrator-runtime.md`, or
`src/references/orchestrator-delegation.md` — the three files issue #408 split out of
`src/agents/orchestrator.md`. They have grown ungated ever since. Seed all three at measured ×
1.2 (the same policy every other row already follows), extend the `facts.ts` measurement-table
comment, and extend `scripts/verify.content-gates.test.ts` to cover the new rows. Do not touch
any existing budget value (R-02, part of the v0.21.0 retrospective remediation epic #703).

## Touch-Paths

- `scripts/lib/build/facts.ts`
- `scripts/verify.content-gates.test.ts`
- plus all generated dist trees per `scripts/lib/build/targets.ts` — this PR does not touch
  `src/**` prose or templates, only `scripts/**`, so no regenerated tree output is expected; the
  `bun run build` step in Execution Strategy below is a verification no-op check, not an expected
  diff.

## Codebase Conventions

Follow the existing `CONTENT_GATE_BUDGETS` seeding convention verbatim (`facts.ts:73-117`, doc
comment lines 79-104): each row is `{ maxSectionLoc, maxFileLoc }`, seeded at *current measured
value × 1.2, rounded up*, sourced from `parseSectionLineCounts` (default `/^## /` boundary,
`scripts/checks/content-gates.check.ts`) for `maxSectionLoc` and total non-trailing-newline line
count for `maxFileLoc`. Do not introduce a new measurement method or a differently-shaped row —
this is a pure data-table extension of an existing, working pattern (V-INT-01/V-INT-03).

Measured at base commit `100b812455d171c7b27bd9a8b09cb9525306b13a` (re-derive at implement time
per Ground rule 7 — do not copy these numbers if the base commit has moved):

| File | Metric | Measured | × 1.2 seed (rounded up) |
|---|---|---:|---:|
| `src/references/orchestrator-dispatch.md` | max `##` section LOC | 49 | 59 |
| `src/references/orchestrator-dispatch.md` | total file LOC | 333 | 400 |
| `src/references/orchestrator-runtime.md` | max `##` section LOC | 130 | 156 |
| `src/references/orchestrator-runtime.md` | total file LOC | 202 | 243 |
| `src/references/orchestrator-delegation.md` | max `##` section LOC | 177 | 213 |
| `src/references/orchestrator-delegation.md` | total file LOC | 177 | 213 |

(`orchestrator-delegation.md`'s single `## 5-Field Delegation Contract` heading sits on line 1,
so its one section spans the whole file — max-section and total-file LOC are numerically equal;
this is expected, not a measurement error.)

## Task Steps

1. Add three `CONTENT_GATE_BUDGETS` rows to `scripts/lib/build/facts.ts` (append only; no
   existing row changes) — `orchestrator-dispatch.md: {59, 400}`, `orchestrator-runtime.md:
   {156, 243}`, `orchestrator-delegation.md: {213, 213}` (re-measured values, per the table
   above, re-derived if the implement-time base commit has moved).
2. Extend the `facts.ts` measurement-table comment with the three files' measured/seed rows.
3. Extend `scripts/verify.content-gates.test.ts`'s `'covers exactly the 8 declared keys'` test to
   11 keys, adding the three new paths.
4. Run `bun test scripts/verify.content-gates.test.ts` — 0 fail.
5. `bun run build` (expect no dist-tree diff — `scripts/**`-only change) then `bun run verify` —
   `V-CONTENTGATE-01`/`02` both `ok`.

## Execution Strategy & Stop Conditions

- Re-measure at the implementer's actual base commit; if a re-measured value would force an
  already-passing existing row to fail, halt and report rather than widening that row.
- A failing `verify.content-gates.test.ts` after correctly-seeded rows means the measurement was
  wrong — halt and report, do not adjust numbers to force a pass.
- Any dist-tree diff from `bun run build` signals an out-of-scope edit — halt and report.

## Sprint Contract

| Task | AC |
|---|---|
| 1. Add three `CONTENT_GATE_BUDGETS` rows | 3 new keys present; 8 pre-existing entries unchanged |
| 2. Extend measurement-table comment | 3 files × 2 rows added |
| 3. Extend declared-keys test to 11 | Test asserts 11 keys, including the 3 new paths |
| 4. Zero-false-positive verification | `bun test scripts/verify.content-gates.test.ts` → 0 fail |
| 5. Full verification pass | `bun run verify` → `V-CONTENTGATE-01`/`02` both `ok`; no dist-tree diff |
