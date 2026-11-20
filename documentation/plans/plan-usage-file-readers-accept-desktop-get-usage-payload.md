---
type: plan
summary: "Make usage.ts, pace-floor.ts and usage-budget.ts file readers accept the desktop get_usage payload via one shared converter reused by usage-probe.ts"
status: current
review_trigger: "on file change"
created: 2026-11-20
last_updated: 2026-11-20
---

# Plan: usage file readers accept the desktop get_usage payload (issue 1361)

See the working plan at `.blackhole/plans/issue-1361.md` for scope; this durable copy carries the same objective.

## Objective
`usage.ts --usage`, `pace-floor.ts --usage` and `usage-budget.ts --usage-file` accept the raw desktop `get_usage` payload exactly as `usage-probe.ts --from-ccd-usage` does, through one shared row converter in `scripts/lib/usage-normalize.ts`; `phase-catchup.md` step 2 and `run-context.md` state it.

## Touch-Paths
- `scripts/lib/usage-normalize.ts`, `scripts/lib/usage-normalize.test.ts`
- `scripts/usage-probe.ts`
- `scripts/usage.test.ts`, `scripts/pace-floor.test.ts`, `scripts/usage-budget.test.ts`
- `src/references/phase-catchup.md`, `src/references/run-context.md`, plus all generated dist trees per `scripts/lib/build/targets.ts`
